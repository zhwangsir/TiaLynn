/**
 * TiaLynn 事件总线（前端）。
 *
 * 模块间通信必须经此（不允许跨域 import 内部函数）。
 * 事件命名约定：`<domain>:<verb>_<noun>`，全小写下划线。
 *
 * Rust ↔ 前端 通信仍用 Tauri `emit` / `listen`。
 */
import mitt, { type Emitter } from 'mitt'
import type { EmotionId } from '@/brain/types/soul'

// mitt 要求 Record<EventType, unknown> —— 用 type 别名而非 interface
// （interface 在 TS 中不自动满足索引签名）
export type EventMap = {
  // ---------- Infra ----------
  'infra:config_loaded': void
  'infra:config_changed': { keys: string[] }
  'infra:soul_reloaded': void
  'infra:hotkey_pressed': { key: string }
  'infra:app_quitting': void

  // ---------- Brain ----------
  'brain:chat_input': { text: string }
  'brain:reply_token': { stream_id: string; delta: string }
  'brain:reply_end': {
    stream_id: string
    full_text: string
    emotion?: EmotionId
    intensity?: number
  }
  'brain:emotion_changed': { emotion: EmotionId; intensity: number }
  'brain:thinking_start': { stream_id: string }
  'brain:thinking_end': { stream_id: string }

  // ---------- Avatar ----------
  'avatar:model_loaded': { model_path: string; cubism: string }
  'avatar:model_load_failed': { reason: string }
  'avatar:mouse_inside': { inside: boolean }
  'avatar:dragged': { x: number; y: number }

  // ---------- Presence ----------
  'presence:tts_start': { audio_path: string; emotion: EmotionId | string }
  'presence:tts_end': void
  'presence:tts_error': { reason: string }
  'presence:stt_start': void
  'presence:stt_result': { text: string }
  'presence:stt_error': { reason: string }
  'presence:proactive_speak': { hint: string } // M5

  // ---------- Hands （M4） ----------
  'hands:tool_request': { tool: string; args: Record<string, unknown> }
  'hands:tool_result': { tool: string; ok: boolean; output?: unknown; error?: string }
  'hands:approval_required': { tool: string; args: Record<string, unknown>; id: string }
  'hands:approval_decision': { id: string; approved: boolean }
}

export const bus: Emitter<EventMap> = mitt<EventMap>()

// 便利方法：兼容旧用法（含 payload-less 事件）
export function emit<K extends keyof EventMap>(
  type: K,
  ...args: EventMap[K] extends void ? [] : [EventMap[K]]
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(bus.emit as any)(type, args[0])
}

// 开发模式：把所有事件打到 console，方便调试
if (import.meta.env.DEV) {
  bus.on('*', (type, e) => {
    console.debug('[bus]', type, e ?? '')
  })
}
