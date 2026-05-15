/**
 * 自主 idle 行为：每 N 秒触发一个动作。
 * 不再直接 set Live2D 参数，而是把"偏移"写入 renderer.setIdleOffset，
 * 由 renderer 在每帧合成中加到 focus + emotion 之上。
 */
import type { TiaLynnRenderer } from '@/live2d/renderer'

type IdleAction = {
  name: string
  durationMs: number
  /** 影响的 param id 列表（结束时这些 offset 会被清空） */
  params: string[]
  /** 计算 t∈[0,1] 时刻每个 param 的偏移 */
  compute: (t: number) => Record<string, number>
}

function waveOnce(t: number): number {
  return Math.sin(t * Math.PI)
}

const ACTIONS: IdleAction[] = [
  {
    name: 'tilt-left',
    durationMs: 1400,
    params: ['ParamAngleZ', 'ParamBodyAngleZ'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamAngleZ: -8 * w, ParamBodyAngleZ: -4 * w }
    },
  },
  {
    name: 'tilt-right',
    durationMs: 1400,
    params: ['ParamAngleZ', 'ParamBodyAngleZ'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamAngleZ: 8 * w, ParamBodyAngleZ: 4 * w }
    },
  },
  {
    name: 'look-up',
    durationMs: 1600,
    params: ['ParamAngleY', 'ParamEyeBallY'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamAngleY: 12 * w, ParamEyeBallY: 0.8 * w }
    },
  },
  {
    name: 'look-down',
    durationMs: 1300,
    params: ['ParamAngleY', 'ParamEyeBallY'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamAngleY: -10 * w, ParamEyeBallY: -0.8 * w }
    },
  },
  {
    name: 'pout',
    durationMs: 900,
    params: ['ParamMouthForm', 'ParamMouthOpenY'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamMouthForm: -0.8 * w, ParamMouthOpenY: 0.15 * w }
    },
  },
  {
    name: 'smile',
    durationMs: 1100,
    params: ['ParamMouthForm', 'ParamCheek'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamMouthForm: 0.8 * w, ParamCheek: 0.35 * w }
    },
  },
  {
    name: 'blush',
    durationMs: 1800,
    params: ['ParamCheek', 'ParamAngleZ'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamCheek: 0.8 * w, ParamAngleZ: -3 * w }
    },
  },
  {
    name: 'deep-breath',
    durationMs: 2400,
    params: ['ParamBodyAngleY'],
    compute: (t) => {
      const w = waveOnce(t)
      return { ParamBodyAngleY: 5 * w }
    },
  },
]

export function startIdleBehavior(
  renderer: TiaLynnRenderer,
  opts?: { minIntervalMs?: number; maxIntervalMs?: number },
): () => void {
  let min = opts?.minIntervalMs ?? 8000
  let max = opts?.maxIntervalMs ?? 15000
  if (max < min) max = min + 1000

  let stopped = false
  let timer: number | null = null
  let activeRaf: number | null = null
  let lastAction: IdleAction | null = null

  function pick(): IdleAction {
    let pickFn = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]
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
        // 收尾：清掉此动作影响的 offset
        for (const p of action.params) renderer.setIdleOffset(p, 0)
        activeRaf = null
        scheduleNext()
        return
      }
      const contributions = action.compute(t)
      for (const [param, value] of Object.entries(contributions)) {
        renderer.setIdleOffset(param, value)
      }
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
    renderer.clearIdleOffsets()
  }
}
