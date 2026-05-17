/**
 * pixi-live2d-display 没有在公开类型中暴露 internalModel 的字段。
 * 这里通过 intersection 补充我们实际访问到的字段，消除 as any 强转。
 */
import type { Live2DModel } from 'pixi-live2d-display/cubism4'

export interface Live2DCoreModel {
  getPartCount?: () => number
  getPartId?: (i: number) => string
  setPartOpacityByIndex?: (i: number, opacity: number) => void
  setPartOpacity?: (id: string, opacity: number) => void
  setParameterValueById?: (id: string, value: number) => void
}

export interface Live2DEyeBlink {
  setBlinkingInterval?: (ms: number) => void
}

export interface Live2DInternalModel {
  coreModel?: Live2DCoreModel
  eyeBlink?: Live2DEyeBlink
  originalWidth?: number
  originalHeight?: number
  settings?: {
    motions?: Record<string, unknown[]>
    json?: {
      FileReferences?: {
        Motions?: Record<string, unknown[]>
      }
    }
  }
}

export interface Live2DModelInternal {
  internalModel?: Live2DInternalModel
  motion?: (group: string, index?: number, priority?: number) => void
}

/** Live2DModel 附带 internalModel 字段的扩展类型。 */
export type ExtLive2DModel = Live2DModel & Live2DModelInternal
