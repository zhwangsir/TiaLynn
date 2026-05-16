import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatMessage, EmotionId } from '@/brain/types/soul'
import { useEmotionStore } from './emotion'
import { speakWithLipSync } from '@/presence/speech/speaker'

interface ChatTokenPayload {
  stream_id: string
  delta: string
}

interface ChatEndPayload {
  stream_id: string
  full_text: string
  emotion?: EmotionId
  intensity?: number
}

/**
 * 从 LLM 输出（可能是 JSON 协议）中尽力提取 `text` 字段，用于流式显示。
 * 容错：未到达 JSON 结构时，返回 raw 本身（先让用户看见字）。
 */
function extractStreamingText(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) {
    return raw // 不是 JSON 协议，直接显示
  }
  // 找 "text":"..."
  const m = raw.match(/"text"\s*:\s*"((?:\\"|[^"])*)/)
  if (!m) return ''
  // 把转义还原
  return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

export const useDialogStore = defineStore('dialog', () => {
  const history = ref<ChatMessage[]>([])
  const currentText = ref('')
  const rawBuffer = ref('')
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
      rawBuffer.value += e.payload.delta
      currentText.value = extractStreamingText(rawBuffer.value) || rawBuffer.value
    })
  }

  function listenEnds(): Promise<UnlistenFn> {
    return listen<ChatEndPayload>('chat::end', (e) => {
      if (e.payload.stream_id !== activeStreamId.value) return
      const emotion = useEmotionStore()
      const emoId: EmotionId = e.payload.emotion ?? emotion.current
      if (e.payload.emotion) {
        emotion.set(e.payload.emotion, e.payload.intensity ?? 0.8)
      }

      // 用后端解析过的 full_text 覆盖（去掉 JSON 包装）
      currentText.value = e.payload.full_text

      history.value.push({
        role: 'assistant',
        content: e.payload.full_text,
        emotion: e.payload.emotion,
        ts: Date.now(),
      })
      streaming.value = false
      activeStreamId.value = null
      rawBuffer.value = ''

      if (e.payload.full_text && !e.payload.full_text.startsWith('(出错了')) {
        void speakWithLipSync(e.payload.full_text, emoId)
      }

      setTimeout(() => {
        if (!streaming.value) currentText.value = ''
      }, 5000)
    })
  }

  async function sendProactive(hint: string): Promise<void> {
    if (streaming.value) return
    await bindReady
    currentText.value = ''
    rawBuffer.value = ''
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

    history.value.push({ role: 'user', content: message, ts: Date.now() })
    currentText.value = ''
    rawBuffer.value = ''
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
