/**
 * 系统级 IPC：配置读写、模型扫描、灵魂加载、TTS sidecar 转发。
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { scanModels, toFileUrl } from '../services/model-scanner'
import { loadSoul } from '../services/soul-loader'
import { saveAvatar } from '../services/soul-saver'
import { loadConfig, saveConfig } from '../services/config-store'
import { getPaths } from '../services/paths'
import type { RuntimeConfig, SoulConfig } from '@shared/types'

export function registerSystemIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('system:version', () => app.getVersion())

  ipcMain.handle('system:paths', () => getPaths())

  ipcMain.handle('system:reveal-data-dir', async () => {
    const p = getPaths().userDataDir
    await shell.openPath(p)
    return p
  })

  ipcMain.handle('system:reveal-models-dir', async () => {
    const list = getPaths().modelSearchPaths
    const target = list[0]
    if (target) await shell.openPath(target)
    return target
  })

  ipcMain.handle('config:load', () => loadConfig())

  ipcMain.handle('config:save', (_evt, dto: RuntimeConfig) => {
    const merged = saveConfig(dto)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('config:changed', merged)
    }
    return merged
  })

  ipcMain.handle('models:scan', () => {
    return scanModels().map((m) => ({ ...m, file_url: toFileUrl(m.absolute_path) }))
  })

  ipcMain.handle('soul:load', () => {
    const loaded = loadSoul()
    return { config: loaded.config, sources: loaded.sourceFiles }
  })

  ipcMain.handle('soul:system-prompt', () => {
    return loadSoul().systemPrompt
  })

  ipcMain.handle('soul:save-avatar', (_evt, avatar: Partial<SoulConfig['avatar']>) => {
    const result = saveAvatar(avatar)
    if (result.ok) {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('soul:changed')
      }
    }
    return result
  })

  ipcMain.handle('soul:pick-directory', async () => {
    const win = getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择模型目录',
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(
    'tts:speak',
    async (_evt, payload: { text: string; voice?: string; emotion?: string }) => {
      const cfg = loadConfig()
      if (cfg.tts_provider !== 'sidecar' || !cfg.tts_sidecar_url) {
        return { ok: false, reason: 'tts-disabled' }
      }
      try {
        const url = `${cfg.tts_sidecar_url.replace(/\/+$/, '')}/v1/tts`
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: payload.text,
            voice: payload.voice ?? cfg.emotion_voice_map[payload.emotion ?? 'neutral'],
            emotion: payload.emotion ?? 'neutral',
          }),
        })
        if (!r.ok) return { ok: false, reason: `sidecar ${r.status}` }
        const buf = await r.arrayBuffer()
        return { ok: true, audio_b64: Buffer.from(buf).toString('base64'), mime: 'audio/wav' }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    },
  )

  ipcMain.handle('tts:probe', async () => {
    const cfg = loadConfig()
    if (!cfg.tts_sidecar_url) return { ok: false, reason: 'no-url' }
    try {
      const r = await fetch(`${cfg.tts_sidecar_url.replace(/\/+$/, '')}/health`)
      return { ok: r.ok, status: r.status }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  })
}
