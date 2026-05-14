use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML parse: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP: {0}")]
    Http(#[from] reqwest::Error),

    #[error("SQLite: {0}")]
    Sql(#[from] rusqlite::Error),

    #[error("Tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Soul config not found at {0}")]
    SoulNotFound(String),

    #[error("LLM endpoint not configured")]
    LlmNotConfigured,

    #[error("Other: {0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
