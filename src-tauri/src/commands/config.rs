use crate::error::{AppError, AppResult};
use crate::{AppState, RuntimeConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDto {
    pub llm_endpoint: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub tts_provider: String,
    pub tts_sidecar_url: String,
    // 模型
    pub live2d_model_dir: String,
    pub live2d_model_file: String,
    #[serde(default = "default_scale")]
    pub live2d_scale: f32,
    #[serde(default = "default_offset_y")]
    pub live2d_offset_y: f32,
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
    // 自主移动
    #[serde(default = "default_motion_enabled")]
    pub motion_enabled: bool,
    #[serde(default = "default_motion_min")]
    pub motion_min_sec: u32,
    #[serde(default = "default_motion_max")]
    pub motion_max_sec: u32,
    #[serde(default = "default_motion_speed")]
    pub motion_speed: f32,
    #[serde(default)]
    pub extra_model_dirs: Vec<String>,
}

fn default_motion_enabled() -> bool {
    true
}
fn default_motion_min() -> u32 {
    90
}
fn default_motion_max() -> u32 {
    300
}
fn default_motion_speed() -> f32 {
    1.0
}

fn default_embedding_model() -> String {
    "text-embedding-3-small".to_string()
}
fn default_scale() -> f32 {
    0.35
}
fn default_offset_y() -> f32 {
    50.0
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

impl From<&RuntimeConfig> for ConfigDto {
    fn from(c: &RuntimeConfig) -> Self {
        ConfigDto {
            llm_endpoint: c.llm_endpoint.clone(),
            llm_model: c.llm_model.clone(),
            llm_api_key: c.llm_api_key.clone(),
            tts_provider: c.tts_provider.clone(),
            tts_sidecar_url: c.tts_sidecar_url.clone(),
            live2d_model_dir: c.live2d_model_dir.clone(),
            live2d_model_file: c.live2d_model_file.clone(),
            live2d_scale: c.live2d_scale,
            live2d_offset_y: c.live2d_offset_y,
            idle_min_sec: c.idle_min_sec,
            idle_max_sec: c.idle_max_sec,
            autocomment_interval_sec: c.autocomment_interval_sec,
            emotion_decay_per_minute: c.emotion_decay_per_minute,
            flip_probability: c.flip_probability,
            emotion_voice_map: c.emotion_voice_map.clone(),
            embedding_endpoint: c.embedding_endpoint.clone(),
            embedding_model: c.embedding_model.clone(),
            motion_enabled: c.motion_enabled,
            motion_min_sec: c.motion_min_sec,
            motion_max_sec: c.motion_max_sec,
            motion_speed: c.motion_speed,
            extra_model_dirs: c.extra_model_dirs.clone(),
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
            live2d_model_dir: d.live2d_model_dir,
            live2d_model_file: d.live2d_model_file,
            live2d_scale: d.live2d_scale,
            live2d_offset_y: d.live2d_offset_y,
            idle_min_sec: d.idle_min_sec,
            idle_max_sec: d.idle_max_sec,
            autocomment_interval_sec: d.autocomment_interval_sec,
            emotion_decay_per_minute: d.emotion_decay_per_minute,
            flip_probability: d.flip_probability,
            emotion_voice_map: d.emotion_voice_map,
            embedding_endpoint: d.embedding_endpoint,
            embedding_model: d.embedding_model,
            motion_enabled: d.motion_enabled,
            motion_min_sec: d.motion_min_sec,
            motion_max_sec: d.motion_max_sec,
            motion_speed: d.motion_speed,
            extra_model_dirs: d.extra_model_dirs,
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
