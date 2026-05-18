/**
 * 模型相关 IPC handlers (heal / dedup / describe / preferences / favorites / enrich)。
 * v0.13: 从 ipc/system.ts 剥离 (audit architecture HIGH god-file 拆分)。
 *
 * 注意：models:scan 仍留在 system.ts 因为它是 bootstrap 必经路径，
 * 跟 config / soul 在同一启动时机被调。
 */
import { ipcMain } from 'electron'

export function registerModelsIpc(): void {
  // v0.15 E1: Live2D 模型行业标准学习数据库
  ipcMain.handle('models:compute-learnings', async (_evt, force?: boolean) => {
    const { computeLearnings } = await import('../services/model-learnings')
    return computeLearnings(!!force)
  })
  ipcMain.handle('models:get-learnings', async () => {
    const { loadLearnings } = await import('../services/model-learnings')
    return loadLearnings()
  })
  ipcMain.handle('models:evaluate', async (_evt, payload: { model_json_path: string }) => {
    const { evaluateModel, loadLearnings } = await import('../services/model-learnings')
    return evaluateModel(payload.model_json_path, loadLearnings())
  })
  ipcMain.handle('models:auto-fill', async (_evt, payload: { model_json_path: string; skip_expressions?: boolean }) => {
    const { fillMissingForModel } = await import('../services/model-auto-fill')
    return fillMissingForModel(payload.model_json_path, { skip_expressions: !!payload.skip_expressions })
  })
  // v0.16 T2: 一键 8 标准 expression
  ipcMain.handle('models:apply-expression-pack', async (_evt, payload: { model_json_path: string }) => {
    const { applyStandardExpressionPack } = await import('../services/expression-pack')
    const { dirname } = await import('node:path')
    return applyStandardExpressionPack(dirname(payload.model_json_path))
  })
  // v0.16 T3: 物理预设
  ipcMain.handle('models:list-physics-presets', async () => {
    const { listPhysicsPresets } = await import('../services/physics-presets')
    return listPhysicsPresets()
  })
  ipcMain.handle('models:apply-physics-preset', async (_evt, payload: { model_json_path: string; preset_id: string }) => {
    const { applyPhysicsPreset } = await import('../services/physics-presets')
    const { dirname } = await import('node:path')
    return applyPhysicsPreset(dirname(payload.model_json_path), payload.preset_id as Parameters<typeof applyPhysicsPreset>[1])
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

  // v0.8.2: Model dedup
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
}
