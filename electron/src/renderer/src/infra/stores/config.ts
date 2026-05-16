/**
 * Pinia store —— runtime config + 模型列表 + soul 加载。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelInfo, RuntimeConfig, SoulConfig } from '@shared/types'
import { bus } from '../eventbus'

export interface ModelInfoExt extends ModelInfo {
  file_url: string
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<RuntimeConfig | null>(null)
  const soul = ref<SoulConfig | null>(null)
  const systemPrompt = ref<string>('')
  const models = ref<ModelInfoExt[]>([])
  const version = ref<string>('')
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<{ ok: boolean; message: string } | null>(null)

  async function bootstrap(): Promise<void> {
    try {
      const [cfg, ver, soulRes, prompt, ms] = await Promise.all([
        window.api.config.load(),
        window.api.system.version(),
        window.api.soul.load(),
        window.api.soul.systemPrompt(),
        window.api.models.scan(),
      ])
      config.value = cfg
      version.value = ver
      soul.value = soulRes.config
      systemPrompt.value = prompt
      models.value = ms
      bus.emit('infra:soul-reloaded')
    } catch (e) {
      console.error('[config] bootstrap failed', e)
    }
    window.api.config.onChanged((cfg) => {
      config.value = cfg
      bus.emit('infra:config-changed')
    })
  }

  async function save(dto: RuntimeConfig): Promise<void> {
    saving.value = true
    try {
      config.value = await window.api.config.save(dto)
    } finally {
      saving.value = false
    }
  }

  async function rescanModels(): Promise<void> {
    models.value = await window.api.models.scan()
  }

  async function reloadSoul(): Promise<void> {
    const res = await window.api.soul.load()
    soul.value = res.config
    systemPrompt.value = await window.api.soul.systemPrompt()
    bus.emit('infra:soul-reloaded')
  }

  async function testLlm(dto: RuntimeConfig): Promise<void> {
    testing.value = true
    testResult.value = null
    try {
      testResult.value = await window.api.llm.test({
        provider: dto.llm_provider,
        endpoint: dto.llm_endpoint,
        api_key: dto.llm_api_key,
        model: dto.llm_model,
      })
    } finally {
      testing.value = false
    }
  }

  return {
    config,
    soul,
    systemPrompt,
    models,
    version,
    saving,
    testing,
    testResult,
    bootstrap,
    save,
    rescanModels,
    reloadSoul,
    testLlm,
  }
})
