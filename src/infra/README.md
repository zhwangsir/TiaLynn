# Infra — 基础设施层

> 让她稳定地活着。

## 职责

- 事件总线（`eventbus.ts`，mitt 单例）
- 配置：灵魂档案 + RuntimeConfig 加载、热重载
- 存储：SQLite 封装（M3 加 Chroma）
- 跨平台抽象（透明窗口、托盘、快捷键）
- 通用 UI 组件（设置面板）
- 日志（M3）

## 模块

```
infra/
├── eventbus.ts        # mitt 单例 + 事件类型
├── config/            # 配置 store + 加载逻辑
├── ui/                # SettingsPanel.vue 等通用 UI
├── stores/            # config pinia
└── styles/            # 全局 css
```

## 输入事件
- 无（所有 infra 模块是基础设施，被其他域调用）

## 输出事件
- `infra:config_loaded` → 启动时
- `infra:config_changed` → 用户保存设置
- `infra:soul_reloaded` → soul YAML 文件变化（notify watcher）
- `infra:hotkey_pressed` → 全局快捷键
- `infra:app_quitting` → 退出前清理

## 约束
- **不持有任何业务状态**
- 不调用其他域的内部函数（其他域通过事件向 infra 注册）
- 所有跨平台代码（macOS-only / Windows-only）放此层抽象
