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
import type {
  ApprovalDecision,
  ApprovalRequest,
  ToolDefinition,
  ToolInvocation,
  ToolPolicy,
  ToolResult,
} from './tools'
import type { ModelMotionSummary, MotionDraft } from './motion'
import type { SemanticsMap } from './motion-semantics'

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
    saveAvatar(avatar: Partial<SoulConfig['avatar']>): Promise<{ ok: boolean; path: string; reason?: string }>
    onChanged(cb: () => void): () => void
  }
  llm: {
    chatStream(payload: {
      streamId: string
      messages: ChatMessage[]
      options?: Partial<ChatOptions>
      provider_override?: { provider?: LlmProvider; endpoint?: string; api_key?: string; model?: string }
      tools?: ToolDefinition[]
      tool_results?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
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
  motion: {
    summarize(modelDir: string): Promise<ModelMotionSummary>
    /** 推断参数语义（cdi3 / 命名规则 / 协同分析） */
    introspect(modelDir: string): Promise<SemanticsMap>
    /** Markdown 格式的人类可读 introspection 报告 */
    introspectDebug(modelDir: string): Promise<string>
    generate(payload: {
      model_dir: string
      description: string
      style?: string
      examples?: number
    }): Promise<{ ok: boolean; draft?: MotionDraft; reason?: string }>
    write(payload: {
      model_json_path: string
      draft: MotionDraft
      group?: string
    }): Promise<{ ok: boolean; motion_path?: string; reason?: string }>
    onWritten(
      cb: (e: { model_json_path: string; motion_relative?: string }) => void,
    ): () => void
  }
  market: {
    installZip(zipPath: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installUrl(url: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installPath(path: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installPaths(paths: string[]): Promise<
      Array<{
        ok: boolean
        installed_to?: string
        detected_name?: string
        model_file?: string
        reason?: string
      }>
    >
    onInstalled(
      cb: (
        results: Array<{
          ok: boolean
          installed_to?: string
          detected_name?: string
          model_file?: string
        }>,
      ) => void,
    ): () => void
  }
  tools: {
    list(): Promise<ToolDefinition[]>
    run(call: ToolInvocation): Promise<ToolResult>
    policyGet(): Promise<ToolPolicy>
    policySet(payload: {
      tool_name: string
      decision: 'always_allow' | 'always_deny' | null
    }): Promise<ToolPolicy>
    policyClear(): Promise<ToolPolicy>
    onApprovalRequest(cb: (req: ApprovalRequest) => void): () => void
    sendApprovalDecision(payload: { invocation_id: string; decision: ApprovalDecision }): void
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
  history: {
    listRecent(limit?: number): Promise<
      Array<{
        id: string
        role: 'user' | 'assistant' | 'system'
        text: string
        emotion: string | null
        intensity: number | null
        ts: number
        error: string | null
        session_id: string
      }>
    >
    append(turn: {
      id: string
      role: 'user' | 'assistant' | 'system'
      text: string
      emotion: string | null
      intensity: number | null
      ts: number
      error: string | null
    }): Promise<{ ok: boolean }>
    clear(): Promise<{ deleted: number }>
  }
}
