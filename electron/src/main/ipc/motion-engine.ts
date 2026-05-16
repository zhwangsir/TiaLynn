/**
 * MotionEngine IPC handlers.
 */
import { ipcMain } from 'electron'
import * as storage from '../services/motion-engine/storage'
import { syncModel } from '../services/motion-engine/sync'
import type { MotionEntry, MotionFilter, MotionVersion, SyncReport } from '@shared/motion-engine'

export function registerMotionEngineIpc(): void {
  // CRUD
  ipcMain.handle('engine:list', (_evt, filter?: MotionFilter): MotionEntry[] => storage.list(filter ?? {}))
  ipcMain.handle('engine:get', (_evt, id: number): MotionEntry | null => storage.get(id))
  ipcMain.handle('engine:create', (_evt, input: Parameters<typeof storage.create>[0]): MotionEntry =>
    storage.create(input),
  )
  ipcMain.handle(
    'engine:update',
    (_evt, payload: { id: number; patch: Partial<MotionEntry> }): MotionEntry =>
      storage.update(payload.id, payload.patch),
  )
  ipcMain.handle('engine:delete', (_evt, id: number): { ok: boolean } => {
    storage.deleteEntry(id)
    return { ok: true }
  })

  // 版本
  ipcMain.handle(
    'engine:save-version',
    (
      _evt,
      payload: { entry_id: number; snapshot_json: string; edited_by: string },
    ): MotionVersion => storage.saveVersion(payload.entry_id, payload.snapshot_json, payload.edited_by),
  )
  ipcMain.handle('engine:list-versions', (_evt, entryId: number): MotionVersion[] =>
    storage.listVersions(entryId),
  )
  ipcMain.handle(
    'engine:get-version',
    (_evt, payload: { entry_id: number; version_no: number }): MotionVersion | null =>
      storage.getVersion(payload.entry_id, payload.version_no),
  )

  // 行为
  ipcMain.handle('engine:record-play', (_evt, id: number): void => storage.recordPlay(id))
  ipcMain.handle(
    'engine:set-rating',
    (_evt, payload: { id: number; rating: -1 | 0 | 1 }): void =>
      storage.setRating(payload.id, payload.rating),
  )

  // 查询
  ipcMain.handle(
    'engine:by-emotion',
    (_evt, payload: { model_dir: string; emotion: string; limit?: number }): MotionEntry[] =>
      storage.findByEmotion(payload.model_dir, payload.emotion, payload.limit),
  )
  ipcMain.handle(
    'engine:by-context',
    (_evt, payload: { model_dir: string; context: string; limit?: number }): MotionEntry[] =>
      storage.findByContext(payload.model_dir, payload.context, payload.limit),
  )
  ipcMain.handle(
    'engine:top-rated',
    (_evt, payload: { model_dir: string; n?: number }): MotionEntry[] =>
      storage.topRated(payload.model_dir, payload.n),
  )

  // 同步
  ipcMain.handle('engine:sync', (_evt, modelDir: string): SyncReport => syncModel(modelDir))
}
