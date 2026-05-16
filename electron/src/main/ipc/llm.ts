/**
 * LLM IPC handler —— 流式对话。
 *
 * 渲染层调用 `window.api.llm.chatStream({ stream_id, messages, options })`，
 * 主进程通过 webContents.send('llm:chunk', { streamId, delta | done | error }) 回推。
 */
import { ipcMain, type BrowserWindow } from 'electron'
import type { ChatMessage, ChatOptions, IpcStreamChunk, LlmProvider } from '@shared/types'
import { buildProvider } from '../services/llm'
import { loadConfig } from '../services/config-store'

const aborts = new Map<string, AbortController>()

export function registerLlmIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'llm:chat-stream',
    async (
      _evt,
      payload: {
        streamId: string
        messages: ChatMessage[]
        options?: Partial<ChatOptions>
        provider_override?: { provider?: LlmProvider; endpoint?: string; api_key?: string; model?: string }
      },
    ) => {
      const cfg = loadConfig()
      const provider = payload.provider_override?.provider ?? cfg.llm_provider
      const endpoint = payload.provider_override?.endpoint ?? cfg.llm_endpoint
      const apiKey = payload.provider_override?.api_key ?? cfg.llm_api_key
      const model = payload.options?.model ?? payload.provider_override?.model ?? cfg.llm_model

      const impl = buildProvider(provider, endpoint, apiKey)
      const abort = new AbortController()
      aborts.set(payload.streamId, abort)

      let fullText = ''
      const send = (msg: IpcStreamChunk): void => {
        const win = getWindow()
        if (!win || win.isDestroyed()) return
        win.webContents.send('llm:chunk', msg)
      }

      try {
        await impl.chatStream(
          payload.messages,
          {
            model,
            temperature: payload.options?.temperature ?? 0.7,
            max_tokens: payload.options?.max_tokens,
          },
          (evt) => {
            if (evt.delta) {
              fullText += evt.delta
              send({ streamId: payload.streamId, delta: evt.delta })
            }
            if (evt.error) {
              send({ streamId: payload.streamId, error: evt.error })
            }
            if (evt.done) {
              send({ streamId: payload.streamId, done: true, full_text: fullText })
            }
          },
          abort.signal,
        )
        return { ok: true }
      } catch (e) {
        send({ streamId: payload.streamId, error: String(e), done: true, full_text: fullText })
        return { ok: false, reason: String(e) }
      } finally {
        aborts.delete(payload.streamId)
      }
    },
  )

  ipcMain.handle('llm:abort', (_evt, streamId: string) => {
    const c = aborts.get(streamId)
    if (c) {
      c.abort()
      aborts.delete(streamId)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle(
    'llm:test',
    async (
      _evt,
      payload: { provider: LlmProvider; endpoint: string; api_key: string; model: string },
    ) => {
      const impl = buildProvider(payload.provider, payload.endpoint, payload.api_key)
      try {
        let captured = ''
        await impl.chatStream(
          [
            { role: 'system', content: '你是 TiaLynn 测试机。回复一句 ok。' },
            { role: 'user', content: 'ping' },
          ],
          { model: payload.model, temperature: 0.2, max_tokens: 32 },
          (evt) => {
            if (evt.delta) captured += evt.delta
          },
        )
        return { ok: true, message: captured.trim() || '(empty response)' }
      } catch (e) {
        return { ok: false, message: String(e) }
      }
    },
  )
}
