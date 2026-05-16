import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * 与 Rust 端 ConfigDto 严格对齐（v0.4 起 live2d_* 与 motion_* 已迁到 soul yaml）。
 */
export interface ConfigDto {
  llm_provider: string // "anthropic" | "ollama" | "openai_compat"
  llm_endpoint: string
  llm_model: string
  llm_api_key: string
  tts_provider: string
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

export interface ModelInfo {
  dir: string
  model_file: string
  absolute_path: string
  source: 'builtin' | 'user' | string
  cubism: 'cubism2' | 'cubism4' | string
  display: string
  root_id: string
}

export interface VoiceEntry {
  id: string
  kind: 'edge' | 'sample' | 'openai' | string
  edge_voice?: string
  sample_path?: string
  note?: string
}

export type SidecarStatus =
  | 'Inactive'
  | 'Probing'
  | 'External'
  | 'Spawned'
  | 'Failed'

export interface SidecarState {
  status: SidecarStatus
  url: string
  last_error: string | null
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<ConfigDto | null>(null)
  const models = ref<ModelInfo[]>([])
  const voices = ref<VoiceEntry[]>([])
  const sidecar = ref<SidecarState | null>(null)
  const searchPaths = ref<string[]>([])
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

  async function listSearchPaths(): Promise<string[]> {
    try {
      const list = await invoke<string[]>('models_list_search_paths')
      searchPaths.value = list
      return list
    } catch {
      return []
    }
  }

  async function addSearchPath(path: string): Promise<string[]> {
    try {
      const list = await invoke<string[]>('models_add_search_path', { path })
      searchPaths.value = list
      return list
    } catch (e) {
      console.warn('[config] add_search_path failed', e)
      return searchPaths.value
    }
  }

  async function removeSearchPath(path: string): Promise<string[]> {
    try {
      const list = await invoke<string[]>('models_remove_search_path', { path })
      searchPaths.value = list
      return list
    } catch (e) {
      console.warn('[config] remove_search_path failed', e)
      return searchPaths.value
    }
  }

  async function loadSidecarStatus(): Promise<void> {
    try {
      sidecar.value = await invoke<SidecarState>('sidecar_status')
    } catch (e) {
      console.warn('[config] sidecar_status failed', e)
    }
  }

  async function startSidecar(): Promise<void> {
    try {
      sidecar.value = await invoke<SidecarState>('sidecar_start')
    } catch (e) {
      console.warn('[config] sidecar_start failed', e)
    }
  }

  async function stopSidecar(): Promise<void> {
    try {
      sidecar.value = await invoke<SidecarState>('sidecar_stop')
    } catch (e) {
      console.warn('[config] sidecar_stop failed', e)
    }
  }

  async function loadVoices(): Promise<void> {
    try {
      voices.value = await invoke<VoiceEntry[]>('tts_list_voices')
    } catch (e) {
      voices.value = []
      console.warn('[config] tts_list_voices failed', e)
    }
  }

  async function registerExampleVoices(): Promise<void> {
    try {
      const dir = await invoke<string>('tts_example_voice_dir')
      await invoke('tts_register_voices_dir', { dir })
      await loadVoices()
    } catch (e) {
      console.warn('[config] register example voices failed', e)
    }
  }

  async function distill(): Promise<number> {
    try {
      return await invoke<number>('memory_distill', { lookBack: 30 })
    } catch (e) {
      console.warn('[config] memory_distill failed', e)
      return 0
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

  listen<ConfigDto>('config::changed', (e) => {
    config.value = e.payload
  })

  return {
    config,
    models,
    voices,
    sidecar,
    searchPaths,
    saving,
    testing,
    testResult,
    version,
    load,
    save,
    testLlm,
    scanModels,
    listSearchPaths,
    addSearchPath,
    removeSearchPath,
    loadSidecarStatus,
    startSidecar,
    stopSidecar,
    loadVoices,
    registerExampleVoices,
    distill,
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
