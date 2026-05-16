/**
 * 情绪 store。
 *
 * v0.4 起：不再用关键词 FSM 推断情绪（被砍）。情绪由 LLM JSON 输出驱动（brain:reply_end）。
 * `infer` 方法移除；保留 `set` / `decay`。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EmotionId } from '@/brain/types/soul'

export const useEmotionStore = defineStore('emotion', () => {
  const current = ref<EmotionId>('neutral')
  const intensity = ref(0.5)
  const lastChangeAt = ref(Date.now())

  function init(initial: EmotionId) {
    current.value = initial
    lastChangeAt.value = Date.now()
  }

  function set(emotion: EmotionId, newIntensity = 0.8) {
    if (current.value === emotion && Math.abs(intensity.value - newIntensity) < 0.05) return
    current.value = emotion
    intensity.value = newIntensity
    lastChangeAt.value = Date.now()
  }

  function decay(decayPerMinute: number) {
    const minutes = (Date.now() - lastChangeAt.value) / 60_000
    intensity.value = Math.max(0.1, intensity.value - decayPerMinute * minutes)
    if (intensity.value < 0.15 && current.value !== 'neutral') {
      set('neutral', 0.5)
    }
  }

  return { current, intensity, lastChangeAt, init, set, decay }
})
