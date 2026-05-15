use crate::core::motion::MotionStatus;
use crate::error::AppResult;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn motion_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> MotionStatus {
    state.motion().snapshot(&app)
}

#[tauri::command]
pub fn motion_set_target(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    duration_sec: f32,
) -> AppResult<()> {
    state.motion().set_target(&app, x, y, duration_sec)
}

#[tauri::command]
pub fn motion_cancel(state: State<'_, AppState>) {
    state.motion().cancel();
}

#[tauri::command]
pub fn motion_set_dragging(state: State<'_, AppState>, on: bool) {
    state.motion().set_dragging(on);
}

/// 返回屏幕逻辑像素尺寸（前端选目的地时需要知道屏幕大小）。
#[tauri::command]
pub fn motion_screen_size(app: tauri::AppHandle) -> AppResult<(i32, i32, f64)> {
    if let Some(monitor) = app.primary_monitor()? {
        let size = monitor.size();
        let sf = monitor.scale_factor();
        return Ok((size.width as i32, size.height as i32, sf));
    }
    Ok((1920, 1080, 1.0))
}
