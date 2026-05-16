/**
 * Live2D 渲染器 —— 基于 pixi-live2d-display + PixiJS 6。
 *
 * 设计原则：用 SDK 标准 API，不去 hack internalModel 字段（之前的 noop 替换会让
 * SDK update 链路崩 "updateParameters is not a function"）。
 *
 * 行为：
 *   - 加载 .model3.json
 *   - 视线跟随 → 调用 `model.focus(x, y)`，SDK 自动更新 Param 链路
 *   - 自动眨眼：用 SDK 默认 EyeBlink，但把间隔调慢到 4~7s（避免之前的过频）
 *   - 嘴型同步：每帧 setParameterValueById('ParamMouthOpenY', value)
 */
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'

Live2DModel.registerTicker(PIXI.Ticker)

export interface RendererOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  backgroundAlpha?: number
}

export interface ModelOptions {
  scale?: number
  offsetY?: number
}

export class Live2DRenderer {
  readonly app: PIXI.Application
  model: Live2DModel | null = null
  private gazeX = 0
  private gazeY = 0
  private lipsyncValue = 0
  private destroyed = false

  constructor(opts: RendererOptions) {
    this.app = new PIXI.Application({
      view: opts.canvas,
      width: opts.width,
      height: opts.height,
      backgroundAlpha: opts.backgroundAlpha ?? 0,
      antialias: true,
      autoStart: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    // 让我们的参数覆盖（嘴型）在 model.update 之后跑：用 LOW 优先级
    this.app.ticker.add(this.tick, this, PIXI.UPDATE_PRIORITY.LOW)
  }

  async loadModel(modelUrl: string, opts: ModelOptions = {}): Promise<void> {
    if (this.destroyed) throw new Error('renderer destroyed')

    if (this.model) {
      try {
        this.app.stage.removeChild(this.model)
        this.model.destroy({ children: true, texture: true, baseTexture: true })
      } catch (e) {
        console.warn('[live2d] dispose old model failed', e)
      }
      this.model = null
    }

    const model = await Live2DModel.from(modelUrl, { autoInteract: false })
    this.model = model
    this.app.stage.addChild(model)

    const scale = opts.scale ?? 0.35
    model.scale.set(scale)
    model.anchor.set(0.5, 0.5)
    model.x = this.app.renderer.width / (2 * (window.devicePixelRatio || 1))
    model.y =
      this.app.renderer.height / (2 * (window.devicePixelRatio || 1)) + (opts.offsetY ?? 50)

    // 调慢默认眨眼到 4500~7500 ms（默认是 4000 ms，那个频率太频繁）
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eyeBlink = (model as any).internalModel?.eyeBlink
      if (eyeBlink && typeof eyeBlink.setBlinkingInterval === 'function') {
        // 把整个眨眼周期拉长
        eyeBlink.setBlinkingInterval(6000)
      }
    } catch (e) {
      console.warn('[live2d] tune eyeBlink failed', e)
    }
  }

  /** 视线目标：相对于 canvas 的本地坐标。SDK 自动转换到 stage 坐标。 */
  setGaze(x: number, y: number): void {
    if (!this.model) return
    this.gazeX = x
    this.gazeY = y
    try {
      // model.focus(x, y, instant?) - 平滑跟随
      this.model.focus(x, y)
    } catch (e) {
      console.warn('[live2d] focus failed', e)
    }
  }

  /** 嘴型 0~1 */
  setLipsync(value: number): void {
    this.lipsyncValue = clamp(value, 0, 1)
  }

  /** 重设大小（窗口 resize） */
  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h)
    if (this.model) {
      this.model.x = w / 2
      this.model.y = h / 2 + 50
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.app.ticker.remove(this.tick, this)
    try {
      if (this.model) {
        this.app.stage.removeChild(this.model)
        this.model.destroy({ children: true, texture: true, baseTexture: true })
      }
    } catch (e) {
      console.warn('[live2d] destroy model failed', e)
    }
    try {
      this.app.destroy(false, { children: true })
    } catch (e) {
      console.warn('[live2d] destroy app failed', e)
    }
  }

  private tick = (): void => {
    if (this.destroyed || !this.model) return
    // 我们只覆盖嘴型 —— 其它参数（眨眼、视线、姿态）走 SDK 默认链路
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cm = (this.model as any).internalModel?.coreModel
      if (cm && typeof cm.setParameterValueById === 'function') {
        cm.setParameterValueById('ParamMouthOpenY', this.lipsyncValue)
      }
    } catch {
      /* ignore */
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
