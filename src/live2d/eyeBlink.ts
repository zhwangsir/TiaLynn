/**
 * 程序化自动眨眼：定时把 ParamEyeLOpen / ParamEyeROpen 由 1 -> 0 -> 1。
 * 不依赖 model3.json 的 EyeBlink 组（胡桃模型的 Ids 是空的）。
 */
import type { TiaLynnRenderer } from './renderer'

export interface EyeBlinkOptions {
  minIntervalMs?: number // 最短间隔
  maxIntervalMs?: number // 最长间隔
  blinkDurationMs?: number // 单次眨眼时长
}

export function startEyeBlink(renderer: TiaLynnRenderer, opts: EyeBlinkOptions = {}): () => void {
  const min = opts.minIntervalMs ?? 2500
  const max = opts.maxIntervalMs ?? 5500
  const dur = opts.blinkDurationMs ?? 140

  let stopped = false
  let timer: number | null = null

  const blinkOnce = () => {
    const start = performance.now()
    const step = () => {
      if (stopped) return
      const t = (performance.now() - start) / dur
      if (t >= 1) {
        setLid(renderer, 1)
        scheduleNext()
        return
      }
      // 简化 V 形：前半段闭眼，后半段睁眼
      const lid = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2
      setLid(renderer, lid)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  const scheduleNext = () => {
    const wait = min + Math.random() * (max - min)
    timer = window.setTimeout(blinkOnce, wait)
  }

  scheduleNext()

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}

function setLid(renderer: TiaLynnRenderer, lid: number) {
  const r = renderer as unknown as {
    model: { internalModel: { coreModel: any } } | null
  }
  const core = r.model?.internalModel?.coreModel
  if (!core) return
  try {
    core.setParameterValueById('ParamEyeLOpen', lid)
    core.setParameterValueById('ParamEyeROpen', lid)
  } catch {
    /* ignore */
  }
}
