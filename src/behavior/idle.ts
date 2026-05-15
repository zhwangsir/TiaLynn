/**
 * 自主 idle 行为：每 8-15s 随机触发一个小动作（轻歪头、看远方、撇嘴、深呼吸）。
 * 这些动作是叠加在视线跟随之上的"扰动"，提升活泼度。
 */
import type { TiaLynnRenderer } from '@/live2d/renderer'

type IdleAction = {
  name: string
  durationMs: number
  apply: (renderer: TiaLynnRenderer, t01: number) => void
}

const ACTIONS: IdleAction[] = [
  {
    name: 'tilt-left',
    durationMs: 1400,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamAngleZ', -8 * w, 0.8)
      driveParam(r, 'ParamBodyAngleZ', -4 * w, 0.8)
    },
  },
  {
    name: 'tilt-right',
    durationMs: 1400,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamAngleZ', 8 * w, 0.8)
      driveParam(r, 'ParamBodyAngleZ', 4 * w, 0.8)
    },
  },
  {
    name: 'look-up',
    durationMs: 1600,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamAngleY', 18 * w, 0.8)
      driveParam(r, 'ParamEyeBallY', w, 0.6)
    },
  },
  {
    name: 'look-down',
    durationMs: 1300,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamAngleY', -12 * w, 0.8)
      driveParam(r, 'ParamEyeBallY', -w, 0.6)
    },
  },
  {
    name: 'pout',
    durationMs: 900,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamMouthForm', -1 * w, 0.7)
      driveParam(r, 'ParamMouthOpenY', 0.2 * w, 0.5)
    },
  },
  {
    name: 'smile',
    durationMs: 1100,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamMouthForm', 1 * w, 0.8)
      driveParam(r, 'ParamCheek', 0.4 * w, 0.5)
    },
  },
  {
    name: 'blush',
    durationMs: 1800,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamCheek', 1 * w, 0.6)
      driveParam(r, 'ParamAngleZ', -3 * w, 0.4)
    },
  },
  {
    name: 'deep-breath',
    durationMs: 2400,
    apply: (r, t) => {
      const w = waveOnce(t)
      driveParam(r, 'ParamBreath', 0.5 + 0.5 * w, 1)
      driveParam(r, 'ParamBodyAngleY', 4 * w, 0.5)
    },
  },
]

function waveOnce(t: number): number {
  // sin 半周期：0 → 1 → 0，t∈[0,1]
  return Math.sin(t * Math.PI)
}

function driveParam(renderer: TiaLynnRenderer, id: string, value: number, weight: number): void {
  const core = (renderer as any).model?.internalModel?.coreModel
  if (!core) return
  try {
    core.addParameterValueById(id, value, weight)
  } catch {
    /* ignore */
  }
}

export function startIdleBehavior(
  renderer: TiaLynnRenderer,
  opts?: { minIntervalMs?: number; maxIntervalMs?: number },
): () => void {
  const min = opts?.minIntervalMs ?? 8000
  const max = opts?.maxIntervalMs ?? 15000
  let stopped = false
  let timer: number | null = null
  let activeRaf: number | null = null
  let lastAction: IdleAction | null = null

  function pick(): IdleAction {
    let pickFn = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]
    // 避免连续两次相同动作
    if (pickFn === lastAction && ACTIONS.length > 1) {
      pickFn = ACTIONS[(ACTIONS.indexOf(pickFn) + 1) % ACTIONS.length]
    }
    lastAction = pickFn
    return pickFn
  }

  function runOne(): void {
    if (stopped) return
    const action = pick()
    const start = performance.now()

    function step(): void {
      if (stopped) return
      const t = (performance.now() - start) / action.durationMs
      if (t >= 1) {
        activeRaf = null
        scheduleNext()
        return
      }
      action.apply(renderer, t)
      activeRaf = requestAnimationFrame(step)
    }
    activeRaf = requestAnimationFrame(step)
  }

  function scheduleNext(): void {
    if (stopped) return
    const wait = min + Math.random() * (max - min)
    timer = window.setTimeout(runOne, wait)
  }

  scheduleNext()

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    if (activeRaf !== null) cancelAnimationFrame(activeRaf)
  }
}
