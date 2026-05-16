/**
 * 窗口交互编排：拖动 + 穿透状态机 + 视线跟随。
 *
 * 工作流：
 *   onMouseMove：根据 alpha mask 命中决定 setIgnoreMouse(true/false, {forward:true})
 *   onMouseDown on hit：调用 window.api.window.startDrag() 走 native 拖动；失败则启用软 fallback
 *   onMouseMove：实时更新 Live2D 视线
 */
import type { AlphaSampler } from './alpha-hit'
import type { Live2DRenderer } from '../render/live2d-renderer'
import { bus } from '../../infra/eventbus'

export interface InteractionOpts {
  container: HTMLElement
  sampler: AlphaSampler
  renderer: Live2DRenderer
  /** 是否启用穿透切换（设置面板打开时关闭） */
  passthroughEnabled?: () => boolean
}

export class WindowInteraction {
  private currentIgnore = true
  private dragging = false
  private destroyed = false
  private softDragOrigin: { mx: number; my: number; bx: number; by: number } | null = null
  private passthroughEnabled: () => boolean

  constructor(private opts: InteractionOpts) {
    this.passthroughEnabled = opts.passthroughEnabled ?? (() => true)
    opts.container.addEventListener('mousemove', this.onMouseMove)
    opts.container.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onWindowMouseMove)
    // 初始默认穿透
    window.api.window.setIgnoreMouse(true, true)
  }

  /** 强制设为非穿透（设置面板等需要） */
  forceInteractive(on: boolean): void {
    if (on) {
      this.currentIgnore = false
      window.api.window.setIgnoreMouse(false)
    } else {
      this.currentIgnore = true
      window.api.window.setIgnoreMouse(true, true)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.opts.container.removeEventListener('mousemove', this.onMouseMove)
    this.opts.container.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onWindowMouseMove)
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.destroyed) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    // 视线跟随永远开启
    this.opts.renderer.setGaze(x, y)

    if (!this.passthroughEnabled()) return

    // 命中判断：UI 元素 OR 立绘 alpha
    const overUi = this.isOverUiElement(e.clientX, e.clientY)
    const overAlpha = this.opts.sampler.hits(x, y, rect.width, rect.height)
    const hit = overUi || overAlpha
    bus.emit('avatar:mouse-inside', { inside: hit, x: e.clientX, y: e.clientY })
    if (hit && this.currentIgnore) {
      this.currentIgnore = false
      window.api.window.setIgnoreMouse(false)
    } else if (!hit && !this.currentIgnore) {
      this.currentIgnore = true
      window.api.window.setIgnoreMouse(true, true)
    }
  }

  /**
   * 判断屏幕坐标是否落在 UI 元素上（非 canvas、非 body）。
   * elementFromPoint 看到的是当前 DOM 命中链最上层元素 —— UI 浮层都是 absolute，
   * 透明区点击会落到 body 或 canvas 上（这两者算「非 UI」，应当穿透）。
   */
  private isOverUiElement(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return false
    if (el === document.body || el === document.documentElement) return false
    if (el.tagName === 'CANVAS') return false
    // 容器（.live2d-stage / .root）本身算透明背景，不算 UI
    if (el.classList.contains('live2d-stage')) return false
    if (el.classList.contains('root')) return false
    return true
  }

  private onWindowMouseMove = async (e: MouseEvent): Promise<void> => {
    if (!this.dragging || !this.softDragOrigin) return
    const dx = e.screenX - this.softDragOrigin.mx
    const dy = e.screenY - this.softDragOrigin.my
    window.api.window.softDrag(this.softDragOrigin.bx + dx, this.softDragOrigin.by + dy)
  }

  private onMouseDown = async (e: MouseEvent): Promise<void> => {
    if (e.button !== 0) return
    if (this.destroyed) return
    if (!this.passthroughEnabled()) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return

    // 优先尝试 native 拖动（airi 同款）
    const result = await window.api.window.startDrag()
    if (result.ok) {
      this.dragging = false
      return
    }

    // fallback：软件拖动（记录初始位置，mousemove 时 setBounds）
    const bounds = await window.api.window.getBounds()
    if (!bounds) return
    this.softDragOrigin = {
      mx: e.screenX,
      my: e.screenY,
      bx: bounds.x,
      by: bounds.y,
    }
    this.dragging = true
  }

  private onMouseUp = (): void => {
    this.dragging = false
    this.softDragOrigin = null
  }
}
