# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TiaLynn — Electron + Vue 3 + TypeScript 桌面 AI 伴侣（Live2D 立绘 + 本地 LLM + RVC 语音 + 主体性感知）。
pnpm workspace 单包：`electron/` 子项目；可选 Python `sidecar/` 提供 TTS/RVC。

## Common Commands

All commands run from repo root (pnpm workspace dispatches to `electron/`):

| 命令 | 用途 |
|---|---|
| `pnpm install` | 安装依赖（首装会编译 better-sqlite3 / electron-click-drag-plugin native 模块） |
| `pnpm dev` | electron-vite dev 模式，热重载渲染层 + 主进程 |
| `pnpm typecheck` | `tsc -p tsconfig.node.json && vue-tsc -p tsconfig.web.json`（**两个 tsconfig 都跑，缺一不行**） |
| `pnpm build` | 生产构建到 `electron/out/` |
| `pnpm package:mac` / `:win` / `:linux` | electron-builder 打包到 `electron/release/<version>/` |

测试（在 `electron/` 下，或 `pnpm -F tialynn-electron <script>`）：
| 命令 | 用途 |
|---|---|
| `pnpm -F tialynn-electron test` | vitest 一次性跑所有单测 |
| `pnpm -F tialynn-electron test:watch` | watch 模式 |
| `pnpm -F tialynn-electron test:coverage` | v8 覆盖率 |
| `pnpm -F tialynn-electron test -- src/path/to/file.test.ts` | 跑单个文件 |

测试范围：**只有纯函数**（`motion-factory/parser` / `services/logger` / `shared/format-utils` 等）。IPC handler 和 Vue 组件没单测。

调试主进程 console：默认 prod 静默；设 `TIALYNN_DEBUG=1` 或 `MAIN_APP_DEBUG=1` 启动会把 renderer console + devtools 打开。

Native 模块重建（升级 Electron 后必要）：`pnpm -F tialynn-electron rebuild`。

## High-Level Architecture

### 进程模型

```
Renderer (Vue 3 + Pinia + PixiJS Live2D)
   │ contextBridge IPC（preload/index.ts 暴露 window.api.*）
Main (Node.js)
   │ HTTP localhost（可选）
Sidecar (Python FastAPI — edge-tts / CosyVoice / F5-TTS / RVC)
```

**所有 LLM / 文件 / 数据库访问只在 main，renderer 永远不直连**。preload 的 `window.api.*` 是唯一桥梁，定义在 `electron/src/shared/api.ts`，main 端 handler 注册在 `electron/src/main/ipc/*.ts`，renderer 端通过 `window.api.<域>.<方法>` 调用。

### 五大能力域（既是文件夹也是心智模型）

| 域 | 在哪 | 做什么 |
|---|---|---|
| **avatar** 身体 | `renderer/src/avatar/` | Live2D 渲染（PixiJS）、alpha 像素级穿透判定（`interaction/window-interaction.ts`）、动作 plan executor、缩略图生成器 |
| **brain** 思考 | `renderer/src/brain/` + `main/ipc/llm.ts` + `main/services/llm/` | 多 LLM provider 路由（Ollama / LM Studio / OpenAI-compat / Anthropic）、parser、stores（dialog/emotion）、provider 健康检查 + 自动 fallback |
| **presence** 声音 | `renderer/src/presence/` + `main/ipc/tts.ts` | TTS sidecar 多 URL 重试 + macOS `say` 兜底、流式音频播放 + 嘴型同步、`emotion_voice_map` 8 情绪分不同 voice |
| **hands** 行动 | `renderer/src/hands/` + `main/services/motion-factory/` + `main/services/automation/` | LLM 生成 motion3.json（motion-factory）、桌面自动化（nut-js wrapper + vision grounding + agent loop）、用户审批弹窗（`approval-store`） |
| **attention** 主体 | `main/services/perception/` + `main/services/attention/` + `main/services/planner/` | Mouse/Idle/Window/Time/Vision 5 个 sensor → PerceptionBus → AttentionScheduler（关注度场 + reactive trigger）→ BehaviorPlanner（LLM 决策 + rule fallback）→ 主动 plan emit 给 renderer 执行 |

**键鼠 reactive trigger 链**：`perception.onType('typing_burst' | 'mouse_stayed' | 'app_focus_changed')` → `scheduler.tryReactiveTrigger()`（双重节流：25-35s cooldown + min_action_interval_ms）→ Planner → 输出 `{ speak, play_group, change_emotion }` 协同 action 序列。

### 桌宠原生化（macOS 关键三连，在 `main/index.ts` + `main/windows/main-window.ts`）

1. `app.setActivationPolicy('accessory')` — 不进 Dock / Cmd+Tab / Mission Control
2. `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })` — 跨 Space + 全屏视频之上。**`skipTransformProcessType: true` 是关键**，否则 setVisibleOnAllWorkspaces 把 process 转回 regular，撤销第 1 点。
3. `setAlwaysOnTop(true, 'screen-saver', 1)` — Electron 最高层级，盖菜单栏 / Dock / Spotlight

⚠️ **不要默认打开 detached DevTools** — detach 窗口是 NSWindow，macOS 会把 process 转回 regular，Dock 图标重新出现破坏桌宠态。只在 `TIALYNN_DEBUG=1` / `MAIN_APP_DEBUG=1` 时打开。

### 像素级穿透 / 拖动判定（`avatar/interaction/window-interaction.ts`）

50ms 主进程 cursor poll → renderer onCursorTick → 决定窗口 `setIgnoreMouseEvents`：
- 鼠标在立绘 alpha 像素上 → ignore=false（响应）
- 鼠标在透明区 → ignore=true + forward=true（穿透到下层桌面但仍收 mousemove）
- 鼠标在 UI 元素上（dialog / panel） → ignore=false

`isOverUiElement` 用 `elementsFromPoint`（复数）+ 自己跳过 `pointer-events: none` 的全屏覆盖层（StickerOverlay 等），不能用 `elementFromPoint`（单数）。`forceInteractive(on)` 切换模态状态时**必须**清 `lastHitTest` cache，否则 250ms 内旧结果误判。

⚠️ 不要给 panel 父级 wrapper 加 `pointer-events: none` + CSS `zoom`：Chromium 会让 `position: fixed` 子元素相对 zoom 元素而非 viewport，破坏关闭按钮 click 路径。全局 UI 缩放用 **`transform: scale(var(--ui-scale, 1))`** 直接在 panel selectors 上（`styles/global.css` 末尾），不通过 wrapper。

⚠️ `.bubble` 有 `translateX(-50%)` 居中定位，**必须**在 scoped style 内合写 `transform: translateX(-50%) scale(var(--ui-scale, 1))`，不能放进全局 transform 规则——后者会覆盖前者（CSS transform 不叠加）。

### 数据布局

| 路径 | 内容 |
|---|---|
| `~/.tialynn/config.json` | RuntimeConfig（LLM endpoint / TTS / RVC / vision），通过 `config-store.ts` 读写 |
| `~/.tialynn/soul/` 或 `<repo>/soul/` | 角色灵魂 yaml（identity / personality / learned_traits / core_memories），优先级：用户目录 > 项目内置 |
| `~/.tialynn/history.sqlite` | better-sqlite3 — 对话历史，启动时按 `history_retention_days` 截断 |
| `~/.tialynn/thumbs/` | Live2D 模型缩略图 PNG |
| `~/.tialynn/window-state.json` | 主窗口 bounds / alwaysOnTop 持久化 |
| `electron/models-library/` | Live2D 模型（不入仓 — Live2D 授权约束） |

路径解析见 `main/services/paths.ts`：用户目录 `~/.tialynn` 优先于 `app.getPath('userData')`。

### Soul 系统（灵魂 = 角色配置）

4 个 yaml 文件按主题切分（不是单文件大 yaml）：
- `identity.yaml` — 名字 / 称呼 master / 立绘 model_dir / 生日
- `personality.yaml` — 三层人格（layer1 底层 / layer2 表层 / layer3 反差）+ signature_lines
- `learned_traits.yaml` — LLM 累积观察主人偏好（运行时可写回）
- `core_memories.yaml` — 关键事件 / 共同回忆

`main/services/soul-loader.ts` 合并 4 个文件成单一 `SoulConfig`。SoulEditor.vue UI 直接编辑 yaml 文本。**热重载**：保存触发 `soul:changed` IPC，renderer 自动 `cfg.reloadSoul()`。

### IPC 文件命名约定（`main/ipc/*.ts`）

每个 IPC 文件导出一个 `register*Ipc(getWindow)` 函数，在 `main/index.ts` 的 `app.whenReady` 里集中调用。命名严格匹配主题：`llm.ts` / `tts.ts` / `models.ts` / `characters.ts` / `motion-factory.ts` / `automation.ts` / `attention.ts` 等。**不要在 `system.ts` 加新东西** — v0.13 audit 拆分后 system.ts 只放窗口控制相关。

### TypeScript 严格度（Tier 3）

`tsconfig.web.json` 启用 `exactOptionalPropertyTypes: true`。意味着 `{ foo?: string }` 不等于 `{ foo?: string | undefined }`：
- 显式给 `foo: undefined` 会报错
- 必须用 `...(value !== undefined ? { foo: value } : {})` 条件展开

这是常见的修编译错点，看到 `TS2375` / `TS2379` 错误时检查可选字段是否被显式赋 undefined。

## Important Patterns

### Action / Plan 协同（system_prompt 已强制约束）

Planner LLM 系统 prompt 要求**每个 speak action 必须同时输出一个 play_group**（哪怕 intensity 低也至少 FlickLeft 歪头）。Rules fallback（LLM 失败/rate limit 时）也已对齐——所有 rule 分支都发 play_group。

`plan-executor.ts` 的 `doChangeEmotion` 在 intensity > 0.4 时会按 `EMOTION_GROUP_MAP` 自动触发 group，但**当 plan 已显式含 `play_group` action 时跳过自动触发**（否则同一个 group 被打断重启）。

### LLM rate limit budget

`planner/index.ts` 的 `llmCallTimestamps.push()` **在 cfg.llm_model / llm_provider 校验之后**——LLM 未配置不消耗 budget。默认 `llm_planner_max_per_minute: 6`，留给 proactive (1.3/min) + reactive (1.7/min) 之外约 50% headroom。

### Bus listener 卫生

renderer Vue 组件在 `<script setup>` **顶层**直接调 `bus.on(...)` 会在每次组件挂载时累积 listener。必须放在 `onMounted` 里，并在 `onBeforeUnmount` 里 `bus.off`。对于多个 handler，常用 `cleanupHandlers: Array<() => void>` 收集 + 统一调用。

### config_store migration

`loadConfig()` 读 `~/.tialynn/config.json` 后 spread 默认值。新增字段在 `DEFAULT` 加；旧默认值需要替换时（如 `emotion_voice_map` 从单 voice 改成 8 voice）写 migration 判断条件——**只在旧默认状态精确匹配时覆盖**，不能假设"看起来像默认"就覆盖（会丢用户自定义）。

## Sidecar (TTS/RVC)

可选 Python sidecar，路径 `sidecar/qwen-tts-server/`。安装：`bash sidecar/install.sh`（完整）/ `--minimal`（只装 edge-tts）。启动后默认监听 `http://127.0.0.1:8765`，设置面板填这个 URL。

TTS IPC（`main/ipc/tts.ts`）走 `tts_sidecar_url` 数组顺序重试，超时 15s（之前 120s 太长），全失败 fallback macOS `say`。

## Don't

- 不要在 `renderer/` 里 `import` 任何 `main/` 或 `node:*` 模块——TypeScript path alias `@shared` 只是 `electron/src/shared/`，types-only。
- 不要硬编码 LLM API key / endpoint，全部从 `config-store` 读，UI 在 Settings 改。
- 不要给非 model3.json (Cubism 4) 模型加支持——Cubism 2 已弃用，加载时自动 fallback 到 cubism4 模型。
- 不要把 `LSUIElement: true` 从 `electron/package.json` build.mac.extendInfo 里去掉——打包后桌宠在 Dock 显示就破功了。
- 不要把 `setVisibleOnAllWorkspaces` 的 `skipTransformProcessType: true` 去掉。
