/**
 * 像素级点击穿透 + 立绘拖动：
 *  - mousemove → 检测 alpha，命中切 ignore=false（接收事件），否则 ignore=true（穿透）
 *  - mousedown → 命中时调 window_start_drag 启动 native 窗口拖动
 *
 * 跨平台一致：完全依赖 Tauri 通用 API。
 *
 * 例外：UI 区域（输入框、设置面板、气泡）虽然 alpha=0，但仍需可交互。
 * 解决：UI 元素加 data-uichrome="1"，命中 UI 时强制 NOT ignore。
 */
import { invoke } from '@tauri-apps/api/core'

const ALPHA_THRESHOLD = 16 // 0..255

let lastIgnoring = false
let canvasRef: HTMLCanvasElement | null = null
let glRef: WebGLRenderingContext | WebGL2RenderingContext | null = null
let onMove: ((e: MouseEvent) => void) | null = null
let onDown: ((e: MouseEvent) => void) | null = null

export function registerCanvas(canvas: HTMLCanvasElement): void {
  canvasRef = canvas
  // pixi-live2d-display 默认用 WebGL；getImageData 走 2D 上下文读不到。
  // 这里通过 readPixels 拿原始像素。
  const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  glRef = ctx
}

export function startAlphaHitTest(): void {
  // 节流：mousemove 高频，60Hz 上限
  let lastTs = 0
  onMove = (e: MouseEvent) => {
    const now = performance.now()
    if (now - lastTs < 16) return
    lastTs = now
    const overUi = isOverInteractiveUi(e.target)
    const hitsModel = hitTestAlpha(e.clientX, e.clientY)
    const ignore = !(overUi || hitsModel)
    setIgnoreIfChanged(ignore)
  }
  window.addEventListener('mousemove', onMove)

  // mousedown：在立绘上按下 → 启动 native 拖动
  onDown = (e: MouseEvent) => {
    if (e.button !== 0) return // 仅左键
    if (isOverInteractiveUi(e.target)) return // UI 元素自己处理
    if (!hitTestAlpha(e.clientX, e.clientY)) return
    invoke('window_start_drag').catch((err) => {
      console.warn('[alpha] start_drag failed', err)
    })
  }
  window.addEventListener('mousedown', onDown)
}

export function stopAlphaHitTest(): void {
  if (onMove) window.removeEventListener('mousemove', onMove)
  if (onDown) window.removeEventListener('mousedown', onDown)
  onMove = null
  onDown = null
}

/**
 * 判断目标元素是不是「可交互 UI」（输入框、按钮、设置面板、气泡等）。
 * 这些元素 alpha=0 但应允许鼠标事件。
 */
function isOverInteractiveUi(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  // 1. 直接元素：input/button/textarea/select
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') {
    return true
  }
  // 2. 祖先链上的 [data-uichrome]
  if (target.closest('[data-uichrome="1"]')) return true
  return false
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

