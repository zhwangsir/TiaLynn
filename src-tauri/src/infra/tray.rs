use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let reload_soul = MenuItem::with_id(app, "reload_soul", "重新加载灵魂", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_hide, &reload_soul, &quit])?;

    let _tray = TrayIconBuilder::with_id("tialynn-tray")
        .menu(&menu)
        .tooltip("TiaLynn — 你的灵魂女友")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_main_visibility(app),
            "reload_soul" => {
                if let Err(e) = reload_soul_now(app) {
                    tracing::warn!("reload soul failed: {e}");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_visibility(tray.app_handle())
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_main_visibility<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(visible) = w.is_visible() {
            if visible {
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

fn reload_soul_now<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<()> {
    use crate::brain::persona::loader::{locate_default_soul, SoulConfig};
    use tauri::Emitter;

    let path = locate_default_soul().ok_or_else(|| anyhow::anyhow!("default.yaml not found"))?;
    let cfg = SoulConfig::load_from_path(&path).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if let Some(state) = app.try_state::<crate::AppState>() {
        state.set_soul(cfg.clone());
    }
    app.emit("soul::changed", cfg)?;
    Ok(())
}
