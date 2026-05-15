use crate::error::AppResult;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    /// 模型目录名（相对 model root，作为 URL 一部分使用）
    pub dir: String,
    /// model3.json 文件名
    pub model_file: String,
    /// 物理绝对路径（仅供 reveal in finder）
    pub absolute_path: String,
    /// 来源：内置 / 用户上传
    pub source: String,
}

/// 扫描两个根目录里的所有 Live2D 模型：
/// 1. <项目根>/  (内置：如 HuTao-Live2D)
/// 2. ~/.tialynn/models/ (用户上传)
///
/// 每个候选子目录如果含 *.model3.json 就识别为一个模型。
#[tauri::command]
pub async fn models_scan() -> AppResult<Vec<ModelInfo>> {
    let mut out = Vec::new();

    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let user_root = dirs::home_dir()
        .unwrap_or_default()
        .join(".tialynn")
        .join("models");

    scan_into(&project_root, "builtin", &mut out, true);
    scan_into(&user_root, "user", &mut out, false);
    Ok(out)
}

fn scan_into(root: &Path, source: &str, out: &mut Vec<ModelInfo>, only_obvious: bool) {
    if !root.exists() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let dir_name = dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        // 忽略明显非模型目录（避免扫到 src/、node_modules/ 这种）
        if only_obvious {
            let is_likely_model = dir_name.to_lowercase().contains("live2d")
                || dir_name.ends_with(".model")
                || has_model3_at_top_level(&dir);
            if !is_likely_model {
                continue;
            }
        }
        if let Some(model_file) = find_model3_json(&dir) {
            out.push(ModelInfo {
                dir: dir_name,
                model_file: model_file
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                absolute_path: model_file.to_string_lossy().to_string(),
                source: source.into(),
            });
        }
    }
}

fn has_model3_at_top_level(dir: &Path) -> bool {
    find_model3_json(dir).is_some()
}

fn find_model3_json(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
            if name.ends_with(".model3.json") {
                return Some(p);
            }
        }
    }
    None
}
