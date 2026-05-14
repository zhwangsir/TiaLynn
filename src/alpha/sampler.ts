/**
 * 拖动 + 像素采样辅助。
 *
 * 注意：v0.1.2 把"窗口外穿透"的核心责任移交 Rust 端 `spawn_mouse_tracker`。
 * 原因：当 ignore=true 时整个 webview 收不到事件，前端无法把 ignore 切回 false，
 *      会永久卡死所有 UI（用户实测复现）。
 *
 * 本模块现在只负责：
 *   - mousedown：在 Live2D 立绘（alpha 命中）上按下时，触发 native 拖窗
 *   - UI 元素白名单：[data-uichrome="1"] / input/button 上的按下不触发拖窗
 *   - 像素采样工具（保留，供未来需要时使用）
 */
import { invoke } from '@tauri-apps/api/core'

const ALPHA_THRESHOLD = 16

let canvasRef: HTMLCanvasElement | null = null
let glRef: WebGLRenderingContext | WebGL2RenderingContext | null = null
let onDown: ((e: MouseEvent) => void) | null = null

export function registerCanvas(canvas: HTMLCanvasElement): void {
  canvasRef = canvas
  const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  glRef = ctx
}

export function startAlphaHitTest(): void {
  onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    if (isOverInteractiveUi(e.target)) return
    if (!hitTestAlpha(e.clientX, e.clientY)) return
    invoke('window_start_drag').catch((err) => {
      console.warn('[alpha] start_drag failed', err)
    })
  }
  window.addEventListener('mousedown', onDown)
}

export function stopAlphaHitTest(): void {
  if (onDown) window.removeEventListener('mousedown', onDown)
  onDown = null
}

function hitTestAlpha(clientX: number, clientY: number): boolean {
  if (!canvasRef || !glRef) return false
  const dpr = window.devicePixelRatio || 1
  const rect = canvasRef.getBoundingClientRect()
  const x = Math.round((clientX - rect.left) * dpr)
  const y = Math.round((rect.bottom - clientY) * dpr)
  if (x < 0 || y < 0 || x >= canvasRef.width || y >= canvasRef.height) return false

  const pixel = new Uint8Array(4)
  try {
    glRef.readPixels(x, y, 1, 1, glRef.RGBA, glRef.UNSIGNED_BYTE, pixel)
  } catch {
    return false
  }
  return pixel[3] > ALPHA_THRESHOLD
}

function isOverInteractiveUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') {
    return true
  }
  if (target.closest('[data-uichrome="1"]')) return true
  return false
}
