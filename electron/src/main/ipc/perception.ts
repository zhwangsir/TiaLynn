/**
 * Perception IPC — renderer 用来：
 *  1. 订阅感知事件（用于调试面板 / Live2D 视线响应）
 *  2. 读/改感知配置
 *  3. 取最近事件历史
 */
import { ipcMain } from 'electron'
import { getPerceptionConfig, updatePerceptionConfig, perception } from '../services/perception'
import type { PerceptionConfig, PerceptionEvent, PerceptionEventType } from '@shared/perception'

export function registerPerceptionIpc(): void {
  ipcMain.handle('perception:get-config', (): PerceptionConfig => getPerceptionConfig())
  ipcMain.handle(
    'perception:update-config',
    (_evt, patch: Partial<PerceptionConfig>): PerceptionConfig => updatePerceptionConfig(patch),
  )
  ipcMain.handle(
    'perception:recent',
    (
      _evt,
      payload: { limit?: number; types?: PerceptionEventType[] },
    ): PerceptionEvent[] => {
      const types = payload.types
      return perception
        .recent(
          payload.limit ?? 50,
          types && types.length > 0 ? (e) => types.includes(e.type) : undefined,
        )
        .map((e) => sanitizeForIpc(e))
    },
  )
}

function sanitizeForIpc(event: PerceptionEvent): PerceptionEvent {
  if (event.type === 'screen_snapshot' && event.image_b64) {
    return { ...event, image_b64: `<${event.image_b64.length} bytes>` as unknown as string }
  }
  return event
}
