/**
 * 文本到语音播放 + 嘴型同步串联。
 *
 * 用法：speakWithLipSync(text, emotion) → 调 tts_speak 拿音频路径 → HTMLAudioElement 播放
 * → AnalyserNode RMS 驱动 Live2D ParamMouthOpenY。
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { lipSyncFromAudio } from '@/live2d/lipSync'

let inflightAudio: HTMLAudioElement | null = null
let inflightStop: (() => void) | null = null

export async function speakWithLipSync(text: string, emotion: string): Promise<void> {
  if (!text.trim()) return

  // 取消上一段未播完的音频，避免重叠
  stopCurrent()

  let path: string
  try {
    path = await invoke<string>('tts_speak', { text, emotion })
  } catch (e) {
    console.warn('[speaker] tts_speak failed:', e)
    return
  }

  const url = convertFileSrc(path)
  const audio = new Audio(url)
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'

  const renderer = window.__tialynn_renderer__
  let stopLip: (() => void) | null = null
  if (renderer) {
    try {
      const h = lipSyncFromAudio(renderer, audio)
      stopLip = h.stop
    } catch (e) {
      console.warn('[speaker] lipSync wiring failed:', e)
    }
  }

  inflightAudio = audio
  inflightStop = () => {
    try {
      audio.pause()
    } catch {
      /* ignore */
    }
    stopLip?.()
    inflightAudio = null
    inflightStop = null
  }

  audio.addEventListener('ended', () => inflightStop?.(), { once: true })
  audio.addEventListener('error', () => inflightStop?.(), { once: true })

  try {
    await audio.play()
  } catch (e) {
    // 浏览器自动播放策略可能阻止，提示一次
    console.warn('[speaker] audio.play() blocked:', e)
    inflightStop?.()
  }
}

export function stopCurrent(): void {
  inflightStop?.()
}
