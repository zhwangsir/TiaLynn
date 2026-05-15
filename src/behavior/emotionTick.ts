/**
 * 情绪衰减 tick：每 30s tick 一次，按 RuntimeConfig.emotion_decay_per_minute 衰减。
 * 配置变化时自动重启间隔（实际衰减率每次 tick 重新读 store）。
 */
import { useEmotionStore } from '@/stores/emotion'
import { useSoulStore } from '@/stores/soul'
import { useConfigStore } from '@/stores/config'

let interval: number | null = null

export function startEmotionTick(): () => void {
  const emotion = useEmotionStore()
  const soul = useSoulStore()
  const config = useConfigStore()

  function tick(): void {
    const decay =
      config.config?.emotion_decay_per_minute ??
      soul.config?.emotions?.decay_per_minute ??
      0.05
    emotion.decay(decay)
  }

  interval = window.setInterval(tick, 30_000)

  return () => {
    if (interval !== null) clearInterval(interval)
    interval = null
  }
}
