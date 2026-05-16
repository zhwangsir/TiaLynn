// TiaLynn v0.4.0 — Constitutional Rewrite
// 五大域：avatar / brain / hands / presence / infra
// 模块间通信通过事件总线（Tauri emit/listen + mitt）

mod avatar;
mod brain;
mod hands;
mod infra;
mod presence;

use crate::avatar::window::{AlphaMask, SharedMask};
use crate::brain::memory::store::{default_db_path, MemoryStore};
use crate::brain::persona::loader::{locate_default_soul, SoulConfig};
use crate::presence::sidecar_mgr::SidecarManager;
use crate::presence::stt::SttRecorder;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager};

/// 应用运行时配置（内存副本，对应 ~/Library/Application Support/TiaLynn/config.json）。
///
/// **注意**：v0.4 开始 live2d 模型路径由 soul/identity.yaml 管理，不再放这里。
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub llm_provider: String, // "anthropic" | "ollama" | "openai_compat"
    pub llm_endpoint: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub tts_provider: String,
    pub tts_sidecar_url: String,
    pub idle_min_sec: u32,
    pub idle_max_sec: u32,
    pub autocomment_interval_sec: u32,
    pub emotion_decay_per_minute: f32,
    pub flip_probability: f32,
    pub emotion_voice_map: HashMap<String, String>,
    pub embedding_endpoint: String,
    pub embedding_model: String,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            llm_provider: std::env::var("TIALYNN_LLM_PROVIDER")
                .unwrap_or_else(|_| "openai_compat".to_string()),
            llm_endpoint: std::env::var("TIALYNN_LLM_ENDPOINT")
                .unwrap_or_else(|_| "http://192.168.71.100:1234/v1".to_string()),
            llm_model: std::env::var("TIALYNN_LLM_MODEL")
                .unwrap_or_else(|_| "qwen3.5-397b-a17b".to_string()),
            llm_api_key: std::env::var("TIALYNN_LLM_API_KEY").unwrap_or_default(),
            tts_provider: std::env::var("TIALYNN_TTS_PROVIDER")
                .unwrap_or_else(|_| "macos_say".to_string()),
            tts_sidecar_url: std::env::var("TIALYNN_TTS_SIDECAR_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:5050".to_string()),
            idle_min_sec: 8,
            idle_max_sec: 15,
            autocomment_interval_sec: 300,
            emotion_decay_per_minute: 0.05,
            flip_probability: 0.15,
            emotion_voice_map: default_emotion_voice_map(),
            embedding_endpoint: std::env::var("TIALYNN_EMBEDDING_ENDPOINT").unwrap_or_default(),
            embedding_model: std::env::var("TIALYNN_EMBEDDING_MODEL")
                .unwrap_or_else(|_| "text-embedding-3-small".to_string()),
        }
    }
}

fn default_emotion_voice_map() -> HashMap<String, String> {
    let mut m = HashMap::new();
    for k in ["neutral", "happy", "shy", "angry", "sad", "sleepy", "possessive"] {
        m.insert(k.into(), "edge_xiaoxiao".into());
    }
    m
}

/// 全局应用状态。Tauri manage 之后通过 State 注入到 command。
pub struct AppState {
    soul: RwLock<Option<SoulConfig>>,
    emotion: RwLock<String>,
    memory: Arc<MemoryStore>,
    config: Mutex<RuntimeConfig>,
    sidecar: Arc<SidecarManager>,
    alpha_mask: SharedMask,
    stt: SttRecorder,
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
            *g = cfg.clone();
        }
        self.sidecar.set_url(cfg.tts_sidecar_url);
    }
    pub fn sidecar(&self) -> Arc<SidecarManager> {
        self.sidecar.clone()
    }
    pub fn alpha_mask(&self) -> SharedMask {
        self.alpha_mask.clone()
    }
    pub fn stt(&self) -> SttRecorder {
        self.stt.clone()
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

    let default_cfg = RuntimeConfig::default();
    let sidecar = Arc::new(SidecarManager::new(default_cfg.tts_sidecar_url.clone()));
    let alpha_mask: SharedMask = Arc::new(RwLock::new(AlphaMask::default()));

    let state = AppState {
        soul: RwLock::new(None),
        emotion: RwLock::new("neutral".into()),
        memory,
        config: Mutex::new(default_cfg),
        sidecar,
        alpha_mask,
        stt: SttRecorder::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .setup(|app| {
            // 启动时尝试加载磁盘上的运行时配置
            if let Some(cfg_dir) = dirs::config_dir() {
                let path = cfg_dir.join("TiaLynn").join("config.json");
                if path.exists() {
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        match serde_json::from_str::<infra::config::ConfigDto>(&text) {
                            Ok(dto) => {
                                let s = app.state::<AppState>();
                                s.replace_runtime_config(dto.into());
                                tracing::info!("loaded runtime config from {}", path.display());
                            }
                            Err(e) => {
                                tracing::warn!("config.json parse failed: {e}");
                            }
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
                tracing::warn!("no soul yaml located on startup");
            }

            // 灵魂热重载 watcher
            spawn_soul_watcher(app.handle().clone());

            // 主窗口微调（置顶、跨 space）
            avatar::window::configure_main_window(app.handle());

            // 全局鼠标轮询 → 窗口外穿透、窗口内可交互
            let mask = app.state::<AppState>().alpha_mask();
            avatar::window::spawn_mouse_tracker(app.handle().clone(), mask);

            // 异步拉起 sidecar（不阻塞启动）
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let s = app_handle.state::<AppState>();
                    let _ = s.sidecar().ensure_running().await;
                    let st = s.sidecar().state();
                    tracing::info!(
                        "sidecar status={:?} url={} err={:?}",
                        st.status,
                        st.url,
                        st.last_error
                    );
                });
            }

            // 全局快捷键：F8 push-to-talk
            register_stt_shortcut(app.handle())?;

            // 系统托盘
            infra::tray::build_tray(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // infra
            infra::soul_commands::soul_load,
            infra::soul_commands::soul_resolve_asset,
            infra::config::config_load,
            infra::config::config_save,
            infra::config::config_test_llm,
            infra::system::system_clear_history,
            infra::system::system_reveal_data_dir,
            infra::system::system_reveal_models_dir,
            infra::system::system_version,
            // avatar
            avatar::commands::window_set_ignore_cursor,
            avatar::commands::window_toggle_visible,
            avatar::commands::window_start_drag,
            avatar::commands::window_set_position,
            avatar::commands::window_get_position,
            avatar::commands::window_set_alpha_mask,
            avatar::models::models_scan,
            avatar::models::models_add_search_path,
            avatar::models::models_remove_search_path,
            avatar::models::models_list_search_paths,
            // brain
            brain::chat::chat_send,
            brain::chat::chat_send_proactive,
            brain::memory::commands::memory_recent,
            brain::memory::commands::memory_append_observation,
            brain::memory::distill::memory_distill,
            // presence
            presence::tts_commands::tts_speak,
            presence::sidecar_commands::sidecar_status,
            presence::sidecar_commands::sidecar_start,
            presence::sidecar_commands::sidecar_stop,
            presence::sidecar_commands::tts_list_voices,
            presence::sidecar_commands::tts_register_voices_dir,
            presence::sidecar_commands::tts_example_voice_dir,
            presence::sidecar_commands::sidecar_install_status,
            presence::sidecar_commands::sidecar_install_run,
            presence::stt_commands::stt_status,
            presence::stt_commands::stt_toggle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn register_stt_shortcut(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use crate::presence::stt::SttStatus;
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let f8 = Shortcut::new(Some(Modifiers::empty()), Code::F8);
    let app_for_cb = app.clone();
    let gs = app.global_shortcut();
    let _ = gs.on_shortcut(f8, move |_app, _sc, event| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        let app = app_for_cb.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            let stt = state.stt();
            match stt.status() {
                SttStatus::Idle => {
                    if let Err(e) = stt.start_recording() {
                        let _ = app.emit("stt::error", e.to_string());
                        return;
                    }
                    let _ = app.emit("stt::started", ());
                }
                SttStatus::Recording => {
                    let wav = match stt.stop_and_save() {
                        Ok(p) => p,
                        Err(e) => {
                            let _ = app.emit("stt::error", e.to_string());
                            return;
                        }
                    };
                    let _ = app.emit("stt::transcribing", ());
                    let cfg = state.runtime_config();
                    let sidecar_url = cfg.tts_sidecar_url.clone();
                    let stt_clone = stt.clone();
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        match crate::presence::stt_commands::__transcribe(&sidecar_url, &wav).await
                        {
                            Ok(text) => {
                                stt_clone.set_result(Ok(text.clone()));
                                let _ = app2.emit("stt::result", text);
                            }
                            Err(e) => {
                                stt_clone.set_result(Err(e.to_string()));
                                let _ = app2.emit("stt::error", e.to_string());
                            }
                        }
                        let _ = std::fs::remove_file(&wav);
                    });
                }
                SttStatus::Transcribing => {}
            }
        });
    });
    let _ = gs.register(f8);
    Ok(())
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

// 让 AppError 暴露在 lib root（旧 import 兼容）
pub use crate::infra::error as error;
