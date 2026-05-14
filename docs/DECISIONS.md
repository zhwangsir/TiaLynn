# 架构决策记录（ADR）

> 记录关键技术选型的"为什么"，便于未来回顾或翻案。

---

## ADR-001 — 桌面壳选用 Tauri 2.x 而非 Electron

**状态**：已采纳  
**日期**：2026-05-15

### 背景
桌面伴侣需要透明置顶窗口、点击穿透、托盘、低占用。

### 选项
- A. Electron：生态最熟、Node 全栈、但单应用 80MB+ 内存 250MB+
- B. Tauri 2.x：Rust 后端 + 系统 webview，包体 5-15MB，性能/内存原生级
- C. Qt/Avalonia：跨平台桌面老牌，但开发体验和现代 web 栈衔接弱

### 决策
**Tauri 2.x**。理由：
1. 包体小、内存低，符合"轻量桌面伴侣"定位
2. 透明窗口、置顶、点击穿透官方 API 成熟
3. 与 airi/JPet 同栈，参考代码易迁移
4. Rust 后端做 RPA / SQLite / sidecar 启动天然合适

### 后果
- ✅ 用户最终包体小，启动快
- ❌ 团队需要 Rust 能力（已具备）
- ❌ Webview 跨平台渲染存在细微差异，需平台 QA

---

## ADR-002 — Live2D SDK 选用 pixi-live2d-display 而非 Cubism Web SDK 直接集成

**状态**：已采纳  
**日期**：2026-05-15

### 背景
HuTao 模型为 Cubism 4 (.moc3)。

### 选项
- A. 官方 Cubism Web SDK（商业授权要求严格）
- B. pixi-live2d-display（开源 MIT，PixiJS 集成）
- C. 自己实现 .moc3 解析（不可能）

### 决策
**B. pixi-live2d-display**。理由：
1. MIT 协议，无商业授权门槛
2. 同时支持 Cubism 3 (.moc) 和 Cubism 4 (.moc3)
3. 内置参数读写、自动眨眼、自动呼吸、命中检测
4. 社区活跃，issue 响应及时
5. 仍需配合官方 `live2dcubismcore.min.js`（Live2D 官网免费下载，开发用途免授权）

### 后果
- ✅ 开发速度快，参数 API 直接可用
- ❌ 商业发布时需注意 `live2dcubismcore` 的授权条款（个人/小团队 < $20M 营收免费）

---

## ADR-003 — TTS 接入采用 Python Sidecar 而非 Rust 绑定

**状态**：已采纳  
**日期**：2026-05-15

### 背景
Qwen3-TTS 1.7B 是 ML 模型，依赖 torch/transformers。

### 选项
- A. Rust 绑定（如 ElBruno.QwenTTS）
- B. Tauri Sidecar：Python FastAPI 子进程
- C. 走云端 API

### 决策
**B. Python Sidecar**。理由：
1. ML 生态在 Python 成熟度远超 Rust
2. Tauri 2 sidecar 机制 + PyInstaller 打包可做到对用户单进程透明
3. TTS Provider 抽象（HTTP）→ 可瞬时切换模型
4. 调试简单（curl 直接调）

### 后果
- ✅ TTS 升级换模型不动 Rust
- ✅ 多 TTS 后端可并存
- ❌ 打包体积 +200MB（torch）
- ❌ 首次启动需等 sidecar 加载（约 3-5s，做 splash 提示）

---

## ADR-004 — 记忆存储采用 SQLite + sqlite-vec 而非 LanceDB / Chroma

**状态**：已采纳  
**日期**：2026-05-15

### 选项
- A. SQLite + sqlite-vec（单文件，rusqlite 集成）
- B. LanceDB（专业向量库，但额外依赖）
- C. Chroma（Python 服务，多一个进程）

### 决策
**A. SQLite + sqlite-vec**。理由：
1. 单文件存储，符合"本地化"原则
2. rusqlite 是 Rust 生态成熟方案
3. sqlite-vec 在 1M 级向量下性能足够桌面应用
4. 关系数据 + 向量数据混存，schema 简洁

### 后果
- ✅ 部署零依赖
- ✅ 备份就是拷贝一个文件
- ❌ 1000 万级向量后性能下降（远超本场景需求）

---

## ADR-005 — 跨平台点击穿透采用前端 Alpha 采样而非全窗穿透

**状态**：已采纳  
**日期**：2026-05-15

### 背景
桌宠需要"角色身上可拖拽点击，角色外可穿透到桌面"。

### 选项
- A. 全窗穿透（不可交互，桌面装饰只读）
- B. 前端 Alpha 采样：mousemove 时读 Live2D canvas 该位置的 alpha → invoke `set_ignore_cursor_events(alpha < threshold)`
- C. 平台原生 hit-test 形状（macOS 可，Win/Linux 痛苦）

### 决策
**B. Alpha 采样**。理由：
1. 跨平台一致（只用 Tauri 通用 API）
2. 像素级精度
3. 实现简单：canvas.getContext('2d').getImageData(x, y, 1, 1)
4. 性能开销可忽略（节流 16ms）

### 后果
- ✅ 像素级穿透
- ❌ mousemove 需要持续在窗口内才能更新，需要默认非穿透 + 检测

---

## ADR-006 — 三层人格 vs 单层 system prompt

**状态**：已采纳  
**日期**：2026-05-15

### 背景
用户要求 TiaLynn 灵魂 + HuTao 外观「性格融合」。

### 决策
将人格分为：
- **Layer 1（底层）**：核心身份认同，永不变（病娇灵魂女友）
- **Layer 2（表层）**：风格调味（胡桃俏皮）
- **Layer 3（反差变量）**：每次回复有概率触发反差切换（增加随机感）

### 后果
- ✅ 同一 yaml 可换肤（替换 layer2）
- ✅ 反差感是项目独特卖点
- ❌ prompt 较长，token 消耗略高（每轮约 +200 token）

---

## ADR-007 — 灵魂热重载

**状态**：已采纳  
**日期**：2026-05-15

### 背景
"调教 TiaLynn 语气"是高频迭代场景。

### 决策
用 Rust `notify` crate 监听 `default.yaml` 变更 → 解析 + JSON Schema 校验 → 通过 Tauri event 推前端。前端 store 全部响应式订阅。

### 后果
- ✅ 改 yaml 立即生效
- ❌ 需要做 schema 校验，否则乱写 yaml 会崩

---

## ADR-008 — 引入项目的深度融合原则

**状态**：已采纳  
**日期**：2026-05-15

### 背景
用户明确「所有引入的项目和开发的内容要深度融合变成当前我们自己的项目」。

### 决策
- 设计/算法可参考 airi、JPet、animo-starter-kit
- **代码必须自己写**，不直接复制粘贴
- 第三方库只通过 npm/cargo/pip 正常依赖管理引入
- 引入的库必须协议清晰（MIT/Apache/BSD）

### 后果
- ✅ 知识产权清晰
- ✅ 代码风格统一
- ❌ 开发量略高于 fork-and-modify
