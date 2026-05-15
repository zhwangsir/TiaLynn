import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useDialogStore } from './dialog'

export type SttStatus = 'Idle' | 'Recording' | 'Transcribing'

export const useSttStore = defineStore('stt', () => {
  const status = ref<SttStatus>('Idle')
  const lastError = ref<string | null>(null)
  const lastText = ref<string | null>(null)

  listen<void>('stt::started', () => {
    status.value = 'Recording'
    lastError.value = null
  })
  listen<void>('stt::transcribing', () => {
    status.value = 'Transcribing'
  })
  listen<string>('stt::result', (e) => {
    lastText.value = e.payload
    status.value = 'Idle'
    if (e.payload && e.payload.trim()) {
      const dialog = useDialogStore()
      dialog.send(e.payload).catch((err) => {
        console.warn('[stt] dispatch send failed:', err)
      })
    }
  })
  listen<string>('stt::error', (e) => {
    lastError.value = e.payload
    status.value = 'Idle'
  })

  return { status, lastError, lastText }
})
