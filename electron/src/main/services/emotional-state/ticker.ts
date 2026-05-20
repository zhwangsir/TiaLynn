/**
 * 周期性 onTick (Phase 1 J P3 接通) — 不靠对话也让情感自然演化。
 *
 * 默认每 5 分钟跑一次:
 *   - mood_intensity 自然衰减
 *   - missing_intensity 按 sinceChat 增长
 *   - 衰减到阈值 → 自动切回 baseline / 升到 missing
 *
 * 跟 attention loop 解耦 — attention 关停时本 ticker 仍跑（情感是 always-on）。
 */
import { getActiveCharacter } from '../character-store'
import { onTick } from './store'

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

export function startEmotionalTicker(intervalMs: number = DEFAULT_TICK_INTERVAL_MS): void {
  if (timer) return
  timer = setInterval(() => {
    try {
      const active = getActiveCharacter()
      if (!active) return
      const next = onTick(active.id)
      // 只在 mood 真切换时输出 — tick 静默运行避免日志洗版
      const lastChange = next.mood_history.at(-1)
      if (lastChange && lastChange.ts > Date.now() - intervalMs - 1000) {
        console.log(
          `[emotional] ${active.id}: mood→${next.current_mood} ` +
            `intensity=${next.mood_intensity.toFixed(2)} ` +
            `missing=${next.missing_intensity.toFixed(2)} (trigger: ${lastChange.trigger})`,
        )
      }
    } catch (e) {
      console.warn('[emotional] tick failed:', e)
    }
  }, intervalMs)
  console.log(`[emotional] ticker started (every ${intervalMs / 1000}s)`)
}

export function stopEmotionalTicker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function isEmotionalTickerRunning(): boolean {
  return timer !== null
}
