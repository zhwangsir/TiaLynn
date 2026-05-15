# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 路线
- Qwen3-TTS sidecar 实装 + voice clone
- sqlite-vec 长期向量记忆 + alpha buffer 跨进程像素穿透回归
- 屏幕感知 + Vision LLM
- RPA 键鼠操作

---

## [0.2.0] — 2026-05-15

### 重大重构：Renderer 参数合成（修复"动作不流畅"根因）

**根因**：focus / emotion / idle / blink 各自直接 `setParameterValueById`，互相覆盖。
**修复**：`TiaLynnRenderer` 统一管理 4 个参数源，每帧合成一次：
```
final = (override 在窗口内 ? value : focus + emotion + idle)
```
- focus 60fps 指数缓动到 target（约 200ms 时间常数）
- emotion live2d 表用 4/秒缓动到目标
- idle action 写 `setIdleOffset` 偏移，结束自动清掉
- 眨眼 / 嘴型同步用 `overrideParam` 短窗强制覆盖
- `wroteKeys` 跟踪上一帧写过的 key，本帧无源时主动回 0 避免残留漂移

### 菜单完整重构（5 Tab）
- **LLM**：endpoint / model / api key + 测试连通
- **外观 / 模型**：列出本机所有 Live2D 模型（项目根 + ~/.tialynn/models/），点击切换；缩放 / 偏移 slider 实时联动
- **行为**：5 个 slider 调 idle / autoComment 间隔、情绪衰减、反差概率
- **语音**：TTS provider + sidecar URL
- **系统**：打开数据 / 模型目录、清空对话、版本号

### 多模型支持（不再固定胡桃）
- Rust `models_scan` 扫描项目根 + `~/.tialynn/models/`
- vite middleware 改为 `/live2d/<model_dir>/<file>` 路由
- 生产 build 自动复制所有模型到 `dist/live2d/`
- 配置变化 → Live2DStage watch → 自动 reload renderer

### LLM JSON 协议
- system prompt 要求 LLM 输出 `{"text":..., "emotion":..., "intensity":...}`
- Rust `parse_reply` 容错（markdown fence、首尾 `{}` 定位、降级）
- 前端流式时用 `extractStreamingText` 从 raw 提取 text（打字机效果保留）
- 情绪不再依赖前端关键词 FSM

### 行为参数热重载
- idle 间隔 / autoComment 间隔 / 情绪衰减 / scale / offset 改了立刻生效
- behavior 模块 `watch` config 字段变化重启 scheduler

### 新增 Rust 命令
- `models_scan` / `system_clear_history` / `system_reveal_data_dir` / `system_reveal_models_dir` / `system_version`

---

## [0.1.3] — 2026-05-15

### 修复（实测发现的两个交互降级）

**1. 视线跟随只在窗口内有效**
- 根因：`focus.ts` 用 `window.mousemove`，与穿透同一个 bug——窗口外 webview 收不到事件，视线卡在最后位置
- 修复：Rust mouse tracker 现在每 80ms `emit("mouse::global", payload)`，前端监听该事件驱动视线
- 副带改进：renderer.setFocus 现在加 clamp + 联动 ParamAngleZ / ParamBodyAngleX，视线跟随更生动
- 现效果：鼠标在屏幕任何位置，TiaLynn 的视线都跟着转

**2. 自主行为太少**
- 原仅有 eyeBlink + 程序化呼吸，立绘看起来"愣着"
- 新增 `src/behavior/idle.ts`：每 8-15s 随机触发一个 idle 动作（轻歪头/看远/撇嘴/微笑/脸红/深呼吸 共 8 种）
- 新增 `src/behavior/emotionTick.ts`：每 30s tick 一次情绪衰减，跌破阈值时自动回归 neutral
- 新增 `src/behavior/autoComment.ts`：按 `behavior.auto_comment_interval_sec` 周期 ±25% 抖动触发主动开口
- 新增 Rust `chat_send_proactive` command：autoComment 走单独路径，hint 注入 system prompt，**不污染对话历史**
- 时段感知 prompt：根据当前时间（早晨/正午/午后/傍晚/深夜）拼 prompt，让主动话题贴合时段

### 新增
- `src/behavior/{idle,autoComment,emotionTick}.ts`
- `chat_send_proactive` Tauri command
- `dialog.sendProactive()` store action
- `mouse::global` 全局鼠标位置事件（80ms 节流）
- `GlobalMouseEvent` payload 类型（含物理坐标 + 窗口 rect + scale_factor）

---

## [0.1.2] — 2026-05-15

### 修复（实测发现的致命交互 bug）

**所有 UI 失效**：点击设置按钮、立绘拖动、输入框输入全部失败。

**根因**：原方案在前端用 mousemove 监听切换 `ignore_cursor_events`。但当 `ignore=true`（穿透）后，webview 完全收不到任何鼠标事件，导致前端**永远无法把 ignore 切回 false**。一旦穿透就锁死。

**修复**：把穿透判定从前端 mousemove 改为 **Rust 后台线程轮询全局鼠标位置**。
- 新增 `src-tauri/src/window.rs::spawn_mouse_tracker`
- 用 `device_query@2` crate 每 40ms 拿全局鼠标坐标
- 与 Tauri 的 `outer_position` / `outer_size` 比对（Retina 物理像素一致，已实测 DPR=2 数值匹配）
- 鼠标在窗口外 → `set_ignore_cursor_events(true)`
- 鼠标在窗口内 → `set_ignore_cursor_events(false)`，webview 立刻可交互

**副作用**：v0.1.2 暂时**退化为矩形穿透**（窗口内透明区不再穿透）。像素级穿透留到 v0.2，那时需要把前端 alpha buffer 通过 event 同步到 Rust 端。

前端 `alpha/sampler.ts` 现在只保留 mousedown→drag 逻辑，UI 元素白名单（input/button/[data-uichrome]）保护设置面板和输入框。

实测确认日志：
```
mouse=(1320,621) window=(160,160,1120,1600) inside=false → ignore=true
```
device_query 在 macOS Retina 返回物理像素，与 Tauri 一致。

---

## [0.1.1] — 2026-05-15

### 修复（首次实测发现的真实问题）
- **Live2D 加载失败 Network error**：根因是 Tauri asset 协议解析含空格的相对路径会失败。改走 vite middleware `/live2d/*`（dev）+ closeBundle 复制到 dist/（prod），跨环境一致。
- **鼠标无法拖动窗口**：alpha sampler 加 mousedown 监听，命中立绘时 invoke `window_start_drag` 启动 native 拖窗。
- **缺设置界面**：新增右上角齿轮 → SettingsPanel.vue，包含 LLM endpoint/model/api key、TTS provider/sidecar URL，带"测试连通"按钮，配置持久化到 `config.json`。

### 稳定性
- LLM `connect_timeout = 5s`（避免 endpoint 不可达时卡 120s）
- Live2D 加载失败显示中文错误卡片（不再静默 console.error）
- `chat::token`/`chat::end` listen 提前到 store 创建期，避免事件 race
- TTS 自动播放 + 嘴型同步串联：`chat::end → speakWithLipSync → AnalyserNode RMS → ParamMouthOpenY`
- 移除冗余 import 与未使用变量

### 新增
- `window_start_drag` Tauri command + `core:window:allow-start-dragging` capability
- `config_load` / `config_save` / `config_test_llm` Tauri command
- `src/audio/speaker.ts` TTS 播放 + lipSync 协调模块
- `src/components/SettingsPanel.vue`
- `src/stores/config.ts`

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

[Unreleased]: https://github.com/zhwangsir/TiaLynn/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zhwangsir/TiaLynn/releases/tag/v0.2.0
[0.1.3]: https://github.com/zhwangsir/TiaLynn/releases/tag/v0.1.3
[0.1.2]: https://github.com/zhwangsir/TiaLynn/releases/tag/v0.1.2
[0.1.1]: https://github.com/zhwangsir/TiaLynn/releases/tag/v0.1.1
[0.1.0]: https://github.com/zhwangsir/TiaLynn/releases/tag/v0.1.0
