/**
 * 主体性循环主控 — 启动 Scheduler + Planner + 把 Plan 推给 renderer 执行。
 */
import type { BrowserWindow } from 'electron'
import type { AttentionConfig, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import { scheduler } from './scheduler'
// v0.21 Round H:用 getPlanner() factory 替代 module-level singleton。
// 当前不传 characterId 用 default(等价旧 singleton)。
// M8 多灵魂时 onTrigger 接到 decision.target_character_id 后 getPlanner(id) 切换。
import { getPlanner, planner } from '../planner'
import { triggerScreenSnapshot } from '../perception'

let getWindow: (() => BrowserWindow | null) | null = null

export function startAttention(
  winGetter: () => BrowserWindow | null,
  initialConfig: Partial<AttentionConfig> = {},
): void {
  getWindow = winGetter
  scheduler.updateConfig(initialConfig)
  scheduler.onTrigger(async (decision: SchedulerDecision) => {
    try {
      console.log(`[attention] trigger: ${decision.reason}`)
      // v0.8.2: proactive trigger 时先抓一张屏给 planner 看
      if (decision.reason.startsWith('proactive_monitor')) {
        await triggerScreenSnapshot('user_request').catch(() => {
          /* vision 失败不阻塞 planner */
        })
      }
      // v0.21 Round H:用 getPlanner() 替 module singleton。
      // 当前所有 trigger 走 default planner(同旧行为);M8 多灵魂时改 getPlanner(decision.target_character_id)
      const plan = await getPlanner().plan(decision)
      console.log(
        `[attention] plan reason="${plan.reasoning ?? ''}" actions=${plan.actions.map((a) => a.type).join(',')}`,
      )
      scheduler.markActionTaken()
      recordPlan(plan)
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

export function recordPlan(plan: BehaviorPlan): void {
  planHistory.push(plan)
  if (planHistory.length > PLAN_HISTORY_LIMIT) planHistory.splice(0, planHistory.length - PLAN_HISTORY_LIMIT)
}

export function recentPlans(limit = 10): BehaviorPlan[] {
  return planHistory.slice(-limit).reverse()
}
