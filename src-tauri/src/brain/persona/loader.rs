use crate::infra::error::{AppError, AppResult};
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
    /// 智能加载：
    /// - path 是单文件 → 旧 schema（向后兼容 default.yaml）
    /// - path 是目录 → 多文件加载（soul/identity.yaml + personality.yaml + ...）
    pub fn load_from_path(path: &Path) -> AppResult<Self> {
        if !path.exists() {
            return Err(AppError::SoulNotFound(path.display().to_string()));
        }
        if path.is_dir() {
            Self::load_from_soul_dir(path)
        } else {
            let text = std::fs::read_to_string(path)?;
            let cfg: SoulConfig = serde_yaml::from_str(&text)?;
            Ok(cfg)
        }
    }

    /// 从 soul/ 多文件加载并合成。
    ///
    /// 字段映射：
    /// - identity.yaml → identity + appearance + speech_style.call_master_as
    /// - personality.yaml → personality + speech_style 其余字段
    /// - core_memories.yaml → 暂存（M3 接入 RAG，不进当前 schema）
    /// - learned_traits.yaml → learned_traits
    pub fn load_from_soul_dir(dir: &Path) -> AppResult<Self> {
        let identity_yaml = dir.join("identity.yaml");
        let personality_yaml = dir.join("personality.yaml");
        let learned_yaml = dir.join("learned_traits.yaml");

        // identity.yaml 必填
        if !identity_yaml.exists() || !personality_yaml.exists() {
            return Err(AppError::SoulNotFound(format!(
                "soul/ 目录缺少 identity.yaml 或 personality.yaml：{}",
                dir.display()
            )));
        }

        let id_text = std::fs::read_to_string(&identity_yaml)?;
        let id_val: serde_yaml::Value = serde_yaml::from_str(&id_text)?;
        let p_text = std::fs::read_to_string(&personality_yaml)?;
        let p_val: serde_yaml::Value = serde_yaml::from_str(&p_text)?;

        let identity = Identity {
            name: str_of(&id_val, "name").unwrap_or_else(|| "TiaLynn".into()),
            master: str_of(&id_val, "master").unwrap_or_else(|| "master".into()),
            birthday: str_of(&id_val, "birthday").unwrap_or_else(|| "2026-05-15".into()),
        };

        let avatar = id_val.get("avatar");
        let appearance = Appearance {
            live2d_model_dir: avatar
                .and_then(|a| a.get("model_dir"))
                .and_then(|v| v.as_str())
                .unwrap_or("HuTao-Live2D")
                .into(),
            model_file: avatar
                .and_then(|a| a.get("model_file"))
                .and_then(|v| v.as_str())
                .unwrap_or("Hu Tao.model3.json")
                .into(),
            anchor: Anchor {
                scale: avatar
                    .and_then(|a| a.get("scale"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.35) as f32,
                x_offset: 0.0,
                y_offset: avatar
                    .and_then(|a| a.get("offset_y"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(50.0) as f32,
            },
        };

        let personality = Personality {
            layer1_core: str_of(&p_val, "layer1_core").unwrap_or_default(),
            layer2_surface: str_of(&p_val, "layer2_surface").unwrap_or_default(),
            layer3_volatility: p_val
                .get("layer3_volatility")
                .and_then(|v| serde_yaml::from_value(v.clone()).ok())
                .unwrap_or(Volatility {
                    flip_probability: 0.15,
                    flip_modes: vec![],
                }),
        };

        let speech_style: SpeechStyle = p_val
            .get("speech_style")
            .and_then(|v| {
                let mut m: serde_yaml::Mapping =
                    serde_yaml::from_value(v.clone()).unwrap_or_default();
                if !m.contains_key("call_master_as") {
                    if let Some(c) = id_val.get("call_master_as") {
                        m.insert("call_master_as".into(), c.clone());
                    }
                }
                serde_yaml::from_value::<SpeechStyle>(serde_yaml::Value::Mapping(m)).ok()
            })
            .unwrap_or(SpeechStyle {
                max_length: 80,
                use_emoticons: true,
                signature_lines: vec![],
                call_master_as: str_of(&id_val, "call_master_as").unwrap_or_else(|| "主人".into()),
            });

        // emotions / behavior / tts / vision 在 multi-file schema 里暂无对应字段，
        // 给 sensible defaults（M2 加完整支持）。
        let emotions = EmotionsCfg {
            initial: "neutral".into(),
            decay_per_minute: 0.05,
            states: HashMap::new(),
        };
        let behavior = Behavior {
            tick_interval_sec: 30,
            auto_comment_interval_sec: 300,
            curiosity_threshold: 60,
            energy_sleep_threshold: 20,
        };
        let tts = TtsCfg {
            provider: "macos_say".into(),
            voice_id: "Tingting".into(),
            speed: 1.0,
            pitch_shift: 0.0,
            emotion_routing: HashMap::new(),
        };

        let learned_traits = if learned_yaml.exists() {
            std::fs::read_to_string(&learned_yaml)
                .ok()
                .and_then(|t| serde_yaml::from_str::<LearnedTraits>(&t).ok())
                .unwrap_or_default()
        } else {
            LearnedTraits::default()
        };

        Ok(SoulConfig {
            schema_version: "2.0".into(),
            identity,
            appearance,
            personality,
            speech_style,
            emotions,
            behavior,
            learned_traits,
            tts,
            vision: VisionCfg::default(),
        })
    }

    /// 拼合三层人格 system prompt（核心算法）。
    ///
    /// `flip_probability_override`：若 Some 则用之，否则用 yaml 内的概率
    /// （让 RuntimeConfig 可覆盖）。
    pub fn build_system_prompt(
        &self,
        emotion: &str,
        history_summary: Option<&str>,
        flip_probability_override: Option<f32>,
    ) -> String {
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
            String::new(),
            String::from("## 输出格式（重要）"),
            String::from(
                "把你的回复包成一个 JSON：{\"text\":\"回复内容\",\"emotion\":\"<情绪>\",\"intensity\":0.0~1.0}\n\
                 情绪只能是这 7 个之一：neutral, happy, shy, angry, sad, sleepy, possessive。\n\
                 intensity 表示这次情绪的强度（0 为无、1 为最强）。\n\
                 只输出这一个 JSON，不要任何解释、不要 Markdown 代码块。",
            ),
        ];

        let p = flip_probability_override.unwrap_or(self.personality.layer3_volatility.flip_probability);
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

fn str_of(v: &serde_yaml::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
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

/// 在多个候选位置寻找灵魂档案。
/// 优先级：
/// 1. ~/.tialynn/soul/                   （用户优先，多文件）
/// 2. <项目根>/soul/                     （v0.4+ 多文件结构）
/// 3. ~/.tialynn/soul/active.yaml         （旧用户副本）
/// 4. <项目根>/default.yaml               （旧单文件兼容）
/// 5. <可执行目录>/default.yaml           （打包后）
pub fn locate_default_soul() -> Option<PathBuf> {
    if let Some(home) = dirs::home_dir() {
        let user_dir = home.join(".tialynn").join("soul");
        if user_dir.join("identity.yaml").exists() {
            return Some(user_dir);
        }
        let user_legacy = home.join(".tialynn").join("soul").join("active.yaml");
        if user_legacy.exists() {
            return Some(user_legacy);
        }
    }

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = Path::new(manifest_dir).parent();
    if let Some(root) = project_root {
        let soul_dir = root.join("soul");
        if soul_dir.join("identity.yaml").exists() {
            return Some(soul_dir);
        }
        let legacy = root.join("default.yaml");
        if legacy.exists() {
            return Some(legacy);
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
