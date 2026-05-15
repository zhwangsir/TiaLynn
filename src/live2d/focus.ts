/**
 * 视线 / 头部跟随鼠标。
 *
 * v0.1.3 起：监听 Rust 端发的 `mouse::global` 事件，全局有效
 *           （鼠标在窗口外也持续跟随）。
 *
 * 之前用 window mousemove 监听，但当窗口 ignore=true 时收不到，
 * 视线会卡在最后一次窗口内的位置不动。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { TiaLynnRenderer } from './renderer'

interface GlobalMouseEvent {
  mouse_phys_x: number
  mouse_phys_y: number
  win_phys_x: number
  win_phys_y: number
  win_phys_w: number
  win_phys_h: number
  scale_factor: number
  inside: boolean
}

export function startMouseFocus(renderer: TiaLynnRenderer): () => void {
  let unlisten: UnlistenFn | null = null
  let stopped = false

  // 启动 listen（异步）
  listen<GlobalMouseEvent>('mouse::global', (e) => {
    if (stopped) return
    const p = e.payload
    const dpr = p.scale_factor || window.devicePixelRatio || 1
    // 物理像素 → webview CSS 像素（webview 内坐标系，可以为负或超出 viewport）
    const cssX = (p.mouse_phys_x - p.win_phys_x) / dpr
    const cssY = (p.mouse_phys_y - p.win_phys_y) / dpr
    renderer.setFocus(cssX, cssY)
  })
    .then((u) => {
      unlisten = u
    })
    .catch((err) => {
      console.warn('[focus] listen mouse::global failed:', err)
    })

  return () => {
    stopped = true
    unlisten?.()
  }
}
