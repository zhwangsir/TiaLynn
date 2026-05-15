use crate::error::{AppError, AppResult};
use crate::AppState;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn system_clear_history(state: State<'_, AppState>) -> AppResult<usize> {
    let mem = state.memory();
    mem.clear_messages()
}

#[tauri::command]
pub async fn system_reveal_data_dir() -> AppResult<String> {
    let path = data_dir();
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    open_in_finder(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn system_reveal_models_dir() -> AppResult<String> {
    let path = dirs::home_dir()
        .unwrap_or_default()
        .join(".tialynn")
        .join("models");
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    open_in_finder(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn system_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
}

#[cfg(target_os = "macos")]
fn open_in_finder(path: &std::path::Path) -> AppResult<()> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| AppError::Other(format!("open failed: {e}")))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_in_finder(path: &std::path::Path) -> AppResult<()> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| AppError::Other(format!("explorer failed: {e}")))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_in_finder(path: &std::path::Path) -> AppResult<()> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
    Ok(())
}
