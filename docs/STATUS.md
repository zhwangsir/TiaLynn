# docs/ 文档现状索引

> 写给「想理解 TiaLynn 当前架构 + 愿景」的新人。各文档时效不一，按本表找。
> 最近 audit：**v2.0 硅基生命容器重定向（2026-05-22）**

## 🟢 现行（v2.0 当前）

| 文档 | 用途 | 状态 |
|------|------|------|
| [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md) ⭐ **顶层产品宪章** | 「硅基生命容器」四大支柱 + 差异化 + 非目标 | v2.0 当前 |
| [PRD.md](PRD.md) | 产品需求文档（v2.0 重写） | v2.0 当前 |
| [ROADMAP.md](ROADMAP.md) | 完整 M0-M10 路线图（v2.0 重写，加 M7-M10） | v2.0 当前 |
| [RELEASE_v0.20.md](RELEASE_v0.20.md) | v0.20 灵魂自演化 + 多 mood 并存 release notes | v0.20 当前 |
| [RELEASE_v0.19.md](RELEASE_v0.19.md) | v0.19 多角色生态闭环 | v0.19 当前 |
| [RELEASE_v0.18.md](RELEASE_v0.18.md) | v0.18 三层人格 + 情感系统 | v0.18 当前 |
| [RELEASE_v0.17.md](RELEASE_v0.17.md) | v0.17 长期记忆 M2 + MCP | v0.17 当前 |
| [ARCHITECTURE_MOTION_SYSTEM.md](ARCHITECTURE_MOTION_SYSTEM.md) | 动作工业链（v0.7 落地） | v0.7+ 当前 |
| [SOUL_SCHEMA.md](SOUL_SCHEMA.md) | 灵魂档案 schema（4 yaml 拆分） | v0.5+ 当前 |
| [../README.md](../README.md) | 用户视角 quick-start + 功能概览 | v0.13 部分过时（需补 v0.20 内容） |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本日志 | 部分过时，实际进度看 git log |
| [rfcs/0001-ts-strict-tier-3.md](rfcs/0001-ts-strict-tier-3.md) | TypeScript Tier 3 严格化 RFC | v0.13 当前 |

## 🟡 历史快照（archived，仅参考）

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | v0.1 Tauri 架构 — 现在是 Electron 五大能力域 + Planner 9 BehaviorAction。新架构主要在 SILICON_LIFE_VISION + 代码本身 |
| [DECISIONS.md](DECISIONS.md) | v0.1 时代 ADR — 当时选 Tauri，但 v0.6 改 Electron。新决策没补 ADR |
| [AIRI_STUDY.md](AIRI_STUDY.md) | v0.6 转 Electron 前研究 airi 的笔记，是历史决策依据 |
| [M0_COMPLETION.md](M0_COMPLETION.md) | v0.4 M0 重写完成记录 |
| [M0_INVENTORY.md](M0_INVENTORY.md) | v0.4 M0 inventory |
| [_archived_default.yaml](_archived_default.yaml) | 老灵魂档案备份 |
| [RELEASE_v0.13.md](RELEASE_v0.13.md) | v0.13 TS Tier 3 + audit 修复批 |
| [RELEASE_v0.14.md](RELEASE_v0.14.md) | v0.14 历史 |
| [RELEASE_v0.15.md](RELEASE_v0.15.md) | v0.15 历史 |
| [RELEASE_v0.16.md](RELEASE_v0.16.md) | v0.16 历史 |

## 🔴 已知文档债

- **新 ARCHITECTURE.md**：覆盖五大能力域 + IPC 设计 + sidecar pipeline + Planner 9 BehaviorAction + ComfyUI 集成路径
- **新 DECISIONS ADR**：转 Electron / 引入 RVC / Attention Scheduler / TS Tier 3 / 手写 MCP / 硅基生命转向
- **TTS 安装文档**：sidecar/install.sh 流程 + 各 backend (Edge / CosyVoice / F5-TTS / RVC) 各自的依赖坑
- **USER_GUIDE.md**：onboarding 流程 + 常见问题 + 性能调优
- **CONTRIBUTING.md** （已存在 root）：补 PR / RFC / commit 风格规范

## 当前 audit 改动（v2.0 硅基生命重定向 — 2026-05-22）

由 Claude Code 在 worktree `compassionate-engelbart-c80410` 上做的底层文件重定义：

- ✅ `CLAUDE.md` — 顶部加 **Vision「硅基生命容器」** 块，四大支柱声明
- ✅ `docs/SILICON_LIFE_VISION.md` — **新建**顶层产品宪章
- ✅ `docs/PRD.md` — 从 v0.1.0 Foundation 重写到 **v2.0.0 Silicon Life Container**
- ✅ `docs/ROADMAP.md` — 扩展 M0-M6，**新增 M7-M10**（创造统一 / 灵魂社会 / 自主进化 / 真硅基生命）
- ✅ `docs/STATUS.md` — 本文档，反映新结构
- ✅ `electron/electron.vite.config.ts` — 修复 wlipsync top-level await 阻断 dev（target: 'chrome130'）

**真实运行验证（2026-05-22 03:00）：**
- pnpm install ✅ 801 packages reused
- typecheck ✅ exit 0
- 单测 ✅ 575 passed / 3 skipped / 578 total
- `pnpm dev` ✅ 5 个 subsystem 全启动（logger / perception / emotional / attention / tray / halt-shortcut）
- attention scheduler 真实在跑（30 秒触发 2 次 reactive + 2 次 rule-based plan）

**仍未跑通的（用户数据 / 权限问题，非代码 bug）：**
- LLM endpoint config 是 placeholder `"x"` `"b"` — 需要主人填真实 endpoint
- `electron/models-library/` 没有 Live2D 模型（.gitignored 不入仓）— `totalModels=0`
- macOS 屏幕录制权限未授 — screen-sensor capture failed

---

完整愿景 → [SILICON_LIFE_VISION.md](SILICON_LIFE_VISION.md)
完整路线 → [ROADMAP.md](ROADMAP.md)
完整产品定位 → [PRD.md](PRD.md)
