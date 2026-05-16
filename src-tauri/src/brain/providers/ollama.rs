//! Ollama provider — 本地兜底。
//!
//! Ollama 提供两个 API：
//! - `/api/chat` 原生 NDJSON 流（这里走这个）
//! - `/v1/chat/completions` OpenAI-compat（也可以走 openai_compat provider）

use super::{ChatMessage, ChatOptions, LlmProvider, TokenStream};
use crate::infra::error::AppResult;
use async_trait::async_trait;
use futures_util::stream::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::pin::Pin;

pub struct OllamaProvider {
    pub endpoint: String, // 形如 http://127.0.0.1:11434
    pub http: reqwest::Client,
}

impl OllamaProvider {
    pub fn new(endpoint: impl Into<String>) -> Self {
        let mut endpoint = endpoint.into();
        if endpoint.is_empty() {
            endpoint = "http://127.0.0.1:11434".into();
        }
        Self {
            endpoint,
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(3))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("ollama http client"),
        }
    }
}

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
    options: OllamaOptions,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct OllamaChunk {
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    done: bool,
}

#[derive(Deserialize)]
struct OllamaMessage {
    #[serde(default)]
    content: String,
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn name(&self) -> &'static str {
        "ollama"
    }
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> AppResult<TokenStream> {
        let url = format!("{}/api/chat", self.endpoint.trim_end_matches('/'));
        let body = OllamaRequest {
            model: &opts.model,
            messages: &messages,
            stream: true,
            options: OllamaOptions {
                temperature: opts.temperature,
                num_predict: opts.max_tokens,
            },
        };

        let resp = self.http.post(&url).json(&body).send().await?.error_for_status()?;
        let byte_stream = Box::pin(resp.bytes_stream());
        let token_stream = ndjson_to_tokens(byte_stream);
        Ok(Box::pin(token_stream))
    }
}

fn ndjson_to_tokens<S>(stream: S) -> impl Stream<Item = AppResult<String>>
where
    S: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    use futures_util::stream;
    let it: Pin<Box<dyn Stream<Item = AppResult<String>> + Send>> = Box::pin(stream::unfold(
        (stream, String::new()),
        |(mut s, mut buf)| async move {
            loop {
                if let Some(end) = buf.find('\n') {
                    let line: String = buf.drain(..=end).collect();
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(chunk) = serde_json::from_str::<OllamaChunk>(line) {
                        if let Some(msg) = chunk.message {
                            if !msg.content.is_empty() {
                                return Some((Ok(msg.content), (s, buf)));
                            }
                        }
                        if chunk.done {
                            return None;
                        }
                    }
                    continue;
                }
                match s.next().await {
                    Some(Ok(bytes)) => buf.push_str(&String::from_utf8_lossy(&bytes)),
                    Some(Err(e)) => return Some((Err(e.into()), (s, buf))),
                    None => return None,
                }
            }
        },
    ));
    it
}
