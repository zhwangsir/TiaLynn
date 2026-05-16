# Avatar — 形象表现层

> 她长什么样、怎么动。

## 职责

- Live2D 模型加载与渲染
- 透明置顶窗口管理
- 拖动、缩放、点击穿透
- 表情切换、idle 动作、视线跟随、嘴型同步（参数源驱动）
- 模型热切换（从用户的 `Live2d-model-master` 任选）
- 鼠标穿透判定

## 模块

```
avatar/
├── render/            # PIXI + Live2DModel
├── animation/         # eyeBlink / focus / lipSync
├── interaction/       # drag / hit-test
├── emotion-params/    # 情绪 → Live2D 参数表
├── components/        # Live2DStage.vue
└── stores/            # avatar pinia state
```

## 输入事件
- `brain:emotion_changed` → 切换情绪参数
- `presence:tts_start` → 启动 lipSync
- `infra:config_changed` → 模型切换 / 缩放调整
- `infra:soul_reloaded` → 模型路径变化

## 输出事件
- `avatar:model_loaded` → 模型加载完成
- `avatar:mouse_inside` → 鼠标进入立绘区域（启发 brain）
- `avatar:dragged` → 用户拖动了立绘

## 约束
- **不直接 import** brain / presence / hands 任何模块
- 不持有 LLM、TTS、记忆相关状态
- 只接收事件，不直接调用其他域的函数
