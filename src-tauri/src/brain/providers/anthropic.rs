//! Anthropic Claude provider — Messages API 流式 + 预留 tool_use 支持。
//!
//! 不通过 OpenAI 兼容层（虽然 Anthropic 也提供 OpenAI-compat endpoint），
//! 直接走原生 `messages` endpoint 以便后续 M4 接入 tool_use。

use super::{ChatMessage, ChatOptions, LlmProvider, TokenStream};
use crate::infra::error::{AppError, AppResult};
use async_trait::async_trait;
use futures_util::stream::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::pin::Pin;

pub struct AnthropicProvider {
    pub endpoint: String, // 默认 https://api.anthropic.com
    pub api_key: Option<String>,
    pub anthropic_version: String,
    pub http: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(endpoint: impl Into<String>, api_key: Option<String>) -> Self {
        let mut endpoint = endpoint.into();
        if endpoint.is_empty() {
            endpoint = "https://api.anthropic.com".into();
        }
        Self {
            endpoint,
            api_key,
            anthropic_version: "2023-06-01".into(),
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("anthropic http client"),
        }
    }
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    temperature: f32,
    stream: bool,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum SseEvent {
    MessageStart {
        #[allow(dead_code)]
        message: serde_json::Value,
    },
    ContentBlockStart {
        index: u32,
        content_block: ContentBlock,
    },
    ContentBlockDelta {
        index: u32,
        delta: BlockDelta,
    },
    ContentBlockStop {
        index: u32,
    },
    MessageDelta {
        #[allow(dead_code)]
        delta: serde_json::Value,
    },
    MessageStop,
    Ping,
    Error {
        error: serde_json::Value,
    },
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum ContentBlock {
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum BlockDelta {
    TextDelta { text: String },
    #[serde(other)]
    Other,
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn name(&self) -> &'static str {
        "anthropic"
    }
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> AppResult<TokenStream> {
        // Anthropic Messages API：system 单独传，其他作为 messages
        let mut system_buf = String::new();
        let mut user_assistant_messages: Vec<AnthropicMessage> = Vec::new();
        for m in &messages {
            match m.role.as_str() {
                "system" => {
                    if !system_buf.is_empty() {
                        system_buf.push_str("\n\n");
                    }
                    system_buf.push_str(&m.content);
                }
                role @ ("user" | "assistant") => {
                    user_assistant_messages.push(AnthropicMessage {
                        role,
                        content: &m.content,
                    });
                }
                _ => {}
            }
        }

        let url = format!("{}/v1/messages", self.endpoint.trim_end_matches('/'));
        let body = AnthropicRequest {
            model: &opts.model,
            max_tokens: opts.max_tokens.unwrap_or(1024),
            temperature: opts.temperature,
            stream: true,
            messages: user_assistant_messages,
            system: if system_buf.is_empty() {
                None
            } else {
                Some(&system_buf)
            },
        };

        let api_key = self
            .api_key
            .clone()
            .ok_or_else(|| AppError::Other("Anthropic API key 未配置".into()))?;
        if api_key.is_empty() {
            return Err(AppError::Other("Anthropic API key 为空".into()));
        }

        let resp = self
            .http
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", &self.anthropic_version)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let byte_stream = Box::pin(resp.bytes_stream());
        let token_stream = sse_to_tokens(byte_stream);
        Ok(Box::pin(token_stream))
    }
}

/// Anthropic SSE 事件解析：把 content_block_delta::text_delta 抽出来。
fn sse_to_tokens<S>(stream: S) -> impl Stream<Item = AppResult<String>>
where
    S: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    use futures_util::stream;
    let buf_state: Pin<Box<dyn Stream<Item = AppResult<String>> + Send>> = Box::pin(
        stream::unfold((stream, String::new(), String::new()), |(mut s, mut buf, mut event)| async move {
            loop {
                // 解析一个完整事件（空行结束）
                if let Some(end) = buf.find("\n\n") {
                    let chunk: String = buf.drain(..end + 2).collect();
                    // chunk 形如 "event: foo\ndata: {...}\n\n"
                    let mut data_line = String::new();
                    for line in chunk.lines() {
                        if let Some(rest) = line.strip_prefix("event:") {
                            event = rest.trim().to_string();
                        } else if let Some(rest) = line.strip_prefix("data:") {
                            data_line = rest.trim().to_string();
                        }
                    }
                    if data_line.is_empty() {
                        continue;
                    }
                    // 解析 JSON
                    if let Ok(ev) = serde_json::from_str::<SseEvent>(&data_line) {
                        if let SseEvent::ContentBlockDelta { delta, .. } = ev {
                            if let BlockDelta::TextDelta { text } = delta {
                                if !text.is_empty() {
                                    return Some((Ok(text), (s, buf, event)));
                                }
                            }
                        }
                    }
                    continue;
                }

                match s.next().await {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    Some(Err(e)) => return Some((Err(e.into()), (s, buf, event))),
                    None => return None,
                }
            }
        }),
    );
    buf_state
}
