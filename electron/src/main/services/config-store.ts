/**
 * 持久化运行时配置（~/.tialynn/config.json）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeConfig } from '@shared/types'
import { getPaths } from './paths'

const DEFAULT: RuntimeConfig = {
  llm_provider: 'openai_compat',
  llm_endpoint: 'http://localhost:1234',
  llm_model: 'qwen2.5-7b-instruct',
  llm_api_key: '',
  tts_provider: 'sidecar',
  tts_sidecar_url: 'http://localhost:8765',
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
