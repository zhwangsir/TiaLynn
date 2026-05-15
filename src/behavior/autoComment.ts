/**
 * 自主评论：按灵魂 yaml 的 behavior.auto_comment_interval_sec 周期触发，
 * 让 TiaLynn 主动说一句话（早安 / 想你 / 你在干嘛之类）。
 *
 * 实现路径：
 *  1. 计时到点 → 选一个 "context prompt" → invoke chat_send（特殊 marker）
 *  2. 后端按正常对话流程处理，LLM 看到 marker 会生成主动一句话
 *
 * 为了简化，v0.1 直接前端模拟 user 角度发一个隐式 prompt：
 *  "[系统：主动开口] 请你按当前时段（早/中/晚/深夜）和心情，主动跟我说一句话。"
 */
import { useDialogStore } from '@/stores/dialog'
import { useSoulStore } from '@/stores/soul'

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
  const soul = useSoulStore()
  const intervalSec = soul.config?.behavior?.auto_comment_interval_sec ?? 300
  // 加随机抖动 ±25%，避免每次时间精确一致
  const baseMs = intervalSec * 1000
  const jitter = baseMs * 0.25

  function schedule(): void {
    if (stopped) return
    const wait = baseMs - jitter + Math.random() * jitter * 2
    timer = window.setTimeout(() => {
      tickOnce()
      schedule()
    }, wait)
  }

  // 启动后等一段时间再首次触发（不要 app 一开就主动说话）
  timer = window.setTimeout(() => {
    schedule()
  }, Math.max(60_000, baseMs / 2))

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}
