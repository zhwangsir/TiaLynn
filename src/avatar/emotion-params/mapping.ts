import type { EmotionId, EmotionStateConfig } from '@/brain/types/soul'

/**
 * 默认情绪 → Live2D 参数表。
 * 当 SoulConfig.emotions.states 缺失某情绪时，回退使用此处。
 */
export const DEFAULT_EMOTION_PARAMS: Record<EmotionId, EmotionStateConfig> = {
  neutral: { color: '#cbd5e1', live2d: {} },
  happy: {
    color: '#fbbf24',
    live2d: { ParamMouthForm: 1.0, ParamEyeLOpen: 1.0, ParamEyeROpen: 1.0, ParamAngleZ: 3 },
  },
  shy: {
    color: '#f9a8d4',
    live2d: { ParamCheek: 1.0, ParamAngleZ: -5, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7 },
  },
  angry: {
    color: '#f87171',
    live2d: { ParamBrowLY: -1.0, ParamBrowRY: -1.0, ParamMouthForm: -1.0 },
  },
  sad: {
    color: '#94a3b8',
    live2d: {
      ParamBrowLAngle: -1.0,
      ParamBrowRAngle: -1.0,
      ParamMouthOpenY: 0.2,
      ParamMouthForm: -0.5,
    },
  },
  sleepy: {
    color: '#a78bfa',
    live2d: { ParamEyeLOpen: 0.3, ParamEyeROpen: 0.3, ParamAngleY: -3 },
  },
  possessive: {
    color: '#7c3aed',
    live2d: { ParamEyeBallX: 0, ParamEyeBallY: 0, ParamBrowLY: 1.0, ParamBrowRY: 1.0 },
  },
}
