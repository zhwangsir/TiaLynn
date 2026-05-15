//! 窗口自主移动控制器。
//!
//! Rust 后台 16ms tick：把窗口从 current 平滑插值到 target。
//! 前端只下 set_target 命令（"去屏幕坐标 (1200, 500)，用 2.5 秒"），
//! 不必管每帧位置。
//!
//! 缓动：cubic ease in-out。
//! 拖动期间暂停（前端 set_dragging）。

use crate::error::AppResult;
use serde::Serialize;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, PhysicalPosition, Runtime};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum MotionPhase {
    Idle,
    Moving,
    Dragging, // 用户在拖
}

#[derive(Debug, Clone, Serialize)]
pub struct MotionStatus {
    pub phase: MotionPhase,
    pub x: i32,
    pub y: i32,
    pub target_x: i32,
    pub target_y: i32,
    pub facing_right: bool,
}

struct Inner {
    phase: MotionPhase,
    start_x: f64,
    start_y: f64,
    target_x: f64,
    target_y: f64,
    started_at: Instant,
    duration: Duration,
    facing_right: bool,
}

pub struct MotionController {
    inner: Arc<RwLock<Inner>>,
    drag_lock: Arc<Mutex<bool>>,
}

impl MotionController {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Inner {
                phase: MotionPhase::Idle,
                start_x: 0.0,
                start_y: 0.0,
                target_x: 0.0,
                target_y: 0.0,
                started_at: Instant::now(),
                duration: Duration::from_secs(0),
                facing_right: true,
            })),
            drag_lock: Arc::new(Mutex::new(false)),
        }
    }

    pub fn set_dragging(&self, on: bool) {
        if let Ok(mut g) = self.drag_lock.lock() {
            *g = on;
        }
        if let Ok(mut g) = self.inner.write() {
            g.phase = if on {
                MotionPhase::Dragging
            } else {
                MotionPhase::Idle
            };
        }
    }

    /// 启动移动到 (tx, ty) 用 duration 秒。
    pub fn set_target<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        tx: i32,
        ty: i32,
        duration_sec: f32,
    ) -> AppResult<()> {
        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };
        let pos = window.outer_position()?;
        let mut g = self.inner.write().unwrap();
        // 拖动时不接受
        if g.phase == MotionPhase::Dragging {
            return Ok(());
        }
        g.start_x = pos.x as f64;
        g.start_y = pos.y as f64;
        g.target_x = tx as f64;
        g.target_y = ty as f64;
        g.started_at = Instant::now();
        g.duration = Duration::from_secs_f32(duration_sec.max(0.1));
        g.facing_right = (tx as f64) >= g.start_x;
        g.phase = MotionPhase::Moving;
        Ok(())
    }

    pub fn snapshot<R: Runtime>(&self, app: &tauri::AppHandle<R>) -> MotionStatus {
        let g = self.inner.read().unwrap();
        let (x, y) = if let Some(w) = app.get_webview_window("main") {
            match w.outer_position() {
                Ok(p) => (p.x, p.y),
                Err(_) => (0, 0),
            }
        } else {
            (0, 0)
        };
        MotionStatus {
            phase: g.phase,
            x,
            y,
            target_x: g.target_x as i32,
            target_y: g.target_y as i32,
            facing_right: g.facing_right,
        }
    }

    pub fn cancel(&self) {
        if let Ok(mut g) = self.inner.write() {
            if g.phase == MotionPhase::Moving {
                g.phase = MotionPhase::Idle;
            }
        }
    }
}

pub fn spawn_motion_loop<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    controller: Arc<MotionController>,
) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(16));
        let Some(window) = app.get_webview_window("main") else {
            continue;
        };

        let (start_x, start_y, tx, ty, t01, finished) = {
            let g = controller.inner.read().unwrap();
            if g.phase != MotionPhase::Moving {
                continue;
            }
            let elapsed = g.started_at.elapsed().as_secs_f64();
            let dur = g.duration.as_secs_f64().max(0.001);
            let t = (elapsed / dur).clamp(0.0, 1.0);
            (g.start_x, g.start_y, g.target_x, g.target_y, t, t >= 1.0)
        };

        let eased = cubic_ease_in_out(t01 as f32) as f64;
        let nx = start_x + (tx - start_x) * eased;
        let ny = start_y + (ty - start_y) * eased;
        let _ = window.set_position(PhysicalPosition::new(nx as i32, ny as i32));

        // 每 ~5 帧 emit 一次状态（前端 persona 用来驱动 walking Live2D 参数）
        let _ = app.emit(
            "motion::tick",
            serde_json::json!({
                "x": nx as i32,
                "y": ny as i32,
                "t": t01,
                "moving": !finished,
            }),
        );

        if finished {
            if let Ok(mut g) = controller.inner.write() {
                g.phase = MotionPhase::Idle;
            }
            let _ = app.emit("motion::end", ());
        }
    });
}

fn cubic_ease_in_out(t: f32) -> f32 {
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        let f = 2.0 * t - 2.0;
        1.0 + f * f * f / 2.0
    }
}
