import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SoulConfig } from '@/brain/types/soul'

export const useSoulStore = defineStore('soul', () => {
  const config = ref<SoulConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      config.value = await invoke<SoulConfig>('soul_load')
    } catch (e) {
      error.value = String(e)
      console.error('[soul] load failed', e)
    } finally {
      loading.value = false
    }
  }

  // 灵魂热重载：监听 Rust 端文件变更事件
  listen<SoulConfig>('soul::changed', (event) => {
    config.value = event.payload
    console.info('[soul] hot reloaded')
  })

  return { config, loading, error, load }
})
