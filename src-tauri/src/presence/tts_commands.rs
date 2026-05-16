use crate::presence::tts::{build_provider, MacOsSayProvider, SidecarHttpProvider, TtsProvider};
use crate::infra::error::AppResult;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn tts_speak(
    state: State<'_, AppState>,
    text: String,
    emotion: String,
) -> AppResult<String> {
    let cfg = state.runtime_config();
    let soul = state.soul();

    // 情绪 → voice 路由：优先 RuntimeConfig.emotion_voice_map，再 soul yaml，最后默认
    let voice_id = cfg
        .emotion_voice_map
        .get(&emotion)
        .cloned()
        .or_else(|| {
            soul.as_ref()
                .and_then(|s| s.tts.emotion_routing.get(&emotion).cloned())
        })
        .unwrap_or_else(|| {
            soul.as_ref()
                .map(|s| s.tts.voice_id.clone())
                .unwrap_or_else(|| "edge_xiaoxiao".to_string())
        });

    // 先按用户选择的 provider 尝试；失败则降级
    let primary: Box<dyn TtsProvider> = build_provider(&cfg.tts_provider, Some(&cfg.tts_sidecar_url));
    let r = primary.speak(&text, &emotion, &voice_id).await;
    match r {
        Ok(p) => Ok(p.to_string_lossy().to_string()),
        Err(e) => {
            tracing::warn!("primary TTS ({}) failed: {e}; falling back", primary.name());
            // sidecar 失败 → 试 macos_say；macos_say 失败 → 真的报
            if primary.name() != "macos_say" {
                let fallback = Box::new(MacOsSayProvider) as Box<dyn TtsProvider>;
                let p = fallback.speak(&text, &emotion, "Tingting").await?;
                return Ok(p.to_string_lossy().to_string());
            }
            // 把无用变量 suppress
            let _ = SidecarHttpProvider {
                base_url: cfg.tts_sidecar_url.clone(),
            };
            Err(e)
        }
    }
}
