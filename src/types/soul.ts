/**
 * SoulConfig: 与 Rust 端 SoulConfig 一一对应（serde -> JSON）。
 * 详细字段含义见 docs/SOUL_SCHEMA.md。
 */
export interface SoulConfig {
  schema_version: string
  identity: {
    name: string
    master: string
    birthday: string
  }
  appearance: {
    live2d_model_dir: string
    model_file: string
    anchor: { scale: number; x_offset: number; y_offset: number }
  }
  personality: {
    layer1_core: string
    layer2_surface: string
    layer3_volatility: {
      flip_probability: number
      flip_modes: string[]
    }
  }
  speech_style: {
    max_length: number
    use_emoticons: boolean
    signature_lines: string[]
    call_master_as: string
  }
  emotions: {
    initial: EmotionId
    decay_per_minute: number
    states: Record<EmotionId, EmotionStateConfig>
  }
  behavior: {
    tick_interval_sec: number
    auto_comment_interval_sec: number
    curiosity_threshold: number
    energy_sleep_threshold: number
  }
  learned_traits: {
    observed_keywords: string[]
    master_routines: string[]
    preference_drift: Record<string, unknown>
  }
  tts: {
    provider: string
    voice_id: string
    speed: number
    pitch_shift: number
    emotion_routing: Record<EmotionId, string>
  }
  vision: {
    enabled: boolean
    endpoint: string
    model: string
    sampling_interval_sec: number
  }
}

export type EmotionId =
  | 'neutral'
  | 'happy'
  | 'shy'
  | 'angry'
  | 'sad'
  | 'sleepy'
  | 'possessive'

export interface EmotionStateConfig {
  color: string
  live2d?: Record<string, number>
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  emotion?: EmotionId
  ts: number
}
