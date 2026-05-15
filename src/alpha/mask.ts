/**
 * 像素穿透：每 200ms 把 Live2D canvas 的 alpha 降采样到 128x96 1-bit mask，
 * 推给 Rust 端。Rust mouse tracker 用 mask 替代矩形判断。
 *
 * mask 编码：每 8 个像素打包成 1 byte（行优先），总长 128*96/8 = 1536 bytes。
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
let pixelBuf: Uint8Array | null = null
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
  pixelBuf = new Uint8Array(MASK_W * MASK_H * 4)
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
  if (!canvasRef || !glRef || !pixelBuf || !packedBuf) return

  const gl = glRef
  // 读 backing store 的 MASK_W x MASK_H 区域 —— 直接降采样
  // 改用 SUBIMAGE：从 canvas 缩放 readPixels。但 readPixels 不支持缩放。
  // 我们读小一点的区域然后下采样到 128×96。
  // 简化：直接读整个 framebuffer，再按 stride 跳读 alpha。
  const fbW = canvasRef.width
  const fbH = canvasRef.height
  if (fbW < 2 || fbH < 2) return

  const stepX = fbW / MASK_W
  const stepY = fbH / MASK_H

  // 一次 readPixels 整张 → 较重；改成读一条线一次（更轻）会太慢。
  // 平衡：读整张，但只读 alpha 通道（RGBA 不能拆开读，只能整张拿）。
  // 对 128×96 mask 我们用 ~32KB readPixels（一条 small row at a time），
  // 实际 mask 计算复杂度可忽略。
  // 取舍：直接读全 framebuffer alpha（fbW * fbH * 4 字节），降采样后打包。
  // M3 上 480×720 canvas readPixels 约 1MB —— 200ms 间隔可接受。

  const full = new Uint8Array(fbW * fbH * 4)
  try {
    gl.readPixels(0, 0, fbW, fbH, gl.RGBA, gl.UNSIGNED_BYTE, full)
  } catch {
    return
  }

  // WebGL 原点左下；mask 我们用左上为原点
  packedBuf.fill(0)
  let hash = 0
  for (let my = 0; my < MASK_H; my++) {
    const srcY = Math.floor((MASK_H - 1 - my) * stepY)
    for (let mx = 0; mx < MASK_W; mx++) {
      const srcX = Math.floor(mx * stepX)
      const alpha = full[(srcY * fbW + srcX) * 4 + 3]
      if (alpha > ALPHA_THRESHOLD) {
        const idx = my * MASK_W + mx
        packedBuf[idx >> 3] |= 1 << (idx & 7)
      }
    }
    // 滚动 hash
    hash = (hash * 31 + packedBuf[my * MASK_W >> 3]) & 0xffff
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
