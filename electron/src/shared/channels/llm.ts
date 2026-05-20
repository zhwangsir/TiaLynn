/**
 * LLM 域 IPC channels — Phase 1 试点 (Channel-style type-safe IPC)。
 *
 * 单一真相源：Channel 对象 = name + 类型契约。
 * main / preload / renderer 都 import 同一个 channel，改类型 3 端同时报错。
 *
 * 试点范围：仅 llm:chat-stream。验证模式后再迁移其他 171 个 IPC。
 */
import type { ChatMessage, ChatOptions, LlmProvider } from '../types'
import type { ToolDefinition } from '../tools'
import { defineChannel } from '../ipc-channel'

export interface LlmChatStreamRequest {
  streamId: string
  messages: ChatMessage[]
  options?: Partial<ChatOptions>
  provider_override?: {
    provider?: LlmProvider
    endpoint?: string
    api_key?: string
    model?: string
  }
  tools?: ToolDefinition[]
  tool_results?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
}

export interface LlmChatStreamResponse {
  ok: boolean
  reason?: string
}

export const llmChatStream = defineChannel<LlmChatStreamRequest, LlmChatStreamResponse>(
  'llm:chat-stream',
)
