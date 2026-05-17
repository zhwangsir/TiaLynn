/**
 * Thumbs IPC handlers — Live2D 模型缩略图缓存。
 * v0.13: 从 ipc/system.ts 剥离（audit architecture HIGH god-file 拆分）。
 *
 * Renderer 后台 worker pool off-screen 渲染每个模型 → webp →
 * 通过 IPC 写盘到 ~/.tialynn/thumbs/<character_id>.webp。
 * UI 卡片直接 file:// 读。
 */
import { ipcMain } from 'electron'

export function registerThumbsIpc(): void {
  ipcMain.handle('thumbs:get', async (_evt, characterId: string) => {
    const { getThumb } = await import('../services/thumb-store')
    return getThumb(characterId)
  })

  // v0.13 (audit performance ROI 2): 批量查询，消除 N+1 IPC 风暴
  ipcMain.handle('thumbs:get-batch', async (_evt, characterIds: string[]) => {
    const { getThumbBatch } = await import('../services/thumb-store')
    return getThumbBatch(characterIds)
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
}
