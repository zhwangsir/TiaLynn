/**
 * Alpha 命中：根据 canvas 当前帧的 alpha 通道判断鼠标是否「在立绘像素上」。
 *
 * 这个能力直接决定窗口何时穿透 / 何时响应。
 * 我们维护一张降采样的 alpha mask（默认 96x144），16ms 更新一次。
 */
import type { Live2DRenderer } from '../render/live2d-renderer'

export interface AlphaSamplerOptions {
  sampleW?: number
  sampleH?: number
  /** alpha 阈值（0~255），高于此值视为命中立绘 */
  threshold?: number
  /** 采样频率 ms */
  updateMs?: number
}

export class AlphaSampler {
  private mask: Uint8Array
  private sw: number
  private sh: number
  private threshold: number
  private timer: ReturnType<typeof setInterval> | null = null
  private offscreen: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor(
    private renderer: Live2DRenderer,
    opts: AlphaSamplerOptions = {},
  ) {
    this.sw = opts.sampleW ?? 96
    this.sh = opts.sampleH ?? 144
    this.threshold = opts.threshold ?? 16
    this.mask = new Uint8Array(this.sw * this.sh)
    this.offscreen = document.createElement('canvas')
    this.offscreen.width = this.sw
    this.offscreen.height = this.sh
    const ctx = this.offscreen.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('AlphaSampler: cannot get 2d context')
    this.ctx = ctx
    const updateMs = opts.updateMs ?? 80
    this.timer = setInterval(() => this.sample(), updateMs)
  }

  /** 判断屏幕坐标（窗口内）是否命中立绘 */
  hits(x: number, y: number, winW: number, winH: number): boolean {
    if (winW <= 0 || winH <= 0) return false
    const sx = Math.floor((x / winW) * this.sw)
    const sy = Math.floor((y / winH) * this.sh)
    if (sx < 0 || sy < 0 || sx >= this.sw || sy >= this.sh) return false
    return this.mask[sy * this.sw + sx] >= this.threshold
  }

  destroy(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private sample(): void {
    const app = this.renderer.app
    if (!app || !app.renderer) return
    const src = app.view as HTMLCanvasElement
    try {
      this.ctx.clearRect(0, 0, this.sw, this.sh)
      // drawImage 自带降采样
      this.ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.sw, this.sh)
      const data = this.ctx.getImageData(0, 0, this.sw, this.sh).data
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        this.mask[j] = data[i + 3]
      }
    } catch (e) {
      // 跨域 canvas 可能 read 失败，这里静默
      console.warn('[alpha] sample failed', e)
    }
  }
}
