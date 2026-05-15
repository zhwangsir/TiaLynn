/**
 * 立绘拖动 + UI 命中检测。
 *
 * 不再用 start_dragging（macOS 透明窗口跨 IPC 时 NSEvent 已过期，不工作）。
 * 改为：mousedown 时记起点 → mousemove 跟随屏幕坐标增量 → invoke window_set_position。
 */
import { invoke } from '@tauri-apps/api/core'

const ALPHA_THRESHOLD = 16

let canvasRef: HTMLCanvasElement | null = null
let glRef: WebGLRenderingContext | WebGL2RenderingContext | null = null
let onDown: ((e: MouseEvent) => void) | null = null

// 拖动状态
let dragging = false
let dragStartScreenX = 0
let dragStartScreenY = 0
let dragStartWinX = 0
let dragStartWinY = 0

export function registerCanvas(canvas: HTMLCanvasElement): void {
  canvasRef = canvas
  const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
    | WebGL2RenderingContext
    | WebGLRenderingContext
    | null
  glRef = ctx
}

export function startAlphaHitTest(): void {
  onDown = async (e: MouseEvent) => {
    if (e.button !== 0) return
    if (isOverInteractiveUi(e.target)) return
    if (!hitTestAlpha(e.clientX, e.clientY)) return

    try {
      const pos = await invoke<[number, number]>('window_get_position')
      dragStartWinX = pos[0]
      dragStartWinY = pos[1]
      dragStartScreenX = e.screenX
      dragStartScreenY = e.screenY
      dragging = true
      // 通知 motion 暂停 + 取消正在进行的自主移动
      invoke('motion_set_dragging', { on: true }).catch(() => {})
      invoke('motion_cancel').catch(() => {})
      window.addEventListener('mousemove', onDragMove)
      window.addEventListener('mouseup', onDragUp, { once: true })
    } catch (err) {
      console.warn('[drag] get_position failed:', err)
    }
  }
  window.addEventListener('mousedown', onDown)
}

export function stopAlphaHitTest(): void {
  if (onDown) window.removeEventListener('mousedown', onDown)
  onDown = null
  if (dragging) {
    window.removeEventListener('mousemove', onDragMove)
    dragging = false
  }
}

function onDragMove(e: MouseEvent): void {
  if (!dragging) return
  // 用 screen 坐标差量，避开 webview viewport 切换问题
  const dpr = window.devicePixelRatio || 1
  const dx = (e.screenX - dragStartScreenX) * dpr
  const dy = (e.screenY - dragStartScreenY) * dpr
  const newX = Math.round(dragStartWinX + dx)
  const newY = Math.round(dragStartWinY + dy)
  invoke('window_set_position', { x: newX, y: newY }).catch((err) => {
    console.debug('[drag] set_position failed:', err)
  })
}

function onDragUp(): void {
  dragging = false
  window.removeEventListener('mousemove', onDragMove)
  // 释放 motion 锁
  invoke('motion_set_dragging', { on: false }).catch(() => {})
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
