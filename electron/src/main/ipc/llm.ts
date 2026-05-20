/**
 * LLM IPC handler —— 流式对话。
 *
 * 渲染层调用 `window.api.llm.chatStream({ stream_id, messages, options })`，
 * 主进程通过 webContents.send('llm:chunk', { streamId, delta | done | error }) 回推。
 */
import { ipcMain, type BrowserWindow } from 'electron'
import type { ChatMessage, ChatOptions, IpcStreamChunk, LlmProvider } from '@shared/types'
import type { ToolDefinition } from '@shared/tools'
import { buildProvider } from '../services/llm'
import { loadConfig } from '../services/config-store'
import { runHealthCheck, type FullHealthReport } from '../services/llm/health-check'

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
        tools?: ToolDefinition[]
        tool_results?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
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
      // v0.17 D-3：从长期记忆做 RAG 检索，把相关记忆 prepend 到 messages
      // fallback embedding + cosine similarity，不依赖外部 embedding 服务
      try {
        const { buildRagContext } = await import('../services/memory-extractor')
        const lastUser = [...payload.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        if (lastUser) {
          const rag = buildRagContext(lastUser, 5)
          if (rag) {
            payload.messages = [{ role: 'system', content: rag }, ...payload.messages]
            console.log(`[llm] RAG injected: ${rag.split('\n').length - 1} memories`)
          }
        }
      } catch (e) {
        console.warn('[llm] RAG inject failed (non-fatal):', e)
      }
      console.log(
        `[llm] chat-stream start streamId=${payload.streamId} provider=${provider} endpoint=${endpoint} model=${model} msgs=${payload.messages.length} hasTools=${!!payload.tools?.length}`,
      )
      const t0 = Date.now()

      let fullText = ''
      let firstChunkAt = 0
      let chunkCount = 0
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
            ...(payload.options?.max_tokens !== undefined && { max_tokens: payload.options.max_tokens }),
          },
          (evt) => {
            if (evt.delta) {
              fullText += evt.delta
              chunkCount++
              if (!firstChunkAt) {
                firstChunkAt = Date.now() - t0
                console.log(`[llm] first delta @ ${firstChunkAt}ms streamId=${payload.streamId}`)
              }
              send({ streamId: payload.streamId, delta: evt.delta })
            }
            if (evt.tool_use) {
              send({ streamId: payload.streamId, tool_use: evt.tool_use })
            }
            if (evt.needs_tools) {
              send({ streamId: payload.streamId, needs_tools: true })
            }
            if (evt.error) {
              console.error(`[llm] error streamId=${payload.streamId}: ${evt.error}`)
              send({ streamId: payload.streamId, error: evt.error })
            }
            if (evt.done) {
              console.log(
                `[llm] done streamId=${payload.streamId} total=${Date.now() - t0}ms chunks=${chunkCount} len=${fullText.length}`,
              )
              send({ streamId: payload.streamId, done: true, full_text: fullText })
            }
          },
          abort.signal,
          {
            ...(payload.tools !== undefined && { tools: payload.tools }),
            ...(payload.tool_results !== undefined && { tool_results: payload.tool_results }),
          },
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

  // v0.8.1: 完整健康自检 (5 项测试)
  ipcMain.handle(
    'llm:health-check',
    async (
      _evt,
      payload?: {
        provider?: LlmProvider
        endpoint?: string
        api_key?: string
        model?: string
        test_vision?: boolean
      },
    ): Promise<FullHealthReport> => {
      const cfg = loadConfig()
      return runHealthCheck(
        {
          llm_provider: payload?.provider ?? cfg.llm_provider,
          llm_endpoint: payload?.endpoint ?? cfg.llm_endpoint,
          llm_model: payload?.model ?? cfg.llm_model,
          llm_api_key: payload?.api_key ?? cfg.llm_api_key,
        },
        { test_vision: payload?.test_vision ?? false },
      )
    },
  )
}
