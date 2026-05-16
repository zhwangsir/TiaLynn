/**
 * 主体性循环主控 — 启动 Scheduler + Planner + 把 Plan 推给 renderer 执行。
 */
import type { BrowserWindow } from 'electron'
import type { AttentionConfig, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import { scheduler } from './scheduler'
import { planner } from '../planner'

let getWindow: (() => BrowserWindow | null) | null = null

export function startAttention(
  winGetter: () => BrowserWindow | null,
  initialConfig: Partial<AttentionConfig> = {},
): void {
  getWindow = winGetter
  scheduler.updateConfig(initialConfig)
  scheduler.onTrigger(async (decision: SchedulerDecision) => {
    try {
      const plan = await planner.plan(decision)
      scheduler.markActionTaken()
      const win = getWindow?.()
      if (win && !win.isDestroyed()) {
        win.webContents.send('attention:plan', plan)
      }
    } catch (e) {
      console.warn('[attention] planner failed:', e)
    }
  })
  scheduler.start()
}

export function stopAttention(): void {
  scheduler.stop()
}

export function updateAttentionConfig(patch: Partial<AttentionConfig>): AttentionConfig {
  return scheduler.updateConfig(patch)
}

export function getAttentionConfig(): AttentionConfig {
  return scheduler.getConfig()
}

export function attentionSnapshot(): import('@shared/attention').AttentionSnapshot {
  return scheduler.snapshot()
}

/** Renderer 主动获取/订阅时用 */
export { scheduler, planner }

/** 用于诊断：拿最近 N 个 plan（主进程内存） */
const planHistory: BehaviorPlan[] = []
const PLAN_HISTORY_LIMIT = 30

scheduler.onTrigger(async (_decision) => {
  // 这个 listener 只用来记录历史（实际执行在上面那个）
  // noop here — 实际记录在 startAttention 的 callback 中
  void _decision
})

export function recordPlan(plan: BehaviorPlan): void {
  planHistory.push(plan)
  if (planHistory.length > PLAN_HISTORY_LIMIT) planHistory.splice(0, planHistory.length - PLAN_HISTORY_LIMIT)
}

export function recentPlans(limit = 10): BehaviorPlan[] {
  return planHistory.slice(-limit).reverse()
}
