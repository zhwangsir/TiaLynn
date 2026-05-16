# Hands — 工具执行层（M4 实施）

> 她能干什么活。**项目的灵魂在此**。

## 职责（M4 启用）

- MCP 客户端（Anthropic Model Context Protocol）
- 内置工具：filesystem / shell / browser / git / screenshot
- 工具调用 UI：意图展示 + 批准/拒绝
- 安全沙盒：默认敏感操作需确认
- 自动化编排：把多步操作组合成"她会的活"
- 主动建议（基于屏幕观察）

## 模块（M4 创建）

```
hands/
├── mcp_client/        # MCP server 连接、能力发现
├── tools/             # 内置工具实现
│   ├── builtin/       # screenshot / open_app 等不走 MCP 的
│   └── adapters/      # MCP server 适配层
├── approval/          # 批准策略 + UI 对话框
└── README.md
```

## M0 状态

**M0 不实施 hands，只占位**。  
当前目录为空，由 M4 milestone 启动开发。

## 输入事件（M4）
- `brain:tool_request` → LLM 要求执行某工具

## 输出事件（M4）
- `hands:tool_result` → 执行结果回喂 brain
- `hands:approval_required` → 弹批准对话框
- `hands:capabilities_changed` → MCP server 增减

## 安全约束（M4）
- 所有"写入 / 执行 / 网络请求"类工具，默认需用户批准
- 白名单可放行重复操作
- 工具执行有审计日志（infra/logger）
