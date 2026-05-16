use crate::infra::error::AppResult;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    /// 唯一 dir id：相对 root 的路径（带斜杠分隔），URL 一部分使用
    pub dir: String,
    /// 入口文件名（*.model3.json 或 model.json）
    pub model_file: String,
    /// 物理绝对路径
    pub absolute_path: String,
    /// "builtin" | "user" | "external_<idx>"
    pub source: String,
    /// "cubism4" | "cubism2"
    pub cubism: String,
    /// 友好显示名（路径末段 + 父目录拼接）
    pub display: String,
    /// root id：哪个搜索根（前端做分组显示用）
    pub root_id: String,
}

const MAX_RESULTS: usize = 4000;
const MAX_DEPTH_PROJECT: usize = 2; // 项目根只看一层
const MAX_DEPTH_EXTERNAL: usize = 5; // 外部库递归 5 层

/// 用户额外搜索路径独立 JSON 文件，与 soul.avatar.search_paths 合并使用。
fn extra_paths_file() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
        .join("extra_model_dirs.json")
}

fn load_extra_paths() -> Vec<String> {
    let path = extra_paths_file();
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

fn save_extra_paths(dirs: &[String]) -> AppResult<()> {
    let path = extra_paths_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(dirs)?)?;
    Ok(())
}

#[tauri::command]
pub async fn models_scan() -> AppResult<Vec<ModelInfo>> {
    let mut out: Vec<ModelInfo> = Vec::new();

    // 1. 项目根（内置 HuTao-Live2D 等）
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    scan_recursive(
        &project_root,
        "project",
        "builtin",
        &mut out,
        0,
        MAX_DEPTH_PROJECT,
        true,
    );

    // 2. ~/.tialynn/models/
    let user_root = dirs::home_dir()
        .unwrap_or_default()
        .join(".tialynn")
        .join("models");
    scan_recursive(
        &user_root,
        "user",
        "user",
        &mut out,
        0,
        MAX_DEPTH_EXTERNAL,
        false,
    );

    // 3. 自定义额外路径（独立 JSON 文件）
    for (idx, p) in load_extra_paths().iter().enumerate() {
        if out.len() >= MAX_RESULTS {
            break;
        }
        let path = expand_tilde(p);
        let root_id = format!("extra_{idx}");
        scan_recursive(
            &path,
            &root_id,
            &format!("external_{idx}"),
            &mut out,
            0,
            MAX_DEPTH_EXTERNAL,
            false,
        );
    }

    Ok(out)
}

fn expand_tilde(p: &str) -> PathBuf {
    if let Some(stripped) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(p)
}

fn scan_recursive(
    root: &Path,
    root_id: &str,
    source: &str,
    out: &mut Vec<ModelInfo>,
    depth: usize,
    max_depth: usize,
    only_obvious: bool,
) {
    if out.len() >= MAX_RESULTS {
        return;
    }
    if !root.exists() || !root.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_RESULTS {
            return;
        }
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        // 跳过隐藏 / 明显非模型目录
        if name.is_empty()
            || name.starts_with('.')
            || matches!(
                name.as_str(),
                "node_modules"
                    | "src"
                    | "src-tauri"
                    | "dist"
                    | "docs"
                    | "public"
                    | "scripts"
                    | "sidecar"
                    | "icons"
                    | "target"
                    | "example_voice"
                    | "__pycache__"
                    | ".venv"
                    | "venv"
            )
        {
            continue;
        }

        if !path.is_dir() {
            continue;
        }

        // 项目根第一层只看明显是 Live2D 的目录
        if only_obvious && depth == 0 {
            let lower = name.to_lowercase();
            let looks_like = lower.contains("live2d")
                || lower.ends_with(".model")
                || lower.ends_with("-model")
                || has_model_file(&path);
            if !looks_like {
                continue;
            }
        }

        // 先检查本目录是否有 model file
        if let Some((file, cubism)) = find_model_file(&path) {
            let rel = path
                .strip_prefix(root)
                .map(|r| r.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.clone());
            let parent = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let display = if parent.is_empty() || parent == root_id {
                name.clone()
            } else {
                format!("{} · {}", parent, name)
            };
            out.push(ModelInfo {
                dir: rel,
                model_file: file,
                absolute_path: path.to_string_lossy().to_string(),
                source: source.into(),
                cubism: cubism.into(),
                display,
                root_id: root_id.into(),
            });
            // 找到了模型就不再深入这个目录（典型 Live2D 模型不会嵌套）
            continue;
        }

        // 否则继续递归
        if depth + 1 <= max_depth {
            scan_recursive(&path, root_id, source, out, depth + 1, max_depth, false);
        }
    }
}

fn has_model_file(dir: &Path) -> bool {
    find_model_file(dir).is_some()
}

/// 返回 (entry_file_name, "cubism4"|"cubism2")。
/// 优先 model3.json，再 model.json。
fn find_model_file(dir: &Path) -> Option<(String, &'static str)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut found_model3: Option<String> = None;
    let mut found_model_json: Option<String> = None;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.ends_with(".model3.json") {
            found_model3 = Some(name.to_string());
        } else if name == "model.json" {
            found_model_json = Some(name.to_string());
        }
    }
    if let Some(n) = found_model3 {
        return Some((n, "cubism4"));
    }
    if let Some(n) = found_model_json {
        return Some((n, "cubism2"));
    }
    None
}

#[tauri::command]
pub async fn models_add_search_path(path: String) -> AppResult<Vec<String>> {
    let mut paths = load_extra_paths();
    let trimmed = path.trim().to_string();
    if !trimmed.is_empty() && !paths.contains(&trimmed) {
        paths.push(trimmed);
    }
    save_extra_paths(&paths)?;
    Ok(paths)
}

#[tauri::command]
pub async fn models_remove_search_path(path: String) -> AppResult<Vec<String>> {
    let mut paths = load_extra_paths();
    paths.retain(|p| *p != path);
    save_extra_paths(&paths)?;
    Ok(paths)
}

#[tauri::command]
pub fn models_list_search_paths() -> Vec<String> {
    load_extra_paths()
}
