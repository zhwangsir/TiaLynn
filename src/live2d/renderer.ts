import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { EmotionStateConfig } from '@/types/soul'

// 让 Live2DModel 内部能拿到 PIXI.Ticker
;(window as any).PIXI = PIXI

export interface RendererOptions {
  canvas: HTMLCanvasElement
  modelUrl: string
  scale: number
}

export class TiaLynnRenderer {
  private app: PIXI.Application
  private model: Live2DModel | null = null
  private params: Map<string, { base: number; target: number; current: number }> = new Map()
  private breathPhase = 0
  private destroyed = false

  constructor(private opts: RendererOptions) {
    this.app = new PIXI.Application({
      view: opts.canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    window.addEventListener('resize', this.onResize)
  }

  async load(): Promise<void> {
    const model = await Live2DModel.from(this.opts.modelUrl, { autoInteract: false })
    this.model = model

    model.scale.set(this.opts.scale)
    // pixi-live2d-display 的 Live2DModel 提供 anchor 属性（运行时），声明里不强求
    ;(model as any).anchor?.set?.(0.5, 0.5)
    model.x = this.app.screen.width / 2
    model.y = this.app.screen.height / 2 + 50

    this.app.stage.addChild(model)

    // 启动自定义 tick：眨眼、呼吸、参数缓动
    this.app.ticker.add(this.tick)
  }

  /**
   * 设置情绪：把目标参数表 lerp 到这些值上，cubic-ease。
   * 缺失参数视为「回归 base」。
   */
  applyEmotion(cfg: EmotionStateConfig | undefined): void {
    if (!this.model || !cfg?.live2d) return
    for (const [paramId, targetValue] of Object.entries(cfg.live2d)) {
      const entry = this.params.get(paramId) ?? { base: 0, target: 0, current: 0 }
      entry.target = targetValue
      this.params.set(paramId, entry)
    }
  }

  /**
   * 嘴型同步：直接覆盖 ParamMouthOpenY（不走缓动表，由音频流驱动）。
   */
  setMouthOpen(value01: number): void {
    if (!this.model) return
    const core = (this.model.internalModel as any).coreModel
    if (!core || typeof core.setParameterValueById !== 'function') return
    try {
      core.setParameterValueById('ParamMouthOpenY', Math.max(0, Math.min(1, value01)))
    } catch {
      /* 参数不存在则忽略 */
    }
  }

  /**
   * 视线跟随：把鼠标位置（webview CSS 像素，可超出 viewport）映射到
   * ParamAngleX/Y + ParamEyeBallX/Y。
   *
   * 坐标可以是负值或大于 viewport 尺寸——意味着鼠标在窗口外，但视线仍能指向。
   */
  setFocus(screenX: number, screenY: number): void {
    if (!this.model) return
    const w = this.app.screen.width
    const h = this.app.screen.height
    // 用大于半边的"饱和距离"防止鼠标稍微出窗口就立刻撞到上限
    const halfW = Math.max(w / 2, 320)
    const halfH = Math.max(h / 2, 360)
    const nx = clamp((screenX - w / 2) / halfW, -1, 1) // -1..1
    const ny = clamp((screenY - h / 2) / halfH, -1, 1) // -1..1
    const core = (this.model.internalModel as any).coreModel
    if (!core) return
    try {
      core.setParameterValueById('ParamAngleX', nx * 30)
      core.setParameterValueById('ParamAngleY', -ny * 20)
      core.setParameterValueById('ParamAngleZ', nx * 8) // 轻微歪头跟随
      core.setParameterValueById('ParamBodyAngleX', nx * 10)
      core.setParameterValueById('ParamEyeBallX', nx)
      core.setParameterValueById('ParamEyeBallY', -ny)
    } catch {
      /* 参数不存在则忽略 */
    }
  }

  /**
   * 列出模型实际参数 id（调试用，配合参数嗅探）。
   */
  enumerateParams(): string[] {
    if (!this.model) return []
    const core = (this.model.internalModel as any).coreModel
    if (!core) return []
    try {
      const count = core.getParameterCount()
      const ids: string[] = []
      for (let i = 0; i < count; i++) ids.push(core.getParameterId(i))
      return ids
    } catch {
      return []
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('resize', this.onResize)
    this.app.ticker.remove(this.tick)
    this.app.destroy(true, { children: true, texture: true })
  }

  // --- 内部 tick ---

  private tick = (deltaFrames: number) => {
    if (!this.model) return
    const dtSec = deltaFrames / 60

    // 呼吸（程序化叠加，覆盖默认 BreathMotion 也可）
    this.breathPhase += dtSec
    const breath = (Math.sin(this.breathPhase * 1.2) + 1) / 2 // 0..1
    const core = (this.model.internalModel as any).coreModel
    if (core) {
      try {
        core.setParameterValueById('ParamBreath', breath, 0.6)
      } catch {
        /* ignore */
      }
    }

    // 缓动参数到 target
    if (core && this.params.size > 0) {
      const easing = 1 - Math.exp(-dtSec * 6) // 一阶低通，约 167ms 收敛
      for (const [paramId, entry] of this.params) {
        entry.current += (entry.target - entry.current) * easing
        try {
          core.setParameterValueById(paramId, entry.current, 1.0)
        } catch {
          /* 参数不存在则忽略 */
        }
      }
    }
  }

  private onResize = () => {
    if (this.destroyed) return
    this.app.renderer.resize(window.innerWidth, window.innerHeight)
    if (this.model) {
      this.model.x = this.app.screen.width / 2
      this.model.y = this.app.screen.height / 2 + 50
    }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}
