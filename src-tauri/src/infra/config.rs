//! 运行时配置：LLM endpoint、TTS、行为参数、情绪音色映射、embedding。
//!
//! **v0.4 起 live2d 模型路径、extra_model_dirs、motion 字段已迁移到 soul YAML。**
//! 这里只放真正的"运行时可调"参数。

use crate::infra::error::{AppError, AppResult};
use crate::{AppState, RuntimeConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigDto {
    pub llm_endpoint: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub tts_provider: String,
    pub tts_sidecar_url: String,
    // 行为
    #[serde(default = "default_idle_min")]
    pub idle_min_sec: u32,
    #[serde(default = "default_idle_max")]
    pub idle_max_sec: u32,
    #[serde(default = "default_autocomment")]
    pub autocomment_interval_sec: u32,
    #[serde(default = "default_decay")]
    pub emotion_decay_per_minute: f32,
    #[serde(default = "default_flip")]
    pub flip_probability: f32,
    // 情绪 → voice id
    #[serde(default)]
    pub emotion_voice_map: HashMap<String, String>,
    // embedding
    #[serde(default)]
    pub embedding_endpoint: String,
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,
}

fn default_idle_min() -> u32 {
    8
}
fn default_idle_max() -> u32 {
    15
}
fn default_autocomment() -> u32 {
    300
}
fn default_decay() -> f32 {
    0.05
}
fn default_flip() -> f32 {
    0.15
}
fn default_embedding_model() -> String {
    "text-embedding-3-small".to_string()
}

impl Default for ConfigDto {
    fn default() -> Self {
        ConfigDto::from(&RuntimeConfig::default())
    }
}

impl From<&RuntimeConfig> for ConfigDto {
    fn from(c: &RuntimeConfig) -> Self {
        ConfigDto {
            llm_endpoint: c.llm_endpoint.clone(),
            llm_model: c.llm_model.clone(),
            llm_api_key: c.llm_api_key.clone(),
            tts_provider: c.tts_provider.clone(),
            tts_sidecar_url: c.tts_sidecar_url.clone(),
            idle_min_sec: c.idle_min_sec,
            idle_max_sec: c.idle_max_sec,
            autocomment_interval_sec: c.autocomment_interval_sec,
            emotion_decay_per_minute: c.emotion_decay_per_minute,
            flip_probability: c.flip_probability,
            emotion_voice_map: c.emotion_voice_map.clone(),
            embedding_endpoint: c.embedding_endpoint.clone(),
            embedding_model: c.embedding_model.clone(),
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
            idle_min_sec: d.idle_min_sec,
            idle_max_sec: d.idle_max_sec,
            autocomment_interval_sec: d.autocomment_interval_sec,
            emotion_decay_per_minute: d.emotion_decay_per_minute,
            flip_probability: d.flip_probability,
            emotion_voice_map: d.emotion_voice_map,
            embedding_endpoint: d.embedding_endpoint,
            embedding_model: d.embedding_model,
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

    let _ = app.emit("config::changed", dto.clone());
    Ok(dto)
}

#[tauri::command]
pub async fn config_test_llm(dto: ConfigDto) -> AppResult<String> {
    if dto.llm_endpoint.trim().is_empty() {
        return Err(AppError::LlmNotConfigured);
    }
    use crate::brain::providers::openai_compat::{
        ChatMessage, ChatOptions, LlmProvider, OpenAiCompatProvider,
    };
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
        format!(
            "连通成功，样本：{}",
            got.chars().take(20).collect::<String>()
        )
    })
}
