use tauri::{Manager, Runtime, WebviewWindow};

/// 启动时对主窗口做平台特化设置（macOS：跨 Space）。
pub fn configure_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.set_always_on_top(true);

    #[cfg(target_os = "macos")]
    macos_polish(&win);
}

#[cfg(target_os = "macos")]
fn macos_polish<R: Runtime>(win: &WebviewWindow<R>) {
    let _ = win.set_visible_on_all_workspaces(true);
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn macos_polish<R: Runtime>(_win: &WebviewWindow<R>) {}

/// 全局鼠标轮询：
/// 在 ignore=true（穿透）状态下，webview 完全收不到任何事件，前端
/// 无法把 ignore 切回 false。所以必须由 Rust 端持续在窗口外查询全局
/// 鼠标位置，进入窗口矩形时立即关闭 ignore，让 webview 重新可交互。
///
/// 策略（v0.1.2）：
///   - mouse 在窗口矩形外 → ignore=true（穿透到桌面/其他窗口）
///   - mouse 在窗口矩形内 → ignore=false（webview 接收事件，UI/拖动/输入全部可用）
///
/// 像素级穿透留到 v0.2：那时需要把 alpha 缓存从前端通过 event 同步到 Rust。
pub fn spawn_mouse_tracker<R: Runtime + 'static>(app: tauri::AppHandle<R>) {
    use device_query::{DeviceQuery, DeviceState};
    use std::time::Duration;

    std::thread::spawn(move || {
        let device = DeviceState::new();
        let mut last_ignore: Option<bool> = None;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            let mouse = device.get_mouse();
            let (mx, my) = (mouse.coords.0, mouse.coords.1);

            let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
                continue;
            };

            // 把窗口位置转为以左上为原点的逻辑像素（device_query 已经是物理像素，
            // PhysicalPosition/Size 也是物理像素，所以直接比较即可）。
            let left = pos.x;
            let top = pos.y;
            let right = left + size.width as i32;
            let bottom = top + size.height as i32;

            let inside = mx >= left && mx < right && my >= top && my < bottom;
            let want_ignore = !inside;

            if last_ignore != Some(want_ignore) {
                if let Err(e) = window.set_ignore_cursor_events(want_ignore) {
                    tracing::warn!("set_ignore_cursor_events failed: {e}");
                }
                tracing::debug!(
                    "mouse=({},{}) window=({},{},{},{}) inside={} → ignore={}",
                    mx, my, left, top, right, bottom, inside, want_ignore
                );
                last_ignore = Some(want_ignore);
            }
        }
    });
}
