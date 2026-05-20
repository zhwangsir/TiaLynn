/**
 * 系统级 IPC：配置读写、模型扫描、灵魂加载、历史、缩略图、磁盘。
 * v0.13: TTS 已剥到 ipc/tts.ts (audit architecture HIGH god-file 拆分)
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { scanModels, toFileUrl } from '../services/model-scanner'
import { loadSoul } from '../services/soul-loader'
import { saveAvatar } from '../services/soul-saver'
import { loadConfig, saveConfig } from '../services/config-store'
import { getPaths } from '../services/paths'
import { appendTurn, clearAll, listRecent, type StoredTurn } from '../services/history-store'
import { startAttention, stopAttention } from '../services/attention'
import { computeDiskUsage, cleanPath } from '../services/disk-usage'
import type { RuntimeConfig, SoulConfig } from '@shared/types'

// v0.13: 跟踪 attention 是否已启动，避免重复 start / 误 stop
let attentionRunning = false
export function markAttentionRunning(v: boolean): void {
  attentionRunning = v
}

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
  // v0.12: 用系统默认浏览器打开外部链接
  ipcMain.handle('system:open-external', async (_evt, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid url' }
    await shell.openExternal(url)
    return { ok: true }
  })

  // v0.13: 磁盘占用统计 + 清理（H1 audit）
  ipcMain.handle('system:disk-usage', async (_evt, force?: boolean) => {
    return computeDiskUsage(!!force)
  })
  ipcMain.handle('system:clean-path', async (_evt, path: string) => {
    return cleanPath(path)
  })

  ipcMain.handle('config:load', () => loadConfig())

  ipcMain.handle('config:save', (_evt, dto: RuntimeConfig) => {
    const merged = saveConfig(dto)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('config:changed', merged)
    }
    // v0.13: LLM 配置状态变化时切换 attention loop
    const llmReady = !!(merged.llm_endpoint && merged.llm_model)
    if (llmReady && !attentionRunning) {
      startAttention(getWindow, { proactive_monitor_interval_ms: 45_000 })
      attentionRunning = true
      console.log('[attention] started (LLM 配置完成)')
    } else if (!llmReady && attentionRunning) {
      stopAttention()
      attentionRunning = false
      console.log('[attention] stopped (LLM 配置被清空)')
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

  ipcMain.handle('history:list-recent', (_evt, limit?: number) => listRecent(limit ?? 50))
  ipcMain.handle('history:append', (_evt, turn: Omit<StoredTurn, 'session_id'>) => {
    appendTurn(turn)
    return { ok: true }
  })
  ipcMain.handle('history:clear', () => ({ deleted: clearAll() }))

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

  // models:* (heal/dedup/describe/preferences/favorites/enrich) IPC 已剥到 ipc/models.ts
  // online:* IPC 已剥到 ipc/online.ts
  // thumbs:* IPC 已剥到 ipc/thumbs.ts
  // tts:* IPC 已剥到 ipc/tts.ts
  // (v0.13 audit architecture HIGH god-file 拆分)

  ipcMain.handle('soul:pick-directory', async () => {
    const win = getWindow() ?? undefined
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择模型目录',
      properties: ['openDirectory'],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  // tts:* IPC 已剥到 ipc/tts.ts (v0.13 audit architecture HIGH god-file 拆分)
}
