/**
 * OpenAI-compatible chat completions streaming
 * 覆盖：OpenAI / LM Studio / SiliconFlow / DeepSeek / Ollama (OAI 接口) / 任意自建 OAI 兼容服务
 *
 * v0.7.5 jinja-template 兼容修复：
 *   很多本地模型（特别是社区量化的 Qwen MoE）的 prompt template 对
 *   `system` role 处理不一致，导致 "No user query found in messages" 错误。
 *   修复策略：
 *     1. 默认 `mergeSystemIntoUser=true`（最大兼容性）
 *        把所有 system 内容拼到第一个 user message 前
 *     2. 检测 jinja template 类错误时自动 retry 合并模式
 *     3. 确保至少有 1 个 user message（如果只有 system，转成 user）
 */
import type { ChatMessage, ChatOptions } from '@shared/types'
import type { ChatExtraOptions, ChatStreamCallback, LlmProviderImpl } from './types'
import { consumeSse } from './anthropic'
import { loadConfig } from '../config-store'

/** 哪些错误内容意味着 prompt template 不支持当前 messages 结构 */
const TEMPLATE_ERROR_PATTERNS = [
  /no user query found/i,
  /jinja template/i,
  /prompt template/i,
  /first message must/i,
  /messages must start with/i,
]

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
    _extra?: ChatExtraOptions,
  ): Promise<void> {
    const cfg = loadConfig()
    // 用户可在 settings 关闭（OpenAI 真版本对 system message 支持完美）
    const mergeFromConfig = cfg.openai_compat_merge_system !== false

    // 第一次尝试：根据 config 决定是否合并
    const success = await this.tryStream(
      messages,
      options,
      onEvent,
      abortSignal,
      mergeFromConfig,
    )
    if (success) return

    // 第二次尝试：如果第一次出现 jinja 错误且当时未合并，强制合并 retry
    if (!mergeFromConfig) {
      const retried = await this.tryStream(messages, options, onEvent, abortSignal, true, true)
      if (retried) return
    }

    onEvent({ done: true })
  }

  /**
   * 单次流式调用尝试。
   * @returns true 表示流正常完成（有任何 delta 或 done 事件）；false 表示遇到 template 错误且未发任何 delta
   */
  private async tryStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal: AbortSignal | undefined,
    mergeSystem: boolean,
    isRetry = false,
  ): Promise<boolean> {
    const url = `${this.endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const normalized = normalizeMessages(messages, mergeSystem)

    const body = {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.max_tokens ?? 1024,
      stream: true,
      messages: normalized,
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
      return true
    }

    if (!resp.ok || !resp.body) {
      const text = resp.body ? await resp.text().catch(() => '') : ''
      const errorMsg = `${resp.status} ${text || resp.statusText}`
      // 检测是否是 template 错误且未 retry → 触发 retry
      if (!isRetry && isTemplateError(text)) {
        return false
      }
      onEvent({
        error: `OpenAI-compat ${errorMsg}${
          isRetry ? '（已自动合并 system 重试，仍失败）' : ''
        }`,
      })
      return true
    }

    let sawDelta = false
    let sawTemplateError = false
    await consumeSse(resp.body, (data) => {
      try {
        const ev = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[]
          error?: { message?: string; code?: string }
        }
        // LM Studio 把错误以 SSE event 形式发送
        if (ev.error?.message) {
          if (!isRetry && isTemplateError(ev.error.message)) {
            sawTemplateError = true
          } else {
            onEvent({
              error: `${ev.error.code ? `[${ev.error.code}] ` : ''}${ev.error.message}${
                isRetry ? '（已自动合并 system 重试，仍失败）' : ''
              }`,
            })
          }
          return
        }
        const delta = ev.choices?.[0]?.delta?.content
        if (delta) {
          sawDelta = true
          onEvent({ delta })
        }
      } catch {
        /* skip */
      }
    })

    if (sawTemplateError && !sawDelta) return false
    return true
  }
}

function isTemplateError(text: string): boolean {
  if (!text) return false
  return TEMPLATE_ERROR_PATTERNS.some((p) => p.test(text))
}

/**
 * 把 messages 数组规范化为模型友好格式：
 * 1. 若 mergeSystem=true：所有 system 内容拼到第一个 user message 前
 * 2. 确保至少有 1 个 user message（只有 system 时转成 user）
 * 3. 合并相邻 same-role messages（某些模板 chokes on this）
 */
function normalizeMessages(
  messages: ChatMessage[],
  mergeSystem: boolean,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (messages.length === 0) {
    return [{ role: 'user', content: '' }]
  }

  let work: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = messages.map(
    (m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }),
  )

  if (mergeSystem) {
    const systemParts: string[] = []
    const rest: typeof work = []
    for (const m of work) {
      if (m.role === 'system') systemParts.push(m.content)
      else rest.push(m)
    }
    if (systemParts.length > 0) {
      const systemBlob = systemParts.join('\n\n')
      const firstUserIdx = rest.findIndex((m) => m.role === 'user')
      if (firstUserIdx >= 0) {
        rest[firstUserIdx] = {
          role: 'user',
          content: `${systemBlob}\n\n---\n\n${rest[firstUserIdx].content}`,
        }
      } else {
        // 全是 assistant 或空 — 加一条 user 承载 system
        rest.unshift({ role: 'user', content: systemBlob })
      }
    }
    work = rest
  }

  // 确保至少一个 user
  if (!work.some((m) => m.role === 'user')) {
    work.push({ role: 'user', content: '请按上述要求生成。' })
  }

  // 合并相邻同 role 消息
  const merged: typeof work = []
  for (const m of work) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      merged.push({ ...m })
    }
  }

  return merged
}
