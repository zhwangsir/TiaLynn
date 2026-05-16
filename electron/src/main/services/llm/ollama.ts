/**
 * Ollama 本地 LLM provider —— /api/chat streaming（NDJSON）。
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ChatExtraOptions, ChatStreamCallback, LlmProviderImpl } from './types'

export class OllamaProvider implements LlmProviderImpl {
  readonly name = 'ollama' as const

  constructor(private endpoint: string) {
    if (!this.endpoint) this.endpoint = 'http://localhost:11434'
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
    _extra?: ChatExtraOptions,
  ): Promise<void> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/api/chat`
    const body = {
      model: options.model,
      stream: true,
      options: { temperature: options.temperature, num_predict: options.max_tokens ?? 1024 },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      })
    } catch (e) {
      onEvent({ error: String(e) })
      onEvent({ done: true })
      return
    }

    if (!resp.ok || !resp.body) {
      const text = resp.body ? await resp.text().catch(() => '') : ''
      onEvent({ error: `Ollama ${resp.status}: ${text || resp.statusText}` })
      onEvent({ done: true })
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) {
          try {
            const ev = JSON.parse(line) as {
              message?: { content?: string }
              done?: boolean
            }
            const delta = ev.message?.content
            if (delta) onEvent({ delta })
            if (ev.done) {
              onEvent({ done: true })
              return
            }
          } catch {
            /* skip */
          }
        }
        nl = buf.indexOf('\n')
      }
    }
    onEvent({ done: true })
  }
}
