/**
 * Preload —— 通过 contextBridge 把主进程能力安全暴露给 renderer。
 *
 * 渲染层只使用 window.api.*，永远不能访问 ipcRenderer 全集合 / Node API。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatMessage,
  ChatOptions,
  IpcStreamChunk,
  LlmProvider,
  RuntimeConfig,
} from '@shared/types'
import type { TialynnApi } from '@shared/api'

interface ChunkListener {
  (chunk: IpcStreamChunk): void
}

const api: TialynnApi = {
  system: {
    version: () => ipcRenderer.invoke('system:version'),
    paths: () => ipcRenderer.invoke('system:paths'),
    revealDataDir: () => ipcRenderer.invoke('system:reveal-data-dir'),
    revealModelsDir: () => ipcRenderer.invoke('system:reveal-models-dir'),
  },
  window: {
    startDrag: (): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('window:start-drag'),
    softDrag: (x: number, y: number): void => ipcRenderer.send('window:soft-drag', { x, y }),
    setIgnoreMouse: (ignore: boolean, forward = true): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('window:set-ignore-mouse', { ignore, forward }),
    getBounds: (): Promise<Electron.Rectangle | null> => ipcRenderer.invoke('window:get-bounds'),
    setBounds: (b: Partial<Electron.Rectangle>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('window:set-bounds', b),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    togglePin: (pin: boolean): Promise<void> => ipcRenderer.invoke('window:toggle-pin', pin),
  },
  cursor: {
    pollStart: (): Promise<void> => ipcRenderer.invoke('cursor:poll-start'),
    pollStop: (): Promise<void> => ipcRenderer.invoke('cursor:poll-stop'),
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
    load: (): Promise<RuntimeConfig> => ipcRenderer.invoke('config:load'),
    save: (dto: RuntimeConfig): Promise<RuntimeConfig> => ipcRenderer.invoke('config:save', dto),
    onChanged: (cb: (cfg: RuntimeConfig) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, cfg: RuntimeConfig): void => cb(cfg)
      ipcRenderer.on('config:changed', handler)
      return () => ipcRenderer.off('config:changed', handler)
    },
  },
  models: {
    scan: () => ipcRenderer.invoke('models:scan'),
  },
  soul: {
    load: () => ipcRenderer.invoke('soul:load'),
    systemPrompt: () => ipcRenderer.invoke('soul:system-prompt'),
    pickDirectory: () => ipcRenderer.invoke('soul:pick-directory'),
    saveAvatar: (avatar) => ipcRenderer.invoke('soul:save-avatar', avatar),
    onChanged: (cb): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('soul:changed', handler)
      return () => ipcRenderer.off('soul:changed', handler)
    },
  },
  llm: {
    chatStream: (payload: {
      streamId: string
      messages: ChatMessage[]
      options?: Partial<ChatOptions>
      provider_override?: { provider?: LlmProvider; endpoint?: string; api_key?: string; model?: string }
    }): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('llm:chat-stream', payload),
    abort: (streamId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('llm:abort', streamId),
    test: (payload: {
      provider: LlmProvider
      endpoint: string
      api_key: string
      model: string
    }): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('llm:test', payload),
    onChunk: (cb: ChunkListener): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, chunk: IpcStreamChunk): void => cb(chunk)
      ipcRenderer.on('llm:chunk', handler)
      return () => ipcRenderer.off('llm:chunk', handler)
    },
  },
  tts: {
    speak: (payload: { text: string; voice?: string; emotion?: string }): Promise<{
      ok: boolean
      audio_b64?: string
      mime?: string
      reason?: string
    }> => ipcRenderer.invoke('tts:speak', payload),
    probe: (): Promise<{ ok: boolean; status?: number; reason?: string }> =>
      ipcRenderer.invoke('tts:probe'),
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
