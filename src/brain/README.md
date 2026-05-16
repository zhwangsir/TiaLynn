# Brain — 智能核心层

> 她怎么思考、记什么。

## 职责

- LLM Provider 抽象（Claude / OpenAI-compat / Ollama）
- 三层人格 prompt：底层身份 + 表层语气 + 反差变量
- 短期记忆（SQLite messages）+ 长期向量记忆（ChromaDB，M3）
- 凝练 tick：周期把对话总结为 fact
- 记忆衰减与强化（M6）
- 情绪状态机（轻量，无关键词 FSM，由 LLM JSON 输出驱动）

## 模块

```
brain/
├── providers/         # claude / ollama / openai-compat 适配
├── persona/           # 灵魂档案 → system prompt 合成
├── memory/            # short_term / long_term / vector / distill
├── emotion/           # decayTick + EmotionId 类型
├── stores/            # dialog / emotion / soul pinia
├── types/             # SoulConfig, ChatMessage, EmotionId
└── components/        # DialogBubble / InputBar
```

## 输入事件
- `brain:chat_input` → 用户输入文本，触发对话
- `presence:stt_result` → 语音输入转写，触发对话
- `hands:tool_result` → 工具调用结果，喂回 LLM 继续生成

## 输出事件
- `brain:reply_token` → 流式 token 推送
- `brain:reply_end` → 流结束，full_text + emotion
- `brain:emotion_changed` → 情绪变化，驱动 avatar
- `hands:tool_request` → LLM 请求调用工具

## 约束
- **不直接 import** avatar / presence / hands 模块
- LLM 输出 JSON 协议：`{ text, emotion, intensity, tool_call? }`
- 所有 prompt 模板放 `persona/`，不散落各处
