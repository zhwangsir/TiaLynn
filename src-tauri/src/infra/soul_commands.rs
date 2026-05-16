use crate::brain::persona::loader::{locate_default_soul, resolve_asset, SoulConfig};
use crate::infra::error::{AppError, AppResult};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn soul_load(state: State<'_, AppState>) -> AppResult<SoulConfig> {
    let path = locate_default_soul()
        .ok_or_else(|| AppError::SoulNotFound("default.yaml not found".into()))?;
    let cfg = SoulConfig::load_from_path(&path)?;
    state.set_soul(cfg.clone());
    Ok(cfg)
}

#[tauri::command]
pub async fn soul_resolve_asset(dir: String, file: String) -> AppResult<String> {
    let p = resolve_asset(&dir, &file)
        .ok_or_else(|| AppError::Other(format!("asset not found: {}/{}", dir, file)))?;
    Ok(p.to_string_lossy().to_string())
}
