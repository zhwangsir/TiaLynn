/**
 * Attention/Behavior 共享类型 — 主体性 AI 的「想什么、做什么」描述。
 */
import type { EmotionId } from './types'

/** 关注度场快照（用于调试 + LLM context） */
export interface AttentionSnapshot {
  /** 关注主人当前活动的程度 0~1 */
  focus_on_master: number
  /** 关注屏幕特定区域的程度 0~1 */
  focus_on_screen: number
  /** 主人需要被关心的程度（idle 越久越高，看到 frustrated 状态加分） */
  concern_level: number
  /** 自己当前的"心情倾向"（受 emotion + soul layer3 反差影响） */
  mood: EmotionId
  /** 最近一次行动时间，用于冷却 */
  last_action_at: number
  /** 最近的视觉描述（如果有） */
  last_vision_activity?: string
  last_vision_state?: string
  /** 当前正在聚焦的应用 */
  current_app?: string
  /** 主人 idle 时长 ms */
  idle_ms: number
  /** 当前时段 */
  time_period: 'morning' | 'afternoon' | 'evening' | 'night' | 'late_night'
}

/** Planner 输出的行为指令 */
export type BehaviorAction =
  | {
      type: 'glance_at_screen'
      /** 看向的屏幕绝对坐标（窗口外也行） */
      screen_x: number
      screen_y: number
      /** 持续时间 ms（看一眼后会自动回中） */
      duration_ms: number
      reason: string
    }
  | {
      type: 'look_back_to_master'
      /** 回到看相机/主人方向 */
      duration_ms: number
    }
  | {
      type: 'speak'
      /** 主动说的话（会作为 assistant turn 注入 dialog） */
      text: string
      emotion: EmotionId
      intensity: number
      /** 是否 TTS */
      tts?: boolean
    }
  | {
      type: 'play_motion'
      /** 通过 TriggerEngine / Library 来源 */
      source: 'library_template' | 'engine_entry'
      template_id?: string
      entry_id?: number
    }
  | {
      type: 'change_emotion'
      emotion: EmotionId
      intensity: number
    }
  | {
      type: 'idle_subtle'
      /** 无目标，纯 idle filler，比如轻微呼吸/眨眼 */
      duration_ms: number
    }

export interface BehaviorPlan {
  /** plan 创建时间 */
  t: number
  /** Planner 触发原因 */
  trigger: string
  /** 决策出的行动序列（按顺序执行） */
  actions: BehaviorAction[]
  /** Planner 内部思考（调试用） */
  reasoning?: string
  /** 是否由 LLM 生成 */
  llm_generated: boolean
}

/** Scheduler 的输出 — 是否触发 Planner */
export interface SchedulerDecision {
  /** 是否触发 Planner */
  should_act: boolean
  /** 触发原因 */
  reason: string
  /** 当前关注度快照（传给 Planner） */
  snapshot: AttentionSnapshot
}

export interface AttentionConfig {
  /** 总开关 — 关闭后只走简单 trigger-engine 反射 */
  enabled: boolean
  /** Scheduler tick 间隔 ms */
  tick_ms: number
  /** 默认两次主动行为最小间隔 */
  min_action_interval_ms: number
  /** 主动说话最小间隔（更长） */
  min_speak_interval_ms: number
  /** Planner 是否调 LLM（关掉 = 纯规则） */
  use_llm_planner: boolean
  /** Planner LLM 调用频率上限（每分钟次数） */
  llm_planner_max_per_minute: number
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  enabled: true,
  tick_ms: 5000,
  min_action_interval_ms: 8000,
  min_speak_interval_ms: 90_000,
  use_llm_planner: true,
  llm_planner_max_per_minute: 4,
}
