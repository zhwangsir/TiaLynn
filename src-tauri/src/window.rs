use tauri::{Manager, Runtime, WebviewWindow};

/// 启动时对主窗口做平台特化设置（macOS：隐藏 traffic lights + 浮动层级）。
pub fn configure_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // 1. 始终置顶
    let _ = win.set_always_on_top(true);

    // 2. 平台特化
    #[cfg(target_os = "macos")]
    macos_polish(&win);
}

#[cfg(target_os = "macos")]
fn macos_polish<R: Runtime>(win: &WebviewWindow<R>) {
    // 使用 macos-private-api：让窗口成为 NSPanel，不抢焦点、跨 space。
    // tauri 2 暴露的 set_visible_on_all_workspaces 大部分需求够用。
    let _ = win.set_visible_on_all_workspaces(true);
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn macos_polish<R: Runtime>(_win: &WebviewWindow<R>) {}
