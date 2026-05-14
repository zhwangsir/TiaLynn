import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EmotionId } from '@/types/soul'
import { detectEmotionFromText } from '@/emotion/fsm'

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

  function infer(text: string): EmotionId {
    const detected = detectEmotionFromText(text)
    if (detected) set(detected)
    return current.value
  }

  function decay(decayPerMinute: number) {
    const minutes = (Date.now() - lastChangeAt.value) / 60_000
    intensity.value = Math.max(0.1, intensity.value - decayPerMinute * minutes)
    if (intensity.value < 0.15 && current.value !== 'neutral') {
      set('neutral', 0.5)
    }
  }

  return { current, intensity, lastChangeAt, init, set, infer, decay }
})
