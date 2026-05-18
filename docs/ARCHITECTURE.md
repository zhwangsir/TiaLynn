# TiaLynn 架构

> 版本：v0.13 (Electron + 五大能力域 + 主体性 AI)
> 最后更新：2026-05-18

## 0. 项目本质

TiaLynn 是一个**常驻桌面的自我进化型 AI 智能体**：

- **身体**：Live2D 形象 + 透明置顶窗口 + 像素级穿透
- **大脑**：本地/云端 LLM + SQLite 短期记忆 + 三层人格 prompt
- **手脚**：动作工坊 (motion factory) + plan executor + 桌面自动化基建
- **声音**：RVC 47 voice + Edge-TTS / CosyVoice / F5-TTS sidecar + 流式 + 嘴型同步
- **主体**：PerceptionBus + Attention Scheduler + Planner LLM + proactive 触发

**核心区别于普通桌宠**：她不只是看着，**她能做事 + 会主动**。
**核心区别于普通 AI 助手**：她不只在对话框里，**她在你桌面上 + 持续感知**。

## 1. 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  services/ — LLM provider / motion factory / attention │  │
│  │  scheduler / planner / perception bus / model scanner  │  │
│  │  / soul loader / online store / sqlite history / disk  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ipc/ — 9 个 IPC 文件，按主题划分（v0.13 拆分后）       │  │
│  │  system / tts / thumbs / models / online / llm /       │  │
│  │  motion-factory / motion-engine / trigger / tools /    │  │
│  │  perception / market / window-control                  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  windows/ — 透明立绘 BrowserWindow + NSPanel + 拖动    │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ contextBridge IPC (deepPlain wrapper)
┌────────────────────────┴─────────────────────────────────────┐
│  Electron Renderer (Vue 3 + Pinia + PixiJS Live2D)           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  五大能力域 + infra 横切（见 §2）                       │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP localhost
┌────────────────────────┴─────────────────────────────────────┐
│  Python Sidecar (FastAPI)                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  edge-tts / CosyVoice / F5-TTS / RVC 47 voice          │  │
│  │  /v1/audio/speech (含 RVC 转换) + /v1/rvc/voices       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 2. 五大能力域 (renderer)

所有 renderer 代码归属其一。**域间通过 infra/eventbus 通信，禁止跨域直接 import store。**
纯 util 函数（如 `brain/parser.ts`）跨域使用合理（v0.13 决策）。

| 域 | 路径 | 职责 |
|----|------|------|
| **avatar** 身体 | `renderer/src/avatar/` | Live2D 渲染 / 像素穿透 / 拖动 / motion player / alpha-hit / 1389 模型库扫描 |
| **brain** 思考 | `renderer/src/brain/` | dialog store / 灵魂 system prompt 合成 / parser（流式 token 增量解析） |
| **presence** 声音 | `renderer/src/presence/` | speech store / TTS 调用 / 嘴型同步 / 双队列流式音频 |
| **hands** 行动 | `renderer/src/hands/` | approval store / plan executor 触发 / 桌面动作 |
| **attention** 主体 | `main/services/attention/` (主进程) | scheduler 5s tick / planner LLM / perception bus / sensors |

横切：
- **infra** `renderer/src/infra/` — UI 组件 / Pinia stores / eventbus / 设置面板 / 资源商店 / 引导对话框

## 3. IPC 设计

`shared/api.ts` 是 single source of truth：

```ts
interface TialynnApi {
  system: { ... }      // version / paths / disk usage / config
  window: { ... }      // 拖动 / 穿透 / 置顶
  cursor: { ... }      // 50ms tick 鼠标位置
  config: { ... }      // 读写 RuntimeConfig
  models: { ... }      // scan / heal / dedup / describe / favorites / enrich
  soul: { ... }        // load / system prompt / saveAvatar
  llm: { ... }         // chat / stream / test / healthCheck
  tts: { ... }         // speak / probe / listRvcVoices
  history: { ... }     // append / listRecent / clear
  thumbs: { ... }      // get / getBatch / save / markFailed / listMissing
  market: { ... }      // installPaths / installFromUrl / installFromZip
  motionFactory: { ... } // generate motion3.json via LLM
  motionEngine: { ... }  // play / sync / library
  trigger: { ... }       // rules
  perception: { ... }    // history / triggerSnapshot
  online: { ... }        // listRepoAssets / install / cancelInstall
  attention: { ... }     // onPlan
  tools: { ... }         // MCP tool list (v0.14+ ready)
}
```

preload 用 `ReturnType<TialynnApi[ns][method]>` 自动同步类型，preload 实现与契约不会漂移。

跨进程克隆走 `deepPlain()` 三级 fallback：`structuredClone → JSON round-trip → manualClone`，专门解决 Vue Proxy → V8 结构化克隆失败问题。

## 4. 主体性 AI 循环 (v0.8+)

```
PerceptionBus (main process)
  ↓ (Mouse / Idle / Window / Time / Vision sensors)
Attention Scheduler (5s tick)
  ↓ (检查触发条件：idle ≥ N min / window 切换 / proactive 60s 等)
Planner (LLM 调用)
  ↓ (输入感知摘要 + soul prompt，输出 BehaviorPlan)
IPC `attention:plan` → renderer
  ↓
Plan Executor (avatar/plan-executor.ts)
  ↓ (依次执行 actions: look_at / speak / play_motion / change_emotion)
  ↓ speak action → bus.emit('brain:inject-utterance')
  ↓ → dialog store 注入 assistant turn → TTS 自动播
```

设计文档：[docs/SOUL_SCHEMA.md](SOUL_SCHEMA.md) | [docs/ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md)

## 5. 设计原则（不可破坏）

1. **域间通过 bus 通信** — 不直接 import 跨域 store（v0.13 plan-executor → brain:inject-utterance 案例）
2. **IPC 契约单一来源** — `shared/api.ts` 定义，preload 自动同步
3. **TS Tier 3 严格** — 0 any / 0 @ts-ignore / noUncheckedIndexedAccess / exactOptional / noImplicitReturns / noImplicitOverride
4. **配置默认空** — LLM endpoint / TTS sidecar URL 默认空，引导用户首次配置
5. **错误显式 throw 或 {ok, reason}** — IPC handler 统一返回 `{ok: boolean, ...}`，main 抛错走 IPC reject
6. **本地优先** — 用户数据在 `~/.tialynn/`，模型库在 `electron/models-library/`，无遥测无上报

## 6. 数据流：一次对话

```
User types "你好" in InputBar
  ↓ bus.emit('brain:chat-input', {text})
brain/stores/dialog.send(text)
  ↓ window.api.llm.chat({...})         // IPC: llm:chat
main/ipc/llm.ts → main/services/llm/<provider>
  ↓ HTTP POST → LLM endpoint (Ollama/LM Studio/Anthropic)
  ↓ SSE stream
main → renderer: 'llm:chunk' event per token
  ↓ bus.emit('brain:reply-token', {delta})
  ↓ DialogBubble UI 实时打字机
  ↓ ... done
bus.emit('brain:reply-end', {full_text, emotion, intensity})
  ↓ presence/speech 监听 → window.api.tts.speak(...)
  ↓ main/ipc/tts.ts → sidecar /v1/audio/speech (含 RVC)
  ↓ 返 audio_b64
renderer 解码 → Web Audio API 播 + AudioContext analyser
  ↓ analyser.getByteFrequencyData 算 RMS
  ↓ bus.emit('presence:lipsync', {rms})
avatar/render/live2d-renderer 接收 RMS → 驱动 ParamMouthOpenY
  ↓ Live2D 嘴型动起来
```

## 7. 配置 + 数据布局

```
~/.tialynn/                              # 用户数据根
├── config.json                          # RuntimeConfig (LLM/TTS/RVC/idle 等)
├── history.sqlite                       # 对话历史 (better-sqlite3, WAL mode)
├── soul/                                # 灵魂档案 (multi-file YAML)
│   ├── identity.yaml
│   ├── personality.yaml
│   └── learned_traits.yaml
├── model-scan-cache.json                # v0.13: 模型扫描 mtime 缓存
├── model-favorites.json                 # 收藏 + 最近使用
├── model-preferences.json               # 每模型 scale / offset_y
├── character-enriched.json              # LLM 角色中文名+简介缓存
├── model-descriptions.json              # AI 生成的模型描述
├── thumbs/                              # Live2D 缩略图 (~10 MB)
│   └── char:<sha1>.webp
├── logs/                                # v0.13: electron-log 写文件
│   └── main.log                         # 10 MB 轮转 + 敏感字段 redact
├── voice_clones/                        # 用户上传的 RVC 训练样本
├── cosyvoice-repo/ (6.8 MB)             # CosyVoice 仓库副本
├── rvc-venv/ (22 MB)                    # Python venv
├── models-tts/ (4-6 GB)                 # TTS 模型 (CosyVoice / F5-TTS / RVC)
└── window-state.json                    # 窗口位置 / always-on-top

electron/models-library/ (5-17 GB)       # Live2D 模型（1389 满载）
docs/rfcs/                               # 重大架构 RFC (TS Tier 3 等)
```

## 8. 安全模型 (v0.13 audit)

- **contextIsolation: true** + **nodeIntegration: false** — renderer 不能直接调 Node API
- **webSecurity: false** — Live2D 跨目录加载需要（known debt，未来用 protocol.handle 替代）
  - **mitigation**：CSP header + setWindowOpenHandler + will-navigate 三道防线
- **sandbox: false** — preload 需要 Node API
- **IPC 输入验证** — 所有用户输入路径过 path.resolve + 白名单（disk-usage / online-store）
- **YAML 解析** — `yaml.JSON_SCHEMA` 防 `!!js/*` 标签注入（soul / motion templates / trigger rules）
- **命令执行** — `execFile(cmd, [args])` 数组形式防 shell 注入（osascript / scp / ssh）
- **日志 redact** — `~/.tialynn/logs/main.log` 自动脱敏 6 类敏感字段（api_key / Bearer / sk- 等）
- **single-instance lock** — 防双启冲突

## 9. 测试 (v0.13 启动)

```bash
pnpm test          # vitest run — 22 个 starter tests
pnpm test:watch    # vitest 监听模式
pnpm test:coverage # v8 覆盖率报告
```

当前覆盖：
- `motion-factory/parser.test.ts` — draftToMotion3Json (7 tests)
- `services/logger.test.ts` — redactSensitive 敏感字段 (15 tests)

待补：motion-engine / planner / model-scanner 等纯函数。

## 10. 技术栈

- **运行时**：Electron 33 / Node 20+ / Vue 3.5 / TypeScript 5.7 (Tier 3 strict)
- **打包**：electron-vite 2.3 + electron-builder 25
- **UI**：Vue 3 setup script + Pinia 2 + mitt eventbus + OKLCH design tokens
- **Live2D**：pixi-live2d-display 0.4 + PIXI.js 6.5 + Cubism Core
- **存储**：better-sqlite3 12 (WAL mode) + js-yaml 4 (JSON_SCHEMA)
- **TTS sidecar**：Python 3.10+ + FastAPI + edge-tts / CosyVoice / F5-TTS / RVC
- **测试**：vitest 2.1 + @vitest/coverage-v8
- **日志**：electron-log 5 (file + console + redact hooks)

---

## 历史背景

v0.1-v0.4 是 Tauri + Rust 时代，v0.6 转 Electron 吸收 [airi](https://github.com/moeru-ai/airi)
的成熟做法，五大能力域结构延续至今。
转 Electron 后的关键决策见 [docs/AIRI_STUDY.md](AIRI_STUDY.md)。
TS Tier 3 严格化 RFC 见 [docs/rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md)。
