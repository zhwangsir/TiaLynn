/**
 * 窗口交互编排：拖动 + 穿透状态机 + 视线跟随 + 右键菜单。
 *
 * 设计：
 *   - 默认 ignore=false（响应一切，UI 永远可点）
 *   - 主进程 cursor poll（每 50ms）独立于 webview mousemove，鼠标静止时也能切换
 *   - 鼠标在 UI / 立绘 alpha 命中 → ignore=false；落在透明区 → ignore=true (forward=true)
 *   - 左键长按立绘 → native 拖动；右键立绘 → emit 'avatar:contextmenu' 让 App 弹菜单
 */
import type { AlphaSampler } from './alpha-hit'
import type { Live2DRenderer } from '../render/live2d-renderer'
import { bus } from '../../infra/eventbus'

export interface InteractionOpts {
  container: HTMLElement
  sampler: AlphaSampler
  renderer: Live2DRenderer
  /** 是否启用穿透切换（设置面板等模态打开时返回 false → 永远响应） */
  passthroughEnabled?: () => boolean
}

export class WindowInteraction {
  private currentIgnore = false
  private dragging = false
  private destroyed = false
  private softDragOrigin: { mx: number; my: number; bx: number; by: number } | null = null
  private passthroughEnabled: () => boolean
  private unsubCursor: (() => void) | null = null

  constructor(private opts: InteractionOpts) {
    this.passthroughEnabled = opts.passthroughEnabled ?? (() => true)

    opts.container.addEventListener('mousemove', this.onMouseMove)
    opts.container.addEventListener('mousedown', this.onMouseDown)
    opts.container.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onWindowMouseMove)

    void window.api.window.setIgnoreMouse(false)
    void window.api.cursor.pollStart()
    this.unsubCursor = window.api.cursor.onTick((pt) => this.onCursorTick(pt))
  }

  /** 强制响应（设置面板 / 右键菜单打开时） */
  forceInteractive(on: boolean): void {
    if (on) {
      this.currentIgnore = false
      void window.api.window.setIgnoreMouse(false)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.opts.container.removeEventListener('mousemove', this.onMouseMove)
    this.opts.container.removeEventListener('mousedown', this.onMouseDown)
    this.opts.container.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onWindowMouseMove)
    this.unsubCursor?.()
    this.unsubCursor = null
    void window.api.cursor.pollStop()
  }

  /** 主进程 cursor tick：唯一负责切 ignore 状态的源 */
  private onCursorTick(pt: { x: number; y: number; inside: boolean }): void {
    if (this.destroyed) return
    if (!this.passthroughEnabled()) {
      if (this.currentIgnore) this.applyIgnore(false)
      return
    }
    if (!pt.inside) return
    const rect = this.opts.container.getBoundingClientRect()
    const overUi = this.isOverUiElement(pt.x, pt.y)
    const overAlpha = this.opts.sampler.hits(pt.x, pt.y, rect.width, rect.height)
    const hit = overUi || overAlpha
    bus.emit('avatar:mouse-inside', { inside: hit, x: pt.x, y: pt.y })
    this.applyIgnore(!hit)
  }

  private applyIgnore(ignore: boolean): void {
    if (this.currentIgnore === ignore) return
    this.currentIgnore = ignore
    if (ignore) {
      void window.api.window.setIgnoreMouse(true, true)
    } else {
      void window.api.window.setIgnoreMouse(false)
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.destroyed) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    this.opts.renderer.setGaze(x, y)
  }

  /**
   * 判断屏幕坐标是否落在 UI 元素上（非 canvas、非 body）。
   * 透明区点击会落到 body 或 canvas 上（这两者算「非 UI」，应当穿透）。
   */
  private isOverUiElement(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return false
    if (el === document.body || el === document.documentElement) return false
    if (el.tagName === 'CANVAS') return false
    if (el.classList.contains('live2d-stage')) return false
    if (el.classList.contains('root')) return false
    return true
  }

  private onWindowMouseMove = (e: MouseEvent): void => {
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
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return

    const result = await window.api.window.startDrag()
    if (result.ok) {
      this.dragging = false
      return
    }

    // fallback: 软件拖动
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

  /** 右键立绘 → 弹主菜单。在 UI 元素 / 透明区上右键不响应（让 OS / Vue 子组件自己处理） */
  private onContextMenu = (e: MouseEvent): void => {
    if (this.destroyed) return
    if (!this.passthroughEnabled()) return
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return
    e.preventDefault()
    bus.emit('avatar:contextmenu', { x: e.clientX, y: e.clientY })
  }

  private onMouseUp = (): void => {
    this.dragging = false
    this.softDragOrigin = null
  }
}
