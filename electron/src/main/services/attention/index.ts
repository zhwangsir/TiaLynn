/**
 * 主体性循环主控 — 启动 Scheduler + Planner + 把 Plan 推给 renderer 执行。
 */
import type { BrowserWindow } from 'electron'
import type { AttentionConfig, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import { scheduler } from './scheduler'
// v0.21 Round H:用 getPlanner() factory 替代 module-level singleton。
// 当前不传 characterId 用 default(等价旧 singleton)。
// M8 多灵魂时 onTrigger 接到 decision.target_character_id 后 getPlanner(id) 切换。
// reviewer H-HIGH-1:删除 `planner` 死 reexport(无人消费 + 触发 planner module 顶层副作用)
import { getPlanner } from '../planner'
// v0.21 Round K:M8 后端最后一步 — onTrigger 真用 active character 作 planner target
import { getActiveCharacterId } from '../character-store'
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
      // v0.21 Round H + I + K:getPlanner factory + target_character_id 真接通。
      //
      // Round K:scheduler 不主动设 target_character_id 时,fallback 到当前 active
      // character。意义:character 切换时 planner 实例自动切换(独立 budget / state),
      // 旧 active 的 planner 留 Map cache 等下次再切回时复用(O(N) characters)。
      //
      // M8 GUI 真做时 scheduler 会主动设 target_character_id(从 mounted 中选),
      // 这里 fallback active 自然失效。架构师建议的 5 行版本。
      const targetId =
        decision.target_character_id ?? (getActiveCharacterId() ?? undefined)
      const plan = await getPlanner(targetId).plan(decision)
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
// reviewer H-HIGH-1:planner reexport 死链(grep 确认无外部消费者),移除
export { scheduler }

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
