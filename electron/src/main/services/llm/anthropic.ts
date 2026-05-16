/**
 * Anthropic Claude Messages API streaming（端口自 src-tauri/src/brain/providers/anthropic.rs）。
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ChatStreamCallback, LlmProviderImpl } from './types'

export class AnthropicProvider implements LlmProviderImpl {
  readonly name = 'anthropic' as const

  constructor(
    private endpoint: string,
    private apiKey: string,
    private anthropicVersion = '2023-06-01',
  ) {
    if (!this.endpoint || this.endpoint.length === 0) {
      this.endpoint = 'https://api.anthropic.com'
    }
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (!this.apiKey) {
      onEvent({ error: 'Anthropic API key 未配置' })
      onEvent({ done: true })
      return
    }

    let system = ''
    const msgs: { role: 'user' | 'assistant'; content: string }[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        system += (system ? '\n\n' : '') + m.content
      } else if (m.role === 'user' || m.role === 'assistant') {
        msgs.push({ role: m.role, content: m.content })
      }
    }

    const url = `${this.endpoint.replace(/\/+$/, '')}/v1/messages`
    const body = {
      model: options.model,
      max_tokens: options.max_tokens ?? 1024,
      temperature: options.temperature,
      stream: true,
      messages: msgs,
      ...(system ? { system } : {}),
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
        },
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
      onEvent({ error: `Anthropic ${resp.status}: ${text || resp.statusText}` })
      onEvent({ done: true })
      return
    }

    let serverError: string | null = null
    await consumeSse(resp.body, (data) => {
      // event: content_block_delta\ndata: {"type":"content_block_delta","delta":{...}}
      // event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"..."}}
      try {
        const ev = JSON.parse(data) as {
          type?: string
          delta?: { type?: string; text?: string }
          error?: { type?: string; message?: string }
        }
        if (
          ev?.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          ev.delta.text
        ) {
          onEvent({ delta: ev.delta.text })
        } else if (ev?.type === 'error' && ev.error) {
          serverError =
            ev.error.message ?? ev.error.type ?? 'Anthropic 返回了未明确说明的错误'
          onEvent({ error: `Anthropic: ${serverError}` })
        }
      } catch {
        /* skip malformed */
      }
    })
    onEvent({ done: true })
  }
}

/** 解析 SSE：行式读取，按空行分块，把每个 data: 行的载荷交给 onData */
export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data && data !== '[DONE]') onData(data)
        }
      }
      idx = buf.indexOf('\n\n')
    }
  }
}
