/**
 * 全域事件总线 —— 五大域间通信。
 *
 * 设计原则：跨域通信走事件，不互相 import 域内组件 / store。
 */
import mitt, { type Emitter } from 'mitt'
import type { EmotionId } from '@shared/types'
import type { MotionDraft } from '@shared/motion'

export type BusEventMap = {
  /* 立绘 */
  'avatar:model-loaded': { model_path: string; cubism: 'cubism2' | 'cubism4' }
  'avatar:model-error': { reason: string }
  'avatar:mouse-inside': { inside: boolean; x: number; y: number }
  'avatar:lipsync': { value: number } // 0~1，AudioWorklet 实时输出
  /** 用户在立绘上右键 → 打开主菜单 */
  'avatar:contextmenu': { x: number; y: number }
  /* 大脑 */
  'brain:chat-input': { text: string }
  'brain:reply-token': { stream_id: string; delta: string }
  'brain:reply-end': { stream_id: string; full_text: string; emotion?: EmotionId; intensity?: number }
  'brain:reply-error': { stream_id: string; error: string }
  'brain:emotion-changed': { emotion: EmotionId; intensity: number }
  /* 在场 */
  'presence:tts-start': { audio_url: string; emotion: EmotionId }
  'presence:tts-end': void
  'presence:stt-result': { text: string }
  /* 配置 */
  'infra:config-changed': void
  'infra:soul-reloaded': void
  /* 通知 */
  'ui:toast': { kind: 'info' | 'warn' | 'error' | 'success'; message: string; ttl_ms?: number }
  /* 动作播放 (v0.7.4) */
  'avatar:play-draft': { draft: MotionDraft; on_end?: () => void }
  'avatar:stop-motion': void
  'avatar:motion-started': { draft_name: string }
  'avatar:motion-ended': { draft_name: string }
}

export const bus: Emitter<BusEventMap> = mitt<BusEventMap>()
