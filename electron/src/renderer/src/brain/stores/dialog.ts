/**
 * 对话 store —— 历史 + 流式控制 + 事件分发。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, EmotionId, IpcStreamChunk } from '@shared/types'
import { useConfigStore } from '../../infra/stores/config'
import { bus } from '../../infra/eventbus'
import { parsePartialText, parseReply } from '../parser'
import type { DialogTurn } from '../types'

const MAX_HISTORY = 40

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useDialogStore = defineStore('dialog', () => {
  const turns = ref<DialogTurn[]>([])
  const replying = ref(false)
  const currentStreamId = ref<string | null>(null)
  const partialBuffer = ref<string>('')

  let unsubChunk: (() => void) | null = null

  async function bootstrap(): Promise<void> {
    if (unsubChunk) return
    unsubChunk = window.api.llm.onChunk((chunk) => handleChunk(chunk))
    // 恢复最近 50 条
    try {
      const rows = await window.api.history.listRecent(50)
      if (rows.length > 0) {
        turns.value = rows.map((r) => ({
          id: r.id,
          role: r.role,
          text: r.text,
          emotion: (r.emotion ?? undefined) as EmotionId | undefined,
          intensity: r.intensity ?? undefined,
          ts: r.ts,
          error: r.error ?? undefined,
        }))
      }
    } catch (e) {
      console.warn('[dialog] history restore failed:', e)
    }
  }

  async function persist(t: DialogTurn): Promise<void> {
    try {
      await window.api.history.append({
        id: t.id,
        role: t.role,
        text: t.text,
        emotion: t.emotion ?? null,
        intensity: t.intensity ?? null,
        ts: t.ts,
        error: t.error ?? null,
      })
    } catch (e) {
      console.warn('[dialog] persist failed:', e)
    }
  }

  function teardown(): void {
    unsubChunk?.()
    unsubChunk = null
  }

  function buildMessages(userText: string): ChatMessage[] {
    const cfg = useConfigStore()
    const system = cfg.systemPrompt
    const history: ChatMessage[] = turns.value
      .filter((t) => !t.error && t.role !== 'system')
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.role, content: t.text }))
    return [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: userText },
    ]
  }

  async function send(text: string): Promise<void> {
    if (!text.trim() || replying.value) return
    const cfg = useConfigStore()
    if (!cfg.config) {
      bus.emit('ui:toast', { kind: 'error', message: '配置未加载，无法发送' })
      return
    }

    const userTurn: DialogTurn = {
      id: uid(),
      role: 'user',
      text: text.trim(),
      ts: Date.now(),
    }
    const assistantTurn: DialogTurn = {
      id: uid(),
      role: 'assistant',
      text: '',
      ts: Date.now(),
      streaming: true,
    }
    turns.value.push(userTurn, assistantTurn)
    void persist(userTurn)
    bus.emit('brain:chat-input', { text: userTurn.text })

    const streamId = uid()
    currentStreamId.value = streamId
    partialBuffer.value = ''
    replying.value = true

    const result = await window.api.llm.chatStream({
      streamId,
      messages: buildMessages(userTurn.text),
      options: { model: cfg.config.llm_model, temperature: 0.8 },
    })

    if (!result.ok) {
      const t = turns.value.find((x) => x.id === assistantTurn.id)
      const reason = result.reason ?? 'failed'
      if (t) {
        t.streaming = false
        t.error = reason
        t.text = `（出错：${reason}）`
      }
      currentStreamId.value = null
      replying.value = false
      bus.emit('ui:toast', { kind: 'error', message: `对话失败：${reason}`, ttl_ms: 8000 })
    }
  }

  function abort(): void {
    if (!currentStreamId.value) return
    window.api.llm.abort(currentStreamId.value)
  }

  function handleChunk(chunk: IpcStreamChunk): void {
    if (chunk.streamId !== currentStreamId.value) return
    const assistant = turns.value[turns.value.length - 1]
    if (!assistant || assistant.role !== 'assistant') return

    if (chunk.delta) {
      partialBuffer.value += chunk.delta
      const partial = parsePartialText(partialBuffer.value)
      if (partial) assistant.text = partial
      else assistant.text = partialBuffer.value // 协议没遵守时也展示
      bus.emit('brain:reply-token', { stream_id: chunk.streamId, delta: chunk.delta })
    }
    if (chunk.error) {
      assistant.error = chunk.error
      assistant.streaming = false
      bus.emit('brain:reply-error', { stream_id: chunk.streamId, error: chunk.error })
      bus.emit('ui:toast', { kind: 'error', message: chunk.error, ttl_ms: 8000 })
    }
    if (chunk.done) {
      const parsed = parseReply(chunk.full_text ?? partialBuffer.value)
      assistant.text = parsed.text
      assistant.emotion = parsed.emotion
      assistant.intensity = parsed.intensity
      assistant.streaming = false
      void persist(assistant)
      bus.emit('brain:reply-end', {
        stream_id: chunk.streamId,
        full_text: parsed.text,
        emotion: parsed.emotion,
        intensity: parsed.intensity,
      })
      bus.emit('brain:emotion-changed', { emotion: parsed.emotion, intensity: parsed.intensity })
      replying.value = false
      currentStreamId.value = null
    }
  }

  async function clear(): Promise<void> {
    turns.value = []
    try {
      await window.api.history.clear()
    } catch (e) {
      console.warn('[dialog] clear failed:', e)
    }
  }

  /** 只在没有任何历史时注入开场白，避免重复 */
  function injectGreeting(): void {
    if (turns.value.length > 0) return
    const greet: DialogTurn = {
      id: uid(),
      role: 'assistant',
      text: '主人——我在这儿，今天先陪我说说话好不好？',
      emotion: 'shy' as EmotionId,
      intensity: 0.6,
      ts: Date.now(),
    }
    turns.value.push(greet)
    void persist(greet)
  }

  return {
    turns,
    replying,
    bootstrap,
    teardown,
    send,
    abort,
    clear,
    injectGreeting,
  }
})
