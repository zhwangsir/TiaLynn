import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { EmotionStateConfig } from '@/types/soul'

;(window as any).PIXI = PIXI

export interface RendererOptions {
  canvas: HTMLCanvasElement
  modelUrl: string
  scale: number
  offsetY?: number
}

interface Override {
  value: number
  expireAt: number
}

/**
 * 渲染器：统一管理所有参数源（focus / emotion / idle / override），
 * 每帧做一次合成，避免多源 set 互相覆盖导致的抖动。
 *
 * 合成公式（针对每个参数 id）：
 *   final = (override 在窗口内则强制)
 *         | focus_contribution + emotion_contribution + idle_offset
 */
export class TiaLynnRenderer {
  private app: PIXI.Application
  private model: Live2DModel | null = null
  private breathPhase = 0
  private destroyed = false
  private offsetY: number

  // 参数源
  private focusTarget = { x: 0, y: 0 }
  private focusCurrent = { x: 0, y: 0 }
  private emotionTargets = new Map<string, number>()
  private emotionCurrent = new Map<string, number>()
  private idleOffset = new Map<string, number>()
  private overrides = new Map<string, Override>()
  private wroteKeys = new Set<string>()

  constructor(private opts: RendererOptions) {
    this.offsetY = opts.offsetY ?? 50
    this.app = new PIXI.Application({
      view: opts.canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    this.focusCurrent = {
      x: this.app.screen.width / 2,
      y: this.app.screen.height / 2,
    }
    this.focusTarget = { ...this.focusCurrent }
    window.addEventListener('resize', this.onResize)
  }

  async load(): Promise<void> {
    const model = await Live2DModel.from(this.opts.modelUrl, { autoInteract: false })
    this.model = model
    model.scale.set(this.opts.scale)
    ;(model as any).anchor?.set?.(0.5, 0.5)
    model.x = this.app.screen.width / 2
    model.y = this.app.screen.height / 2 + this.offsetY
    this.app.stage.addChild(model)
    this.app.ticker.add(this.tick)
  }

  setFocus(screenX: number, screenY: number): void {
    this.focusTarget = { x: screenX, y: screenY }
  }

  applyEmotion(cfg: EmotionStateConfig | undefined): void {
    this.emotionTargets.clear()
    if (cfg?.live2d) {
      for (const [k, v] of Object.entries(cfg.live2d)) {
        this.emotionTargets.set(k, Number(v))
      }
    }
  }

  setIdleOffset(paramId: string, value: number): void {
    if (Math.abs(value) < 0.001) this.idleOffset.delete(paramId)
    else this.idleOffset.set(paramId, value)
  }

  clearIdleOffsets(): void {
    this.idleOffset.clear()
  }

  /**
   * 短时强制覆盖某参数。眨眼、嘴型同步、其他绝对值动作用。
   * 过期后参数自动回到合成结果。
   */
  overrideParam(paramId: string, value: number, durationMs: number): void {
    this.overrides.set(paramId, {
      value,
      expireAt: performance.now() + durationMs,
    })
  }

  /** 嘴型同步：每次音频帧调用，override 80ms。 */
  setMouthOpen(value01: number): void {
    this.overrideParam('ParamMouthOpenY', clamp(value01, 0, 1), 80)
  }

  setScaleAndOffset(scale: number, offsetY: number): void {
    if (!this.model) return
    this.model.scale.set(scale)
    this.offsetY = offsetY
    this.model.y = this.app.screen.height / 2 + offsetY
  }

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

  private tick = (deltaFrames: number) => {
    if (!this.model) return
    const dtSec = Math.min(deltaFrames / 60, 0.1)
    const core = (this.model.internalModel as any).coreModel
    if (!core) return

    // 呼吸
    this.breathPhase += dtSec
    const breath = (Math.sin(this.breathPhase * 1.2) + 1) / 2
    safeSet(core, 'ParamBreath', breath)

    // focus 缓动
    const focusEase = 1 - Math.exp(-dtSec * 5)
    this.focusCurrent.x += (this.focusTarget.x - this.focusCurrent.x) * focusEase
    this.focusCurrent.y += (this.focusTarget.y - this.focusCurrent.y) * focusEase

    // emotion 缓动
    const emotionEase = 1 - Math.exp(-dtSec * 4)
    for (const k of [...this.emotionCurrent.keys()]) {
      if (!this.emotionTargets.has(k)) {
        const cur = this.emotionCurrent.get(k) ?? 0
        const next = cur + (0 - cur) * emotionEase
        if (Math.abs(next) < 0.005) this.emotionCurrent.delete(k)
        else this.emotionCurrent.set(k, next)
      }
    }
    for (const [k, target] of this.emotionTargets) {
      const cur = this.emotionCurrent.get(k) ?? 0
      this.emotionCurrent.set(k, cur + (target - cur) * emotionEase)
    }

    const w = this.app.screen.width
    const h = this.app.screen.height
    const halfW = Math.max(w / 2, 320)
    const halfH = Math.max(h / 2, 360)
    const nx = clamp((this.focusCurrent.x - w / 2) / halfW, -1, 1)
    const ny = clamp((this.focusCurrent.y - h / 2) / halfH, -1, 1)
    const focusParams: Record<string, number> = {
      ParamAngleX: nx * 28,
      ParamAngleY: -ny * 18,
      ParamAngleZ: nx * 6,
      ParamBodyAngleX: nx * 8,
      ParamEyeBallX: nx,
      ParamEyeBallY: -ny,
    }

    const allKeys = new Set<string>()
    for (const k of Object.keys(focusParams)) allKeys.add(k)
    for (const k of this.emotionCurrent.keys()) allKeys.add(k)
    for (const k of this.idleOffset.keys()) allKeys.add(k)
    for (const k of this.overrides.keys()) allKeys.add(k)
    for (const k of this.wroteKeys) allKeys.add(k)

    const now = performance.now()
    const newWrote = new Set<string>()

    for (const k of allKeys) {
      const ov = this.overrides.get(k)
      let value: number
      if (ov && now <= ov.expireAt) {
        value = ov.value
      } else {
        if (ov) this.overrides.delete(k)
        value = composeBase(k, focusParams, this.emotionCurrent, this.idleOffset)
      }
      safeSet(core, k, value)
      newWrote.add(k)
    }
    this.wroteKeys = newWrote
  }

  private onResize = () => {
    if (this.destroyed) return
    this.app.renderer.resize(window.innerWidth, window.innerHeight)
    if (this.model) {
      this.model.x = this.app.screen.width / 2
      this.model.y = this.app.screen.height / 2 + this.offsetY
    }
  }
}

function composeBase(
  k: string,
  focusParams: Record<string, number>,
  emotionCurrent: Map<string, number>,
  idleOffset: Map<string, number>,
): number {
  const f = focusParams[k] ?? 0
  const e = emotionCurrent.get(k) ?? 0
  const i = idleOffset.get(k) ?? 0
  return f + e + i
}

function safeSet(core: any, id: string, value: number): void {
  try {
    core.setParameterValueById(id, value)
  } catch {
    /* 参数不存在则忽略 */
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}
