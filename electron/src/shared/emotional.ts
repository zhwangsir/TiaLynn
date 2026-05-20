/**
 * Long-term emotional state types — shared 层 (Phase 1 J)。
 *
 * 跟 character intimacy_level 互补:
 *   intimacy_level = 总累积关系深度（单调递增）
 *   EmotionalState = 此刻心情 + 短期波动 + 话题情感记忆（多维 + 可衰减）
 *
 * 纯接口 — 无 fs / electron 依赖，main + renderer + shared 通用。
 */

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

export interface TopicImprint {
  topic: string
  sentiment: number
  count: number
  last_at: number
}

export interface MoodChange {
  ts: number
  mood: Mood
  trigger: string
}

export interface EmotionalState {
  character_id: string
  baseline_mood: Mood
  current_mood: Mood
  mood_intensity: number
  missing_intensity: number
  last_chat_at: number
  updated_at: number
  topic_imprints: Record<string, TopicImprint>
  mood_history: MoodChange[]
}
