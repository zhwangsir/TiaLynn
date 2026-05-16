# TiaLynn 架构文档

> 版本：v0.4.0 (Constitutional Rewrite)  
> 最后更新：2026-05-16

## 0. 项目本质

TiaLynn 是一个**常驻桌面的自我进化型 AI 智能体**：

- **身体**：Live2D 形象 + 透明置顶窗口 + 桌面交互
- **大脑**：本地/云端 LLM + 长期记忆 + 工具调用
- **手脚**：MCP/Function Call 驱动的电脑操作能力
- **灵魂**：可热重载的人格档案 + 持续学习的记忆系统

**核心区别于普通桌宠**：她不只是看着，**她能做事**。  
**核心区别于普通 AI 助手**：她不只在对话框里，**她在你桌面上**。

## 1. 五大能力域

所有代码必须归属其一。**模块间通过事件总线通信，禁止跨域直接 import 内部函数。**

```
┌─────────────────────────────────────────────────────────────────┐
│                          Event Bus (mitt)                       │
└───┬──────────┬─────────────┬─────────────┬──────────────────┬───┘
    │          │             │             │                  │
    ▼          ▼             ▼             ▼                  ▼
┌────────┐ ┌────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────┐
│ Avatar │ │ Brain  │ │   Hands    │ │   Presence   │ │  Infra   │
│        │ │        │ │            │ │              │ │          │
│ 她长   │ │ 她怎么 │ │  她能干    │ │   她怎么"在" │ │  让她    │
│ 什么样 │ │ 思考、 │ │  什么活    │ │   你身边     │ │  稳定地  │
│ 怎么动 │ │ 记什么 │ │            │ │              │ │  活着    │
└────────┘ └────────┘ └────────────┘ └──────────────┘ └──────────┘
```

### 🎭 Avatar — 形象表现层

她的身体。

- Live2D 渲染（pixi-live2d-display）
- 透明置顶窗口 + 拖动 + 缩放
- 表情切换、idle 动作、视线跟随、嘴型同步（参数源驱动）
- 模型热切换（从用户的 `Live2d-model-master` 任选）
- 鼠标穿透判定（窗口外穿透）

### 🧠 Brain — 智能核心层

她怎么思考、记什么。

- LLM Provider 抽象（Claude / OpenAI-compat / Ollama）
- 三层人格 prompt：底层（identity）+ 表层（personality）+ 反差变量
- 短期记忆（SQLite messages）+ 长期向量记忆（ChromaDB，M3 启用）
- 凝练 tick：周期把对话总结为 fact
- 记忆衰减与强化（M6）
- 元认知：能查询自己记得什么（M6）

### 🛠 Hands — 工具执行层

她能干什么活。**项目的灵魂在此**。

- MCP 客户端（Anthropic Model Context Protocol）
- 内置工具：filesystem / shell / browser / git / screenshot
- 工具调用 UI：意图展示 + 批准/拒绝
- 安全沙盒：默认敏感操作需确认
- 自动化编排：把多步操作组合成"她会的活"
- 主动建议（M5+）

### 💗 Presence — 陪伴交互层

她怎么"在"你身边。

- 时段感知（早晚不同语气）
- 状态感知（你空闲多久、屏幕在干嘛）
- 主动行为：定时关心、闲聊、催睡
- 情感反应：基于事件触发情绪
- 语音：STT（whisper.cpp）+ TTS（CosyVoice/GPT-SoVITS）+ 嘴型同步
- 屏幕感知（M5+）

### 🔐 Infra — 基础设施层

让她稳定地活着。

- 数据：SQLite（结构化）+ Chroma（向量）+ YAML（配置）
- 配置：灵魂档案热重载 + 提示词模板化
- 事件总线：mitt（前端）+ Tauri emit（前后端跨进程）
- 跨平台抽象（macOS 优先）
- 备份：灵魂包导出/导入
- 可观测：日志、记忆查看器、prompt 调试

## 2. 项目结构

```
TiaLynn/
├── soul/                    # 灵魂档案（YAML）
│   ├── identity.yaml        # 名字、称呼、avatar 偏好
│   ├── personality.yaml     # 三层人格 prompt 模板
│   ├── core_memories.yaml   # 永久注入的核心记忆
│   └── learned_traits.yaml  # 学习到的特质（自动写入）
│
├── src/                     # 前端
│   ├── avatar/              # 域 1：形象
│   │   ├── render/          # Live2D renderer
│   │   ├── animation/       # eyeBlink / focus / lipSync
│   │   ├── interaction/     # 拖动 / 点击穿透
│   │   ├── emotion-params/  # 情绪→Live2D 参数表
│   │   ├── components/      # Live2DStage.vue 等
│   │   ├── stores/          # avatar state pinia
│   │   └── README.md
│   ├── brain/               # 域 2：智能
│   │   ├── persona/         # prompt 组装
│   │   ├── memory/          # short / long / vector
│   │   ├── providers/       # claude / ollama / openai-compat（前端调用层）
│   │   ├── stores/          # dialog / emotion / soul pinia
│   │   ├── types/
│   │   └── README.md
│   ├── hands/               # 域 3：工具（M0 空骨架）
│   │   ├── mcp_client/      # M4 实施
│   │   ├── tools/
│   │   ├── approval/
│   │   └── README.md
│   ├── presence/            # 域 4：陪伴
│   │   ├── speech/          # tts / stt / lipSync 协调
│   │   ├── awareness/       # 时段/空闲/屏幕（M5 实施）
│   │   ├── triggers/        # 主动开口（M5 实施）
│   │   ├── stores/          # stt pinia
│   │   └── README.md
│   ├── infra/               # 域 5：基础设施
│   │   ├── eventbus.ts      # mitt 实例
│   │   ├── config/          # 配置 store + 加载
│   │   ├── ui/              # 通用 UI（设置面板）
│   │   └── README.md
│   ├── App.vue
│   └── main.ts
│
├── src-tauri/src/
│   ├── avatar/              # window mouse_tracker
│   ├── brain/               # llm / memory / persona / embed
│   ├── hands/               # MCP / tools（M4）
│   ├── presence/            # tts / stt / sidecar
│   ├── infra/               # config / soul / system / tray / eventbus / error
│   ├── lib.rs               # app 入口
│   └── main.rs
│
├── sidecar/
│   └── speech/              # CosyVoice + whisper Python sidecar
│
├── data/                    # 本地数据（.gitignore）
│   ├── memory.db
│   ├── vectors/             # Chroma 持久化
│   └── logs/
│
├── public/                  # 静态资源
│   └── live2dcubismcore.min.js
│
└── docs/
    ├── ARCHITECTURE.md      # 本文件
    ├── ROADMAP.md           # 里程碑路线
    ├── DECISIONS.md         # 决策记录
    ├── M0_INVENTORY.md      # 现有代码盘点
    ├── PRD.md               # 产品需求（保留历史）
    └── PROJECT_VISION.md    # 项目愿景报告
```

## 3. 事件总线规范

模块间不直接 import 内部函数，通过事件通信。

**前端**：`mitt` 单例，由 `src/infra/eventbus.ts` 导出。

```ts
import { bus } from '@/infra/eventbus'

// 发
bus.emit('brain:reply_streaming', { text: '主人主人', emotion: 'happy' })

// 收
bus.on('avatar:state_changed', ({ state }) => { ... })
```

**Rust ↔ 前端**：用 Tauri 的 `emit` / `listen`。

**事件命名约定**：`<domain>:<verb>_<noun>`，小写下划线。

### 初始事件清单（M0）

| 事件名 | 发起方 | 监听方 | payload |
|---|---|---|---|
| `infra:config_loaded` | infra | all | 全量 config |
| `infra:config_changed` | infra | all | 变化字段 |
| `infra:soul_reloaded` | infra | brain, avatar | 全量 soul |
| `brain:chat_input` | dialog ui | brain | { text } |
| `brain:reply_token` | brain | dialog ui | { stream_id, delta } |
| `brain:reply_end` | brain | dialog ui, presence, avatar | { full_text, emotion } |
| `brain:emotion_changed` | brain | avatar | { emotion, intensity } |
| `avatar:model_loaded` | avatar | brain, presence | { model_path } |
| `avatar:mouse_inside` | avatar | brain | { inside, screen_x, screen_y } |
| `presence:tts_start` | presence | avatar (lipSync) | { audio_path } |
| `presence:tts_end` | presence | brain | { stream_id } |
| `presence:stt_result` | presence | brain | { text } |
| `hands:tool_request` | brain | hands | { tool, args } |
| `hands:tool_result` | hands | brain | { tool, ok, output } |

## 4. 设计原则（不可破坏）

1. **配置驱动**：所有可调参数 YAML 化，热重载。代码里**禁止硬编码**业务参数。
2. **能力可插拔**：MCP server、LLM provider、TTS 引擎都是插件，通过统一接口接入。
3. **本地优先**：默认本地运行，云端是增强而非依赖。
4. **可观测**：所有 LLM 调用、工具执行、记忆读写都有日志。
5. **安全沙盒**：涉及写入/执行/网络的工具调用默认需要批准（白名单可放行）。
6. **域边界**：跨域只通过事件，禁止 `import` 跨域的内部模块。

## 5. 技术栈（已锁定）

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2.x + Web 前端 |
| Live2D | pixi-live2d-display@cubism4（cubism2 后续） |
| LLM | Claude API（主）+ Ollama（兜底）+ OpenAI-compat（兼容） |
| 记忆 | SQLite（结构化）+ ChromaDB（向量，M3 启用） |
| TTS | CosyVoice 2（M2 实装）+ macOS say（占位） |
| STT | whisper.cpp（M2，目前 sidecar 用 faster-whisper） |
| 工具调用 | MCP 协议（@modelcontextprotocol/sdk） |
| 桌面控制 | pyautogui / nut-js / Anthropic Computer Use（M4 决） |

## 6. 数据流：一次对话

```
[1] 用户在输入框打字 / 按 F8 说话
       │
       ▼
[2] STT (if voice) → presence:stt_result → text
       │
       ▼
[3] dialog store: bus.emit('brain:chat_input', { text })
       │
       ▼
[4] brain/chat handler:
    a. 从 memory 召回相关长期记忆 (M3)
    b. 组合三层人格 prompt
    c. 调 LLM Provider，流式
    d. 若 LLM 触发 tool_use → bus.emit('hands:tool_request')
       ↓
    e. hands 执行工具 → 等用户批准 → 返回结果
       ↓
    f. 把结果喂回 LLM，继续 stream
       │
       ▼
[5] brain:reply_token (一路推到 dialog ui)
       │
       ▼
[6] brain:reply_end → emotion 解析 → avatar:emotion_changed
       │
       ▼
[7] presence/tts: 合成音频 → presence:tts_start
       │
       ▼
[8] avatar/lipSync 监听 presence:tts_start → 驱动嘴部参数
       │
       ▼
[9] 音频播放完 → presence:tts_end
       │
       ▼
[10] brain/distill 后台凝练（M3）
```
