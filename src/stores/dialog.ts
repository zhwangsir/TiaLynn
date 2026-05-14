import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ChatMessage, EmotionId } from '@/types/soul'
import { useEmotionStore } from './emotion'

interface ChatTokenPayload {
  stream_id: string
  delta: string
}

interface ChatEndPayload {
  stream_id: string
  full_text: string
  emotion?: EmotionId
}

export const useDialogStore = defineStore('dialog', () => {
  const history = ref<ChatMessage[]>([])
  const currentText = ref('')
  const streaming = ref(false)
  const activeStreamId = ref<string | null>(null)

  // 流式回调注册（单次注册即可）
  let listenersBound = false

  async function bindListeners() {
    if (listenersBound) return
    listenersBound = true

    await listen<ChatTokenPayload>('chat::token', (e) => {
      if (e.payload.stream_id !== activeStreamId.value) return
      currentText.value += e.payload.delta
    })

    await listen<ChatEndPayload>('chat::end', (e) => {
      if (e.payload.stream_id !== activeStreamId.value) return
      const emotion = useEmotionStore()
      if (e.payload.emotion) emotion.set(e.payload.emotion)
      history.value.push({
        role: 'assistant',
        content: e.payload.full_text,
        emotion: e.payload.emotion,
        ts: Date.now(),
      })
      streaming.value = false
      activeStreamId.value = null
      // 5 秒后自动隐藏气泡（除非新对话进来）
      setTimeout(() => {
        if (!streaming.value) currentText.value = ''
      }, 5000)
    })
  }

  async function send(message: string) {
    if (streaming.value) return
    await bindListeners()

    const emotion = useEmotionStore()
    emotion.infer(message)

    history.value.push({ role: 'user', content: message, ts: Date.now() })
    currentText.value = ''
    streaming.value = true

    try {
      const id = await invoke<string>('chat_send', { message })
      activeStreamId.value = id
    } catch (e) {
      console.error('[dialog] send failed', e)
      currentText.value = `(出错了：${e})`
      streaming.value = false
    }
  }

  async function loadHistory() {
    try {
      const recent = await invoke<ChatMessage[]>('memory_recent', { limit: 20 })
      history.value = recent
    } catch (e) {
      console.warn('[dialog] load history failed', e)
    }
  }

  return { history, currentText, streaming, send, loadHistory }
})
