import type { ChatMessage, ChatOptions } from '@shared/types'

export interface ChatStreamEvent {
  delta?: string
  done?: boolean
  error?: string
}

export type ChatStreamCallback = (evt: ChatStreamEvent) => void

export interface LlmProviderImpl {
  readonly name: 'anthropic' | 'openai_compat' | 'ollama'
  chatStream(
    messages: ChatMessage[],
    options: ChatOptions,
    onEvent: ChatStreamCallback,
    abortSignal?: AbortSignal,
  ): Promise<void>
}
