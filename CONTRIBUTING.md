# Contributing to TiaLynn

欢迎贡献！本项目是个人专属伴侣应用，但欢迎社区改进通用框架部分。

## 开发流程

### 1. Fork & Clone

```bash
gh repo fork wangzhenyu/TiaLynn --clone
cd TiaLynn
```

### 2. 准备环境

```bash
# 安装依赖
pnpm install
cargo install tauri-cli --version "^2.0" --locked

# 准备 Live2D 模型（不入仓）
mkdir -p HuTao-Live2D
# 复制你的模型文件进来

# （可选）启动 sidecar
cd sidecar/qwen-tts-server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 5050
```

### 3. 创建分支

分支命名：`feat/<feature>`、`fix/<issue>`、`docs/<topic>`、`refactor/<scope>`。

### 4. 提交规范

Conventional Commits：

```
feat: 新增情绪状态机的疲劳衰减
fix: 修复嘴型同步在多次播放后失效
docs: 补全 SOUL_SCHEMA 的反差变量说明
refactor: 抽离 Live2D 参数嗅探到独立模块
```

### 5. 验证

提 PR 前请确保：

```bash
pnpm typecheck                    # TS 类型检查
pnpm build                        # 前端打包
( cd src-tauri && cargo check )   # Rust 类型检查
( cd src-tauri && cargo clippy -- -D warnings )   # 可选：lint
```

### 6. PR 模板

```markdown
## 改动摘要
（一句话）

## 改动范围
- [ ] 前端 (src/)
- [ ] 后端 (src-tauri/)
- [ ] Sidecar
- [ ] 文档
- [ ] 灵魂档案

## 验证方式
（如何复现 / 测试）

## 关联 Issue
Closes #xxx
```

## 模块边界

| 关注点 | 不该跨越 |
|---|---|
| Live2D 渲染 | 不要在 `live2d/` 里直接调 LLM 或 SQLite |
| LLM 适配 | 不要在 `core/llm.rs` 里写业务（prompt 合成） |
| 灵魂 prompt | 集中在 `core/soul.rs::build_system_prompt` |
| 跨平台抽象 | 平台 API 仅放在 `window.rs` + `tray.rs` |

## 代码风格

- TypeScript：`strict` 模式，避免 `any`（必要时加注释解释）
- Rust：rustfmt + clippy；命名 snake_case；错误用 `AppError`
- Vue：`<script setup lang="ts">`；组件 PascalCase
- CSS：Tailwind 优先；全局自定义类放 `src/styles/global.css`

## 灵魂档案修改

`default.yaml` 是项目语义核心，改它会改变 TiaLynn 的人格。

- **layer1_core** 改动需在 PR 描述里解释意图
- **emotions.states** 改动需验证至少 4 个情绪在 Live2D 上视觉合理
- **signature_lines** 鼓励扩充

## 第三方资产

**不要把以下内容入仓**：
- Live2D 模型文件（受授权约束）
- 个人录音 / 声音克隆样本
- 任何 API key / 密钥

`.gitignore` 已配置兜底。

## 行为守则

- 尊重他人，包括对 TiaLynn 的人格设定
- 不上传含真人姓名 / 联系方式 / 密码的代码或截图
- 安全问题请通过 GitHub Security Advisory 上报，不要开公开 Issue
