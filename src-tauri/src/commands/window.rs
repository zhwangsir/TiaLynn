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

/// 把窗口移到指定物理像素位置（用于手动拖动 — start_dragging 在 macOS 透明窗口
/// 跨 IPC 时 NSEvent 已过期，无法用，改成前端 mousemove 时每帧手动设位置）。
#[tauri::command]
pub fn window_set_position(app: tauri::AppHandle, x: i32, y: i32) -> AppResult<()> {
    use tauri::PhysicalPosition;
    if let Some(w) = app.get_webview_window("main") {
        w.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// 拿当前窗口物理像素位置（前端拖动起点用）。
#[tauri::command]
pub fn window_get_position(app: tauri::AppHandle) -> AppResult<(i32, i32)> {
    if let Some(w) = app.get_webview_window("main") {
        let p = w.outer_position()?;
        return Ok((p.x, p.y));
    }
    Ok((0, 0))
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
