# Contributing to TiaLynn

欢迎贡献！本项目是个人 AI 伴侣，但欢迎社区改进通用框架部分。

## 开发流程

### 1. Fork & Clone

```bash
gh repo fork zhwangsir/TiaLynn --clone
cd TiaLynn
```

### 2. 准备环境

```bash
# 安装依赖（pnpm workspace 会自动只装 electron 子项目）
pnpm install

# 准备 Live2D 模型（不入仓 — 受授权约束）
mkdir -p electron/models-library
# 把你的 .model3.json + .moc3 + textures 目录复制进去

# （可选）启动 TTS sidecar
bash sidecar/install.sh           # 完整安装含 CosyVoice + RVC
# or
bash sidecar/install.sh --minimal # 只装 edge-tts

cd sidecar/qwen-tts-server
source .venv/bin/activate
uvicorn main:app --port 8765
```

### 3. 创建分支

分支命名：`feat/<feature>`、`fix/<issue>`、`docs/<topic>`、`refactor/<scope>`、`chore/<task>`。

### 4. 提交规范

Conventional Commits：

```
feat: 新增情绪状态机的疲劳衰减
fix: 修复嘴型同步在多次播放后失效
docs: 补全 SOUL_SCHEMA 的反差变量说明
refactor: 抽离 Live2D 参数嗅探到独立模块
chore: 升级 electron 33 → 35
```

### 5. 验证

提 PR 前请确保：

```bash
pnpm typecheck                                  # TS 类型检查
pnpm build                                      # electron-vite 产物
pnpm -F tialynn-electron package:mac            # macOS .dmg 打包（可选，需 ~2 分钟）
```

TypeScript Tier 3 严格模式开启 — `any` / `@ts-ignore` 均不被允许（RFC 0001）。

### 6. PR 模板

```markdown
## 改动摘要
（一句话）

## 改动范围
- [ ] avatar (electron/src/renderer/src/avatar/)
- [ ] brain (electron/src/renderer/src/brain/ + electron/src/main/services/llm/)
- [ ] presence (electron/src/renderer/src/presence/ + sidecar/)
- [ ] hands (electron/src/renderer/src/hands/ + electron/src/main/services/motion-factory/)
- [ ] attention (electron/src/main/services/attention/ + perception/)
- [ ] infra (UI / IPC / 配置 / 文档)

## 验证方式
（如何复现 / 测试）

## 关联 Issue
Closes #xxx
```

## 模块边界

五大能力域 + infra 横切：

| 域 | 职责 | 边界 |
|----|------|------|
| **avatar** 身体 | Live2D 渲染 / 像素穿透 / 拖动 | 不直接调 LLM / SQLite / TTS |
| **brain** 思考 | LLM provider / dialog store / 灵魂 prompt | 不直接渲染 / 不调 system shell |
| **presence** 声音 | TTS / STT / 嘴型同步 / 流式音频 | 不维护对话状态 |
| **hands** 行动 | Motion factory / Plan executor / 桌面动作 | 不写业务逻辑 |
| **attention** 主体 | PerceptionBus / Scheduler / Planner | 不直接操作 UI |

域间通信走 `infra/eventbus`（renderer）或 IPC（main ↔ renderer），不直接 import 跨域 store。
纯 util 函数（`brain/parser.ts` 等）可以跨域使用。

## 代码风格

- **TypeScript**：Tier 3 strict mode — `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitReturns` + `noImplicitOverride`。不允许 `any` / `@ts-ignore`。
- **Vue**：`<script setup lang="ts">`；组件 PascalCase；优先 `ref` 而非 `reactive`（更易跨进程 IPC 序列化）。
- **CSS**：OKLCH 颜色 + design tokens（`var(--color-*)` / `var(--text-*)` / `var(--space-*)` / `var(--ease-*)`）。
- **Python sidecar**：PEP 8；类型注解；用 venv。
- **文件大小**：单文件 < 800 行（SettingsPanel / ModelLibraryPanel 是 known 例外，欢迎拆）。
- **函数大小**：< 50 行（IPC handler 可放宽到 100 行）。

## 灵魂档案修改

`default.yaml` + `~/.tialynn/soul/*.yaml` 是 TiaLynn 人格的语义核心。

- **layer1_core** 改动需在 PR 描述里解释意图
- **emotions.states** 改动需验证至少 4 个情绪在 Live2D 上视觉合理
- **signature_lines** 鼓励扩充

## 第三方资产

**不要把以下内容入仓**：
- Live2D 模型文件（受 Live2D 商业授权约束）
- 个人录音 / 声音克隆样本
- 任何 API key / 密钥（包括示例配置里）
- Python sidecar 的 venv / TTS 模型

`.gitignore` 已配置兜底，但提交前请 `git status` 确认。

## 关键文档

- [docs/STATUS.md](docs/STATUS.md) — 文档现状索引（有的文档已过时）
- [docs/ARCHITECTURE_MOTION_SYSTEM.md](docs/ARCHITECTURE_MOTION_SYSTEM.md) — 动作系统
- [docs/SOUL_SCHEMA.md](docs/SOUL_SCHEMA.md) — 灵魂档案 schema
- [docs/rfcs/0001-ts-strict-tier-3.md](docs/rfcs/0001-ts-strict-tier-3.md) — TS 严格化决策

## 行为守则

- 尊重他人，包括对 TiaLynn 的人格设定
- 不上传含真人姓名 / 联系方式 / 密码的代码或截图
- 安全问题请通过 GitHub Security Advisory 上报，不要开公开 Issue
