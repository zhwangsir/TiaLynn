/**
 * 系统级 IPC：配置读写、模型扫描、灵魂加载、TTS sidecar 转发。
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanModels, toFileUrl } from '../services/model-scanner'

const execFileAsync = promisify(execFile)

/**
 * macOS `say` fallback：把文本合成为 WAV PCM 并返回 base64。
 * 用于 sidecar 不可用时保底，让 TiaLynn 能开口说话。
 */
/**
 * 去掉 LLM 输出常见的「情感括号前缀」— 这些应当用 emotion 字段+语气表达，
 * 不应被 TTS 念出来。
 *   匹配：（害羞）、(shy)、【撒娇地】、[note]、*tease*、~小声~
 *   保守：只删开头连续的标注块，正文里的括号不动
 */
function stripEmotionPrefix(text: string): string {
  let s = text.trim()
  // 循环最多 3 次去掉嵌套/多重前缀（如「（撒娇地）（小声）主人...」）
  for (let i = 0; i < 3; i++) {
    const m = s.match(
      /^(?:[（(【\[][^）)】\]\n]{1,30}[）)】\]]|[*~_][^*~_\n]{1,30}[*~_])\s*[，,、。\.\s]*/,
    )
    if (!m || m[0].length === 0) break
    s = s.slice(m[0].length)
  }
  return s.trim()
}

async function macSayToWav(text: string): Promise<
  { ok: true; audio_b64: string; mime: string } | { ok: false; reason: string }
> {
  if (!text.trim()) return { ok: false, reason: 'empty-text' }
  // 选系统中文音色（macOS 26 一般有 Tingting / Sinji）
  const voice = 'Tingting'
  const outFile = join(tmpdir(), `tialynn-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
  const t0 = Date.now()
  try {
    await execFileAsync(
      'say',
      ['-v', voice, '-o', outFile, '--data-format=LEI16@22050', text],
      { timeout: 30_000 },
    )
    const buf = await readFile(outFile)
    console.log(
      `[tts] macSay ok len=${text.length} wav=${(buf.length / 1024).toFixed(1)}KB dt=${Date.now() - t0}ms`,
    )
    return { ok: true, audio_b64: buf.toString('base64'), mime: 'audio/wav' }
  } catch (e) {
    console.error(`[tts] macSay FAILED: ${String(e).slice(0, 200)}`)
    return { ok: false, reason: `macSay: ${String(e).slice(0, 120)}` }
  } finally {
    await unlink(outFile).catch(() => {})
  }
}
import { loadSoul } from '../services/soul-loader'
import { saveAvatar } from '../services/soul-saver'
import { loadConfig, saveConfig } from '../services/config-store'
import { getPaths } from '../services/paths'
import { appendTurn, clearAll, listRecent, type StoredTurn } from '../services/history-store'
import { startAttention, stopAttention } from '../services/attention'
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

  // v0.10: 模型缩略图缓存 — renderer worker pool 渲染完 webp 通过 IPC 写盘
  ipcMain.handle('thumbs:get', async (_evt, characterId: string) => {
    const { getThumb } = await import('../services/thumb-store')
    return getThumb(characterId)
  })
  ipcMain.handle(
    'thumbs:save',
    async (_evt, payload: { character_id: string; webp_base64: string }) => {
      const { saveThumb } = await import('../services/thumb-store')
      return saveThumb(payload.character_id, payload.webp_base64)
    },
  )
  ipcMain.handle(
    'thumbs:mark-failed',
    async (_evt, payload: { character_id: string; reason: string }) => {
      const { markFailed } = await import('../services/thumb-store')
      markFailed(payload.character_id, payload.reason)
      return { ok: true }
    },
  )
  ipcMain.handle('thumbs:list-missing', async (_evt, characterIds: string[]) => {
    const { listMissing } = await import('../services/thumb-store')
    return listMissing(characterIds)
  })
  ipcMain.handle('thumbs:clear-all', async () => {
    const { clearAll } = await import('../services/thumb-store')
    return clearAll()
  })

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

  ipcMain.handle(
    'tts:speak',
    async (_evt, payload: { text: string; voice?: string; emotion?: string }) => {
      const cfg = loadConfig()
      const emotion = payload.emotion ?? 'neutral'
      const voiceId = payload.voice ?? cfg.emotion_voice_map[emotion] ?? 'clone_base'
      // v0.8.2: 去掉 LLM 输出常见的「（害羞）」「(shy)」等情感括号前缀
      const cleanText = stripEmotionPrefix(payload.text)
      if (!cleanText) return { ok: false, reason: 'empty-text-after-strip' }
      const ttsPayloadText = cleanText
      // v0.8.2: 支持 string | string[]，按顺序尝试，第一个成功的为准
      if (cfg.tts_provider === 'sidecar' && cfg.tts_sidecar_url) {
        const urls = Array.isArray(cfg.tts_sidecar_url)
          ? cfg.tts_sidecar_url.filter((u) => u && u.trim())
          : cfg.tts_sidecar_url
            ? [cfg.tts_sidecar_url]
            : []
        for (let i = 0; i < urls.length; i++) {
          const baseUrl = urls[i]!
          // 所有 sidecar 都用 voice clone（mac 和 workstation 都装了 F5-TTS）
          const tryVoice = voiceId
          try {
            const url = `${baseUrl.replace(/\/+$/, '')}/v1/audio/speech`
            const t0 = Date.now()
            // v0.9: 如果配了 RVC voice + 这个 sidecar 是 workstation（默认 ws sidecar 是 url[0]）→ 透传 rvc_* 参数
            // 简单判断：用 rvc_voice 不为空就传（sidecar 自己处理是否能用 RVC）
            const body: Record<string, unknown> = {
              text: ttsPayloadText,
              voice: tryVoice,
              emotion,
            }
            if (cfg.rvc_voice && cfg.rvc_voice.trim()) {
              body.rvc_voice = cfg.rvc_voice.trim()
              body.rvc_f0_up_key = cfg.rvc_f0_up_key ?? 0
              body.rvc_index_rate = cfg.rvc_index_rate ?? 0.75
              body.rvc_f0_method = cfg.rvc_f0_method ?? 'rmvpe'
              // v0.11: RVC 高级参数
              body.rvc_protect = cfg.rvc_protect ?? 0.33
              body.rvc_filter_radius = cfg.rvc_filter_radius ?? 3
              body.rvc_rms_mix_rate = cfg.rvc_rms_mix_rate ?? 1.0
              body.rvc_resample_sr = cfg.rvc_resample_sr ?? 0
            }
            // v0.11: 底座 TTS 语速/音量/音调
            if (cfg.tts_rate) body.rate = cfg.tts_rate
            if (cfg.tts_volume) body.volume = cfg.tts_volume
            if (cfg.tts_pitch) body.pitch = cfg.tts_pitch
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120_000),
            })
            if (r.ok) {
              const buf = await r.arrayBuffer()
              const mime = r.headers.get('content-type') || 'audio/wav'
              console.log(
                `[tts] sidecar ok ${baseUrl} voice=${tryVoice} emotion=${emotion} bytes=${(buf.byteLength / 1024).toFixed(1)}KB dt=${Date.now() - t0}ms`,
              )
              return { ok: true, audio_b64: Buffer.from(buf).toString('base64'), mime }
            }
            const errText = await r.text().catch(() => '')
            console.warn(`[tts] sidecar ${baseUrl} HTTP ${r.status} ${errText.slice(0, 100)}，try next`)
          } catch (e) {
            console.warn(`[tts] sidecar ${baseUrl} unreachable，try next:`, String(e).slice(0, 80))
          }
        }
        console.warn('[tts] 所有 sidecar 都失败，fallback macOS say')
      }
      // macOS 系统 say 兜底
      if (process.platform === 'darwin') {
        return await macSayToWav(cleanText)
      }
      return { ok: false, reason: 'no-tts-backend' }
    },
  )

  // v0.9: 列 workstation 上 RVC 已训练的音色（让设置 UI 提供下拉选项）
  ipcMain.handle('tts:list-rvc-voices', async () => {
    const cfg = loadConfig()
    if (!cfg.tts_sidecar_url) return { ok: false, voices: [], reason: 'no-sidecar' }
    const urls = Array.isArray(cfg.tts_sidecar_url) ? cfg.tts_sidecar_url : [cfg.tts_sidecar_url]
    for (const u of urls) {
      try {
        const r = await fetch(`${u.replace(/\/+$/, '')}/v1/rvc/voices`, {
          signal: AbortSignal.timeout(8000),
        })
        if (!r.ok) continue
        const data = (await r.json()) as { available?: boolean; voices?: string[]; reason?: string }
        if (data.available) {
          return { ok: true, voices: data.voices ?? [], sidecar: u }
        }
        return { ok: false, voices: [], reason: data.reason ?? 'rvc-unavailable', sidecar: u }
      } catch {
        /* try next */
      }
    }
    return { ok: false, voices: [], reason: 'all-sidecars-unreachable' }
  })

  ipcMain.handle('tts:probe', async () => {
    const cfg = loadConfig()
    if (!cfg.tts_sidecar_url) return { ok: false, reason: 'no-url' }
    // tts_sidecar_url 是 string | string[]（用户可配多个 backend），probe 第一个可达的
    const urls = Array.isArray(cfg.tts_sidecar_url) ? cfg.tts_sidecar_url : [cfg.tts_sidecar_url]
    for (const u of urls) {
      try {
        // v0.8.2: sidecar 健康接口是 /healthz（不是 /health）
        const r = await fetch(`${u.replace(/\/+$/, '')}/healthz`, {
          signal: AbortSignal.timeout(3000),
        })
        if (r.ok) return { ok: true, status: r.status, url: u }
      } catch {
        // 试下一个
      }
    }
    return { ok: false, reason: 'all-backends-unreachable' }
  })
}
