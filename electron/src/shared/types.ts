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
  /**
   * v0.7.5: OpenAI-compat 兼容模式 — 把 system message 合并到第一个 user message 前。
   * 默认 true，兼容 LM Studio 上的 Qwen/Llama 量化模型（jinja template bug）。
   * 真 OpenAI / SiliconFlow 可关掉（它们对 system 支持完美）。
   */
  openai_compat_merge_system?: boolean
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
  /** 解析 .model3.json 后得到的元数据；用于过滤"完整可用"模型 */
  meta?: {
    /** moc3 文件存在 + 至少一张 texture */
    has_core: boolean
    /** 至少有 1 个动作 (motion3.json) */
    has_motions: boolean
    /** 有 expressions 表情 */
    has_expressions: boolean
    /** 有 physics 物理 */
    has_physics: boolean
    /** 动作总数 */
    motion_count: number
    /** 表情总数 */
    expression_count: number
    /** moc3 文件 size (KB) - 占位模型通常 < 50KB */
    moc_kb: number
    /** 全部 texture 总大小 (KB) - 占位/小色块通常 < 200KB */
    texture_kb: number
    /** 综合判定：has_core && has_motions && 大小达标 */
    complete: boolean
    /** 强烈推荐（builtin + 通过严格阈值） */
    recommended: boolean
    /** 不完整时给出原因（多个用 ; 连接） */
    reason?: string
  }
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
  /** LLM 发起的工具调用（流式期间，可能多个） */
  tool_use?: {
    id: string
    name: string
    input: Record<string, unknown>
  }
  /** 该轮 stop_reason 是 tool_use，提示 renderer 需要执行工具并续轮 */
  needs_tools?: boolean
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
