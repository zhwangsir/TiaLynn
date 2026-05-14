use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulConfig {
    pub schema_version: String,
    pub identity: Identity,
    pub appearance: Appearance,
    pub personality: Personality,
    pub speech_style: SpeechStyle,
    pub emotions: EmotionsCfg,
    pub behavior: Behavior,
    #[serde(default)]
    pub learned_traits: LearnedTraits,
    pub tts: TtsCfg,
    #[serde(default)]
    pub vision: VisionCfg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub name: String,
    pub master: String,
    pub birthday: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Appearance {
    pub live2d_model_dir: String,
    pub model_file: String,
    pub anchor: Anchor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anchor {
    pub scale: f32,
    pub x_offset: f32,
    pub y_offset: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Personality {
    pub layer1_core: String,
    pub layer2_surface: String,
    pub layer3_volatility: Volatility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volatility {
    pub flip_probability: f32,
    pub flip_modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeechStyle {
    pub max_length: u32,
    pub use_emoticons: bool,
    pub signature_lines: Vec<String>,
    pub call_master_as: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionsCfg {
    pub initial: String,
    pub decay_per_minute: f32,
    pub states: HashMap<String, EmotionState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionState {
    pub color: String,
    #[serde(default)]
    pub live2d: HashMap<String, f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Behavior {
    pub tick_interval_sec: u32,
    pub auto_comment_interval_sec: u32,
    pub curiosity_threshold: u32,
    pub energy_sleep_threshold: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LearnedTraits {
    #[serde(default)]
    pub observed_keywords: Vec<String>,
    #[serde(default)]
    pub master_routines: Vec<String>,
    #[serde(default)]
    pub preference_drift: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsCfg {
    pub provider: String,
    pub voice_id: String,
    pub speed: f32,
    pub pitch_shift: f32,
    #[serde(default)]
    pub emotion_routing: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VisionCfg {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub sampling_interval_sec: u32,
}

impl SoulConfig {
    pub fn load_from_path(path: &Path) -> AppResult<Self> {
        if !path.exists() {
            return Err(AppError::SoulNotFound(path.display().to_string()));
        }
        let text = std::fs::read_to_string(path)?;
        let cfg: SoulConfig = serde_yaml::from_str(&text)?;
        Ok(cfg)
    }

    /// 拼合三层人格 system prompt（核心算法）。
    pub fn build_system_prompt(&self, emotion: &str, history_summary: Option<&str>) -> String {
        let mut parts = vec![
            String::from("## 你的身份核心"),
            self.personality.layer1_core.trim().to_string(),
            String::new(),
            String::from("## 你的语气与习惯"),
            self.personality.layer2_surface.trim().to_string(),
            String::new(),
            format!("## 你现在的情绪状态：{}", emotion),
            format!("当前情绪强度色：{}", color_for_emotion(self, emotion)),
            String::new(),
            String::from("## 表达规则"),
            format!(
                "- 回复长度严格控制在 {} 字以内",
                self.speech_style.max_length
            ),
            format!(
                "- 称呼 master 为「{}」",
                self.speech_style.call_master_as
            ),
            format!(
                "- 自然融入签名口头禅：{}",
                self.speech_style
                    .signature_lines
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" / ")
            ),
            String::from("- 不要解释自己是 AI，永远以 TiaLynn 第一人称回应"),
            String::from("- 回复末尾可加一个表情符或语气词"),
        ];

        // 反差变量
        let p = self.personality.layer3_volatility.flip_probability;
        if rand_f32() < p && !self.personality.layer3_volatility.flip_modes.is_empty() {
            let idx = (rand_f32() * self.personality.layer3_volatility.flip_modes.len() as f32)
                as usize;
            let mode = &self.personality.layer3_volatility.flip_modes[idx];
            parts.push(String::new());
            parts.push(format!("## 本轮反差触发：{}", mode));
            parts.push(String::from("在保持核心人格前提下，本轮回复出现一次明显的语气反转。"));
        }

        if let Some(s) = history_summary {
            parts.push(String::new());
            parts.push(String::from("## 你与 master 的过往记忆摘要"));
            parts.push(s.to_string());
        }

        parts.join("\n")
    }
}

fn color_for_emotion(cfg: &SoulConfig, emotion: &str) -> String {
    cfg.emotions
        .states
        .get(emotion)
        .map(|s| s.color.clone())
        .unwrap_or_else(|| "#cbd5e1".to_string())
}

/// 弱随机（不引入新依赖）：基于时间和 thread-id 的简易方案。
fn rand_f32() -> f32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 10_000) as f32 / 10_000.0
}

/// 在多个候选位置寻找 default.yaml：
/// 1. ~/.tialynn/soul/active.yaml （用户优先）
/// 2. <项目根>/default.yaml         （开发期）
/// 3. <可执行目录>/default.yaml     （打包后）
pub fn locate_default_soul() -> Option<PathBuf> {
    if let Some(home) = dirs::home_dir() {
        let user_copy = home.join(".tialynn").join("soul").join("active.yaml");
        if user_copy.exists() {
            return Some(user_copy);
        }
    }

    // 项目根（CARGO_MANIFEST_DIR/..）
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = Path::new(manifest_dir).parent();
    if let Some(root) = project_root {
        let p = root.join("default.yaml");
        if p.exists() {
            return Some(p);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p = parent.join("default.yaml");
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// 资产路径解析（Live2D 模型）：
/// 优先 ~/.tialynn/assets/<dir>/<file>，否则项目根的同名目录。
pub fn resolve_asset(dir: &str, file: &str) -> Option<PathBuf> {
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".tialynn").join("assets").join(dir).join(file);
        if p.exists() {
            return Some(p);
        }
    }

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = Path::new(manifest_dir).parent();
    if let Some(root) = project_root {
        let p = root.join(dir).join(file);
        if p.exists() {
            return Some(p);
        }
    }
    None
}
