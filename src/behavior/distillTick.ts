/**
 * 自动记忆凝练：每隔一段时间调一次 memory_distill，把短期对话总结成长期记忆。
 * - 默认间隔 30 分钟
 * - 启动后等 5 分钟才第一次触发
 */
import { invoke } from '@tauri-apps/api/core'

let timer: number | null = null
let stopped = false

const INTERVAL_MS = 30 * 60 * 1000
const FIRST_DELAY_MS = 5 * 60 * 1000

async function tickOnce(): Promise<void> {
  try {
    const n = await invoke<number>('memory_distill', { lookBack: 40 })
    if (n > 0) {
      console.info(`[distill] auto: wrote ${n} long-term memories`)
    }
  } catch (e) {
    console.debug('[distill] tick skipped:', e)
  }
}

export function startDistillTick(): () => void {
  function schedule(): void {
    if (stopped) return
    timer = window.setTimeout(async () => {
      await tickOnce()
      schedule()
    }, INTERVAL_MS)
  }
  timer = window.setTimeout(async () => {
    await tickOnce()
    schedule()
  }, FIRST_DELAY_MS)
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}
