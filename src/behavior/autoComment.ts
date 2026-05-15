/**
 * 自主评论：按 RuntimeConfig.autocomment_interval_sec 周期触发。
 * 当 config 变化时自动重启 schedule。
 */
import { watch } from 'vue'
import { useDialogStore } from '@/stores/dialog'
import { useConfigStore } from '@/stores/config'

let timer: number | null = null
let stopped = false

function timeOfDayHint(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return '早晨'
  if (h >= 11 && h < 14) return '正午'
  if (h >= 14 && h < 18) return '午后'
  if (h >= 18 && h < 22) return '傍晚到夜里'
  return '深夜'
}

function buildPrompt(): string {
  const tod = timeOfDayHint()
  return `[系统：你现在主动开口跟 master 说一句话。当前时段：${tod}。要自然，符合你"病娇黏人但表面俏皮"的人格，长度 1-2 句话即可。不要重复以前说过的开场。]`
}

function tickOnce(): void {
  if (stopped) return
  const dialog = useDialogStore()
  if (dialog.streaming) return
  dialog.sendProactive(buildPrompt()).catch((e: unknown) => {
    console.warn('[autoComment] sendProactive failed:', e)
  })
}

export function startAutoComment(): () => void {
  const config = useConfigStore()

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function intervalSec(): number {
    return config.config?.autocomment_interval_sec ?? 300
  }

  function schedule(): void {
    if (stopped) return
    const baseMs = intervalSec() * 1000
    const jitter = baseMs * 0.25
    const wait = baseMs - jitter + Math.random() * jitter * 2
    timer = window.setTimeout(() => {
      tickOnce()
      schedule()
    }, wait)
  }

  // 启动后等一段时间再首次触发（不要 app 一开就主动说话）
  timer = window.setTimeout(() => {
    schedule()
  }, Math.max(60_000, (intervalSec() * 1000) / 2))

  // 配置变化时重排
  const stopWatch = watch(
    () => config.config?.autocomment_interval_sec,
    () => {
      clearTimer()
      schedule()
    },
  )

  return () => {
    stopped = true
    clearTimer()
    stopWatch()
  }
}
