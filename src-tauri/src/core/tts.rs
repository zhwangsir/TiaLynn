use crate::error::AppResult;
use async_trait::async_trait;
use std::path::PathBuf;
use std::process::Command;

#[async_trait]
pub trait TtsProvider: Send + Sync {
    /// 将文本合成为音频文件，返回路径。
    async fn speak(&self, text: &str, emotion: &str, voice_id: &str) -> AppResult<PathBuf>;
    fn name(&self) -> &'static str;
}

/// macOS 内置 `say` 命令，v0.1 默认 fallback，零依赖。
/// 输出 AIFF（macOS say 原生格式，浏览器可直接播放）。
pub struct MacOsSayProvider;

#[async_trait]
impl TtsProvider for MacOsSayProvider {
    async fn speak(&self, text: &str, _emotion: &str, voice_id: &str) -> AppResult<PathBuf> {
        let cache = tts_cache_dir();
        std::fs::create_dir_all(&cache)?;
        let out = cache.join(format!("say_{}.aiff", uuid::Uuid::new_v4()));

        let voice = if voice_id.is_empty() || voice_id == "default" {
            "Tingting" // macOS 自带中文女声
        } else {
            voice_id
        };

        let status = Command::new("say")
            .arg("-v")
            .arg(voice)
            .arg("-o")
            .arg(&out)
            .arg(text)
            .status()?;

        if !status.success() {
            return Err(crate::error::AppError::Other(format!(
                "say exited with status {}",
                status
            )));
        }
        Ok(out)
    }

    fn name(&self) -> &'static str {
        "macos_say"
    }
}

/// Sidecar HTTP TTS（v0.2 启用：Qwen3-TTS Python sidecar）。
/// v0.1 占位实现：当 sidecar 不可达时直接报错，由上层切换 fallback。
pub struct SidecarHttpProvider {
    pub base_url: String,
}

#[async_trait]
impl TtsProvider for SidecarHttpProvider {
    async fn speak(&self, text: &str, emotion: &str, voice_id: &str) -> AppResult<PathBuf> {
        let client = reqwest::Client::new();
        let url = format!("{}/v1/audio/speech", self.base_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .json(&serde_json::json!({
                "text": text,
                "voice": voice_id,
                "emotion": emotion,
            }))
            .send()
            .await?
            .error_for_status()?;
        let bytes = resp.bytes().await?;
        let cache = tts_cache_dir();
        std::fs::create_dir_all(&cache)?;
        let out = cache.join(format!("sidecar_{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&out, &bytes)?;
        Ok(out)
    }

    fn name(&self) -> &'static str {
        "sidecar"
    }
}

pub fn tts_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
        .join("tts")
}

/// 工厂：根据 provider 字符串和 sidecar_url 选择实现。
pub fn build_provider(provider: &str, sidecar_url: Option<&str>) -> Box<dyn TtsProvider> {
    match provider {
        "sidecar" => Box::new(SidecarHttpProvider {
            base_url: sidecar_url
                .unwrap_or("http://127.0.0.1:5050")
                .to_string(),
        }),
        // macos_say 是默认 fallback
        _ => Box::new(MacOsSayProvider),
    }
}
