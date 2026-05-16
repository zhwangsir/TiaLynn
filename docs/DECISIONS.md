# 架构决策记录（ADR）

> 记录关键技术选型的"为什么"，便于未来回顾或翻案。

---

## ADR-100 — 项目重定向（M0 起点）

**状态**：已采纳  
**日期**：2026-05-16

### 背景
项目从 v0.1.0 到 v0.3.2 累计 13 个版本、~7800 行代码，但用户实测反复出问题：
- 设置打不开、立绘抽动、眨眼频率过快、看不到立绘等
- 用户最终判断"开发方向偏了"

### 真正的问题
我把项目做成了"通用桌宠 SDK"，但用户想要的是：
- **常驻桌面的自我进化型 AI 智能体**
- 身体（Live2D）+ 大脑（LLM）+ **手脚（MCP 工具调用）** + 灵魂（人格 + 记忆）
- 关键差异：**她能干事**，不只是看着

### 决策
重写项目宪法，按五大能力域（avatar / brain / hands / presence / infra）重组，**hands 域是项目灵魂**。

### 后果
- 历史功能（散步、像素穿透、autoComment 等）被砍
- 引入 MCP 协议作为工具调用骨干
- 技术栈锁定：Tauri + Claude API + SQLite + Chroma + CosyVoice + whisper.cpp

---

## ADR-101 — 砍 8 项过度设计代码

**状态**：已采纳  
**日期**：2026-05-16

### 砍清单
1. `src/alpha/mask.ts` — 像素穿透 mask（128×96 不够覆盖小 UI，多次引入 bug）
2. `src-tauri/src/core/motion.rs` + `commands/motion.rs` — 窗口自主散步（M5 重做更克制）
3. `src/behavior/persona.ts` — 10 状态 FSM + 意图引擎（过度设计，由 LLM 驱动即可）
4. `src/behavior/autoComment.ts` — 主动开口（M5 重做）
5. `src/behavior/idle.ts` — 8 种 idle 动作（与 persona 重叠）
6. `src/emotion/fsm.ts` 关键词触发表 — LLM JSON emotion 取代
7. `src/alpha/sampler.ts` 的 `hitTestAlpha` —— 拖动逻辑保留，hit-test 砍

### 理由
**Less is more**。这些代码引入的复杂度大于价值。用户对当前效果不满，根因不是这些功能缺失，是核心功能（对话、记忆、工具）没做好。

---

## ADR-102 — 模块边界与事件总线

**状态**：已采纳  
**日期**：2026-05-16

### 决策
所有代码归属五大域之一，**域间通信只通过事件总线**：
- 前端：`mitt` 单例（`src/infra/eventbus.ts`）
- Rust ↔ 前端：Tauri `emit` / `listen`

事件命名：`<domain>:<verb>_<noun>`。

### 理由
之前代码跨域 import 内部函数频繁（如 audio/speaker 直接 import live2d/lipSync），导致：
- 模块耦合，改一处崩多处
- 难做 plugin 系统（M4 需要）
- 难做测试

### 后果
- 跨域调用需经事件，性能损耗约 < 1μs/次，可忽略
- 强制定义清晰的事件契约
- 后续 MCP server / TTS engine / LLM provider 都成为插件

---

## ADR-103 — Live2D 模型路径完全配置化

**状态**：已采纳  
**日期**：2026-05-16

### 决策
- `soul/identity.yaml::avatar.model_path` 直接指定绝对路径
- `soul/identity.yaml::avatar.search_paths` 列表配置可扫描的根目录
- 砍掉 RuntimeConfig 的 `live2d_model_dir/file/extra_model_dirs` 字段
- 走 soul 层而非 runtime config

### 理由
模型路径属于"她的身体"的一部分，应该归属灵魂档案。runtime config 应该只放运行时变化（LLM endpoint、TTS provider 等）。

---

## ADR-104 — 灵魂档案拆分为 4 个 YAML

**状态**：已采纳  
**日期**：2026-05-16

### 决策

```
soul/
├── identity.yaml          # 名字、master 称呼、avatar 偏好
├── personality.yaml       # 三层人格 prompt 模板
├── core_memories.yaml     # 永久注入的核心记忆
└── learned_traits.yaml    # 学习到的特质（自动写入）
```

### 理由
原单文件 `default.yaml` 240 行，混了 identity / personality / emotions / behavior / tts / vision。
- 拆分让每个文件聚焦一个意图
- `learned_traits.yaml` 单独文件方便自动写入而不污染用户编辑的部分
- `core_memories.yaml` 是用户精心选择的"她记得的事"，独立维护

### 后果
- Rust SoulConfig 拆为 4 个 struct
- 热重载 watcher 需要 watch 整个 soul/ 目录
- 用户启动时若是旧 default.yaml，自动迁移到新结构

---

## ADR-105 — LLM Provider 抽象 + Anthropic 主路径

**状态**：已采纳（M1 实施）  
**日期**：2026-05-16

### 决策
- 抽象 `LLMProvider` trait
- 实现：`AnthropicProvider`（主，支持 tool_use）+ `OpenAICompatProvider`（兼容）+ `OllamaProvider`（兜底）
- 默认 Anthropic（Claude 4.x），M4 工具调用走 Anthropic tool_use API

### 理由
Claude 在 tool_use / function calling 上的稳定性是其他模型不能比的。M4 是项目灵魂，必须用最稳的工具调用 backbone。
本地 Ollama 作兜底，保证"完全离线"的承诺仍然可达成。

---

## ADR-106 — 向量记忆：ChromaDB（M3）

**状态**：计划中  
**日期**：2026-05-16

### 决策
M3 启用 ChromaDB 替代当前全表 cosine 召回。

### 理由
- 当前全表扫描在几千条记忆下勉强能用，但目标是"用一个月"，记忆量会增长
- Chroma 嵌入式（本地文件），无需服务进程
- Rust 调 Chroma 用 `chromadb` crate 或 HTTP 客户端

### 备选
- sqlite-vec：嵌入式但生态早期
- LanceDB：性能好但额外依赖

### 后果
- `data/vectors/` 目录持久化
- 长期记忆 schema 不变，多一个 `chroma_id` 列做关联

---

## ADR-107 — MCP 协议（M4，项目灵魂）

**状态**：计划中  
**日期**：2026-05-16

### 决策
M4 引入 Anthropic 设计的 Model Context Protocol：
- @modelcontextprotocol/sdk 作为 client
- 接入官方 MCP servers：filesystem、shell、git、browser
- 任何"她能干的活"都走 MCP，不自造轮子

### 理由
- 标准化 = 不重复造轮子
- 社区生态强（Slack / GitHub / Linear / Postgres ... 全都有现成 server）
- Claude 原生支持 tool_use → MCP 集成最丝滑

### 风险与缓解
- 工具被滥用 → approval 流程默认开启
- 沙盒泄露 → 受 sidecar 模式约束

---

## 历史 ADR

ADR-001 ~ ADR-008 见 git history（v0.1.0 时记录）。
