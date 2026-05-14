use crate::core::tts::build_provider;
use crate::error::AppResult;
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
    let voice_id = soul
        .as_ref()
        .and_then(|s| s.tts.emotion_routing.get(&emotion).cloned())
        .unwrap_or_else(|| {
            soul.as_ref()
                .map(|s| s.tts.voice_id.clone())
                .unwrap_or_else(|| "default".to_string())
        });

    let provider = build_provider(&cfg.tts_provider, Some(&cfg.tts_sidecar_url));
    let path = provider.speak(&text, &emotion, &voice_id).await?;
    Ok(path.to_string_lossy().to_string())
}
