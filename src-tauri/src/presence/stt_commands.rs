use crate::presence::stt::SttState;
use crate::infra::error::{AppError, AppResult};
use crate::AppState;
use tauri::{Emitter, State};

#[tauri::command]
pub fn stt_status(state: State<'_, AppState>) -> SttState {
    state.stt().snapshot()
}

#[tauri::command]
pub async fn stt_toggle(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<SttState> {
    use crate::presence::stt::SttStatus;
    let stt = state.stt();
    match stt.status() {
        SttStatus::Idle => {
            stt.start_recording()?;
            let _ = app.emit("stt::started", ());
            return Ok(stt.snapshot());
        }
        SttStatus::Recording => {
            let wav = stt.stop_and_save()?;
            let _ = app.emit("stt::transcribing", ());
            let cfg = state.runtime_config();
            let sidecar_url = cfg.tts_sidecar_url.clone();
            let stt_clone = stt.clone_arc();
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let r = __transcribe(&sidecar_url, &wav).await;
                let _ = std::fs::remove_file(&wav);
                match r {
                    Ok(text) => {
                        stt_clone.set_result(Ok(text.clone()));
                        let _ = app_handle.emit("stt::result", text);
                    }
                    Err(e) => {
                        stt_clone.set_result(Err(e.to_string()));
                        let _ = app_handle.emit("stt::error", e.to_string());
                    }
                }
            });
            return Ok(stt.snapshot());
        }
        SttStatus::Transcribing => Ok(stt.snapshot()),
    }
}

pub async fn __transcribe(sidecar_url: &str, wav_path: &std::path::Path) -> AppResult<String> {
    transcribe_via_sidecar(sidecar_url, wav_path).await
}

async fn transcribe_via_sidecar(sidecar_url: &str, wav_path: &std::path::Path) -> AppResult<String> {
    let url = format!("{}/v1/audio/transcribe", sidecar_url.trim_end_matches('/'));
    let bytes = std::fs::read(wav_path)?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("rec.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::Other(format!("mime: {e}")))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("sidecar transcribe unreachable: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("sidecar transcribe status: {e}")))?;
    let v: serde_json::Value = resp.json().await?;
    Ok(v.get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string())
}
