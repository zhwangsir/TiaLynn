/**
 * OpenAI-compatible chat completions streaming（覆盖 OpenAI / SiliconFlow / DeepSeek / 任意自建 OAI 兼容服务）。
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ChatExtraOptions, ChatStreamCallback, LlmProviderImpl } from './types'
import { consumeSse } from './anthropic'

export class OpenAiCompatProvider implements LlmProviderImpl {
  readonly name = 'openai_compat' as const

  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {
    if (!this.endpoint) this.endpoint = 'https://api.openai.com'
  }

  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
    _extra?: ChatExtraOptions, // v0.6.4 暂不支持 tools（Anthropic 优先）
  ): Promise<void> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const body = {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens ?? 1024,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
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
      onEvent({ error: `OpenAI-compat ${resp.status}: ${text || resp.statusText}` })
      onEvent({ done: true })
      return
    }

    await consumeSse(resp.body, (data) => {
      try {
        const ev = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[]
        }
        const delta = ev.choices?.[0]?.delta?.content
        if (delta) onEvent({ delta })
      } catch {
        /* skip */
      }
    })
    onEvent({ done: true })
  }
}
