# Presence — 陪伴交互层

> 她怎么"在"你身边。

## 职责

- 时段感知（早晚不同语气）
- 状态感知（空闲多久、屏幕在干嘛）—— M5 实施
- 主动行为：定时关心、闲聊、催睡 —— M5 实施
- 情感反应：基于事件触发情绪
- 语音：STT（whisper.cpp）+ TTS（CosyVoice/GPT-SoVITS）+ 嘴型同步协调
- 屏幕感知 —— M5+ 实施

## 模块

```
presence/
├── speech/            # tts / stt / speaker（音频播放 + lipSync 协调）
├── awareness/         # 时段 / 空闲 / 屏幕（M5 启用）
├── triggers/          # 主动开口策略（M5 启用）
└── stores/            # stt pinia
```

## 输入事件
- `brain:reply_end` → 拿到 full_text，调 TTS 合成
- `infra:hotkey_pressed` → F8 触发 STT
- `infra:tick_*` → 定时器事件（M5）

## 输出事件
- `presence:tts_start` → 音频开始，avatar 启动 lipSync
- `presence:tts_end` → 播放完成
- `presence:stt_result` → 语音转写，喂给 brain
- `presence:proactive_speak` → 主动开口建议（M5）

## 约束
- TTS / STT 都通过 Python sidecar（`sidecar/speech/`）
- 不直接持有 LLM 状态
- 嘴型同步：通过事件协调 avatar，不直接调 avatar 函数
