use crate::brain::memory::store::StoredMessage;
use crate::infra::error::AppResult;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn memory_recent(
    state: State<'_, AppState>,
    limit: usize,
) -> AppResult<Vec<StoredMessage>> {
    state.memory().recent_messages(limit.max(1).min(200))
}

#[tauri::command]
pub async fn memory_append_observation(
    state: State<'_, AppState>,
    source: String,
    raw: String,
    summary: Option<String>,
) -> AppResult<i64> {
    state
        .memory()
        .append_observation(&source, &raw, summary.as_deref())
}
