use crate::error::{AppError, AppResult};
use crate::{AppState, RuntimeConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDto {
    pub llm_endpoint: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub tts_provider: String,
    pub tts_sidecar_url: String,
}

impl From<&RuntimeConfig> for ConfigDto {
    fn from(c: &RuntimeConfig) -> Self {
        ConfigDto {
            llm_endpoint: c.llm_endpoint.clone(),
            llm_model: c.llm_model.clone(),
            llm_api_key: c.llm_api_key.clone(),
            tts_provider: c.tts_provider.clone(),
            tts_sidecar_url: c.tts_sidecar_url.clone(),
        }
    }
}

impl From<ConfigDto> for RuntimeConfig {
    fn from(d: ConfigDto) -> Self {
        RuntimeConfig {
            llm_endpoint: d.llm_endpoint,
            llm_model: d.llm_model,
            llm_api_key: d.llm_api_key,
            tts_provider: d.tts_provider,
            tts_sidecar_url: d.tts_sidecar_url,
        }
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
        .join("config.json")
}

#[tauri::command]
pub async fn config_load(state: State<'_, AppState>) -> AppResult<ConfigDto> {
    // 优先从磁盘读，没有再用内存默认
    let path = config_path();
    if path.exists() {
        let text = std::fs::read_to_string(&path)?;
        match serde_json::from_str::<ConfigDto>(&text) {
            Ok(dto) => {
                let cfg: RuntimeConfig = dto.clone().into();
                state.replace_runtime_config(cfg);
                return Ok(dto);
            }
            Err(e) => {
                tracing::warn!("config.json parse failed: {e}");
            }
        }
    }
    Ok(ConfigDto::from(&state.runtime_config()))
}

#[tauri::command]
pub async fn config_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    dto: ConfigDto,
) -> AppResult<ConfigDto> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&dto)?;
    std::fs::write(&path, text)?;

    let cfg: RuntimeConfig = dto.clone().into();
    state.replace_runtime_config(cfg);

    // 通知前端：配置已更新（可让 UI 刷新摘要）
    let _ = app.emit("config::changed", dto.clone());
    Ok(dto)
}

#[tauri::command]
pub async fn config_test_llm(dto: ConfigDto) -> AppResult<String> {
    // 简单连通性测试：发个 1-token 请求
    if dto.llm_endpoint.trim().is_empty() {
        return Err(AppError::LlmNotConfigured);
    }
    use crate::core::llm::{ChatMessage, ChatOptions, LlmProvider, OpenAiCompatProvider};
    use futures_util::StreamExt;

    let provider = OpenAiCompatProvider::new(
        dto.llm_endpoint.clone(),
        if dto.llm_api_key.is_empty() {
            None
        } else {
            Some(dto.llm_api_key.clone())
        },
    );
    let opts = ChatOptions {
        model: dto.llm_model.clone(),
        temperature: 0.0,
        max_tokens: Some(8),
    };
    let messages = vec![ChatMessage {
        role: "user".into(),
        content: "ping".into(),
    }];
    let mut stream = provider.chat_stream(messages, opts).await?;
    let mut got = String::new();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(t) => {
                got.push_str(&t);
                if got.len() > 16 {
                    break;
                }
            }
            Err(e) => return Err(e),
        }
    }
    Ok(if got.is_empty() {
        "endpoint 已连通（无文本返回，但流可打开）".to_string()
    } else {
        format!("连通成功，样本：{}", got.chars().take(20).collect::<String>())
    })
}
