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

#[derive(Debug, Clone, Serialize)]
pub struct InstallStatus {
    pub venv_ready: bool,
    pub edge_tts_ready: bool,
    pub cosyvoice_repo_ready: bool,
    pub cosyvoice_model_ready: bool,
}

#[tauri::command]
pub fn sidecar_install_status() -> InstallStatus {
    use std::path::Path;
    let project = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let venv = project.join("sidecar").join("qwen-tts-server").join(".venv");
    let venv_python = venv.join("bin").join("python");
    let venv_ready = venv_python.exists();

    let edge_tts_ready = venv_ready
        && venv
            .join("lib")
            .read_dir()
            .ok()
            .and_then(|mut it| {
                it.find_map(|e| {
                    let p = e.ok()?.path();
                    if p.is_dir()
                        && p.file_name()
                            .and_then(|s| s.to_str())
                            .map(|n| n.starts_with("python"))
                            .unwrap_or(false)
                    {
                        Some(p)
                    } else {
                        None
                    }
                })
            })
            .map(|py_lib| py_lib.join("site-packages").join("edge_tts").exists())
            .unwrap_or(false);

    let home = dirs::home_dir().unwrap_or_default();
    let cosyvoice_repo = home.join(".tialynn").join("cosyvoice-repo").join(".git");
    let cosyvoice_model = home
        .join(".tialynn")
        .join("models-tts")
        .join("cosyvoice2-0.5b");
    InstallStatus {
        venv_ready,
        edge_tts_ready,
        cosyvoice_repo_ready: cosyvoice_repo.exists(),
        cosyvoice_model_ready: cosyvoice_model.exists()
            && cosyvoice_model
                .read_dir()
                .map(|mut d| d.next().is_some())
                .unwrap_or(false),
    }
}

/// 异步运行 sidecar/install.sh，每行 stdout 通过 event 发给前端。
#[tauri::command]
pub async fn sidecar_install_run(
    app: tauri::AppHandle,
    minimal: Option<bool>,
) -> AppResult<()> {
    use std::path::Path;
    use std::process::Stdio;
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let project = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::Other("project root not found".into()))?;
    let script = project.join("sidecar").join("install.sh");
    if !script.exists() {
        return Err(AppError::Other(format!(
            "install.sh not found at {}",
            script.display()
        )));
    }

    let mut cmd = tokio::process::Command::new("bash");
    cmd.arg(&script);
    if minimal.unwrap_or(false) {
        cmd.arg("--minimal");
    }
    cmd.current_dir(&project)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("spawn install.sh: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("no stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("no stderr".into()))?;

    let app_for_out = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_for_out.emit("sidecar::install_log", line);
        }
    });
    let app_for_err = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_for_err.emit("sidecar::install_log", format!("[stderr] {line}"));
        }
    });

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("install.sh wait: {e}")))?;
    let _ = app.emit(
        "sidecar::install_done",
        serde_json::json!({"success": status.success(), "code": status.code().unwrap_or(-1)}),
    );
    if !status.success() {
        return Err(AppError::Other(format!(
            "install.sh exited with {}",
            status.code().unwrap_or(-1)
        )));
    }
    Ok(())
}
