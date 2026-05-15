/**
 * Persona FSM：让 TiaLynn 在桌面上"活起来"。
 *
 * 状态：stand / walk / run / sit / sleep / peek
 *
 * 决策驱动（每 1s tick 一次）：
 *  - energy 0-100：精力（白天回升，夜里下降，睡觉快速回升）
 *  - attention 0-100：注意力（鼠标靠近 / 用户互动 → 升高，无交互 → 降低）
 *  - mood 0-100：心情（被夸赞/对话愉快 → 升，被怼 → 降）
 *  - curiosity 0-100：好奇心（突发事件 → 升）
 *
 * 状态转换逻辑见 decideNextState。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { TiaLynnRenderer } from '@/live2d/renderer'

export type PersonaState = 'stand' | 'walk' | 'run' | 'sit' | 'sleep' | 'peek'

interface MotionTickPayload {
  x: number
  y: number
  t: number
  moving: boolean
}

interface ScreenInfo {
  width: number // 物理像素
  height: number
  scaleFactor: number
}

class Persona {
  energy = 80
  mood = 65
  attention = 50
  curiosity = 40
  state: PersonaState = 'stand'
  stateEnteredAt = performance.now()
  walking = false
  facingRight = true
  private renderer: TiaLynnRenderer | null = null
  private screen: ScreenInfo = { width: 1920, height: 1080, scaleFactor: 2 }
  private windowSize = { w: 320, h: 480 } // CSS 像素，物理 = ×scaleFactor
  private mouseInside = false
  private lastMouseMoveAt = performance.now()
  private lastMouseGlobal = { x: 0, y: 0 }
  private tickHandle: number | null = null
  private motionRequestActive = false

  // 移动控制配置（从 store 读）
  private motionEnabled = true
  private motionMinSec = 90
  private motionMaxSec = 300
  private motionSpeed = 1.0

  private nextMotionAt = performance.now() + 60_000 // 启动 60s 后才考虑首次移动

  attach(renderer: TiaLynnRenderer): void {
    this.renderer = renderer
  }

  setConfig(opts: {
    enabled: boolean
    minSec: number
    maxSec: number
    speed: number
  }): void {
    this.motionEnabled = opts.enabled
    this.motionMinSec = Math.max(20, opts.minSec)
    this.motionMaxSec = Math.max(this.motionMinSec + 10, opts.maxSec)
    this.motionSpeed = Math.max(0.3, Math.min(3, opts.speed))
  }

  async start(): Promise<void> {
    try {
      const [w, h, sf] = await invoke<[number, number, number]>('motion_screen_size')
      this.screen = { width: w, height: h, scaleFactor: sf }
    } catch (e) {
      console.warn('[persona] screen_size failed', e)
    }
    this.windowSize = { w: window.innerWidth, h: window.innerHeight }

    await Promise.all([
      listen<MotionTickPayload>('motion::tick', (e) => {
        this.walking = e.payload.moving
      }),
      listen<void>('motion::end', () => {
        this.walking = false
        this.motionRequestActive = false
      }),
      listen<{
        mouse_phys_x: number
        mouse_phys_y: number
        win_phys_x: number
        win_phys_y: number
        win_phys_w: number
        win_phys_h: number
        inside: boolean
        scale_factor: number
      }>('mouse::global', (e) => {
        const p = e.payload
        this.mouseInside = p.inside
        this.screen.scaleFactor = p.scale_factor
        // 检测鼠标"是否真的在动"
        const movedDx = Math.abs(p.mouse_phys_x - this.lastMouseGlobal.x)
        const movedDy = Math.abs(p.mouse_phys_y - this.lastMouseGlobal.y)
        if (movedDx > 4 || movedDy > 4) {
          this.lastMouseMoveAt = performance.now()
          // 用户在动 → attention 抬升
          this.attention = Math.min(100, this.attention + 0.4)
        }
        this.lastMouseGlobal = { x: p.mouse_phys_x, y: p.mouse_phys_y }
      }),
    ])

    if (this.tickHandle === null) {
      this.tickHandle = window.setInterval(() => this.tick(), 1000)
    }
  }

  stop(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle)
      this.tickHandle = null
    }
  }

  private tick(): void {
    const now = performance.now()
    const hour = new Date().getHours()
    const inDeepNight = hour >= 0 && hour < 6
    const inNight = hour >= 22 || hour < 7

    // 1. 自然漂移
    if (this.state === 'sleep') {
      this.energy = Math.min(100, this.energy + 1.2)
    } else if (inDeepNight) {
      this.energy = Math.max(0, this.energy - 0.4)
    } else if (inNight) {
      this.energy = Math.max(0, this.energy - 0.15)
    } else {
      this.energy = Math.max(0, Math.min(100, this.energy + 0.05))
    }

    // attention 衰减（用户不动 → 越来越无聊）
    const secSinceMove = (now - this.lastMouseMoveAt) / 1000
    if (secSinceMove > 30) {
      this.attention = Math.max(0, this.attention - 0.3)
    }

    // mood 向 50 缓慢回归
    this.mood += (50 - this.mood) * 0.005

    // 2. 决策
    const desired = this.decideNextState({ inDeepNight, inNight, secSinceMove })
    if (desired !== this.state) {
      this.transitionTo(desired)
    }

    // 3. 状态 tick
    this.tickState()

    // 4. 是否要触发一次自主移动
    this.maybeScheduleMotion(now)
  }

  private decideNextState(ctx: {
    inDeepNight: boolean
    inNight: boolean
    secSinceMove: number
  }): PersonaState {
    // 深夜累了 → 睡
    if (this.energy < 25 && ctx.inNight) return 'sleep'
    if (this.energy < 12) return 'sleep'

    // 鼠标在窗口里 + 离立绘很近 → peek（探头看）
    if (this.mouseInside && this.attention > 60) return 'peek'

    // 用户长时间不动 → 主动接近（这里只切到 walk，目标点由 maybeScheduleMotion 给）
    if (ctx.secSinceMove > 120 && this.attention < 30) {
      return 'walk'
    }

    // 当前在移动中 → 保持 walk/run
    if (this.walking) {
      return this.mood > 80 ? 'run' : 'walk'
    }

    // 心情很好 + 精力够 → 随机走动概率高
    // 默认大部分时间站着
    return 'stand'
  }

  private transitionTo(next: PersonaState): void {
    this.state = next
    this.stateEnteredAt = performance.now()
    // 通知前端其他模块（可选）
    window.dispatchEvent(new CustomEvent('persona:state', { detail: next }))
  }

  private tickState(): void {
    if (!this.renderer) return
    const t = (performance.now() - this.stateEnteredAt) / 1000

    switch (this.state) {
      case 'walk': {
        // 走路：身体上下波动（呼吸放大）+ 左右摆
        const phase = t * Math.PI * 2 * 1.8 * this.motionSpeed
        const sway = Math.sin(phase) * 4
        const bob = Math.abs(Math.sin(phase * 2)) * 0.2
        this.renderer.setIdleOffset('ParamBodyAngleZ', sway)
        this.renderer.setIdleOffset('ParamBodyAngleY', -bob * 5)
        this.renderer.setIdleOffset('ParamAngleZ', sway * 0.5)
        break
      }
      case 'run': {
        const phase = t * Math.PI * 2 * 3.0 * this.motionSpeed
        const sway = Math.sin(phase) * 8
        const bob = Math.abs(Math.sin(phase * 2)) * 0.4
        this.renderer.setIdleOffset('ParamBodyAngleZ', sway)
        this.renderer.setIdleOffset('ParamBodyAngleY', -bob * 8)
        this.renderer.setIdleOffset('ParamAngleZ', sway * 0.6)
        this.renderer.setIdleOffset('ParamAngleY', 6) // 头微前倾
        break
      }
      case 'sit': {
        this.renderer.setIdleOffset('ParamBodyAngleY', -10)
        this.renderer.setIdleOffset('ParamAngleY', -3)
        break
      }
      case 'sleep': {
        const breath = (Math.sin(t * 0.6) + 1) / 2
        this.renderer.overrideParam('ParamEyeLOpen', 0.05, 1200)
        this.renderer.overrideParam('ParamEyeROpen', 0.05, 1200)
        this.renderer.setIdleOffset('ParamAngleY', -8)
        this.renderer.setIdleOffset('ParamBodyAngleY', -6 - breath * 3)
        break
      }
      case 'peek': {
        // 探头看：身体微前倾 + 害羞
        this.renderer.setIdleOffset('ParamAngleZ', -3)
        this.renderer.setIdleOffset('ParamCheek', 0.6)
        this.renderer.setIdleOffset('ParamBodyAngleX', 4)
        break
      }
      case 'stand':
      default: {
        // 清空 idle offset，让 renderer 合成基线
        this.renderer.setIdleOffset('ParamBodyAngleZ', 0)
        this.renderer.setIdleOffset('ParamBodyAngleY', 0)
        this.renderer.setIdleOffset('ParamBodyAngleX', 0)
        this.renderer.setIdleOffset('ParamAngleZ', 0)
        this.renderer.setIdleOffset('ParamAngleY', 0)
        this.renderer.setIdleOffset('ParamCheek', 0)
        break
      }
    }
  }

  private async maybeScheduleMotion(now: number): Promise<void> {
    if (!this.motionEnabled) return
    if (this.motionRequestActive) return
    if (this.state === 'sleep') return
    if (now < this.nextMotionAt) return

    // 拿当前窗口位置，用于计算距离 → 决定移动时长
    let curX = 0
    let curY = 0
    try {
      const status = await invoke<{ x: number; y: number }>('motion_status')
      curX = status.x
      curY = status.y
    } catch (e) {
      console.debug('[persona] motion_status failed', e)
    }

    const target = this.pickTarget()
    const dist = Math.hypot(target.px - curX, target.py - curY)
    // 物理像素/秒；motion_speed 默认 1.0
    const duration = Math.max(1.8, Math.min(8, dist / (260 * this.motionSpeed)))

    this.motionRequestActive = true
    try {
      await invoke('motion_set_target', {
        x: target.px,
        y: target.py,
        durationSec: duration,
      })
    } catch (e) {
      console.warn('[persona] motion_set_target failed', e)
      this.motionRequestActive = false
      return
    }

    const waitSec =
      this.motionMinSec + Math.random() * (this.motionMaxSec - this.motionMinSec)
    this.nextMotionAt = now + waitSec * 1000 + duration * 1000
  }

  private pickTarget(): { px: number; py: number } {
    const sf = this.screen.scaleFactor
    const winW = this.windowSize.w * sf
    const winH = this.windowSize.h * sf
    const margin = 20 * sf
    const xRange = this.screen.width - winW - margin * 2
    const yRange = this.screen.height - winH - margin * 2
    const px = Math.round(margin + Math.random() * Math.max(0, xRange))
    const py = Math.round(margin + Math.random() * Math.max(0, yRange))
    return { px, py }
  }
}

export const persona = new Persona()
