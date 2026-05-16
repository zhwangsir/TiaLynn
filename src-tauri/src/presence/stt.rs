//! STT：cpal 录音 → 写 WAV 临时文件 → POST 给 sidecar `/v1/audio/transcribe` → 文本。
//!
//! 状态机：
//!   Idle → Recording → Transcribing → 完成回到 Idle
//!
//! 全局快捷键 F8 toggle（第一次按 = 开始，第二次按 = 停止 + 转写）。

use crate::infra::error::{AppError, AppResult};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum SttStatus {
    Idle,
    Recording,
    Transcribing,
}

#[derive(Debug, Clone, Serialize)]
pub struct SttState {
    pub status: SttStatus,
    pub last_text: Option<String>,
    pub last_error: Option<String>,
}

struct RecorderInner {
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
}

#[derive(Clone)]
pub struct SttRecorder {
    state: Arc<Mutex<SttState>>,
    stream_holder: Arc<Mutex<Option<cpal::Stream>>>,
    samples: Arc<Mutex<RecorderInner>>,
}

// cpal::Stream 不是 Send，但我们用 Arc<Mutex<>> 持有，主线程访问。
// Tauri 命令以 async fn 形式调用 + State<AppState>，state 跨线程 Send 不需要 Stream 本身 Send。
// 通过 unsafe 标记：我们保证只在主线程进行 stream 操作。
unsafe impl Send for SttRecorder {}
unsafe impl Sync for SttRecorder {}

impl SttRecorder {
    pub fn clone_arc(&self) -> Self {
        self.clone()
    }

    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(SttState {
                status: SttStatus::Idle,
                last_text: None,
                last_error: None,
            })),
            stream_holder: Arc::new(Mutex::new(None)),
            samples: Arc::new(Mutex::new(RecorderInner {
                samples: Vec::new(),
                sample_rate: 16000,
                channels: 1,
            })),
        }
    }

    pub fn snapshot(&self) -> SttState {
        self.state.lock().map(|g| g.clone()).unwrap_or_else(|_| SttState {
            status: SttStatus::Idle,
            last_text: None,
            last_error: None,
        })
    }

    pub fn status(&self) -> SttStatus {
        self.snapshot().status
    }

    pub fn start_recording(&self) -> AppResult<()> {
        if self.status() != SttStatus::Idle {
            return Ok(()); // 已在录音 → no-op
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| AppError::Other("no input audio device".into()))?;
        let supported = device
            .default_input_config()
            .map_err(|e| AppError::Other(format!("default_input_config: {e}")))?;

        let cfg = supported.config();
        let sample_format = supported.sample_format();
        let sr = cfg.sample_rate.0;
        let ch = cfg.channels;

        // 重置缓冲
        {
            let mut s = self.samples.lock().unwrap();
            s.samples.clear();
            s.sample_rate = sr;
            s.channels = ch;
        }

        let samples_for_cb = self.samples.clone();
        let err_fn = |e: cpal::StreamError| tracing::warn!("input stream error: {e}");

        let stream = match sample_format {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &cfg,
                    move |data: &[f32], _| {
                        let mut s = samples_for_cb.lock().unwrap();
                        s.samples.extend(data.iter().map(|x| (x.clamp(-1.0, 1.0) * 32767.0) as i16));
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Other(format!("build_input_stream: {e}")))?,
            cpal::SampleFormat::I16 => device
                .build_input_stream(
                    &cfg,
                    move |data: &[i16], _| {
                        let mut s = samples_for_cb.lock().unwrap();
                        s.samples.extend_from_slice(data);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Other(format!("build_input_stream: {e}")))?,
            cpal::SampleFormat::U16 => device
                .build_input_stream(
                    &cfg,
                    move |data: &[u16], _| {
                        let mut s = samples_for_cb.lock().unwrap();
                        s.samples
                            .extend(data.iter().map(|&x| (x as i32 - 32768) as i16));
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Other(format!("build_input_stream: {e}")))?,
            other => {
                return Err(AppError::Other(format!(
                    "unsupported sample format: {:?}",
                    other
                )));
            }
        };

        stream
            .play()
            .map_err(|e| AppError::Other(format!("stream.play: {e}")))?;

        *self.stream_holder.lock().unwrap() = Some(stream);
        self.state.lock().unwrap().status = SttStatus::Recording;
        Ok(())
    }

    pub fn stop_and_save(&self) -> AppResult<PathBuf> {
        if self.status() != SttStatus::Recording {
            return Err(AppError::Other("not recording".into()));
        }
        // drop stream → 停止录音
        *self.stream_holder.lock().unwrap() = None;
        let (samples, sr, ch) = {
            let s = self.samples.lock().unwrap();
            (s.samples.clone(), s.sample_rate, s.channels)
        };
        if samples.is_empty() {
            self.state.lock().unwrap().status = SttStatus::Idle;
            return Err(AppError::Other("empty recording".into()));
        }

        let path = wav_temp_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let spec = hound::WavSpec {
            channels: ch,
            sample_rate: sr,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec)
            .map_err(|e| AppError::Other(format!("wav create: {e}")))?;
        for s in samples {
            writer
                .write_sample(s)
                .map_err(|e| AppError::Other(format!("wav write: {e}")))?;
        }
        writer
            .finalize()
            .map_err(|e| AppError::Other(format!("wav finalize: {e}")))?;

        self.state.lock().unwrap().status = SttStatus::Transcribing;
        Ok(path)
    }

    pub fn set_result(&self, text: Result<String, String>) {
        let mut g = self.state.lock().unwrap();
        match text {
            Ok(t) => {
                g.last_text = Some(t);
                g.last_error = None;
            }
            Err(e) => {
                g.last_error = Some(e);
            }
        }
        g.status = SttStatus::Idle;
    }
}

fn wav_temp_path() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
        .join("stt")
        .join(format!("rec_{}.wav", uuid::Uuid::new_v4()))
}
