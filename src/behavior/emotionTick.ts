/**
 * 情绪衰减 tick：每分钟把当前情绪强度按 soul.emotions.decay_per_minute 衰减，
 * 跌破阈值时切回 neutral。
 */
import { useEmotionStore } from '@/stores/emotion'
import { useSoulStore } from '@/stores/soul'

let interval: number | null = null

export function startEmotionTick(): () => void {
  const emotion = useEmotionStore()
  const soul = useSoulStore()

  function tick(): void {
    const decay = soul.config?.emotions?.decay_per_minute ?? 0.05
    emotion.decay(decay)
  }

  // 每 30s tick 一次（衰减按分钟率计算，emotion.decay 内部按真实时长算）
  interval = window.setInterval(tick, 30_000)

  return () => {
    if (interval !== null) clearInterval(interval)
    interval = null
  }
}
