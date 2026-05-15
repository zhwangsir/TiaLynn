import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface ConfigDto {
  llm_endpoint: string
  llm_model: string
  llm_api_key: string
  tts_provider: string
  tts_sidecar_url: string
  // 模型
  live2d_model_dir: string
  live2d_model_file: string
  live2d_scale: number
  live2d_offset_y: number
  // 行为
  idle_min_sec: number
  idle_max_sec: number
  autocomment_interval_sec: number
  emotion_decay_per_minute: number
  flip_probability: number
}

export interface ModelInfo {
  dir: string
  model_file: string
  absolute_path: string
  source: 'builtin' | 'user' | string
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<ConfigDto | null>(null)
  const models = ref<ModelInfo[]>([])
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<string | null>(null)
  const version = ref<string>('')

  async function load(): Promise<void> {
    try {
      config.value = await invoke<ConfigDto>('config_load')
      version.value = await invoke<string>('system_version')
    } catch (e) {
      console.warn('[config] load failed', e)
    }
  }

  async function save(dto: ConfigDto): Promise<void> {
    saving.value = true
    try {
      config.value = await invoke<ConfigDto>('config_save', { dto })
    } finally {
      saving.value = false
    }
  }

  async function testLlm(dto: ConfigDto): Promise<void> {
    testing.value = true
    testResult.value = null
    try {
      const msg = await invoke<string>('config_test_llm', { dto })
      testResult.value = `✓ ${msg}`
    } catch (e) {
      testResult.value = `✗ ${describe(e)}`
    } finally {
      testing.value = false
    }
  }

  async function scanModels(): Promise<void> {
    try {
      models.value = await invoke<ModelInfo[]>('models_scan')
    } catch (e) {
      console.warn('[config] models_scan failed', e)
    }
  }

  async function clearHistory(): Promise<number> {
    return await invoke<number>('system_clear_history')
  }

  async function revealDataDir(): Promise<string> {
    return await invoke<string>('system_reveal_data_dir')
  }

  async function revealModelsDir(): Promise<string> {
    return await invoke<string>('system_reveal_models_dir')
  }

  // 监听后端配置变更（菜单外部修改时同步）
  listen<ConfigDto>('config::changed', (e) => {
    config.value = e.payload
  })

  return {
    config,
    models,
    saving,
    testing,
    testResult,
    version,
    load,
    save,
    testLlm,
    scanModels,
    clearHistory,
    revealDataDir,
    revealModelsDir,
  }
})

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return JSON.stringify(e)
}
