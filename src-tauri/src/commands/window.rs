use crate::error::AppResult;
use crate::AppState;
use tauri::{Manager, State};

#[tauri::command]
pub fn window_set_ignore_cursor(app: tauri::AppHandle, ignore: bool) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.set_ignore_cursor_events(ignore)?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_toggle_visible(app: tauri::AppHandle) -> AppResult<bool> {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible()?;
        if visible {
            w.hide()?;
            Ok(false)
        } else {
            w.show()?;
            w.set_focus()?;
            Ok(true)
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn window_start_drag(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.start_dragging()?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_set_alpha_mask(
    state: State<'_, AppState>,
    width: u32,
    height: u32,
    data: Vec<u8>,
) -> AppResult<()> {
    let mask = state.alpha_mask();
    let mut m = mask.write().map_err(|_| crate::error::AppError::Other("mask lock poisoned".into()))?;
    m.width = width;
    m.height = height;
    m.data = data;
    Ok(())
}
