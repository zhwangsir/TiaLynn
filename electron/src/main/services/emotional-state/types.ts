/**
 * Long-term emotional state trajectory — TiaLynn 情感模型护城河 (Phase 1 J)。
 *
 * 跟 character intimacy_level 互补：
 *   - intimacy_level   = 总累积关系深度（单调递增）
 *   - EmotionalState   = 此刻心情 + 短期波动 + 话题情感记忆（多维 + 可衰减）
 *
 * airi 没有这个层 — 他们的 system prompt 是静态文本，无法表达"今天心情不好"
 * "提到大学时代会变温柔"这种动态人格切片。
 */

/** 基础心情池 — 跟 soul example_dialogues 的 emotion 标签对齐 */
export type Mood =
  | 'happy'
  | 'calm'
  | 'shy'
  | 'tease'
  | 'sad'
  | 'anxious'
  | 'missing'
  | 'sleepy'
  | 'angry'

/** 话题印记 — 某话题被聊到后留下的情感残留 */
export interface TopicImprint {
  /** 话题关键词（lowercased） */
  topic: string
  /** sentiment -1.0 ~ 1.0：负值=不愉快话题，正值=喜欢的话题 */
  sentiment: number
  /** 被提及次数（越多印记越稳定） */
  count: number
  /** 最近一次被提及 ts */
  last_at: number
}

/** mood 历史一条 — 用于回溯 */
export interface MoodChange {
  ts: number
  mood: Mood
  /** 触发原因短描述（'chat_burst' / 'long_silence' / 'topic:工作' / 'periodic'） */
  trigger: string
}

export interface EmotionalState {
  character_id: string
  /** 默认底色 — 角色 baseline，永远会回归到这 */
  baseline_mood: Mood
  /** 当下的心情 */
  current_mood: Mood
  /** current_mood 强度 0~1 — 0.3 是淡，0.9 是浓烈 */
  mood_intensity: number
  /** 想念主人的强度 0~1 — 跟 last_chat_at 间隔挂钩 */
  missing_intensity: number
  /** 最近 chat 时刻 */
  last_chat_at: number
  /** 上次更新这个 state 时刻 */
  updated_at: number
  /** 话题情感印记表（key = lowercased topic） */
  topic_imprints: Record<string, TopicImprint>
  /** 最近 mood_history (最多 30 条 LRU) */
  mood_history: MoodChange[]
}

/** 创建默认 state — 新 character 时调用 */
export function createDefaultEmotionalState(
  characterId: string,
  baseline: Mood = 'calm',
): EmotionalState {
  const now = Date.now()
  return {
    character_id: characterId,
    baseline_mood: baseline,
    current_mood: baseline,
    mood_intensity: 0.3,
    missing_intensity: 0,
    last_chat_at: now,
    updated_at: now,
    topic_imprints: {},
    mood_history: [{ ts: now, mood: baseline, trigger: 'init' }],
  }
}
