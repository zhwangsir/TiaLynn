import type { EmotionId } from '@shared/types'

export interface DialogTurn {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  emotion?: EmotionId
  intensity?: number
  ts: number
  /** 流式中？ */
  streaming?: boolean
  error?: string
}

export interface ParsedReply {
  text: string
  emotion: EmotionId
  intensity: number
}
