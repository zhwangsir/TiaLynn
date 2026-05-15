use crate::core::sidecar::SidecarState;
use crate::error::{AppError, AppResult};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

// suppress unused warning for Serialize on VoiceEntry alone
#[allow(dead_code)]
const _: () = ();

#[tauri::command]
pub async fn sidecar_status(state: State<'_, AppState>) -> AppResult<SidecarState> {
    Ok(state.sidecar().state())
}

#[tauri::command]
pub async fn sidecar_start(state: State<'_, AppState>) -> AppResult<SidecarState> {
    state.sidecar().ensure_running().await
}

#[tauri::command]
pub async fn sidecar_stop(state: State<'_, AppState>) -> AppResult<SidecarState> {
    state.sidecar().stop();
    Ok(state.sidecar().state())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEntry {
    pub id: String,
    pub kind: String,
    pub edge_voice: Option<String>,
    pub sample_path: Option<String>,
    pub note: Option<String>,
}

#[tauri::command]
pub async fn tts_list_voices(state: State<'_, AppState>) -> AppResult<Vec<VoiceEntry>> {
    let cfg = state.runtime_config();
    let url = format!(
        "{}/v1/voices",
        cfg.tts_sidecar_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("sidecar unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "sidecar /v1/voices status {}",
            resp.status()
        )));
    }
    let env: serde_json::Value = resp.json().await?;
    let voices = env
        .get("voices")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    Ok(serde_json::from_value(voices)?)
}

#[tauri::command]
pub async fn tts_register_voices_dir(
    state: State<'_, AppState>,
    dir: String,
) -> AppResult<serde_json::Value> {
    let cfg = state.runtime_config();
    let url = format!(
        "{}/v1/audio/register-batch",
        cfg.tts_sidecar_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "dir": dir }))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("sidecar unreachable: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "register-batch status {}",
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

/// 返回项目根的 example_voice/ 绝对路径（前端"一键注册"用）。
#[tauri::command]
pub fn tts_example_voice_dir() -> String {
    use std::path::Path;
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("example_voice").to_string_lossy().to_string())
        .unwrap_or_else(|| "example_voice".to_string())
}
