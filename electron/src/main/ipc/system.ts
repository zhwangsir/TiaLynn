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
      startAttention(getWindow, { proactive_monitor_interval_ms: 60_000 })
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

  // v0.8.2: Model Auto-Heal — 给模型补基础 motion/expression + bind orphan
  ipcMain.handle('models:heal', async (_evt, payload: { model_json_path: string }) => {
    const { healModel } = await import('../services/model-healer')
    try {
      return healModel(payload.model_json_path)
    } catch (e) {
      return {
        ok: false,
        reason: `heal failed: ${String(e)}`,
        added: { motions: [], expressions: [], bound_orphans: { motions: [], expressions: [] } },
      }
    }
  })

  // v0.8.2: Model dedup — 找重复模型 + 一键删除冗余
  ipcMain.handle('models:find-duplicates', async () => {
    const { findDuplicates } = await import('../services/model-dedup')
    return findDuplicates()
  })
  ipcMain.handle(
    'models:apply-dedup',
    async (_evt, payload?: { group_keys?: string[]; dry_run?: boolean }) => {
      const { applyDedup } = await import('../services/model-dedup')
      return applyDedup(payload ?? {})
    },
  )
  // v0.8.2: 合并同组 — 把 exact group 内分散的 motion/expression 引用并入主 model3.json
  ipcMain.handle('models:merge-groups', async (_evt, payload?: { group_keys?: string[] }) => {
    const { mergeGroups } = await import('../services/model-dedup')
    return mergeGroups(payload ?? {})
  })
  // v0.8.2: AI 生成模型介绍（缓存）
  ipcMain.handle(
    'models:describe',
    async (_evt, payload: import('../services/model-describer').DescribePayload) => {
      const { describeModel } = await import('../services/model-describer')
      return describeModel(payload)
    },
  )
  ipcMain.handle('models:cached-descriptions', async () => {
    const { getCachedDescriptions } = await import('../services/model-describer')
    return getCachedDescriptions()
  })
  // v0.9: 模型个人偏好（scale / offset_y） — 按 character_id 持久化
  ipcMain.handle('models:get-preference', async (_evt, characterId: string) => {
    const { getPreference } = await import('../services/model-preferences')
    return getPreference(characterId)
  })
  ipcMain.handle(
    'models:set-preference',
    async (_evt, payload: { character_id: string; scale: number; offset_y: number }) => {
      const { setPreference } = await import('../services/model-preferences')
      setPreference(payload.character_id, { scale: payload.scale, offset_y: payload.offset_y })
      return { ok: true }
    },
  )

  // thumbs:* IPC 已剥到 ipc/thumbs.ts (v0.13 audit architecture HIGH)

  // v0.12: 收藏 + 最近使用
  ipcMain.handle('models:favorites', async () => {
    const { getAll } = await import('../services/model-favorites')
    return getAll()
  })
  ipcMain.handle('models:toggle-favorite', async (_evt, dir: string) => {
    const { toggleFavorite } = await import('../services/model-favorites')
    return toggleFavorite(dir)
  })
  ipcMain.handle('models:mark-recent', async (_evt, dir: string) => {
    const { markRecent } = await import('../services/model-favorites')
    markRecent(dir)
    return { ok: true }
  })
  ipcMain.handle('models:clear-recent', async () => {
    const { clearRecent } = await import('../services/model-favorites')
    clearRecent()
    return { ok: true }
  })

  // v0.12: character enrichment（LLM 一次性生成中文名+介绍）
  let enrichAbort: AbortController | null = null
  ipcMain.handle('models:enrich-cached', async () => {
    const { getAll } = await import('../services/character-enricher')
    return getAll()
  })
  ipcMain.handle('models:enrich-start', async (evt) => {
    if (enrichAbort) enrichAbort.abort()
    enrichAbort = new AbortController()
    const { enrichAll } = await import('../services/character-enricher')
    // 后台跑，不 block IPC return
    void enrichAll(
      (p) => {
        try {
          evt.sender.send('models:enrich-progress', p)
        } catch {
          /* renderer may be gone */
        }
      },
      enrichAbort.signal,
    ).catch((e) => {
      try {
        evt.sender.send('models:enrich-progress', { total: 0, done: 0, failed: 0, error: String(e) })
      } catch {
        /* skip */
      }
    })
    return { ok: true }
  })
  ipcMain.handle('models:enrich-abort', async () => {
    if (enrichAbort) {
      enrichAbort.abort()
      enrichAbort = null
    }
    return { ok: true }
  })
  ipcMain.handle('models:enrich-clear', async () => {
    const { clearAll } = await import('../services/character-enricher')
    clearAll()
    return { ok: true }
  })

  // v0.12: 在线资源商店
  const onlineInstallControllers = new Map<string, AbortController>()
  ipcMain.handle('online:list-recommended', async () => {
    const { RECOMMENDED_REPOS } = await import('../services/online-store')
    return RECOMMENDED_REPOS
  })
  ipcMain.handle(
    'online:list-assets',
    async (_evt, payload: { repo_id: string; sub_path?: string }) => {
      const { listRepoAssets } = await import('../services/online-store')
      return listRepoAssets(payload.repo_id, payload.sub_path)
    },
  )
  ipcMain.handle(
    'online:check-installed',
    async (_evt, payload: { kind: 'rvc' | 'live2d'; voice_id?: string; repo_slug?: string; asset_name?: string }) => {
      const { checkRvcInstalled, checkLive2dInstalled } = await import('../services/online-store')
      if (payload.kind === 'rvc' && payload.voice_id) {
        return { installed: await checkRvcInstalled(payload.voice_id) }
      }
      if (payload.kind === 'live2d' && payload.repo_slug && payload.asset_name) {
        return { installed: checkLive2dInstalled(payload.repo_slug, payload.asset_name) }
      }
      return { installed: false }
    },
  )
  ipcMain.handle(
    'online:install',
    async (
      evt,
      payload: { repo_id: string; asset_path: string; kind: 'rvc' | 'live2d' },
    ) => {
      const installId = `${payload.repo_id}/${payload.asset_path}`
      const old = onlineInstallControllers.get(installId)
      if (old) old.abort()
      const ctrl = new AbortController()
      onlineInstallControllers.set(installId, ctrl)
      const { installAsset } = await import('../services/online-store')
      void installAsset(
        payload.repo_id,
        payload.asset_path,
        payload.kind,
        (p) => {
          try {
            evt.sender.send('online:install-progress', { install_id: installId, ...p })
          } catch {
            /* renderer gone */
          }
        },
        ctrl.signal,
      )
        .then((r) => {
          try {
            evt.sender.send('online:install-done', { install_id: installId, ...r })
          } catch { /* skip */ }
        })
        .finally(() => onlineInstallControllers.delete(installId))
      return { ok: true, install_id: installId }
    },
  )
  ipcMain.handle('online:cancel-install', async (_evt, installId: string) => {
    const ctrl = onlineInstallControllers.get(installId)
    if (ctrl) {
      ctrl.abort()
      onlineInstallControllers.delete(installId)
    }
    return { ok: true }
  })
  ipcMain.handle(
    'online:install-custom',
    async (evt, payload: { url: string; kind: 'rvc' | 'live2d' }) => {
      const installId = `custom/${payload.url}`
      const old = onlineInstallControllers.get(installId)
      if (old) old.abort()
      const ctrl = new AbortController()
      onlineInstallControllers.set(installId, ctrl)
      const { installCustomZip } = await import('../services/online-store')
      void installCustomZip(payload.url, payload.kind, (p) => {
        try {
          evt.sender.send('online:install-progress', { install_id: installId, ...p })
        } catch { /* skip */ }
      }, ctrl.signal)
        .then((r) => {
          try {
            evt.sender.send('online:install-done', { install_id: installId, ...r })
          } catch { /* skip */ }
        })
        .finally(() => onlineInstallControllers.delete(installId))
      return { ok: true, install_id: installId }
    },
  )

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
