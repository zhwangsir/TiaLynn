use crate::brain::memory::embed;
use crate::brain::providers::openai_compat::{ChatMessage, ChatOptions, LlmProvider, OpenAiCompatProvider};
use crate::infra::error::{AppError, AppResult};
use crate::AppState;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{Emitter, Manager, State};

#[derive(Serialize, Clone)]
pub struct ChatTokenPayload {
    pub stream_id: String,
    pub delta: String,
}

#[derive(Serialize, Clone)]
pub struct ChatEndPayload {
    pub stream_id: String,
    pub full_text: String,
    pub emotion: Option<String>,
    pub intensity: Option<f32>,
}

/// 解析 LLM 返回的 JSON 协议 `{"text":..., "emotion":..., "intensity":...}`。
/// 容错：JSON 解析失败时把 raw 当作 text，emotion=None。
fn parse_reply(raw: &str) -> (String, Option<String>, Option<f32>) {
    let trimmed = raw.trim();
    let cleaned = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim_end_matches("```")
        .trim();
    let start = cleaned.find('{');
    let end = cleaned.rfind('}');
    let candidate = match (start, end) {
        (Some(s), Some(e)) if e > s => &cleaned[s..=e],
        _ => return (raw.to_string(), None, None),
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(candidate) else {
        return (raw.to_string(), None, None);
    };
    let text = v
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let emotion = v
        .get("emotion")
        .and_then(|e| e.as_str())
        .map(|s| s.to_string());
    let intensity = v.get("intensity").and_then(|i| i.as_f64()).map(|x| x as f32);
    if text.is_empty() {
        (raw.to_string(), emotion, intensity)
    } else {
        (text, emotion, intensity)
    }
}

#[tauri::command]
pub async fn chat_send_proactive(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    hint: String,
) -> AppResult<String> {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stream_id_clone = stream_id.clone();

    let soul = state
        .soul()
        .ok_or_else(|| AppError::Other("soul not loaded".into()))?;
    let emotion = state.emotion();
    let cfg = state.runtime_config();
    let mut system_prompt =
        soul.build_system_prompt(&emotion, None, Some(cfg.flip_probability));
    system_prompt.push_str("\n\n## 本轮特殊指令\n");
    system_prompt.push_str(&hint);

    let history = state.memory().recent_messages(20)?;
    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];
    for m in history {
        messages.push(ChatMessage {
            role: m.role,
            content: m.content,
        });
    }

    if cfg.llm_endpoint.is_empty() {
        return Err(AppError::LlmNotConfigured);
    }
    let provider = OpenAiCompatProvider::new(
        cfg.llm_endpoint.clone(),
        if cfg.llm_api_key.is_empty() {
            None
        } else {
            Some(cfg.llm_api_key.clone())
        },
    );
    let opts = ChatOptions {
        model: cfg.llm_model.clone(),
        temperature: 0.95,
        max_tokens: Some(220),
    };

    let memory = state.memory_arc();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut raw = String::new();
        match provider.chat_stream(messages, opts).await {
            Ok(mut stream) => {
                while let Some(t) = stream.next().await {
                    match t {
                        Ok(piece) => {
                            raw.push_str(&piece);
                            let _ = app_handle.emit(
                                "chat::token",
                                ChatTokenPayload {
                                    stream_id: stream_id_clone.clone(),
                                    delta: piece,
                                },
                            );
                        }
                        Err(_) => break,
                    }
                }
            }
            Err(e) => {
                tracing::warn!("proactive chat_stream open failed: {e}");
            }
        }

        let (text, emotion, intensity) = parse_reply(&raw);
        if !text.is_empty() {
            let _ = memory.append_message("assistant", &text, emotion.as_deref());
        }
        let _ = app_handle.emit(
            "chat::end",
            ChatEndPayload {
                stream_id: stream_id_clone,
                full_text: text,
                emotion,
                intensity,
            },
        );
    });

    Ok(stream_id)
}

#[tauri::command]
pub async fn chat_send(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message: String,
) -> AppResult<String> {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stream_id_clone = stream_id.clone();

    let soul = state
        .soul()
        .ok_or_else(|| AppError::Other("soul not loaded".into()))?;
    let emotion = state.emotion();
    let cfg = state.runtime_config();

    // 长期记忆召回（若配置了 embedding endpoint）
    let recalled_summary = if !cfg.embedding_endpoint.is_empty() {
        match embed::embed(
            &cfg.embedding_endpoint,
            &cfg.embedding_model,
            if cfg.llm_api_key.is_empty() {
                None
            } else {
                Some(&cfg.llm_api_key)
            },
            &message,
        )
        .await
        {
            Ok(q_emb) => {
                let top = state.memory().recall_similar(&q_emb, 3).unwrap_or_default();
                if top.is_empty() {
                    None
                } else {
                    let lines: Vec<String> = top
                        .iter()
                        .map(|m| format!("- [{}] {}: {}", m.kind, m.title, m.content))
                        .collect();
                    Some(lines.join("\n"))
                }
            }
            Err(e) => {
                tracing::debug!("embedding recall skipped: {e}");
                None
            }
        }
    } else {
        None
    };

    let system_prompt = soul.build_system_prompt(
        &emotion,
        recalled_summary.as_deref(),
        Some(cfg.flip_probability),
    );

    let history = state.memory().recent_messages(20)?;
    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];
    for m in history {
        messages.push(ChatMessage {
            role: m.role,
            content: m.content,
        });
    }
    messages.push(ChatMessage {
        role: "user".into(),
        content: message.clone(),
    });

    state
        .memory()
        .append_message("user", &message, Some(&emotion))?;

    if cfg.llm_endpoint.is_empty() {
        return Err(AppError::LlmNotConfigured);
    }
    let provider = OpenAiCompatProvider::new(
        cfg.llm_endpoint.clone(),
        if cfg.llm_api_key.is_empty() {
            None
        } else {
            Some(cfg.llm_api_key.clone())
        },
    );
    let opts = ChatOptions {
        model: cfg.llm_model.clone(),
        temperature: 0.85,
        max_tokens: Some(512),
    };

    let memory = state.memory_arc();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut raw = String::new();
        let r = provider.chat_stream(messages, opts).await;
        match r {
            Ok(mut stream) => {
                while let Some(token_r) = stream.next().await {
                    match token_r {
                        Ok(t) => {
                            raw.push_str(&t);
                            let _ = app_handle.emit(
                                "chat::token",
                                ChatTokenPayload {
                                    stream_id: stream_id_clone.clone(),
                                    delta: t,
                                },
                            );
                        }
                        Err(e) => {
                            tracing::warn!("chat token error: {e}");
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!("chat_stream open failed: {e}");
                raw = format!("(连接 LLM 失败：{})", e);
                let _ = app_handle.emit(
                    "chat::token",
                    ChatTokenPayload {
                        stream_id: stream_id_clone.clone(),
                        delta: raw.clone(),
                    },
                );
            }
        }

        let (text, emotion, intensity) = parse_reply(&raw);
        if !text.is_empty() {
            let _ = memory.append_message("assistant", &text, emotion.as_deref());
        }
        let _ = app_handle.emit(
            "chat::end",
            ChatEndPayload {
                stream_id: stream_id_clone,
                full_text: text,
                emotion,
                intensity,
            },
        );

        if let Some(w) = app_handle.get_webview_window("main") {
            let _ = w.show();
        }
    });

    Ok(stream_id)
}
