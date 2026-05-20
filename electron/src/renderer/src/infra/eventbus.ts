/**
 * 全域事件总线 —— 五大域间通信。
 *
 * 设计原则：跨域通信走事件，不互相 import 域内组件 / store。
 */
import mitt, { type Emitter } from 'mitt'
import type { EmotionId } from '@shared/types'
import type { MotionDraft } from '@shared/motion'
import type { BehaviorAction, BehaviorPlan } from '@shared/attention'

export type BusEventMap = {
  /* 立绘 */
  'avatar:model-loaded': { model_path: string; cubism: 'cubism2' | 'cubism4' }
  'avatar:model-error': { reason: string }
  'avatar:mouse-inside': { inside: boolean; x: number; y: number }
  'avatar:lipsync': { value: number } // 0~1，AudioWorklet 实时输出 (mouthOpen)
  /** Phase 1: wlipsync 输出的 AEIOU 元音权重 — 留给未来驱动 Live2D ParamMouthA/E/I/O/U 多参数 */
  'avatar:vowel-weights': { A: number; E: number; I: number; O: number; U: number }
  /** 用户在立绘上右键 → 打开主菜单 */
  'avatar:contextmenu': { x: number; y: number }
  /** v0.8.2: 强制重载当前 Live2D 模型（比如动作工坊新写了 motion / Heal 完成后） */
  'avatar:reload-model': void
  /** v0.9: 立绘缩放 — dock 上 ⊕⊖ 按钮触发。delta=0 + reset:true 表示复原 auto-fit */
  'avatar:zoom': { delta: number; reset?: boolean }
  /* 大脑 */
  'brain:chat-input': { text: string }
  'brain:reply-token': { stream_id: string; delta: string }
  'brain:reply-end': { stream_id: string; full_text: string; emotion?: EmotionId; intensity?: number }
  'brain:reply-error': { stream_id: string; error: string }
  'brain:emotion-changed': { emotion: EmotionId; intensity: number }
  /** v0.8.2: dialog LLM 在 reply 里附带的 actions（瞥屏/换表情/idle 等），让 plan-executor 执行 */
  'brain:reply-actions': { actions: BehaviorAction[] }
  /** v0.13: 主体性 plan 主动注入 assistant 回合（避免 avatar 域直接 import brain/stores） */
  'brain:inject-utterance': { text: string; emotion: EmotionId; intensity: number }
  /** v0.14: character 切换通知，所有域可监听重新加载 */
  'character:switched': { character: import('@shared/character').Character }
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
  /* 主体性 Behavior 执行 (v0.8) */
  'attention:execute-plan': { plan: BehaviorPlan }
}

export const bus: Emitter<BusEventMap> = mitt<BusEventMap>()
