//! Rust 端事件名常量。
//!
//! Rust ↔ 前端 跨进程通信用 Tauri 的 emit/listen，事件名集中定义在这里
//! 避免代码里散落字符串字面量。

#[allow(dead_code)]
pub mod ev {
    // Infra
    pub const INFRA_CONFIG_LOADED: &str = "infra:config_loaded";
    pub const INFRA_CONFIG_CHANGED: &str = "infra:config_changed";
    pub const INFRA_SOUL_RELOADED: &str = "infra:soul_reloaded";
    pub const INFRA_HOTKEY: &str = "infra:hotkey_pressed";

    // Brain
    pub const BRAIN_CHAT_INPUT: &str = "brain:chat_input";
    pub const BRAIN_REPLY_TOKEN: &str = "brain:reply_token";
    pub const BRAIN_REPLY_END: &str = "brain:reply_end";
    pub const BRAIN_EMOTION_CHANGED: &str = "brain:emotion_changed";

    // Avatar
    pub const AVATAR_MOUSE_GLOBAL: &str = "avatar:mouse_global";
    pub const AVATAR_MODEL_LOADED: &str = "avatar:model_loaded";

    // Presence
    pub const PRESENCE_TTS_START: &str = "presence:tts_start";
    pub const PRESENCE_TTS_END: &str = "presence:tts_end";
    pub const PRESENCE_STT_START: &str = "presence:stt_start";
    pub const PRESENCE_STT_RESULT: &str = "presence:stt_result";
    pub const PRESENCE_STT_ERROR: &str = "presence:stt_error";
    pub const PRESENCE_STT_TRANSCRIBING: &str = "presence:stt_transcribing";

    // Hands (M4)
    pub const HANDS_TOOL_REQUEST: &str = "hands:tool_request";
    pub const HANDS_TOOL_RESULT: &str = "hands:tool_result";
    pub const HANDS_APPROVAL_REQUIRED: &str = "hands:approval_required";

    // Sidecar
    pub const SIDECAR_INSTALL_LOG: &str = "sidecar:install_log";
    pub const SIDECAR_INSTALL_DONE: &str = "sidecar:install_done";
}
