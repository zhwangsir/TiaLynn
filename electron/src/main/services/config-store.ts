/**
 * 持久化运行时配置（~/.tialynn/config.json）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeConfig } from '@shared/types'
import { getPaths } from './paths'

const DEFAULT: RuntimeConfig = {
  llm_provider: 'openai_compat',
  // 默认留空 — 首次启动时引导用户填本地 ollama / LM Studio / vLLM endpoint
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  tts_provider: 'sidecar',
  // 默认留空 — 用户在 Settings 里配（或留空使用 macOS `say` fallback）
  tts_sidecar_url: '',
  // v0.9: RVC 默认不启用（空 voice）。训练好后在设置里选
  rvc_voice: '',
  rvc_f0_up_key: 0,
  rvc_index_rate: 0.75,
  rvc_f0_method: 'rmvpe' as const,
  // v0.11: 底座 TTS 语速/音量/音调（edge_tts SSML 格式）
  tts_rate: '+0%',
  tts_volume: '+0%',
  tts_pitch: '+0Hz',
  // v0.11: RVC 高级参数
  rvc_protect: 0.33,
  rvc_filter_radius: 3,
  rvc_rms_mix_rate: 1.0,
  rvc_resample_sr: 0,
  idle_min_sec: 60,
  idle_max_sec: 180,
  autocomment_interval_sec: 600,
  emotion_decay_per_minute: 0.1,
  flip_probability: 0.15,
  emotion_voice_map: {
    neutral: 'edge:zh-CN-XiaoyiNeural',
    happy: 'edge:zh-CN-XiaoyiNeural',
    sad: 'edge:zh-CN-XiaoyiNeural',
    angry: 'edge:zh-CN-XiaoyiNeural',
    shy: 'edge:zh-CN-XiaoyiNeural',
    tease: 'edge:zh-CN-XiaoyiNeural',
    sleepy: 'edge:zh-CN-XiaoyiNeural',
    surprise: 'edge:zh-CN-XiaoyiNeural',
  },
  embedding_endpoint: '',
  embedding_model: '',
  openai_compat_merge_system: true, // 兼容 LM Studio Qwen MoE jinja bug
  history_retention_days: 0, // 0 = 永久保留；用户可改 90/180/365
}

function configPath(): string {
  return join(getPaths().userDataDir, 'config.json')
}

export function loadConfig(): RuntimeConfig {
  const p = configPath()
  if (!existsSync(p)) return { ...DEFAULT }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<RuntimeConfig>
    return { ...DEFAULT, ...parsed, emotion_voice_map: { ...DEFAULT.emotion_voice_map, ...(parsed.emotion_voice_map ?? {}) } }
  } catch (e) {
    console.warn('[config] parse failed, using defaults:', e)
    return { ...DEFAULT }
  }
}

export function saveConfig(cfg: RuntimeConfig): RuntimeConfig {
  const merged = { ...loadConfig(), ...cfg }
  writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
