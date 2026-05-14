use crate::core::llm::{ChatMessage, ChatOptions, LlmProvider, OpenAiCompatProvider};
use crate::error::{AppError, AppResult};
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
}

#[tauri::command]
pub async fn chat_send(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message: String,
) -> AppResult<String> {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let stream_id_clone = stream_id.clone();

    // 1. 准备 prompt
    let soul = state
        .soul()
        .ok_or_else(|| AppError::Other("soul not loaded".into()))?;
    let emotion = state.emotion();
    let system_prompt = soul.build_system_prompt(&emotion, None);

    // 2. 取短期上下文（最近 20 条）
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

    // 3. 落库用户消息
    state
        .memory()
        .append_message("user", &message, Some(&emotion))?;

    // 4. 构建 provider
    let cfg = state.runtime_config();
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

    // 5. 开流并异步推送（不阻塞 invoke）
    let memory = state.memory_arc();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut full_text = String::new();
        let r = provider.chat_stream(messages, opts).await;
        match r {
            Ok(mut stream) => {
                while let Some(token_r) = stream.next().await {
                    match token_r {
                        Ok(t) => {
                            full_text.push_str(&t);
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
                full_text = format!("(连接 LLM 失败：{})", e);
                let _ = app_handle.emit(
                    "chat::token",
                    ChatTokenPayload {
                        stream_id: stream_id_clone.clone(),
                        delta: full_text.clone(),
                    },
                );
            }
        }

        // 落库 assistant
        if !full_text.is_empty() {
            let _ = memory.append_message("assistant", &full_text, None);
        }

        let _ = app_handle.emit(
            "chat::end",
            ChatEndPayload {
                stream_id: stream_id_clone,
                full_text,
                emotion: None,
            },
        );

        // 让窗口出现在前台（如果被隐藏）
        if let Some(w) = app_handle.get_webview_window("main") {
            let _ = w.show();
        }
    });

    Ok(stream_id)
}
