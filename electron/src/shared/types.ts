/**
 * 主进程 ↔ 渲染进程共享类型。
 */

export type LlmProvider = 'anthropic' | 'openai_compat' | 'ollama'

export interface RuntimeConfig {
  llm_provider: LlmProvider
  llm_endpoint: string
  llm_model: string
  llm_api_key: string
  tts_provider: 'edge' | 'sidecar' | 'none'
  tts_sidecar_url: string
  idle_min_sec: number
  idle_max_sec: number
  autocomment_interval_sec: number
  emotion_decay_per_minute: number
  flip_probability: number
  emotion_voice_map: Record<string, string>
  embedding_endpoint: string
  embedding_model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  temperature: number
  max_tokens?: number
}

export interface ModelInfo {
  dir: string
  model_file: string
  absolute_path: string
  source: 'builtin' | 'user' | string
  cubism: 'cubism2' | 'cubism4'
  display: string
  root_id: string
}

export interface SoulConfig {
  schema_version: string
  name: string
  master: string
  call_master_as: string
  layer1_core: string
  layer2_surface: string
  layer3_volatility_prompt: string
  flip_probability: number
  speech_style: {
    catchphrases: string[]
    speech_tics: string[]
    forbidden_words: string[]
  }
  output_protocol: {
    format: string
    example: string
  }
  avatar: {
    model_dir: string
    model_file: string
    scale: number
    offset_y: number
    search_paths: string[]
  }
}

export interface IpcStreamChunk {
  streamId: string
  delta?: string
  done?: boolean
  error?: string
  full_text?: string
  emotion?: string
  intensity?: number
}

export type EmotionId =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprise'
  | 'shy'
  | 'tease'
  | 'sleepy'
