import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatMessage, EmotionId } from '@/types/soul'
import { useEmotionStore } from './emotion'
import { speakWithLipSync } from '@/audio/speaker'

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

  // store 创建时立即并行 listen，避免 token 事件到来时还没绑定。
  const bindReady: Promise<void> = bindListeners()

  function bindListeners(): Promise<void> {
    return Promise.all([listenTokens(), listenEnds()]).then(() => undefined)
  }

  function listenTokens(): Promise<UnlistenFn> {
    return listen<ChatTokenPayload>('chat::token', (e) => {
      if (e.payload.stream_id !== activeStreamId.value) return
      currentText.value += e.payload.delta
    })
  }

  function listenEnds(): Promise<UnlistenFn> {
    return listen<ChatEndPayload>('chat::end', (e) => {
      if (e.payload.stream_id !== activeStreamId.value) return
      const emotion = useEmotionStore()
      const emoId: EmotionId = e.payload.emotion ?? emotion.current
      if (e.payload.emotion) emotion.set(e.payload.emotion)

      history.value.push({
        role: 'assistant',
        content: e.payload.full_text,
        emotion: e.payload.emotion,
        ts: Date.now(),
      })
      streaming.value = false
      activeStreamId.value = null

      // TTS + 嘴型同步（错误占位不发声）
      if (e.payload.full_text && !e.payload.full_text.startsWith('(出错了')) {
        void speakWithLipSync(e.payload.full_text, emoId)
      }

      // 5 秒后自动收起气泡（除非新对话进来）
      setTimeout(() => {
        if (!streaming.value) currentText.value = ''
      }, 5000)
    })
  }

  async function sendProactive(hint: string): Promise<void> {
    if (streaming.value) return
    await bindReady
    currentText.value = ''
    streaming.value = true
    try {
      const id = await invoke<string>('chat_send_proactive', { hint })
      activeStreamId.value = id
    } catch (e) {
      console.warn('[dialog] proactive send failed', e)
      streaming.value = false
    }
  }

  async function send(message: string): Promise<void> {
    if (streaming.value) return
    await bindReady

    const emotion = useEmotionStore()
    emotion.infer(message)

    history.value.push({ role: 'user', content: message, ts: Date.now() })
    currentText.value = ''
    streaming.value = true

    try {
      const id = await invoke<string>('chat_send', { message })
      activeStreamId.value = id
    } catch (e) {
      console.warn('[dialog] send failed', e)
      currentText.value = `(出错了：${describe(e)})`
      streaming.value = false
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const recent = await invoke<ChatMessage[]>('memory_recent', { limit: 20 })
      history.value = recent
    } catch (e) {
      console.warn('[dialog] load history failed', e)
    }
  }

  return { history, currentText, streaming, send, sendProactive, loadHistory }
})

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return JSON.stringify(e)
}
