/**
 * 像素穿透 mask：每 200ms 把 Live2D canvas alpha 降采样 + DOM 中
 * [data-uichrome="1"] / input / button 等 UI 元素的 bbox 一起合成成 1-bit mask 推到 Rust。
 *
 * 这样 Rust mouse tracker 同时认 立绘 alpha 区 + UI 区域为"on-pixel"，
 * 解决：UI chrome（齿轮、设置面板、输入框）在 alpha=0 透明区被误判穿透的问题。
 *
 * mask 编码：128×96，1 bit/像素，行优先；总长 128*96/8 = 1536 bytes。
 */
import { invoke } from '@tauri-apps/api/core'

const MASK_W = 128
const MASK_H = 96
const ALPHA_THRESHOLD = 16
const PUSH_INTERVAL_MS = 200

let canvasRef: HTMLCanvasElement | null = null
let glRef: WebGLRenderingContext | WebGL2RenderingContext | null = null
let timer: number | null = null
let stopped = false
let lastMaskHash = 0
let packedBuf: Uint8Array | null = null

export function registerMaskCanvas(canvas: HTMLCanvasElement): void {
  canvasRef = canvas
  const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  glRef = ctx
}

export function startMaskPush(): void {
  if (timer !== null) return
  stopped = false
  packedBuf = new Uint8Array(Math.ceil((MASK_W * MASK_H) / 8))
  schedule()
}

export function stopMaskPush(): void {
  stopped = true
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function schedule(): void {
  if (stopped) return
  timer = window.setTimeout(() => {
    pushOnce().finally(schedule)
  }, PUSH_INTERVAL_MS)
}

async function pushOnce(): Promise<void> {
  if (!canvasRef || !glRef || !packedBuf) return

  const gl = glRef
  const fbW = canvasRef.width
  const fbH = canvasRef.height
  if (fbW < 2 || fbH < 2) return

  const stepX = fbW / MASK_W
  const stepY = fbH / MASK_H

  // 1. 读 Live2D framebuffer 全帧
  const full = new Uint8Array(fbW * fbH * 4)
  try {
    gl.readPixels(0, 0, fbW, fbH, gl.RGBA, gl.UNSIGNED_BYTE, full)
  } catch {
    return
  }

  // 2. 降采样到 128×96，画立绘 alpha 区
  packedBuf.fill(0)
  for (let my = 0; my < MASK_H; my++) {
    const srcY = Math.floor((MASK_H - 1 - my) * stepY) // WebGL 原点左下 → mask 左上
    for (let mx = 0; mx < MASK_W; mx++) {
      const srcX = Math.floor(mx * stepX)
      const alpha = full[(srcY * fbW + srcX) * 4 + 3]
      if (alpha > ALPHA_THRESHOLD) {
        const idx = my * MASK_W + mx
        packedBuf[idx >> 3] |= 1 << (idx & 7)
      }
    }
  }

  // 3. 叠加 UI chrome bbox（齿轮、设置面板、对话气泡、输入栏 等）
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  if (viewportW > 0 && viewportH > 0) {
    const els = document.querySelectorAll<HTMLElement>(
      '[data-uichrome="1"], input, textarea, button, select',
    )
    els.forEach((el) => {
      // 跳过被隐藏的
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const x0 = Math.max(0, Math.floor((r.left / viewportW) * MASK_W))
      const y0 = Math.max(0, Math.floor((r.top / viewportH) * MASK_H))
      const x1 = Math.min(MASK_W, Math.ceil(((r.left + r.width) / viewportW) * MASK_W))
      const y1 = Math.min(MASK_H, Math.ceil(((r.top + r.height) / viewportH) * MASK_H))
      for (let my = y0; my < y1; my++) {
        for (let mx = x0; mx < x1; mx++) {
          const idx = my * MASK_W + mx
          packedBuf![idx >> 3] |= 1 << (idx & 7)
        }
      }
    })
  }

  // 4. 简单哈希避免重复推送
  let hash = 0
  for (let i = 0; i < packedBuf.length; i++) {
    hash = (hash * 31 + packedBuf[i]) & 0xffffff
  }
  if (hash === lastMaskHash) return
  lastMaskHash = hash

  try {
    await invoke('window_set_alpha_mask', {
      width: MASK_W,
      height: MASK_H,
      data: Array.from(packedBuf),
    })
  } catch (e) {
    console.debug('[mask] push failed:', e)
  }
}
