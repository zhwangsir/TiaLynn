/**
 * TriggerEngine IPC handlers.
 */
import { ipcMain } from 'electron'
import * as engine from '../services/trigger-engine/engine'
import type { TriggerDecision, TriggerEvent, TriggerRule } from '@shared/trigger'

export function registerTriggerIpc(): void {
  ipcMain.handle(
    'trigger:decide',
    (
      _evt,
      payload: { event: TriggerEvent; model_dir?: string; ignore_cooldown?: boolean },
    ): TriggerDecision | null =>
      engine.decide(payload.event, {
        ...(payload.model_dir !== undefined && { model_dir: payload.model_dir }),
        ...(payload.ignore_cooldown !== undefined && { ignore_cooldown: payload.ignore_cooldown }),
      }),
  )
  ipcMain.handle('trigger:list-rules', (): TriggerRule[] => engine.loadRules())
  ipcMain.handle('trigger:save-rules', (_evt, rules: TriggerRule[]): TriggerRule[] => {
    engine.saveRules(rules)
    return engine.loadRules()
  })
  ipcMain.handle('trigger:reset-defaults', (): TriggerRule[] => engine.resetToDefaults())
  ipcMain.handle('trigger:reset-cooldowns', (): { ok: boolean } => {
    engine.resetCooldowns()
    return { ok: true }
  })
}
