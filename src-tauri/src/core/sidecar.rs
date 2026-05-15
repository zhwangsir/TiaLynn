//! 管理 Python TTS sidecar 子进程：spawn / kill / health probe。
//!
//! 策略：
//! 1. 启动时先 probe `http://127.0.0.1:5050/healthz`，若已有进程在跑直接复用
//! 2. 否则尝试 spawn：`python3 -m uvicorn main:app --host 127.0.0.1 --port 5050`
//!    工作目录指向 `<项目根>/sidecar/qwen-tts-server/`
//! 3. spawn 失败 / probe 不通时 SidecarStatus = Inactive，TTS 会降级到 macos_say

use crate::error::AppResult;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum SidecarStatus {
    Inactive,
    Probing,
    External, // 探测到已运行（用户自己起的）
    Spawned,  // 我们启动的
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarState {
    pub status: SidecarStatus,
    pub url: String,
    pub last_error: Option<String>,
}

pub struct SidecarManager {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    status: SidecarStatus,
    last_error: Option<String>,
    child: Option<Child>,
    url: String,
}

impl SidecarManager {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                status: SidecarStatus::Inactive,
                last_error: None,
                child: None,
                url: url.into(),
            })),
        }
    }

    pub fn state(&self) -> SidecarState {
        let g = self.inner.lock().unwrap();
        SidecarState {
            status: g.status,
            url: g.url.clone(),
            last_error: g.last_error.clone(),
        }
    }

    pub fn set_url(&self, url: String) {
        let mut g = self.inner.lock().unwrap();
        g.url = url;
    }

    /// 探测 + 必要时启动。
    pub async fn ensure_running(&self) -> AppResult<SidecarState> {
        // 1. 先探测当前 URL
        {
            let mut g = self.inner.lock().unwrap();
            g.status = SidecarStatus::Probing;
            g.last_error = None;
        }

        let url = self.state().url.clone();
        if probe(&url).await {
            let mut g = self.inner.lock().unwrap();
            // 如果是我们自己 spawn 的 child 还在 → 保持 Spawned，否则 External
            g.status = if g.child.is_some() {
                SidecarStatus::Spawned
            } else {
                SidecarStatus::External
            };
            return Ok(SidecarState {
                status: g.status,
                url,
                last_error: None,
            });
        }

        // 2. 尝试 spawn
        let py_dir = sidecar_dir();
        if !py_dir.exists() {
            let mut g = self.inner.lock().unwrap();
            g.status = SidecarStatus::Failed;
            g.last_error = Some(format!("sidecar dir not found: {}", py_dir.display()));
            return Ok(SidecarState {
                status: g.status,
                url,
                last_error: g.last_error.clone(),
            });
        }

        match try_spawn(&py_dir) {
            Ok(child) => {
                {
                    let mut g = self.inner.lock().unwrap();
                    g.child = Some(child);
                    g.status = SidecarStatus::Spawned;
                }
                // 等待 up to 8s，直到 healthz 通
                for _ in 0..40 {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    if probe(&url).await {
                        return Ok(self.state());
                    }
                }
                let mut g = self.inner.lock().unwrap();
                g.status = SidecarStatus::Failed;
                g.last_error = Some("sidecar spawned but healthz never returned 200".into());
                Ok(SidecarState {
                    status: g.status,
                    url: g.url.clone(),
                    last_error: g.last_error.clone(),
                })
            }
            Err(e) => {
                let mut g = self.inner.lock().unwrap();
                g.status = SidecarStatus::Failed;
                g.last_error = Some(format!("spawn failed: {e}"));
                Ok(SidecarState {
                    status: g.status,
                    url: g.url.clone(),
                    last_error: g.last_error.clone(),
                })
            }
        }
    }

    /// 杀掉我们自己 spawn 的子进程（不影响外部已有进程）。
    pub fn stop(&self) {
        let mut g = self.inner.lock().unwrap();
        if let Some(mut child) = g.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        g.status = SidecarStatus::Inactive;
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}

fn sidecar_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("qwen-tts-server"))
        .unwrap_or_else(|| PathBuf::from("sidecar/qwen-tts-server"))
}

fn try_spawn(py_dir: &Path) -> std::io::Result<Child> {
    // 优先用 venv 里的 python
    let venv_py = py_dir.join(".venv").join("bin").join("python");
    let py = if venv_py.exists() {
        venv_py
    } else {
        PathBuf::from("python3")
    };

    Command::new(py)
        .args([
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "5050",
        ])
        .current_dir(py_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

async fn probe(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let target = format!("{}/healthz", url.trim_end_matches('/'));
    match client.get(&target).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}
