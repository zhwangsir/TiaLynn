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
import type { ApplyResult, LibrarySummary, MotionTemplate } from './motion-library'
import type { MotionEntry, MotionFilter, MotionVersion, SyncReport } from './motion-engine'
import type { TriggerDecision, TriggerEvent, TriggerRule } from './trigger'
import type { PerceptionConfig, PerceptionEvent, PerceptionEventType } from './perception'
import type { AttentionConfig, AttentionSnapshot, BehaviorPlan } from './attention'

export interface SystemPaths {
  projectRoot: string
  userDataDir: string
  soulDir: string
  modelSearchPaths: string[]
  historyDbPath: string
}

export type ModelInfoExt = ModelInfo & { file_url: string }

/** v0.12: character enrichment 进度 */
export interface EnrichProgress {
  total: number
  done: number
  failed: number
  current?: string
  error?: string
}

/** v0.12: 在线资源 */
export type RepoSource = 'huggingface' | 'github' | 'browse_only'
export interface RecommendedRepo {
  id: string
  name: string
  description: string
  kind: 'rvc' | 'live2d'
  source: RepoSource
  asset_path?: string
  hint?: string
  browse_url?: string
}
export interface OnlineAsset {
  type: 'file' | 'directory'
  path: string
  size: number
}
export interface OnlineInstallProgress {
  install_id: string
  asset_path: string
  stage: 'download' | 'extract' | 'deploy' | 'done' | 'fail'
  percent: number
  message?: string
  bytes_done?: number
  bytes_total?: number
}
export interface OnlineInstallDone {
  install_id: string
  ok: boolean
  voice_id?: string
  reason?: string
}

export interface TialynnApi {
  system: {
    version(): Promise<string>
    paths(): Promise<SystemPaths>
    revealDataDir(): Promise<string>
    revealModelsDir(): Promise<string>
    openExternal(url: string): Promise<{ ok: boolean; reason?: string }>
    diskUsage(force?: boolean): Promise<{
      entries: Array<{
        label: string
        path: string
        bytes: number
        exists: boolean
        hint: string
        cleanable: boolean
      }>
      total_bytes: number
      computed_at_ms: number
    }>
    cleanPath(path: string): Promise<{ ok: boolean; freed_bytes: number; reason?: string }>
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
    heal(payload: { model_json_path: string }): Promise<{
      ok: boolean
      reason?: string
      added: {
        motions: string[]
        expressions: string[]
        bound_orphans: { motions: string[]; expressions: string[] }
      }
    }>
    findDuplicates(): Promise<{
      total_models: number
      groups: Array<{
        group_key: string
        confidence: 'exact' | 'same_moc' | 'similar_dir'
        keep: ModelInfoExt
        others: ModelInfoExt[]
      }>
      exact_duplicates: number
      exact_disk_kb: number
    }>
    applyDedup(payload?: { group_keys?: string[]; dry_run?: boolean }): Promise<{
      ok: boolean
      deleted: string[]
      failed: Array<{ path: string; reason: string }>
      freed_kb: number
    }>
    mergeGroups(payload?: { group_keys?: string[] }): Promise<{
      ok: boolean
      merged_groups: number
      added_motions: number
      added_expressions: number
      archived_model_jsons: string[]
      skipped: Array<{ group_key: string; reason: string }>
    }>
    describe(payload: {
      model_dir: string
      model_json_path: string
      display: string
      ip: string
      motion_count: number
      expression_count: number
    }): Promise<{ ok: boolean; text?: string; reason?: string; from_cache?: boolean }>
    cachedDescriptions(): Promise<Record<string, string>>
    getPreference(
      characterId: string,
    ): Promise<{ scale: number; offset_y: number; last_used_at: number } | null>
    setPreference(payload: {
      character_id: string
      scale: number
      offset_y: number
    }): Promise<{ ok: boolean }>
    // v0.12
    favorites(): Promise<{
      favorites: string[]
      recent: Array<{ dir: string; used_at: number }>
    }>
    toggleFavorite(dir: string): Promise<{ is_favorite: boolean }>
    markRecent(dir: string): Promise<{ ok: boolean }>
    clearRecent(): Promise<{ ok: boolean }>
    enrichCached(): Promise<
      Record<string, {
        character_id: string
        chinese_name: string
        intro_one_line: string
        tags: string[]
        source_dir: string
        enriched_at: number
      }>
    >
    enrichStart(): Promise<{ ok: boolean }>
    enrichAbort(): Promise<{ ok: boolean }>
    enrichClear(): Promise<{ ok: boolean }>
    onEnrichProgress(cb: (p: EnrichProgress) => void): () => void
  }
  thumbs: {
    get(characterId: string): Promise<{
      exists: boolean
      url?: string
      size_bytes?: number
      age_ms?: number
      failed?: boolean
    }>
    save(payload: {
      character_id: string
      webp_base64: string
    }): Promise<{ ok: boolean; reason?: string }>
    markFailed(payload: { character_id: string; reason: string }): Promise<{ ok: boolean }>
    listMissing(characterIds: string[]): Promise<string[]>
    clearAll(): Promise<{ deleted: number }>
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
    healthCheck(payload?: {
      provider?: LlmProvider
      endpoint?: string
      api_key?: string
      model?: string
      test_vision?: boolean
    }): Promise<{
      provider: LlmProvider
      endpoint: string
      model: string
      overall_ok: boolean
      results: Array<{
        test: string
        ok: boolean
        detail: string
        is_thinking_model?: boolean
        supports_vision?: boolean
        latency_ms?: number
      }>
      recommendations: string[]
    }>
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
      strategy?: string
    }): Promise<{ ok: boolean; draft?: MotionDraft; reason?: string; strategy_used?: string }>
    write(payload: {
      model_json_path: string
      draft: MotionDraft
      group?: string
    }): Promise<{ ok: boolean; motion_path?: string; reason?: string }>
    onWritten(
      cb: (e: { model_json_path: string; motion_relative?: string }) => void,
    ): () => void
  }
  library: {
    summary(): Promise<LibrarySummary>
    list(): Promise<MotionTemplate[]>
    get(id: string): Promise<MotionTemplate | undefined>
    reload(): Promise<LibrarySummary>
    apply(payload: {
      template_id: string
      model_dir: string
      speed_scale?: number
      intensity_scale?: number
      name_suffix?: string
    }): Promise<ApplyResult>
  }
  attention: {
    getConfig(): Promise<AttentionConfig>
    updateConfig(patch: Partial<AttentionConfig>): Promise<AttentionConfig>
    snapshot(): Promise<AttentionSnapshot>
    recentPlans(limit?: number): Promise<BehaviorPlan[]>
    onPlan(cb: (plan: BehaviorPlan) => void): () => void
  }
  perception: {
    getConfig(): Promise<PerceptionConfig>
    updateConfig(patch: Partial<PerceptionConfig>): Promise<PerceptionConfig>
    recent(payload: { limit?: number; types?: PerceptionEventType[] }): Promise<PerceptionEvent[]>
    onEvent(cb: (e: PerceptionEvent) => void): () => void
    triggerSnapshot(
      reason?: 'mouse_focus' | 'app_changed' | 'user_request' | 'idle_concern',
    ): Promise<void>
  }
  trigger: {
    decide(payload: {
      event: TriggerEvent
      model_dir?: string
      ignore_cooldown?: boolean
    }): Promise<TriggerDecision | null>
    listRules(): Promise<TriggerRule[]>
    saveRules(rules: TriggerRule[]): Promise<TriggerRule[]>
    resetDefaults(): Promise<TriggerRule[]>
    resetCooldowns(): Promise<{ ok: boolean }>
  }
  strategy: {
    list(): Promise<
      Array<{
        id: string
        display_name_zh: string
        description: string
        cost: 'low' | 'medium' | 'high'
      }>
    >
  }
  engine: {
    list(filter?: MotionFilter): Promise<MotionEntry[]>
    get(id: number): Promise<MotionEntry | null>
    create(input: {
      model_dir: string
      name: string
      file_path: string
      group_name?: string
      source: MotionEntry['source']
      strategy?: string | null
      prompt?: string | null
      llm_provider?: string | null
      llm_model?: string | null
      duration_ms?: number
      loop_flag?: boolean
      param_count?: number
      validator_score?: number | null
      scorer_score?: number | null
      parent_entry_id?: number | null
      emotion_tags?: string[]
      context_tags?: string[]
    }): Promise<MotionEntry>
    update(payload: { id: number; patch: Partial<MotionEntry> }): Promise<MotionEntry>
    delete(id: number): Promise<{ ok: boolean }>
    saveVersion(payload: {
      entry_id: number
      snapshot_json: string
      edited_by: string
    }): Promise<MotionVersion>
    listVersions(entryId: number): Promise<MotionVersion[]>
    getVersion(payload: { entry_id: number; version_no: number }): Promise<MotionVersion | null>
    recordPlay(id: number): Promise<void>
    setRating(payload: { id: number; rating: -1 | 0 | 1 }): Promise<void>
    byEmotion(payload: { model_dir: string; emotion: string; limit?: number }): Promise<MotionEntry[]>
    byContext(payload: { model_dir: string; context: string; limit?: number }): Promise<MotionEntry[]>
    topRated(payload: { model_dir: string; n?: number }): Promise<MotionEntry[]>
    sync(modelDir: string): Promise<SyncReport>
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
    listRvcVoices(): Promise<{
      ok: boolean
      voices: string[]
      reason?: string
      sidecar?: string
    }>
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
  online: {
    listRecommended(): Promise<RecommendedRepo[]>
    listAssets(payload: { repo_id: string; sub_path?: string }): Promise<OnlineAsset[]>
    checkInstalled(payload: {
      kind: 'rvc' | 'live2d'
      voice_id?: string
      repo_slug?: string
      asset_name?: string
    }): Promise<{ installed: boolean }>
    install(payload: {
      repo_id: string
      asset_path: string
      kind: 'rvc' | 'live2d'
    }): Promise<{ ok: boolean; install_id: string }>
    cancelInstall(installId: string): Promise<{ ok: boolean }>
    installCustom(payload: {
      url: string
      kind: 'rvc' | 'live2d'
    }): Promise<{ ok: boolean; install_id: string }>
    onInstallProgress(cb: (p: OnlineInstallProgress) => void): () => void
    onInstallDone(cb: (p: OnlineInstallDone) => void): () => void
  }
}
