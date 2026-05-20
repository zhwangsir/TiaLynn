/**
 * Preload —— 通过 contextBridge 把主进程能力安全暴露给 renderer。
 *
 * 渲染层只使用 window.api.*，永远不能访问 ipcRenderer 全集合 / Node API。
 *
 * 关键：所有 IPC invoke/send 的参数都过 deepPlain() 兜底，
 * 避免 renderer 不小心传入 Vue reactive Proxy / class instance / function
 * 导致 V8 结构化克隆 "An object could not be cloned" 报错。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatMessage,
  ChatOptions,
  IpcStreamChunk,
  LlmProvider,
  RuntimeConfig,
} from '@shared/types'
import type { ApprovalRequest } from '@shared/tools'
import type { TialynnApi } from '@shared/api'
import { llmChatStream } from '@shared/channels/llm'
import {
  memoryAdd,
  memoryCount,
  memoryDailyReflection,
  memoryDelete,
  memoryExtractFromTurn,
  memoryList,
  memoryRagContext,
  memorySearch,
} from '@shared/channels/memory'
import {
  mcpCallTool,
  mcpListServers,
  mcpListTools,
  mcpRegister,
  mcpUnregister,
} from '@shared/channels/mcp'
import { ttsListRvcVoices, ttsProbe, ttsSpeak } from '@shared/channels/tts'
import {
  attentionGetConfig,
  attentionRecentPlans,
  attentionSnapshot,
  attentionUpdateConfig,
} from '@shared/channels/attention'
import {
  perceptionGetConfig,
  perceptionRecent,
  perceptionUpdateConfig,
} from '@shared/channels/perception'
import {
  triggerDecide,
  triggerListRules,
  triggerResetCooldowns,
  triggerResetDefaults,
  triggerSaveRules,
} from '@shared/channels/trigger'
import {
  marketInstallPath,
  marketInstallPaths,
  marketInstallUrl,
  marketInstallZip,
} from '@shared/channels/market'
import {
  thumbsClearAll,
  thumbsGet,
  thumbsGetBatch,
  thumbsListMissing,
  thumbsMarkFailed,
  thumbsSave,
} from '@shared/channels/thumbs'
import {
  engineByContext,
  engineByEmotion,
  engineCreate,
  engineDelete,
  engineGet,
  engineGetVersion,
  engineList,
  engineListVersions,
  engineRecordPlay,
  engineSaveVersion,
  engineSetRating,
  engineSync,
  engineTopRated,
  engineUpdate,
} from '@shared/channels/motion-engine'
import {
  charactersActive,
  charactersClone,
  charactersCreate,
  charactersDelete,
  charactersGet,
  charactersList,
  charactersReadSoulFile,
  charactersRecordChat,
  charactersSwitch,
  charactersUpdate,
  charactersWriteSoulFile,
} from '@shared/channels/characters'
import {
  onlineCancelInstall,
  onlineCheckInstalled,
  onlineInstall,
  onlineInstallCustom,
  onlineListAssets,
  onlineListRecommended,
} from '@shared/channels/online'
import {
  libraryApply,
  libraryGet,
  libraryList,
  libraryReload,
  librarySummary,
  motionGenerate,
  motionIntrospect,
  motionSummarize,
  motionWrite,
} from '@shared/channels/motion-factory'
import {
  cursorPollStart,
  cursorPollStop,
  windowClose,
  windowGetBounds,
  windowMinimize,
  windowSetBounds,
  windowSetIgnoreMouse,
  windowStartDrag,
  windowTogglePin,
} from '@shared/channels/window-control'
import {
  agentClick,
  agentClickAndType,
  agentCursorPos,
  agentDoubleClick,
  agentDrag,
  agentFind,
  agentFindAndClick,
  agentHalt,
  agentIsHalted,
  agentKey,
  agentMove,
  agentRunTask,
  agentScreenSize,
  agentScreenshot,
  agentScroll,
  agentType,
} from '@shared/channels/automation'

interface ChunkListener {
  (chunk: IpcStreamChunk): void
}

/**
 * 把任意参数 deep clone 成纯 JS 对象。
 * 优先用 V8 structuredClone (Electron renderer 已支持)；它不接受 Proxy 时
 * 退回 JSON 一遍（JSON.stringify 会走 Proxy getter 自动 unwrap）。
 */
function deepPlain<T>(v: T): T {
  if (v === undefined || v === null) return v
  if (typeof v !== 'object') return v
  try {
    return structuredClone(v)
  } catch {
    /* fallback */
  }
  try {
    return JSON.parse(JSON.stringify(v)) as T
  } catch {
    /* fallback */
  }
  // 最后兜底：手动递归 unwrap Vue Proxy
  return manualClone(v) as T
}

function manualClone(v: unknown): unknown {
  if (v === null || v === undefined) return v
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return v
  if (t === 'function' || t === 'symbol') return undefined
  if (Array.isArray(v)) return v.map(manualClone)
  if (t === 'object') {
    // ArrayBuffer / typed array 直接 copy
    if (v instanceof ArrayBuffer) return v.slice(0)
    if (ArrayBuffer.isView(v)) {
      const ctor = v.constructor as new (buf: ArrayBuffer) => unknown
      return new ctor(((v as { buffer: ArrayBuffer }).buffer).slice(0))
    }
    const rec = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(rec)) {
      try {
        out[k] = manualClone(rec[k])
      } catch {
        out[k] = null
      }
    }
    return out
  }
  return undefined
}

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args.map(deepPlain))

const send = (channel: string, ...args: unknown[]): void =>
  ipcRenderer.send(channel, ...args.map(deepPlain))

// Phase 1: type-safe channel wrapper — 通过 IpcChannel<P,R> 自动推 payload + 返回值类型
import type { IpcChannel } from '@shared/ipc-channel'
function invokeChannel<P, R>(channel: IpcChannel<P, R>, payload: P): Promise<R> {
  return ipcRenderer.invoke(channel.name, deepPlain(payload)) as Promise<R>
}

const api: TialynnApi = {
  system: {
    version: () => invoke('system:version') as Promise<string>,
    paths: () => invoke('system:paths') as ReturnType<TialynnApi['system']['paths']>,
    revealDataDir: () => invoke('system:reveal-data-dir') as Promise<string>,
    revealModelsDir: () => invoke('system:reveal-models-dir') as Promise<string>,
    openExternal: (url: string) =>
      invoke('system:open-external', url) as Promise<{ ok: boolean; reason?: string }>,
    diskUsage: (force = false) =>
      invoke('system:disk-usage', force) as ReturnType<TialynnApi['system']['diskUsage']>,
    cleanPath: (path: string) =>
      invoke('system:clean-path', path) as ReturnType<TialynnApi['system']['cleanPath']>,
    // v0.17 P3: tray menu 点击 → main → 这条事件 → renderer onMenuSelect(id)
    onTrayAction: (cb: (id: string) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
      ipcRenderer.on('tray:action', handler)
      return () => ipcRenderer.off('tray:action', handler)
    },
  },
  window: {
    startDrag: () => invokeChannel(windowStartDrag, undefined as never),
    softDrag: (x: number, y: number): void => send('window:soft-drag', { x, y }),
    setIgnoreMouse: (ignore: boolean, forward = true) =>
      invokeChannel(windowSetIgnoreMouse, { ignore, forward }),
    getBounds: () => invokeChannel(windowGetBounds, undefined as never),
    setBounds: (b: Partial<Electron.Rectangle>) => invokeChannel(windowSetBounds, b),
    close: () => invokeChannel(windowClose, undefined as never),
    minimize: () => invokeChannel(windowMinimize, undefined as never),
    togglePin: (pin: boolean) => invokeChannel(windowTogglePin, pin),
  },
  cursor: {
    pollStart: () => invokeChannel(cursorPollStart, undefined as never),
    pollStop: () => invokeChannel(cursorPollStop, undefined as never),
    onTick: (cb: (pt: { x: number; y: number; inside: boolean }) => void): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        pt: { x: number; y: number; inside: boolean },
      ): void => cb(pt)
      ipcRenderer.on('cursor:tick', handler)
      return () => ipcRenderer.off('cursor:tick', handler)
    },
  },
  config: {
    load: () => invoke('config:load') as Promise<RuntimeConfig>,
    save: (dto: RuntimeConfig) => invoke('config:save', dto) as Promise<RuntimeConfig>,
    onChanged: (cb: (cfg: RuntimeConfig) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, cfg: RuntimeConfig): void => cb(cfg)
      ipcRenderer.on('config:changed', handler)
      return () => ipcRenderer.off('config:changed', handler)
    },
  },
  models: {
    scan: () => invoke('models:scan') as ReturnType<TialynnApi['models']['scan']>,
    heal: (payload: { model_json_path: string }) =>
      invoke('models:heal', payload) as ReturnType<TialynnApi['models']['heal']>,
    findDuplicates: () =>
      invoke('models:find-duplicates') as ReturnType<TialynnApi['models']['findDuplicates']>,
    applyDedup: (payload?: { group_keys?: string[]; dry_run?: boolean }) =>
      invoke('models:apply-dedup', payload) as ReturnType<TialynnApi['models']['applyDedup']>,
    mergeGroups: (payload?: { group_keys?: string[] }) =>
      invoke('models:merge-groups', payload) as ReturnType<TialynnApi['models']['mergeGroups']>,
    describe: (payload: {
      model_dir: string
      model_json_path: string
      display: string
      ip: string
      motion_count: number
      expression_count: number
    }) => invoke('models:describe', payload) as ReturnType<TialynnApi['models']['describe']>,
    cachedDescriptions: () =>
      invoke('models:cached-descriptions') as ReturnType<TialynnApi['models']['cachedDescriptions']>,
    getPreference: (characterId: string) =>
      invoke('models:get-preference', characterId) as ReturnType<TialynnApi['models']['getPreference']>,
    setPreference: (payload: { character_id: string; scale: number; offset_y: number }) =>
      invoke('models:set-preference', payload) as ReturnType<TialynnApi['models']['setPreference']>,
    // v0.12: 收藏 + 最近
    favorites: () => invoke('models:favorites') as ReturnType<TialynnApi['models']['favorites']>,
    toggleFavorite: (dir: string) =>
      invoke('models:toggle-favorite', dir) as ReturnType<TialynnApi['models']['toggleFavorite']>,
    markRecent: (dir: string) =>
      invoke('models:mark-recent', dir) as ReturnType<TialynnApi['models']['markRecent']>,
    clearRecent: () => invoke('models:clear-recent') as ReturnType<TialynnApi['models']['clearRecent']>,
    // v0.12: character enrichment
    enrichCached: () =>
      invoke('models:enrich-cached') as ReturnType<TialynnApi['models']['enrichCached']>,
    enrichStart: () => invoke('models:enrich-start') as ReturnType<TialynnApi['models']['enrichStart']>,
    enrichAbort: () => invoke('models:enrich-abort') as ReturnType<TialynnApi['models']['enrichAbort']>,
    enrichClear: () => invoke('models:enrich-clear') as ReturnType<TialynnApi['models']['enrichClear']>,
    onEnrichProgress: (cb: (p: import('@shared/api').EnrichProgress) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: import('@shared/api').EnrichProgress): void =>
        cb(p)
      ipcRenderer.on('models:enrich-progress', handler)
      return () => ipcRenderer.off('models:enrich-progress', handler)
    },
    // v0.15+v0.16: 模型 learning / 评分 / 补全
    computeLearnings: (force = false) =>
      invoke('models:compute-learnings', force) as ReturnType<TialynnApi['models']['computeLearnings']>,
    getLearnings: () =>
      invoke('models:get-learnings') as ReturnType<TialynnApi['models']['getLearnings']>,
    evaluate: (payload) =>
      invoke('models:evaluate', payload) as ReturnType<TialynnApi['models']['evaluate']>,
    autoFill: (payload) =>
      invoke('models:auto-fill', payload) as ReturnType<TialynnApi['models']['autoFill']>,
    applyExpressionPack: (payload) =>
      invoke('models:apply-expression-pack', payload) as ReturnType<TialynnApi['models']['applyExpressionPack']>,
    listPhysicsPresets: () =>
      invoke('models:list-physics-presets') as ReturnType<TialynnApi['models']['listPhysicsPresets']>,
    applyPhysicsPreset: (payload) =>
      invoke('models:apply-physics-preset', payload) as ReturnType<TialynnApi['models']['applyPhysicsPreset']>,
    analyzeParams: (payload) =>
      invoke('models:analyze-params', payload) as ReturnType<TialynnApi['models']['analyzeParams']>,
  },
  online: {
    listRecommended: () => invokeChannel(onlineListRecommended, undefined as never),
    listAssets: (payload: { repo_id: string; sub_path?: string }) =>
      invokeChannel(onlineListAssets, payload),
    checkInstalled: (payload: {
      kind: 'rvc' | 'live2d'
      voice_id?: string
      repo_slug?: string
      asset_name?: string
    }) => invokeChannel(onlineCheckInstalled, payload),
    install: (payload: { repo_id: string; asset_path: string; kind: 'rvc' | 'live2d' }) =>
      invokeChannel(onlineInstall, payload),
    cancelInstall: (installId: string) => invokeChannel(onlineCancelInstall, installId),
    installCustom: (payload: { url: string; kind: 'rvc' | 'live2d' }) =>
      invokeChannel(onlineInstallCustom, payload),
    onInstallProgress: (
      cb: (p: import('@shared/api').OnlineInstallProgress) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        p: import('@shared/api').OnlineInstallProgress,
      ): void => cb(p)
      ipcRenderer.on('online:install-progress', handler)
      return () => ipcRenderer.off('online:install-progress', handler)
    },
    onInstallDone: (
      cb: (p: import('@shared/api').OnlineInstallDone) => void,
    ): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        p: import('@shared/api').OnlineInstallDone,
      ): void => cb(p)
      ipcRenderer.on('online:install-done', handler)
      return () => ipcRenderer.off('online:install-done', handler)
    },
  },
  thumbs: {
    get: (characterId: string) => invokeChannel(thumbsGet, characterId),
    getBatch: (characterIds: string[]) => invokeChannel(thumbsGetBatch, characterIds),
    save: (payload: { character_id: string; webp_base64: string }) =>
      invokeChannel(thumbsSave, payload),
    markFailed: (payload: { character_id: string; reason: string }) =>
      invokeChannel(thumbsMarkFailed, payload),
    listMissing: (characterIds: string[]) => invokeChannel(thumbsListMissing, characterIds),
    clearAll: () => invokeChannel(thumbsClearAll, undefined as never),
  },
  characters: {
    list: () => invokeChannel(charactersList, undefined as never),
    active: () => invokeChannel(charactersActive, undefined as never),
    get: (id) => invokeChannel(charactersGet, id),
    create: (input) => invokeChannel(charactersCreate, input),
    update: (payload) => invokeChannel(charactersUpdate, payload),
    delete: (id) => invokeChannel(charactersDelete, id),
    clone: (payload) => invokeChannel(charactersClone, payload),
    switch: (id) => invokeChannel(charactersSwitch, id),
    recordChat: () => invokeChannel(charactersRecordChat, undefined as never),
    readSoulFile: (payload) => invokeChannel(charactersReadSoulFile, payload),
    writeSoulFile: (payload) => invokeChannel(charactersWriteSoulFile, payload),
    onSwitched: (cb) => {
      const handler = (_: unknown, character: unknown): void => cb(character as Parameters<typeof cb>[0])
      ipcRenderer.on('character:switched', handler)
      return () => ipcRenderer.off('character:switched', handler)
    },
  },
  soul: {
    load: () => invoke('soul:load') as ReturnType<TialynnApi['soul']['load']>,
    systemPrompt: () => invoke('soul:system-prompt') as Promise<string>,
    pickDirectory: () => invoke('soul:pick-directory') as Promise<string | null>,
    saveAvatar: (avatar) =>
      invoke('soul:save-avatar', avatar) as ReturnType<TialynnApi['soul']['saveAvatar']>,
    onChanged: (cb): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('soul:changed', handler)
      return () => ipcRenderer.off('soul:changed', handler)
    },
  },
  llm: {
    // Phase 1 试点：走 type-safe channel
    chatStream: (payload) => invokeChannel(llmChatStream, payload),
    abort: (streamId: string) => invoke('llm:abort', streamId) as Promise<{ ok: boolean }>,
    test: (payload: { provider: LlmProvider; endpoint: string; api_key: string; model: string }) =>
      invoke('llm:test', payload) as Promise<{ ok: boolean; message: string }>,
    healthCheck: (payload) =>
      invoke('llm:health-check', payload) as ReturnType<TialynnApi['llm']['healthCheck']>,
    onChunk: (cb: ChunkListener): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, chunk: IpcStreamChunk): void => cb(chunk)
      ipcRenderer.on('llm:chunk', handler)
      return () => ipcRenderer.off('llm:chunk', handler)
    },
  },
  tts: {
    // Phase 1 W4: type-safe channels
    speak: (payload) => invokeChannel(ttsSpeak, payload),
    probe: () => invokeChannel(ttsProbe, undefined as never),
    listRvcVoices: () => invokeChannel(ttsListRvcVoices, undefined as never),
  },
  history: {
    listRecent: (limit) =>
      invoke('history:list-recent', limit) as ReturnType<TialynnApi['history']['listRecent']>,
    append: (turn) => invoke('history:append', turn) as Promise<{ ok: boolean }>,
    clear: () => invoke('history:clear') as Promise<{ deleted: number }>,
  },
  motion: {
    summarize: (modelDir: string) => invokeChannel(motionSummarize, modelDir),
    introspect: (modelDir: string) => invokeChannel(motionIntrospect, modelDir),
    introspectDebug: (modelDir: string) =>
      invoke('motion:introspect-debug', modelDir) as Promise<string>,
    generate: (payload) => invokeChannel(motionGenerate, payload),
    write: (payload) => invokeChannel(motionWrite, payload),
    onWritten: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        ev: { model_json_path: string; motion_relative?: string },
      ): void => cb(ev)
      ipcRenderer.on('motion:written', handler)
      return () => ipcRenderer.off('motion:written', handler)
    },
  },
  library: {
    summary: () => invokeChannel(librarySummary, undefined as never),
    list: () => invokeChannel(libraryList, undefined as never),
    get: (id: string) => invokeChannel(libraryGet, id),
    reload: () => invokeChannel(libraryReload, undefined as never),
    apply: (payload) => invokeChannel(libraryApply, payload),
  },
  attention: {
    getConfig: () => invokeChannel(attentionGetConfig, undefined as never),
    updateConfig: (patch) => invokeChannel(attentionUpdateConfig, patch),
    snapshot: () => invokeChannel(attentionSnapshot, undefined as never),
    recentPlans: (limit) => invokeChannel(attentionRecentPlans, limit),
    onPlan: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        plan: import('@shared/attention').BehaviorPlan,
      ): void => cb(plan)
      ipcRenderer.on('attention:plan', handler)
      return () => ipcRenderer.off('attention:plan', handler)
    },
  },
  perception: {
    getConfig: () => invokeChannel(perceptionGetConfig, undefined as never),
    updateConfig: (patch) => invokeChannel(perceptionUpdateConfig, patch),
    recent: (payload) => invokeChannel(perceptionRecent, payload),
    onEvent: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        ev: import('@shared/perception').PerceptionEvent,
      ): void => cb(ev)
      ipcRenderer.on('perception:event', handler)
      return () => ipcRenderer.off('perception:event', handler)
    },
    triggerSnapshot: (reason) =>
      invoke('perception:trigger-snapshot', reason) as Promise<void>,
  },
  trigger: {
    decide: (payload) => invokeChannel(triggerDecide, payload),
    listRules: () => invokeChannel(triggerListRules, undefined as never),
    saveRules: (rules) => invokeChannel(triggerSaveRules, rules),
    resetDefaults: () => invokeChannel(triggerResetDefaults, undefined as never),
    resetCooldowns: () => invokeChannel(triggerResetCooldowns, undefined as never),
  },
  strategy: {
    list: () => invoke('strategy:list') as ReturnType<TialynnApi['strategy']['list']>,
  },
  engine: {
    list: (filter) => invokeChannel(engineList, filter),
    get: (id: number) => invokeChannel(engineGet, id),
    create: (input) => invokeChannel(engineCreate, input),
    update: (payload) => invokeChannel(engineUpdate, payload),
    delete: (id: number) => invokeChannel(engineDelete, id),
    saveVersion: (payload) => invokeChannel(engineSaveVersion, payload),
    listVersions: (entryId: number) => invokeChannel(engineListVersions, entryId),
    getVersion: (payload) => invokeChannel(engineGetVersion, payload),
    recordPlay: (id: number) => invokeChannel(engineRecordPlay, id),
    setRating: (payload) => invokeChannel(engineSetRating, payload),
    byEmotion: (payload) => invokeChannel(engineByEmotion, payload),
    byContext: (payload) => invokeChannel(engineByContext, payload),
    topRated: (payload) => invokeChannel(engineTopRated, payload),
    sync: (modelDir: string) => invokeChannel(engineSync, modelDir),
  },
  market: {
    installZip: (zipPath: string) => invokeChannel(marketInstallZip, zipPath),
    installUrl: (url: string) => invokeChannel(marketInstallUrl, url),
    installPath: (path: string) => invokeChannel(marketInstallPath, path),
    installPaths: (paths: string[]) => invokeChannel(marketInstallPaths, paths),
    onInstalled: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        results: Parameters<typeof cb>[0],
      ): void => cb(results)
      ipcRenderer.on('market:installed', handler)
      return () => ipcRenderer.off('market:installed', handler)
    },
  },
  tools: {
    list: () => invoke('tools:list') as ReturnType<TialynnApi['tools']['list']>,
    run: (call) => invoke('tools:run', call) as ReturnType<TialynnApi['tools']['run']>,
    policyGet: () => invoke('tools:policy-get') as ReturnType<TialynnApi['tools']['policyGet']>,
    policySet: (payload) =>
      invoke('tools:policy-set', payload) as ReturnType<TialynnApi['tools']['policySet']>,
    policyClear: () => invoke('tools:policy-clear') as ReturnType<TialynnApi['tools']['policyClear']>,
    onApprovalRequest: (cb): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, req: ApprovalRequest): void => cb(req)
      ipcRenderer.on('tools:approval-request', handler)
      return () => ipcRenderer.off('tools:approval-request', handler)
    },
    sendApprovalDecision: (payload) => send('tools:approval-decision', payload),
    onChanged: (cb): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('tools:changed', handler)
      return () => ipcRenderer.off('tools:changed', handler)
    },
  },
  comfyui: {
    status: () => invoke('comfyui:status') as ReturnType<TialynnApi['comfyui']['status']>,
    listCheckpoints: () => invoke('comfyui:list-checkpoints') as ReturnType<TialynnApi['comfyui']['listCheckpoints']>,
    listLoras: () => invoke('comfyui:list-loras') as ReturnType<TialynnApi['comfyui']['listLoras']>,
    listSamplers: () => invoke('comfyui:list-samplers') as ReturnType<TialynnApi['comfyui']['listSamplers']>,
    listVideoModels: () => invoke('comfyui:list-video-models') as ReturnType<TialynnApi['comfyui']['listVideoModels']>,
    uploadImage: (payload) =>
      invoke('comfyui:upload-image', payload) as ReturnType<TialynnApi['comfyui']['uploadImage']>,
    generateImage: (payload) =>
      invoke('comfyui:generate-image', payload) as ReturnType<TialynnApi['comfyui']['generateImage']>,
    generateI2I: (payload) =>
      invoke('comfyui:generate-i2i', payload) as ReturnType<TialynnApi['comfyui']['generateI2I']>,
    generateVideoT2V: (payload) =>
      invoke('comfyui:generate-video-t2v', payload) as ReturnType<TialynnApi['comfyui']['generateVideoT2V']>,
    generateVideoI2V: (payload) =>
      invoke('comfyui:generate-video-i2v', payload) as ReturnType<TialynnApi['comfyui']['generateVideoI2V']>,
    generateSticker: (payload) =>
      invoke('comfyui:generate-sticker', payload) as ReturnType<TialynnApi['comfyui']['generateSticker']>,
    generateBackground: (payload) =>
      invoke('comfyui:generate-background', payload) as ReturnType<TialynnApi['comfyui']['generateBackground']>,
    listRecent: (kind) =>
      invoke('comfyui:list-recent', kind) as ReturnType<TialynnApi['comfyui']['listRecent']>,
    cancel: () => invoke('comfyui:cancel') as ReturnType<TialynnApi['comfyui']['cancel']>,
    onProgress: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        p: Parameters<Parameters<TialynnApi['comfyui']['onProgress']>[0]>[0],
      ): void => cb(p)
      ipcRenderer.on('comfyui:progress', handler)
      return () => ipcRenderer.off('comfyui:progress', handler)
    },
  },
  // Phase 1 W4: type-safe channels (memory + mcp)
  memory: {
    list: (opts) => invokeChannel(memoryList, opts),
    count: () => invokeChannel(memoryCount, undefined as never),
    add: (payload) => invokeChannel(memoryAdd, payload),
    delete: (id) => invokeChannel(memoryDelete, id),
    search: (payload) => invokeChannel(memorySearch, payload),
    extractFromTurn: (payload) => invokeChannel(memoryExtractFromTurn, payload),
    ragContext: (payload) => invokeChannel(memoryRagContext, payload),
    dailyReflection: () => invokeChannel(memoryDailyReflection, undefined as never),
  },
  mcp: {
    listServers: () => invokeChannel(mcpListServers, undefined as never),
    register: (payload) => invokeChannel(mcpRegister, payload),
    unregister: (id) => invokeChannel(mcpUnregister, id),
    listTools: (serverId) => invokeChannel(mcpListTools, serverId),
    callTool: (payload) => invokeChannel(mcpCallTool, payload),
  },
  agent: {
    halt: (on) => invokeChannel(agentHalt, on),
    isHalted: () => invokeChannel(agentIsHalted, undefined as never),
    cursorPos: () => invokeChannel(agentCursorPos, undefined as never),
    screenSize: () => invokeChannel(agentScreenSize, undefined as never),
    move: (p) => invokeChannel(agentMove, p),
    click: (p) => invokeChannel(agentClick, p),
    doubleClick: (p) => invokeChannel(agentDoubleClick, p),
    scroll: (p) => invokeChannel(agentScroll, p),
    drag: (p) => invokeChannel(agentDrag, p),
    type: (p) => invokeChannel(agentType, p),
    key: (p) => invokeChannel(agentKey, p),
    clickAndType: (p) => invokeChannel(agentClickAndType, p),
    screenshot: (region) => invokeChannel(agentScreenshot, region),
    find: (p) => invokeChannel(agentFind, p),
    findAndClick: (p) => invokeChannel(agentFindAndClick, p),
    runTask: (p) => invokeChannel(agentRunTask, p),
    onStep: (cb): (() => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        step: Parameters<Parameters<TialynnApi['agent']['onStep']>[0]>[0],
      ): void => cb(step)
      ipcRenderer.on('agent:step', handler)
      return () => ipcRenderer.off('agent:step', handler)
    },
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    console.error('[preload] exposeInMainWorld failed:', e)
  }
} else {
  // contextIsolation 关闭时直接挂全局（不推荐，仅做兜底）
  window.api = api
}
