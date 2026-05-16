/**
 * 渲染进程通过 window.api.* 调用主进程能力的接口契约。
 * preload 与 renderer 共享此类型。
 */
import type {
  ChatMessage,
  ChatOptions,
  IpcStreamChunk,
  LlmProvider,
  ModelInfo,
  RuntimeConfig,
  SoulConfig,
} from './types'

export interface SystemPaths {
  projectRoot: string
  userDataDir: string
  soulDir: string
  modelSearchPaths: string[]
  historyDbPath: string
}

export type ModelInfoExt = ModelInfo & { file_url: string }

export interface TialynnApi {
  system: {
    version(): Promise<string>
    paths(): Promise<SystemPaths>
    revealDataDir(): Promise<string>
    revealModelsDir(): Promise<string>
  }
  window: {
    startDrag(): Promise<{ ok: boolean; reason?: string }>
    softDrag(x: number, y: number): void
    setIgnoreMouse(ignore: boolean, forward?: boolean): Promise<{ ok: boolean }>
    getBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>
    setBounds(b: Partial<{ x: number; y: number; width: number; height: number }>): Promise<{ ok: boolean }>
    close(): Promise<void>
    minimize(): Promise<void>
    togglePin(pin: boolean): Promise<void>
  }
  cursor: {
    pollStart(): Promise<void>
    pollStop(): Promise<void>
    onTick(cb: (pt: { x: number; y: number; inside: boolean }) => void): () => void
  }
  config: {
    load(): Promise<RuntimeConfig>
    save(dto: RuntimeConfig): Promise<RuntimeConfig>
    onChanged(cb: (cfg: RuntimeConfig) => void): () => void
  }
  models: {
    scan(): Promise<ModelInfoExt[]>
  }
  soul: {
    load(): Promise<{ config: SoulConfig; sources: string[] }>
    systemPrompt(): Promise<string>
    pickDirectory(): Promise<string | null>
  }
  llm: {
    chatStream(payload: {
      streamId: string
      messages: ChatMessage[]
      options?: Partial<ChatOptions>
      provider_override?: { provider?: LlmProvider; endpoint?: string; api_key?: string; model?: string }
    }): Promise<{ ok: boolean; reason?: string }>
    abort(streamId: string): Promise<{ ok: boolean }>
    test(payload: {
      provider: LlmProvider
      endpoint: string
      api_key: string
      model: string
    }): Promise<{ ok: boolean; message: string }>
    onChunk(cb: (chunk: IpcStreamChunk) => void): () => void
  }
  tts: {
    speak(payload: { text: string; voice?: string; emotion?: string }): Promise<{
      ok: boolean
      audio_b64?: string
      mime?: string
      reason?: string
    }>
    probe(): Promise<{ ok: boolean; status?: number; reason?: string }>
  }
}
