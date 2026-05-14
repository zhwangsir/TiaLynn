/**
 * 像素级点击穿透：监听 mousemove，读取 Live2D canvas 在当前位置的 alpha；
 * alpha < 阈值 时让 Tauri 窗口忽略鼠标事件（穿透到桌面），否则恢复正常。
 *
 * 跨平台一致：完全依赖 Tauri 通用 API。
 */
import { invoke } from '@tauri-apps/api/core'

const ALPHA_THRESHOLD = 16 // 0..255

let lastIgnoring = false
let pixelBuffer: ImageData | null = null
let canvasRef: HTMLCanvasElement | null = null
let glRef: WebGLRenderingContext | WebGL2RenderingContext | null = null
let onMove: ((e: MouseEvent) => void) | null = null

export function registerCanvas(canvas: HTMLCanvasElement): void {
  canvasRef = canvas
  // pixi-live2d-display 默认用 WebGL；getImageData 走 2D 上下文读不到。
  // 这里通过 readPixels 拿原始像素：拿 alpha 还要 framebuffer 绑定到屏幕。
  const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  glRef = ctx
}

export function startAlphaHitTest(): void {
  // 节流：mousemove 高频，我们以 60Hz 上限处理
  let lastTs = 0
  onMove = (e: MouseEvent) => {
    const now = performance.now()
    if (now - lastTs < 16) return
    lastTs = now
    const ignore = !hitTestAlpha(e.clientX, e.clientY)
    setIgnoreIfChanged(ignore)
  }
  window.addEventListener('mousemove', onMove)
}

export function stopAlphaHitTest(): void {
  if (onMove) window.removeEventListener('mousemove', onMove)
  onMove = null
}

function hitTestAlpha(clientX: number, clientY: number): boolean {
  if (!canvasRef || !glRef) return true // 没有 canvas 时默认接收事件

  const dpr = window.devicePixelRatio || 1
  const rect = canvasRef.getBoundingClientRect()
  const x = Math.round((clientX - rect.left) * dpr)
  const y = Math.round((rect.bottom - clientY) * dpr) // WebGL 原点在左下

  // 边界外
  if (x < 0 || y < 0 || x >= canvasRef.width || y >= canvasRef.height) return false

  const pixel = new Uint8Array(4)
  try {
    glRef.readPixels(x, y, 1, 1, glRef.RGBA, glRef.UNSIGNED_BYTE, pixel)
  } catch {
    return true
  }
  return pixel[3] > ALPHA_THRESHOLD
}

function setIgnoreIfChanged(ignore: boolean) {
  if (ignore === lastIgnoring) return
  lastIgnoring = ignore
  invoke('window_set_ignore_cursor', { ignore }).catch((e) => {
    console.warn('[alpha] toggle ignore failed', e)
  })
}

// suppress unused
void pixelBuffer
