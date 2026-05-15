/**
 * 自动眨眼：定时把 ParamEyeLOpen/ParamEyeROpen 由 1 → 0 → 1。
 * 用 renderer.overrideParam，避免被合成层覆盖。
 */
import type { TiaLynnRenderer } from './renderer'

export interface EyeBlinkOptions {
  minIntervalMs?: number
  maxIntervalMs?: number
  blinkDurationMs?: number
}

export function startEyeBlink(renderer: TiaLynnRenderer, opts: EyeBlinkOptions = {}): () => void {
  const min = opts.minIntervalMs ?? 2500
  const max = opts.maxIntervalMs ?? 5500
  const dur = opts.blinkDurationMs ?? 140

  let stopped = false
  let timer: number | null = null

  function blinkOnce(): void {
    const start = performance.now()
    function step(): void {
      if (stopped) return
      const t = (performance.now() - start) / dur
      if (t >= 1) {
        // 完结：让 override 自然过期
        scheduleNext()
        return
      }
      const lid = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2
      // 25ms 窗口确保下一帧合成时仍生效
      renderer.overrideParam('ParamEyeLOpen', lid, 25)
      renderer.overrideParam('ParamEyeROpen', lid, 25)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function scheduleNext(): void {
    const wait = min + Math.random() * (max - min)
    timer = window.setTimeout(blinkOnce, wait)
  }

  scheduleNext()

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}
