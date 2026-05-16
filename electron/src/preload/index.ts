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
    try {
      return JSON.parse(JSON.stringify(v)) as T
    } catch {
      return v
    }
  }
}

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args.map(deepPlain))

const send = (channel: string, ...args: unknown[]): void =>
  ipcRenderer.send(channel, ...args.map(deepPlain))

const api: TialynnApi = {
  system: {
    version: () => invoke('system:version') as Promise<string>,
    paths: () => invoke('system:paths') as ReturnType<TialynnApi['system']['paths']>,
    revealDataDir: () => invoke('system:reveal-data-dir') as Promise<string>,
    revealModelsDir: () => invoke('system:reveal-models-dir') as Promise<string>,
  },
  window: {
    startDrag: () => invoke('window:start-drag') as Promise<{ ok: boolean; reason?: string }>,
    softDrag: (x: number, y: number): void => send('window:soft-drag', { x, y }),
    setIgnoreMouse: (ignore: boolean, forward = true) =>
      invoke('window:set-ignore-mouse', { ignore, forward }) as Promise<{ ok: boolean }>,
    getBounds: () => invoke('window:get-bounds') as Promise<Electron.Rectangle | null>,
    setBounds: (b: Partial<Electron.Rectangle>) =>
      invoke('window:set-bounds', b) as Promise<{ ok: boolean }>,
    close: () => invoke('window:close') as Promise<void>,
    minimize: () => invoke('window:minimize') as Promise<void>,
    togglePin: (pin: boolean) => invoke('window:toggle-pin', pin) as Promise<void>,
  },
  cursor: {
    pollStart: () => invoke('cursor:poll-start') as Promise<void>,
    pollStop: () => invoke('cursor:poll-stop') as Promise<void>,
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
    chatStream: (payload) =>
      invoke('llm:chat-stream', payload) as Promise<{ ok: boolean; reason?: string }>,
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
    speak: (payload: { text: string; voice?: string; emotion?: string }) =>
      invoke('tts:speak', payload) as Promise<{
        ok: boolean
        audio_b64?: string
        mime?: string
        reason?: string
      }>,
    probe: () =>
      invoke('tts:probe') as Promise<{ ok: boolean; status?: number; reason?: string }>,
  },
  history: {
    listRecent: (limit) =>
      invoke('history:list-recent', limit) as ReturnType<TialynnApi['history']['listRecent']>,
    append: (turn) => invoke('history:append', turn) as Promise<{ ok: boolean }>,
    clear: () => invoke('history:clear') as Promise<{ deleted: number }>,
  },
  motion: {
    summarize: (modelDir: string) =>
      invoke('motion:summarize', modelDir) as ReturnType<TialynnApi['motion']['summarize']>,
    introspect: (modelDir: string) =>
      invoke('motion:introspect', modelDir) as ReturnType<TialynnApi['motion']['introspect']>,
    introspectDebug: (modelDir: string) =>
      invoke('motion:introspect-debug', modelDir) as Promise<string>,
    generate: (payload) =>
      invoke('motion:generate', payload) as ReturnType<TialynnApi['motion']['generate']>,
    write: (payload) =>
      invoke('motion:write', payload) as ReturnType<TialynnApi['motion']['write']>,
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
    summary: () => invoke('library:summary') as ReturnType<TialynnApi['library']['summary']>,
    list: () => invoke('library:list') as ReturnType<TialynnApi['library']['list']>,
    get: (id: string) =>
      invoke('library:get', id) as ReturnType<TialynnApi['library']['get']>,
    reload: () => invoke('library:reload') as ReturnType<TialynnApi['library']['reload']>,
    apply: (payload) =>
      invoke('library:apply', payload) as ReturnType<TialynnApi['library']['apply']>,
  },
  attention: {
    getConfig: () =>
      invoke('attention:get-config') as ReturnType<TialynnApi['attention']['getConfig']>,
    updateConfig: (patch) =>
      invoke('attention:update-config', patch) as ReturnType<
        TialynnApi['attention']['updateConfig']
      >,
    snapshot: () =>
      invoke('attention:snapshot') as ReturnType<TialynnApi['attention']['snapshot']>,
    recentPlans: (limit) =>
      invoke('attention:recent-plans', limit) as ReturnType<
        TialynnApi['attention']['recentPlans']
      >,
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
    getConfig: () =>
      invoke('perception:get-config') as ReturnType<TialynnApi['perception']['getConfig']>,
    updateConfig: (patch) =>
      invoke('perception:update-config', patch) as ReturnType<
        TialynnApi['perception']['updateConfig']
      >,
    recent: (payload) =>
      invoke('perception:recent', payload) as ReturnType<TialynnApi['perception']['recent']>,
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
    decide: (payload) =>
      invoke('trigger:decide', payload) as ReturnType<TialynnApi['trigger']['decide']>,
    listRules: () =>
      invoke('trigger:list-rules') as ReturnType<TialynnApi['trigger']['listRules']>,
    saveRules: (rules) =>
      invoke('trigger:save-rules', rules) as ReturnType<TialynnApi['trigger']['saveRules']>,
    resetDefaults: () =>
      invoke('trigger:reset-defaults') as ReturnType<TialynnApi['trigger']['resetDefaults']>,
    resetCooldowns: () =>
      invoke('trigger:reset-cooldowns') as ReturnType<TialynnApi['trigger']['resetCooldowns']>,
  },
  strategy: {
    list: () => invoke('strategy:list') as ReturnType<TialynnApi['strategy']['list']>,
  },
  engine: {
    list: (filter) => invoke('engine:list', filter) as ReturnType<TialynnApi['engine']['list']>,
    get: (id: number) => invoke('engine:get', id) as ReturnType<TialynnApi['engine']['get']>,
    create: (input) =>
      invoke('engine:create', input) as ReturnType<TialynnApi['engine']['create']>,
    update: (payload) =>
      invoke('engine:update', payload) as ReturnType<TialynnApi['engine']['update']>,
    delete: (id: number) =>
      invoke('engine:delete', id) as ReturnType<TialynnApi['engine']['delete']>,
    saveVersion: (payload) =>
      invoke('engine:save-version', payload) as ReturnType<TialynnApi['engine']['saveVersion']>,
    listVersions: (entryId: number) =>
      invoke('engine:list-versions', entryId) as ReturnType<TialynnApi['engine']['listVersions']>,
    getVersion: (payload) =>
      invoke('engine:get-version', payload) as ReturnType<TialynnApi['engine']['getVersion']>,
    recordPlay: (id: number) => invoke('engine:record-play', id) as Promise<void>,
    setRating: (payload) => invoke('engine:set-rating', payload) as Promise<void>,
    byEmotion: (payload) =>
      invoke('engine:by-emotion', payload) as ReturnType<TialynnApi['engine']['byEmotion']>,
    byContext: (payload) =>
      invoke('engine:by-context', payload) as ReturnType<TialynnApi['engine']['byContext']>,
    topRated: (payload) =>
      invoke('engine:top-rated', payload) as ReturnType<TialynnApi['engine']['topRated']>,
    sync: (modelDir: string) =>
      invoke('engine:sync', modelDir) as ReturnType<TialynnApi['engine']['sync']>,
  },
  market: {
    installZip: (zipPath: string) =>
      invoke('market:install-zip', zipPath) as ReturnType<TialynnApi['market']['installZip']>,
    installUrl: (url: string) =>
      invoke('market:install-url', url) as ReturnType<TialynnApi['market']['installUrl']>,
    installPath: (path: string) =>
      invoke('market:install-path', path) as ReturnType<TialynnApi['market']['installPath']>,
    installPaths: (paths: string[]) =>
      invoke('market:install-paths', paths) as ReturnType<TialynnApi['market']['installPaths']>,
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
  // @ts-expect-error 全局桥接 fallback
  window.api = api
}
