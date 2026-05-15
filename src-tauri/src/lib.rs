mod commands;
mod core;
mod error;
mod tray;
mod window;

use crate::core::memory::{default_db_path, MemoryStore};
use crate::core::soul::{locate_default_soul, SoulConfig};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager};

/// 应用运行时配置（一份内存副本，对应 ~/.tialynn/config.toml）。
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub llm_endpoint: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub tts_provider: String,
    pub tts_sidecar_url: String,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            llm_endpoint: std::env::var("TIALYNN_LLM_ENDPOINT")
                .unwrap_or_else(|_| "http://192.168.71.100:1234/v1".to_string()),
            llm_model: std::env::var("TIALYNN_LLM_MODEL")
                .unwrap_or_else(|_| "qwen3.5-397b-a17b".to_string()),
            llm_api_key: std::env::var("TIALYNN_LLM_API_KEY").unwrap_or_default(),
            tts_provider: std::env::var("TIALYNN_TTS_PROVIDER")
                .unwrap_or_else(|_| "macos_say".to_string()),
            tts_sidecar_url: std::env::var("TIALYNN_TTS_SIDECAR_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5050".to_string()),
        }
    }
}

/// 全局应用状态。Tauri manage 之后通过 State 注入到 command。
pub struct AppState {
    soul: RwLock<Option<SoulConfig>>,
    emotion: RwLock<String>,
    memory: Arc<MemoryStore>,
    config: Mutex<RuntimeConfig>,
}

impl AppState {
    pub fn soul(&self) -> Option<SoulConfig> {
        self.soul.read().ok().and_then(|g| g.clone())
    }
    pub fn set_soul(&self, cfg: SoulConfig) {
        if let Ok(mut g) = self.soul.write() {
            *g = Some(cfg);
        }
    }
    pub fn emotion(&self) -> String {
        self.emotion
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "neutral".into())
    }
    pub fn set_emotion(&self, e: String) {
        if let Ok(mut g) = self.emotion.write() {
            *g = e;
        }
    }
    pub fn memory(&self) -> Arc<MemoryStore> {
        self.memory.clone()
    }
    pub fn memory_arc(&self) -> Arc<MemoryStore> {
        self.memory.clone()
    }
    pub fn runtime_config(&self) -> RuntimeConfig {
        self.config.lock().map(|g| g.clone()).unwrap_or_default()
    }
    pub fn replace_runtime_config(&self, cfg: RuntimeConfig) {
        if let Ok(mut g) = self.config.lock() {
            *g = cfg;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,tialynn=debug")),
        )
        .init();

    let memory = Arc::new(
        MemoryStore::open(default_db_path(), uuid::Uuid::new_v4().to_string())
            .expect("open memory db"),
    );

    let state = AppState {
        soul: RwLock::new(None),
        emotion: RwLock::new("neutral".into()),
        memory,
        config: Mutex::new(RuntimeConfig::default()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(|app| {
            // 启动时尝试加载磁盘上的运行时配置
            if let Some(cfg_dir) = dirs::config_dir() {
                let path = cfg_dir.join("TiaLynn").join("config.json");
                if path.exists() {
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        if let Ok(dto) =
                            serde_json::from_str::<commands::config::ConfigDto>(&text)
                        {
                            let s = app.state::<AppState>();
                            s.replace_runtime_config(dto.into());
                            tracing::info!("loaded runtime config from {}", path.display());
                        }
                    }
                }
            }

            // 启动时尝试加载灵魂
            if let Some(path) = locate_default_soul() {
                if let Ok(cfg) = SoulConfig::load_from_path(&path) {
                    let s = app.state::<AppState>();
                    s.set_emotion(cfg.emotions.initial.clone());
                    s.set_soul(cfg);
                } else {
                    tracing::warn!("soul file found but parse failed: {}", path.display());
                }
            } else {
                tracing::warn!("no default.yaml located on startup");
            }

            // 灵魂热重载 watcher
            spawn_soul_watcher(app.handle().clone());

            // 主窗口微调（置顶、跨 space）
            window::configure_main_window(app.handle());

            // 全局鼠标轮询 → 窗口外穿透、窗口内可交互
            window::spawn_mouse_tracker(app.handle().clone());

            // 系统托盘
            tray::build_tray(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::soul::soul_load,
            commands::soul::soul_resolve_asset,
            commands::chat::chat_send,
            commands::chat::chat_send_proactive,
            commands::memory::memory_recent,
            commands::memory::memory_append_observation,
            commands::tts::tts_speak,
            commands::window::window_set_ignore_cursor,
            commands::window::window_toggle_visible,
            commands::window::window_start_drag,
            commands::config::config_load,
            commands::config::config_save,
            commands::config::config_test_llm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_soul_watcher(app: tauri::AppHandle) {
    use notify::{RecursiveMode, Watcher};

    let Some(path) = locate_default_soul() else {
        return;
    };

    let dir = match path.parent() {
        Some(d) => d.to_path_buf(),
        None => return,
    };

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!("soul watcher init failed: {e}");
                return;
            }
        };
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            tracing::warn!("soul watcher watch failed: {e}");
            return;
        }

        // 节流：500ms 合并连续事件
        let mut last_fire = std::time::Instant::now() - std::time::Duration::from_secs(60);
        while let Ok(_event) = rx.recv() {
            if last_fire.elapsed() < std::time::Duration::from_millis(500) {
                continue;
            }
            last_fire = std::time::Instant::now();
            if let Ok(cfg) = SoulConfig::load_from_path(&path) {
                if let Some(s) = app.try_state::<AppState>() {
                    s.set_soul(cfg.clone());
                }
                let _ = app.emit("soul::changed", cfg);
                tracing::info!("soul hot-reloaded");
            }
        }
    });
}
