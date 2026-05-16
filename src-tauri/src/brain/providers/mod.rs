//! LLM Provider 抽象。统一接口，让 chat 流程不关心是 Claude / Ollama / OpenAI-compat。

use crate::infra::error::AppResult;
use async_trait::async_trait;
use futures_util::stream::BoxStream;
use serde::{Deserialize, Serialize};

pub mod anthropic;
pub mod ollama;
pub mod openai_compat;

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

    fn name(&self) -> &'static str;
}

/// 根据 provider 字符串选用具体实现。
///
/// - "anthropic" / "claude" → Anthropic Claude API
/// - "ollama"               → Ollama 本地
/// - 其他（默认）           → OpenAI-compat
pub fn build_provider(
    provider: &str,
    endpoint: &str,
    api_key: Option<String>,
) -> Box<dyn LlmProvider> {
    match provider.to_lowercase().as_str() {
        "anthropic" | "claude" => Box::new(anthropic::AnthropicProvider::new(
            endpoint.to_string(),
            api_key,
        )),
        "ollama" => Box::new(ollama::OllamaProvider::new(endpoint.to_string())),
        _ => Box::new(openai_compat::OpenAiCompatProvider::new(
            endpoint.to_string(),
            api_key,
        )),
    }
}
