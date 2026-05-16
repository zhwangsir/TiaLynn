/**
 * 窗口交互编排：拖动 + 穿透状态机 + 视线跟随。
 *
 * v0.6.1 关键修正：解决「UI 按钮点不到」根本原因。
 *
 * 旧设计（错）：默认 setIgnoreMouseEvents(true, forward) + 依赖 webview mousemove 切回。
 *   问题：forward 只转 mousemove，不转 click。如果鼠标静止悬停在 UI 上不动，
 *         状态卡在 ignore=true，永远点不到。
 *
 * 新设计：
 *   - 默认 ignore=false（响应一切，UI 永远可点）
 *   - 主进程 cursor poll（每 50ms，独立于 webview mousemove）→ renderer 决定
 *     如果鼠标在透明区且没有任何 UI/立绘命中 → ignore=true (forward=true)
 *     如果鼠标在 UI 或立绘 alpha 上 → ignore=false
 *   - poll 即使在鼠标静止时也持续运行 → 不会再卡死状态
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
  private currentIgnore = false // 默认响应一切
  private dragging = false
  private destroyed = false
  private softDragOrigin: { mx: number; my: number; bx: number; by: number } | null = null
  private passthroughEnabled: () => boolean
  private unsubCursor: (() => void) | null = null

  constructor(private opts: InteractionOpts) {
    this.passthroughEnabled = opts.passthroughEnabled ?? (() => true)

    // 视线跟随：从 webview mousemove 拿（这种事件 forward 模式下也有）
    opts.container.addEventListener('mousemove', this.onMouseMove)
    opts.container.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onWindowMouseMove)

    // 默认 ignore=false（响应一切）—— Electron 默认状态，不需要主动调
    // 但显式调一次确保状态正确
    void window.api.window.setIgnoreMouse(false)

    // 启动主进程 cursor polling（即使鼠标静止也能切换）
    void window.api.cursor.pollStart()
    this.unsubCursor = window.api.cursor.onTick((pt) => this.onCursorTick(pt))
  }

  /** 强制响应（设置面板打开时调 forceInteractive(true)） */
  forceInteractive(on: boolean): void {
    if (on) {
      this.currentIgnore = false
      void window.api.window.setIgnoreMouse(false)
    }
    // off 状态由 cursor poll 自动接管
  }

  destroy(): void {
    this.destroyed = true
    this.opts.container.removeEventListener('mousemove', this.onMouseMove)
    this.opts.container.removeEventListener('mousedown', this.onMouseDown)
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
      // 模态打开：强制响应
      if (this.currentIgnore) this.applyIgnore(false)
      return
    }
    if (!pt.inside) {
      // 鼠标在窗口外，不切（让 OS 决定）
      return
    }
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

  /** webview mousemove：仅用于驱动视线 + drag fallback */
  private onMouseMove = (e: MouseEvent): void => {
    if (this.destroyed) return
    const rect = this.opts.container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    this.opts.renderer.setGaze(x, y)
  }

  /** 判断屏幕坐标是否落在 UI 元素上（非 canvas、非 body）。 */
  private isOverUiElement(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return false
    if (el === document.body || el === document.documentElement) return false
    if (el.tagName === 'CANVAS') return false
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
    // 只有 alpha 命中（立绘）才触发拖动 —— UI 元素不拖
    if (this.isOverUiElement(e.clientX, e.clientY)) return
    if (!this.opts.sampler.hits(x, y, rect.width, rect.height)) return

    const result = await window.api.window.startDrag()
    if (result.ok) {
      this.dragging = false
      return
    }

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
