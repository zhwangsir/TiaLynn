/**
 * Lipsync —— 从 base64 PCM/WAV 解码 → AnalyserNode → RMS 0~1 → 总线 'avatar:lipsync'。
 *
 * 当前是简单 RMS 版（已经比 Tauri 时代的 setInterval 抖动好），
 * 后续 v0.7 升级到 wlipsync AudioWorklet 走 AEIOU 元音权重。
 */
import { bus } from '../../infra/eventbus'

export interface LipsyncSession {
  stop(): void
  ended: Promise<void>
}

export async function playWithLipsync(b64: string, mime: string): Promise<LipsyncSession> {
  const blob = b64ToBlob(b64, mime || 'audio/wav')
  const url = URL.createObjectURL(blob)

  const audio = new Audio(url)
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AC = window.AudioContext ?? (window as any).webkitAudioContext
  const ctx: AudioContext = new AC()
  const src = ctx.createMediaElementSource(audio)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.5
  src.connect(analyser)
  src.connect(ctx.destination)

  const buf = new Uint8Array(analyser.frequencyBinCount)
  let stopped = false
  let raf = 0

  function loop(): void {
    if (stopped) return
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / buf.length)
    // RMS 一般 0.05~0.3，重映射到 0~1（夹紧到 0~0.85 防止张嘴过大）
    const value = clamp(rms * 3.5, 0, 0.85)
    bus.emit('avatar:lipsync', { value })
    raf = requestAnimationFrame(loop)
  }

  const ended = new Promise<void>((resolve) => {
    audio.addEventListener('ended', () => {
      stopped = true
      cancelAnimationFrame(raf)
      bus.emit('avatar:lipsync', { value: 0 })
      bus.emit('presence:tts-end')
      URL.revokeObjectURL(url)
      ctx.close().catch(() => undefined)
      resolve()
    })
    audio.addEventListener('error', () => {
      stopped = true
      bus.emit('avatar:lipsync', { value: 0 })
      bus.emit('presence:tts-end')
      URL.revokeObjectURL(url)
      ctx.close().catch(() => undefined)
      resolve()
    })
  })

  await audio.play()
  raf = requestAnimationFrame(loop)

  return {
    stop(): void {
      stopped = true
      cancelAnimationFrame(raf)
      audio.pause()
      bus.emit('avatar:lipsync', { value: 0 })
      bus.emit('presence:tts-end')
      URL.revokeObjectURL(url)
      ctx.close().catch(() => undefined)
    },
    ended,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const len = bin.length
  const u8 = new Uint8Array(len)
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i)
  return new Blob([u8], { type: mime })
}
