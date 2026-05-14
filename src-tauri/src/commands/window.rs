use crate::error::AppResult;
use tauri::Manager;

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
