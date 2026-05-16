/**
 * 在场域：监听 'brain:reply-end' → 调 TTS sidecar → 播放 + 嘴型同步。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { bus } from '../../infra/eventbus'
import { useConfigStore } from '../../infra/stores/config'
import { playWithLipsync, type LipsyncSession } from '../speech/lipsync'

export const useSpeechStore = defineStore('speech', () => {
  const speaking = ref(false)
  const lastError = ref<string | null>(null)
  let current: LipsyncSession | null = null

  function bootstrap(): void {
    bus.on('brain:reply-end', async ({ full_text, emotion }) => {
      const cfg = useConfigStore()
      if (!cfg.config || cfg.config.tts_provider === 'none') return
      if (!full_text.trim()) return
      await speak(full_text, emotion ?? 'neutral')
    })
  }

  async function speak(text: string, emotion: string): Promise<void> {
    if (speaking.value) {
      current?.stop()
      current = null
    }
    const cfg = useConfigStore()
    const voice = cfg.config?.emotion_voice_map[emotion]
    const result = await window.api.tts.speak({ text, emotion, voice })
    if (!result.ok || !result.audio_b64) {
      lastError.value = result.reason ?? 'tts-failed'
      // TTS 失败也无所谓 —— 立绘还在，对话还在
      return
    }
    try {
      speaking.value = true
      bus.emit('presence:tts-start', { audio_url: '', emotion: emotion as never })
      current = await playWithLipsync(result.audio_b64, result.mime ?? 'audio/wav')
      await current.ended
    } catch (e) {
      lastError.value = String(e)
    } finally {
      speaking.value = false
      current = null
    }
  }

  function stop(): void {
    current?.stop()
    current = null
    speaking.value = false
  }

  return { speaking, lastError, bootstrap, speak, stop }
})
