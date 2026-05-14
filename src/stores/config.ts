import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface ConfigDto {
  llm_endpoint: string
  llm_model: string
  llm_api_key: string
  tts_provider: string
  tts_sidecar_url: string
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<ConfigDto | null>(null)
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<string | null>(null)

  async function load(): Promise<void> {
    try {
      config.value = await invoke<ConfigDto>('config_load')
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

  return { config, saving, testing, testResult, load, save, testLlm }
})

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return JSON.stringify(e)
}
