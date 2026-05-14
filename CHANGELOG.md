# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 路线
- Qwen3-TTS sidecar 实装 + voice clone
- sqlite-vec 长期向量记忆
- 屏幕感知 + Vision LLM
- RPA 键鼠操作

---

## [0.1.0] — 2026-05-15

### 新增（Foundation 基础框架）
- **Tauri 2.x + Vue 3 + TypeScript** 跨平台项目骨架
- **透明置顶无边框窗口** + 系统托盘（显隐 / 重载灵魂 / 退出）
- **像素级点击穿透**（前端 alpha 采样 + Tauri `set_ignore_cursor_events`）
- **Live2D 渲染**（PixiJS + pixi-live2d-display + Cubism 4 runtime）
  - 自动眨眼（程序化，不依赖 model3.json EyeBlink 组）
  - 程序化呼吸
  - 视线跟随鼠标
  - 参数嗅探（开发模式 console 打印）
- **三层人格 system prompt 生成器**
  - Layer 1：病娇灵魂底层
  - Layer 2：胡桃俏皮表层
  - Layer 3：反差变量（每轮 15% 触发）
- **灵魂热重载**（notify watcher 监听 `default.yaml`）
- **OpenAI-compat LLM 适配层** + SSE 流式 token 推送
- **6 情绪状态机** + 情绪→Live2D 参数缓动映射
- **SQLite 短期记忆**（消息流 + 长期记忆 schema 预留 + 观察事件流）
- **对话气泡 UI** + 输入栏（打字机效果）
- **TTS 适配层**：macOS `say` fallback + Qwen3-TTS Python sidecar 骨架
- **嘴型同步**（Web Audio AnalyserNode RMS → ParamMouthOpenY）
- **设计文档**：PRD / ARCHITECTURE / SOUL_SCHEMA / DECISIONS

### 引入的开源依赖
- 前端：`vue@3.5`, `pinia@2.3`, `pixi.js@6.5`, `pixi-live2d-display@0.4`, `@tauri-apps/api@2.11`
- 后端：`tauri@2.11`, `reqwest@0.12`, `rusqlite@0.32`（bundled）, `tokio@1`, `serde-yaml@0.9`, `notify@6`
- Sidecar：`fastapi@0.115`, `uvicorn@0.32`（v0.2 启用 torch/transformers）

### 已知局限（v0.1.0 明确不做）
- Windows / Linux 完整适配（结构预留，实测延后到 v0.5）
- Vision LLM / 屏幕感知（v0.3）
- RPA 自动操作（v0.4）
- Voice clone 实际推理（v0.2，目前 sidecar 返回静音占位）
- 表情/动作 motion 文件（永久走程序化驱动）

[Unreleased]: https://github.com/wangzhenyu/TiaLynn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wangzhenyu/TiaLynn/releases/tag/v0.1.0
