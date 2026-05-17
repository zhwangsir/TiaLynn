# docs/ 文档现状索引

> 写给「想理解 TiaLynn 当前架构」的新人。各文档时效不一，按本表找。
> 最近 audit: v0.13 (2026-05-18)

## 🟢 仍然有效

| 文档 | 用途 | 最近更新 |
|------|------|----------|
| [README.md](../README.md) | 用户视角 quick-start + 功能概览 | v0.13 重写 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本日志 — 但只到 M2 路线规划，v0.5+ 实际进度看 git log | 部分过时 |
| [rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md) | TypeScript Tier 3 严格化 RFC | v0.13 当前 |
| [ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md) | 动作工业链（v0.7 落地的） | v0.7 当前 |

## 🟡 部分过时（参考性）

| 文档 | 状况 |
|------|------|
| [PRD.md](PRD.md) | v0.1 Tauri 时代写的产品定位 — 大方向仍对，但具体功能列表已被 v0.2-v0.12 远远超越 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | v0.1 Tauri 架构 — 现在是 Electron 五大能力域。新架构现在主要在 README 的「架构」section + 代码本身 |
| [DECISIONS.md](DECISIONS.md) | v0.1 时代 ADR — 当时选 Tauri，但 v0.6 改 Electron。新决策没补 ADR |
| [ROADMAP.md](ROADMAP.md) | v0.5 时代路线图 — 看 README 的「版本路线」section 看实际进度 |
| [SOUL_SCHEMA.md](SOUL_SCHEMA.md) | 灵魂档案 schema — 主要 schema 没大变，多灵魂文件合并是 v0.5 加的 |

## ⚪ 历史快照（archived）

| 文档 | 说明 |
|------|------|
| [AIRI_STUDY.md](AIRI_STUDY.md) | v0.6 转 Electron 前研究 airi 的笔记，决策依据 |
| [M0_COMPLETION.md](M0_COMPLETION.md) | v0.4 M0 重写完成记录 |
| [M0_INVENTORY.md](M0_INVENTORY.md) | v0.4 M0 inventory |
| [_archived_default.yaml](_archived_default.yaml) | 老灵魂档案备份 |

## 🔴 已知但还没补的文档债

- **新 ARCHITECTURE.md**：覆盖五大能力域 + IPC 设计 + sidecar pipeline + 主体性循环
- **新 ROADMAP.md**：v0.13 后的真实路线（M2 长期记忆 / M3 MCP / M4 RPA）
- **新 DECISIONS ADR**：转 Electron、引入 RVC、加 attention scheduler、TS Tier 3 几个大决策
- **TTS 安装文档**：sidecar/install.sh 流程 + 各 backend (Edge / CosyVoice / F5-TTS / RVC) 各自的依赖坑
- **cosyvoice-repo 路径搬家**（M5）：当前在 `~/.tialynn/cosyvoice-repo` 不合理（属于 sidecar
  代码，不是用户数据），应该挪到 `sidecar/cosyvoice/` 但需要 install.sh + sidecar 路径联动改

## 当前 audit 改动（v0.13）

由 audit 报告衍生的 commit：
- `feat(v0.9-v0.12)`: 累积功能合并 + TS Tier 3 (RFC 0001)
- `fix(v0.13)`: workspace 瘦身 + single-instance + LLM guard + 默认 endpoint 空 (C2/H2/H3/H4)
- `docs`: README 重写 (C1)
- `feat(v0.13)`: 首次启动引导浮窗 (C4)
- `feat(v0.13)`: 磁盘占用统计面板 + 清理 (H1)
- `chore(v0.13)`: 接 electron-log 统一日志 (M2)
- `chore(v0.13)`: history.sqlite 保留策略 + docs 现状索引 (M4/M6)

完整 audit 报告见对话历史。
