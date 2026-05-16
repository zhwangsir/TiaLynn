/**
 * 嘴型同步：把 HTMLAudioElement 的输出接到 AnalyserNode，
 * 每帧取 RMS，平滑后驱动 ParamMouthOpenY。
 */
import type { TiaLynnRenderer } from '../render/renderer'

export interface LipSyncHandle {
  stop: () => void
}

export function lipSyncFromAudio(
  renderer: TiaLynnRenderer,
  audio: HTMLAudioElement,
): LipSyncHandle {
  // 复用全局 AudioContext，避免多次 new 触发自动播放策略
  const ctx = getAudioCtx()
  const source = ctx.createMediaElementSource(audio)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.4

  source.connect(analyser)
  source.connect(ctx.destination)

  const buffer = new Float32Array(analyser.fftSize)
  let stopped = false
  let smoothed = 0

  const loop = () => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
    const rms = Math.sqrt(sum / buffer.length) // 0..~1
    const mouth = Math.min(1, rms * 6) // 经验放大
    smoothed += (mouth - smoothed) * 0.35
    renderer.setMouthOpen(smoothed)
    requestAnimationFrame(loop)
  }

  requestAnimationFrame(loop)

  return {
    stop: () => {
      stopped = true
      try {
        source.disconnect()
        analyser.disconnect()
      } catch {
        /* ignore */
      }
      renderer.setMouthOpen(0)
    },
  }
}

let _ctx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  if (_ctx) return _ctx
  _ctx = new AudioContext()
  // 用户首次交互后 resume
  if (_ctx.state === 'suspended') {
    const resume = () => {
      _ctx?.resume()
      window.removeEventListener('click', resume)
      window.removeEventListener('keydown', resume)
    }
    window.addEventListener('click', resume)
    window.addEventListener('keydown', resume)
  }
  return _ctx
}
