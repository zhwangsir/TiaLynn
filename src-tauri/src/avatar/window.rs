use serde::Serialize;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

#[derive(Debug, Default, Clone)]
pub struct AlphaMask {
    pub width: u32,
    pub height: u32,
    /// 行优先；每 byte 8 个像素，bit 0 = leftmost
    pub data: Vec<u8>,
}

impl AlphaMask {
    pub fn hit_test_unit(&self, u: f32, v: f32) -> bool {
        if self.width == 0 || self.height == 0 || self.data.is_empty() {
            return false;
        }
        if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
            return false;
        }
        let mx = (u * self.width as f32) as u32;
        let my = (v * self.height as f32) as u32;
        let idx = (my * self.width + mx) as usize;
        let byte = idx >> 3;
        let bit = idx & 7;
        if byte >= self.data.len() {
            return false;
        }
        (self.data[byte] >> bit) & 1 == 1
    }
}

pub type SharedMask = Arc<RwLock<AlphaMask>>;

#[derive(Clone, Serialize)]
pub struct GlobalMouseEvent {
    /// 全局鼠标物理像素坐标（device_query 报告）
    pub mouse_phys_x: i32,
    pub mouse_phys_y: i32,
    /// 主窗口物理像素 rect
    pub win_phys_x: i32,
    pub win_phys_y: i32,
    pub win_phys_w: u32,
    pub win_phys_h: u32,
    /// 主窗口 scale factor（用于前端把物理坐标换算回 CSS 像素）
    pub scale_factor: f64,
    /// 鼠标是否在窗口内
    pub inside: bool,
}

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
pub fn spawn_mouse_tracker<R: Runtime + 'static>(app: tauri::AppHandle<R>, mask: SharedMask) {
    use device_query::{DeviceQuery, DeviceState};
    use std::time::Duration;

    std::thread::spawn(move || {
        let device = DeviceState::new();
        let mut last_ignore: Option<bool> = None;
        let mut emit_counter: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };

            let mouse = device.get_mouse();
            let (mx, my) = (mouse.coords.0, mouse.coords.1);

            let (Ok(pos), Ok(size), Ok(sf)) = (
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
            ) else {
                continue;
            };

            let left = pos.x;
            let top = pos.y;
            let right = left + size.width as i32;
            let bottom = top + size.height as i32;
            let in_rect = mx >= left && mx < right && my >= top && my < bottom;

            // 进一步用 alpha mask 判断"是否在立绘上"
            let inside = if in_rect {
                let u = (mx - left) as f32 / size.width as f32;
                let v = (my - top) as f32 / size.height as f32;
                let mask_g = mask.read().ok();
                let on_pixel = mask_g.as_ref().map(|m| m.hit_test_unit(u, v)).unwrap_or(false);
                let has_mask = mask_g.as_ref().map(|m| !m.data.is_empty()).unwrap_or(false);
                // mask 尚未推送过 → 退化到矩形（让 UI 可用）
                if has_mask {
                    on_pixel
                } else {
                    true
                }
            } else {
                false
            };
            let want_ignore = !inside;

            if last_ignore != Some(want_ignore) {
                if let Err(e) = window.set_ignore_cursor_events(want_ignore) {
                    tracing::warn!("set_ignore_cursor_events failed: {e}");
                }
                tracing::debug!(
                    "mouse=({},{}) rect={} → ignore={}",
                    mx, my, in_rect, want_ignore
                );
                last_ignore = Some(want_ignore);
            }

            emit_counter = emit_counter.wrapping_add(1);
            if emit_counter % 2 == 0 {
                let payload = GlobalMouseEvent {
                    mouse_phys_x: mx,
                    mouse_phys_y: my,
                    win_phys_x: left,
                    win_phys_y: top,
                    win_phys_w: size.width,
                    win_phys_h: size.height,
                    scale_factor: sf,
                    inside: in_rect,
                };
                let _ = window.emit("mouse::global", payload);
            }
        }
    });
}
