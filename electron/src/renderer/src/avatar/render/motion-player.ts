/**
 * 在已加载的 Live2D 模型上播放 MotionDraft（不写入磁盘，直接 runtime 播）。
 *
 * 实现：手写小型动画器，逐帧 setParameterValueById，
 * 比 pixi-live2d-display.motion() 灵活（不需要先 reload 模型）。
 */
import type { MotionDraft } from '@shared/motion'
import type { Live2DRenderer } from './live2d-renderer'

export interface PlayHandle {
  stop(): void
  ended: Promise<void>
}

export function playDraft(renderer: Live2DRenderer, draft: MotionDraft): PlayHandle {
  const start = performance.now()
  let stopped = false
  let raf = 0
  let resolveEnded: () => void = () => undefined
  const ended = new Promise<void>((r) => (resolveEnded = r))
  const duration = draft.duration

  function applyAt(timeSec: number): void {
    for (const track of draft.tracks) {
      const v = sample(track.keyframes, timeSec)
      if (v != null) renderer.applyParam(track.param, v)
    }
  }

  function tick(): void {
    if (stopped) return
    const elapsed = (performance.now() - start) / 1000
    const t = draft.loop ? elapsed % duration : Math.min(elapsed, duration)
    applyAt(t)
    if (!draft.loop && elapsed >= duration) {
      stopped = true
      resolveEnded()
      return
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      resolveEnded()
    },
    ended,
  }
}

/** 线性插值采样 */
function sample(kf: Array<[number, number]>, t: number): number | null {
  if (kf.length === 0) return null
  if (t <= kf[0][0]) return kf[0][1]
  if (t >= kf[kf.length - 1][0]) return kf[kf.length - 1][1]
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i][0]) {
      const [t0, v0] = kf[i - 1]
      const [t1, v1] = kf[i]
      const dt = t1 - t0
      if (dt <= 0) return v1
      return v0 + (v1 - v0) * ((t - t0) / dt)
    }
  }
  return kf[kf.length - 1][1]
}
