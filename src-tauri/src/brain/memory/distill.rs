//! 记忆凝练：把短期对话总结成"事实"条目写入长期记忆。
//!
//! 触发：每 N 轮调一次（前端定时器），或者手动 invoke。
//! 流程：取最近 K 条 messages → 喂给 LLM 让它输出 JSON 数组 →
//!       每条 fact 调 embedding → 写入 memories 表。

use crate::brain::memory::embed;
use crate::brain::providers::openai_compat::{ChatMessage, ChatOptions, LlmProvider, OpenAiCompatProvider};
use crate::infra::error::{AppError, AppResult};
use crate::AppState;
use futures_util::StreamExt;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
struct FactItem {
    kind: String, // fact / event / preference / observation
    title: String,
    content: String,
    #[serde(default = "default_importance")]
    importance: f32,
}

fn default_importance() -> f32 {
    0.5
}

#[tauri::command]
pub async fn memory_distill(
    state: State<'_, AppState>,
    look_back: Option<usize>,
) -> AppResult<usize> {
    let cfg = state.runtime_config();
    if cfg.llm_endpoint.is_empty() {
        return Err(AppError::LlmNotConfigured);
    }

    let take = look_back.unwrap_or(20).clamp(4, 80);
    let recent = state.memory().recent_messages(take)?;
    if recent.is_empty() {
        return Ok(0);
    }

    // 构造凝练 prompt
    let mut convo = String::from("以下是 master 与 TiaLynn 的最近对话：\n");
    for m in &recent {
        convo.push_str(&format!("[{}] {}\n", m.role, m.content));
    }

    let system = String::from(
        "你是一个记忆凝练助手。从给定对话里提炼出**应该长期记住**的事实、事件、偏好或观察。\
         输出严格的 JSON 数组：[{\"kind\":\"fact|event|preference|observation\",\
         \"title\":\"<不超过 20 字>\",\
         \"content\":\"<不超过 80 字>\",\
         \"importance\":0~1}]。\
         若没有值得记忆的内容，输出 []。不要任何额外解释。",
    );

    let provider = OpenAiCompatProvider::new(
        cfg.llm_endpoint.clone(),
        if cfg.llm_api_key.is_empty() {
            None
        } else {
            Some(cfg.llm_api_key.clone())
        },
    );

    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: system,
        },
        ChatMessage {
            role: "user".into(),
            content: convo,
        },
    ];
    let opts = ChatOptions {
        model: cfg.llm_model.clone(),
        temperature: 0.3,
        max_tokens: Some(800),
    };

    let mut stream = provider.chat_stream(messages, opts).await?;
    let mut raw = String::new();
    while let Some(tok) = stream.next().await {
        match tok {
            Ok(t) => raw.push_str(&t),
            Err(_) => break,
        }
    }

    let trimmed = raw.trim();
    let cleaned = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim_end_matches("```")
        .trim();
    let start = cleaned.find('[');
    let end = cleaned.rfind(']');
    let json_str = match (start, end) {
        (Some(s), Some(e)) if e > s => &cleaned[s..=e],
        _ => return Ok(0),
    };
    let items: Vec<FactItem> = serde_json::from_str(json_str).unwrap_or_default();
    if items.is_empty() {
        return Ok(0);
    }

    let memory = state.memory();
    let mut inserted = 0usize;
    for item in items {
        let emb = if !cfg.embedding_endpoint.is_empty() {
            let text_for_embed = format!("{}: {}", item.title, item.content);
            match embed::embed(
                &cfg.embedding_endpoint,
                &cfg.embedding_model,
                if cfg.llm_api_key.is_empty() {
                    None
                } else {
                    Some(&cfg.llm_api_key)
                },
                &text_for_embed,
            )
            .await
            {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!("embed for distill failed: {e}");
                    None
                }
            }
        } else {
            None
        };

        let _ = memory.insert_long_term_memory(
            &item.kind,
            &item.title,
            &item.content,
            item.importance.clamp(0.0, 1.0),
            emb.as_deref(),
        )?;
        inserted += 1;
    }
    Ok(inserted)
}
