/**
 * Attention/Planner IPC handlers.
 */
import { ipcMain } from 'electron'
import {
  attentionSnapshot,
  getAttentionConfig,
  recentPlans,
  updateAttentionConfig,
} from '../services/attention'
import type { AttentionConfig, AttentionSnapshot, BehaviorPlan } from '@shared/attention'

export function registerAttentionIpc(): void {
  ipcMain.handle('attention:get-config', (): AttentionConfig => getAttentionConfig())
  ipcMain.handle(
    'attention:update-config',
    (_evt, patch: Partial<AttentionConfig>): AttentionConfig => updateAttentionConfig(patch),
  )
  ipcMain.handle('attention:snapshot', (): AttentionSnapshot => attentionSnapshot())
  ipcMain.handle('attention:recent-plans', (_evt, limit?: number): BehaviorPlan[] =>
    recentPlans(limit),
  )
}
