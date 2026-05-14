use crate::error::AppResult;
use async_trait::async_trait;
use futures_util::stream::{BoxStream, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub model: String,
    pub temperature: f32,
    pub max_tokens: Option<u32>,
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            model: "default".into(),
            temperature: 0.85,
            max_tokens: Some(512),
        }
    }
}

pub type TokenStream = BoxStream<'static, AppResult<String>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> AppResult<TokenStream>;
}

/// OpenAI-compatible 流式 chat completions 客户端。
/// 覆盖 vLLM / LM Studio / Ollama (with /v1) / OpenAI 本身。
pub struct OpenAiCompatProvider {
    pub endpoint: String, // 形如 http://192.168.71.100:1234/v1
    pub api_key: Option<String>,
    pub http: reqwest::Client,
}

impl OpenAiCompatProvider {
    pub fn new(endpoint: impl Into<String>, api_key: Option<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            api_key,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("build http client"),
        }
    }
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    temperature: f32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct ChatStreamChunk {
    choices: Vec<ChatStreamChoice>,
}
#[derive(Deserialize)]
struct ChatStreamChoice {
    #[serde(default)]
    delta: ChatStreamDelta,
}
#[derive(Deserialize, Default)]
struct ChatStreamDelta {
    #[serde(default)]
    content: Option<String>,
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> AppResult<TokenStream> {
        let url = format!("{}/chat/completions", self.endpoint.trim_end_matches('/'));
        let body = ChatRequest {
            model: &opts.model,
            messages: &messages,
            temperature: opts.temperature,
            stream: true,
            max_tokens: opts.max_tokens,
        };

        let mut req = self.http.post(&url).json(&body);
        if let Some(k) = &self.api_key {
            if !k.is_empty() {
                req = req.bearer_auth(k);
            }
        }

        let resp = req.send().await?.error_for_status()?;
        let byte_stream = Box::pin(resp.bytes_stream());
        let token_stream = sse_to_tokens(byte_stream);
        Ok(Box::pin(token_stream))
    }
}

/// 把字节流解析成 SSE data: chunks → 抽出 delta.content。
fn sse_to_tokens<S>(stream: S) -> impl Stream<Item = AppResult<String>>
where
    S: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    use futures_util::stream;
    let buf_state: Pin<Box<dyn Stream<Item = AppResult<String>> + Send>> = Box::pin(
        stream::unfold((stream, String::new()), |(mut s, mut buf)| async move {
            loop {
                if let Some(line_end) = buf.find('\n') {
                    let line: String = buf.drain(..=line_end).collect();
                    let line = line.trim();
                    if let Some(payload) = line.strip_prefix("data:") {
                        let payload = payload.trim();
                        if payload == "[DONE]" {
                            return None;
                        }
                        if payload.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<ChatStreamChunk>(payload) {
                            Ok(chunk) => {
                                if let Some(delta) = chunk
                                    .choices
                                    .into_iter()
                                    .next()
                                    .and_then(|c| c.delta.content)
                                {
                                    if !delta.is_empty() {
                                        return Some((Ok(delta), (s, buf)));
                                    }
                                }
                            }
                            Err(_) => {
                                // 解析失败：保守跳过此行
                            }
                        }
                    }
                    continue;
                }

                match s.next().await {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    Some(Err(e)) => return Some((Err(e.into()), (s, buf))),
                    None => return None,
                }
            }
        }),
    );
    buf_state
}
