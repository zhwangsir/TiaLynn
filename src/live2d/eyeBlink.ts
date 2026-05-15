/**
 * 自动眨眼：定时把 ParamEyeLOpen/ParamEyeROpen 由 1 → 0 → 1。
 * 用 renderer.overrideParam，避免被合成层覆盖。
 *
 * 注意：scheduleNext 必须检查 stopped，否则旧 loop 在 stop 后还会重排。
 */
import type { TiaLynnRenderer } from './renderer'

export interface EyeBlinkOptions {
  minIntervalMs?: number
  maxIntervalMs?: number
  blinkDurationMs?: number
}

export function startEyeBlink(renderer: TiaLynnRenderer, opts: EyeBlinkOptions = {}): () => void {
  // 真实人眨眼平均 3-5s 一次。放慢到 3.5-7s 看着更自然。
  const min = opts.minIntervalMs ?? 3500
  const max = opts.maxIntervalMs ?? 7000
  const dur = opts.blinkDurationMs ?? 150

  let stopped = false
  let timer: number | null = null

  function blinkOnce(): void {
    if (stopped) return
    const start = performance.now()
    function step(): void {
      if (stopped) return
      const t = (performance.now() - start) / dur
      if (t >= 1) {
        scheduleNext()
        return
      }
      const lid = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2
      renderer.overrideParam('ParamEyeLOpen', lid, 30)
      renderer.overrideParam('ParamEyeROpen', lid, 30)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function scheduleNext(): void {
    if (stopped) return
    const wait = min + Math.random() * (max - min)
    timer = window.setTimeout(blinkOnce, wait)
  }

  scheduleNext()

  return () => {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}
