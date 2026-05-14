# TiaLynn 架构文档

> 版本：v0.1.0  
> 最后更新：2026-05-15

## 1. 技术栈

| 层 | 技术 | 理由 |
|---|---|---|
| 桌面壳 | Tauri 2.x | 5-15MB 包体、原生透明窗口、像素穿透 API 成熟 |
| 后端 | Rust 1.95 | Tauri 原生 |
| 前端 | Vue 3 + TypeScript + Vite | 响应式、生态成熟 |
| 渲染 | PixiJS 7 + pixi-live2d-display + Cubism 4 Runtime | Live2D 业界标准 |
| 样式 | Tailwind CSS | 快速 UI |
| 存储 | SQLite (rusqlite) + sqlite-vec（v0.2 启用） | 单文件本地数据库 |
| TTS sidecar | Python 3.10+ FastAPI + Qwen3-TTS（v0.2 启用） | ML 生态 |
| 配置 | YAML + JSON Schema | 灵魂档案可读可校验 |

## 2. 模块边界

```
┌─────────────────────── Tauri Webview (前端 Vue) ───────────────────────┐
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  Live2D      │  │  Dialog UI   │  │  Mouse / Alpha Sampler       │  │
│  │  Renderer    │  │  Bubble      │  │  (穿透检测)                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘  │
│         │                  │                          │                  │
│  ┌──────┴─────────────────┴──────────────────────────┴───────────────┐  │
│  │           Frontend Stores (Pinia: emotion, dialog, soul)          │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                  │                                       │
└──────────────────────────────────┼───────────────────────────────────────┘
                                   │  Tauri IPC (invoke / event)
┌──────────────────────────────────┼───────────────────────────────────────┐
│                                  ▼                                       │
│  ┌──────────────────────────── Rust Core ───────────────────────────┐  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐            │  │
│  │  │  Soul       │  │  LLM         │  │  Memory      │            │  │
│  │  │  Loader     │  │  Adapter     │  │  Store       │            │  │
│  │  │  (yaml)     │  │  (OpenAI)    │  │  (sqlite)    │            │  │
│  │  └─────────────┘  └──────┬───────┘  └──────────────┘            │  │
│  │                          │                                        │  │
│  │  ┌─────────────┐  ┌──────┴───────┐  ┌──────────────┐            │  │
│  │  │  Window     │  │  TTS         │  │  Tray        │            │  │
│  │  │  Manager    │  │  Adapter     │  │  Manager     │            │  │
│  │  └─────────────┘  └──────┬───────┘  └──────────────┘            │  │
│  └─────────────────────────┼─────────────────────────────────────────┘  │
│                            │                                             │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │  HTTP (localhost)
┌────────────────────────────┴─────────────────────────────────────────────┐
│             Sidecar: Qwen3-TTS Server (Python, v0.2 启用)              │
└──────────────────────────────────────────────────────────────────────────┘
```

## 3. 数据流：一次对话的完整链路

```
1. 用户在气泡输入框输入 "今天好累"
       │
       ▼
2. Vue 调用 invoke('chat', { message })
       │
       ▼
3. Rust 端 chat handler:
   a. 从 Memory 加载短期对话历史（最近 N 条）
   b. 从 Soul 加载三层人格 system prompt
   c. 拼合 messages = [system, ...history, {user, "今天好累"}]
   d. 调用 LLM Adapter，OpenAI-compat SSE 流式
       │
       ▼
4. Rust 通过 emit('chat::token', delta) 边收边推前端
       │
       ▼
5. Vue 气泡 store 接收 token，打字机效果显示
   同时调用 Emotion FSM: 输入 "累" → 检测 → 切换 emotion='caring'
       │
       ▼
6. Emotion 变化 → Live2D Renderer 订阅 → 修改 Param 组合（柔和眼神 + 微倾头）
       │
       ▼
7. 全部 token 收齐 → 调用 TTS Adapter → 播放音频
       │
       ▼
8. 音频播放过程中：Web Audio AnalyserNode 取 RMS → ParamMouthOpenY
       │
       ▼
9. 对话完成 → Memory.append({user_msg, assistant_msg, emotion, ts})
```

## 4. 目录结构

```
TiaLynn/
├── docs/                          # 设计文档
├── HuTao-Live2D/                  # Live2D 模型（不入仓，.gitignore）
├── example_voice/                 # 声音样本（不入仓，.gitignore）
├── default.yaml                   # 默认灵魂档案
├── src-tauri/                     # Rust 后端
│   ├── src/
│   │   ├── main.rs                # 入口
│   │   ├── window.rs              # 窗口管理 + 点击穿透
│   │   ├── tray.rs                # 系统托盘
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── chat.rs            # 对话命令
│   │   │   ├── soul.rs            # 灵魂加载
│   │   │   ├── memory.rs          # 记忆 CRUD
│   │   │   └── tts.rs             # TTS 调用
│   │   ├── core/
│   │   │   ├── mod.rs
│   │   │   ├── soul.rs            # 灵魂三层人格 prompt 合成
│   │   │   ├── llm.rs             # OpenAI-compat 客户端
│   │   │   ├── memory.rs          # SQLite 操作
│   │   │   └── tts.rs             # TTS Provider trait
│   │   └── error.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── src/                           # Vue 前端
│   ├── main.ts
│   ├── App.vue
│   ├── components/
│   │   ├── Live2DCanvas.vue       # PixiJS Live2D 渲染
│   │   ├── DialogBubble.vue       # 对话气泡
│   │   └── InputBar.vue           # 输入框
│   ├── stores/
│   │   ├── soul.ts
│   │   ├── dialog.ts
│   │   ├── emotion.ts
│   │   └── settings.ts
│   ├── live2d/
│   │   ├── renderer.ts            # Live2D 渲染器封装
│   │   ├── params.ts              # 参数嗅探 + 程序化驱动
│   │   ├── eyeBlink.ts            # 自动眨眼
│   │   ├── breath.ts              # 呼吸
│   │   ├── focus.ts               # 视线跟随
│   │   └── lipSync.ts             # 嘴型同步
│   ├── emotion/
│   │   ├── fsm.ts                 # 情绪状态机
│   │   └── mapping.ts             # 情绪→Live2D 参数映射
│   ├── alpha/
│   │   └── sampler.ts             # 像素 alpha 采样穿透
│   └── utils/
├── sidecar/
│   └── qwen-tts-server/           # Python TTS 服务（v0.2 启用，先放骨架）
│       ├── main.py
│       └── requirements.txt
├── public/
│   └── live2dcubismcore.min.js    # Cubism 4 runtime（从 Live2D 官网下载）
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── .gitignore
├── LICENSE
├── README.md
├── CHANGELOG.md
└── CONTRIBUTING.md
```

## 5. 关键接口契约

### 5.1 Rust ↔ Vue（Tauri IPC）

| Command (invoke) | 参数 | 返回 |
|---|---|---|
| `soul_load` | `path?: string` | `SoulConfig` |
| `soul_reload` | - | `SoulConfig`（热重载） |
| `chat_send` | `message: string` | `stream_id: string` |
| `memory_recent` | `limit: number` | `Message[]` |
| `tts_speak` | `text: string, emotion: string` | `audio_path: string` |
| `window_set_ignore_cursor` | `ignore: bool` | `()` |

| Event (emit) | Payload |
|---|---|
| `chat::token` | `{ stream_id, delta }` |
| `chat::end` | `{ stream_id, full_text, emotion }` |
| `soul::changed` | `SoulConfig`（热重载触发） |
| `tts::audio_ready` | `{ path, duration_ms }` |

### 5.2 LLM Provider Trait（Rust）

```rust
#[async_trait]
pub trait LLMProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<Message>,
        opts: ChatOptions,
    ) -> Result<BoxStream<'static, Result<String>>>;
}
```

实现：`OpenAICompatProvider`（覆盖 Ollama / LM Studio / vLLM / OpenAI 本身）

### 5.3 TTS Provider Trait（Rust）

```rust
#[async_trait]
pub trait TTSProvider: Send + Sync {
    async fn speak(&self, text: &str, emotion: Emotion) -> Result<PathBuf>;
}
```

实现：
- v0.1：`MacOSSayProvider`（fallback，调用 `say` 命令）
- v0.1：`SidecarHttpProvider`（指向 sidecar，未启动则降级）
- v0.2：Sidecar 内 Qwen3-TTS 完整实装

## 6. 配置文件

### 6.1 灵魂档案 `default.yaml`（详见 SOUL_SCHEMA.md）

### 6.2 运行时配置 `~/.tialynn/config.toml`

```toml
[llm]
endpoint = "http://192.168.71.100:1234/v1"
model = "qwen3.5-397b-a17b"
api_key = ""

[tts]
provider = "macos_say"   # "macos_say" | "sidecar"
sidecar_url = "http://127.0.0.1:5050"

[window]
width = 400
height = 600
always_on_top = true
click_through = "pixel"   # "pixel" | "always" | "never"

[memory]
db_path = "~/Library/Application Support/TiaLynn/memory.db"
short_term_window = 20
```

## 7. 跨平台抽象点

| 能力 | macOS | Windows | Linux |
|---|---|---|---|
| 透明窗口 | NSWindow.isOpaque=false | WS_EX_LAYERED | GTK compositor |
| 点击穿透 | setIgnoresMouseEvents | WS_EX_TRANSPARENT | XShape |
| 置顶 | NSStatusWindowLevel | HWND_TOPMOST | _NET_WM_STATE_ABOVE |
| 托盘 | NSStatusItem | Shell_NotifyIcon | StatusNotifierItem |
| 全局快捷键 | Carbon | RegisterHotKey | X11 grab |

Tauri 2 已抽象前三项；托盘用 `tauri-plugin-tray`；快捷键 `tauri-plugin-global-shortcut`（v0.2）。

## 8. 性能预算

| 指标 | 目标 |
|---|---|
| 启动时间（冷） | < 2s |
| 内存常驻 | < 200MB |
| Live2D 帧率 | 60 FPS |
| LLM 首 token 延迟 | < 1.5s（本地网络） |
| TTS 首音延迟 | < 800ms（v0.2 Qwen3） |
| 嘴型同步延迟 | < 100ms |
