<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'
import { estimateTokens } from '../../brain/token-estimate'
import { SttSession } from '../../presence/stt/web-speech'
import { useCharacterStore } from '../stores/character'

const emit = defineEmits<{ (e: 'close'): void }>()

const dialog = useDialogStore()
const character = useCharacterStore()
const placeholderTip = computed<string>(() => {
  const name = character.active?.name?.trim()
  return name ? `想对 ${name} 说什么？  Enter 发送 · Esc 关闭` : '想说点什么？  Enter 发送 · Esc 关闭'
})
const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

// F: STT — Electron Chromium 原生支持 SpeechRecognition
const sttSupported = ref(SttSession.isSupported())
const sttListening = ref(false)
const sttError = ref('')
let sttSession: SttSession | null = null

function toggleStt(): void {
  if (!sttSupported.value) return
  if (sttSession?.isActive()) {
    sttSession.stop()
    return
  }
  sttError.value = ''
  sttSession = new SttSession({
    onStart: () => { sttListening.value = true },
    onInterim: (t) => { text.value = t },  // 实时显示在 input
    onFinal: (t) => {
      text.value = t
      // 用户停顿即自动发 — 桌宠对话场景下"说完即发"更自然
      void submit()
    },
    onError: (err) => {
      sttListening.value = false
      // not-allowed = 麦克风权限被拒；no-speech = 没说话不算错
      if (err !== 'no-speech' && err !== 'aborted') {
        sttError.value = err === 'not-allowed' ? '请授权麦克风' : `STT 错误: ${err}`
      }
    },
    onEnd: () => { sttListening.value = false },
  }, { lang: 'zh-CN' })
  sttSession.start()
}

async function submit(): Promise<void> {
  const v = text.value.trim()
  if (!v) return
  text.value = ''
  // R39 fix (HIGH): 发送后重置历史浏览态 — 否则下次 ↑ 从旧位置继续, 行为偏离 terminal/Zsh
  historyIdx.value = -1
  draftBeforeBrowse.value = null
  await dialog.send(v)
  await nextTick()
  inputRef.value?.focus()
}

// R36: ↑↓ 浏览 user 历史消息 (terminal / Slack 风格)
const userHistory = computed<string[]>(() => {
  // 从最新往旧，去重连续相同
  const out: string[] = []
  let last = ''
  for (let i = dialog.turns.length - 1; i >= 0; i--) {
    const t = dialog.turns[i]
    if (t?.role !== 'user') continue
    const txt = t.text.trim()
    if (!txt || txt === last) continue
    out.push(txt)
    last = txt
    if (out.length >= 50) break
  }
  return out
})
const historyIdx = ref(-1) // -1 = 没浏览, 0 = 最新, 1 = 上一条...
const draftBeforeBrowse = ref<string | null>(null) // 保存浏览前用户已打的草稿

/** R50: 仅在 > 50 字时计算并显示, 短输入无需提示 */
const estimatedTokens = computed<number>(() => {
  const t = text.value
  if (!t || t.length < 50) return 0
  return estimateTokens(t)
})

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
    return
  }
  // ↑↓ 历史浏览 — 仅当 cursor 在首/末位置（无选区）且单行不跨行
  // R39 fix (MED): cursor 必须严格在 selectionStart === 0 (Zsh 惯例)
  const ta = e.target as HTMLTextAreaElement
  const hasSelection = ta.selectionStart !== ta.selectionEnd
  if (e.key === 'ArrowUp' && !e.shiftKey && !e.isComposing && !hasSelection) {
    const beforeCursor = ta.value.slice(0, ta.selectionStart)
    if (!beforeCursor.includes('\n') && ta.selectionStart === 0) {
      const hist = userHistory.value
      if (hist.length === 0) return
      if (historyIdx.value < 0) draftBeforeBrowse.value = text.value
      const next = Math.min(historyIdx.value + 1, hist.length - 1)
      if (next !== historyIdx.value) {
        e.preventDefault()
        historyIdx.value = next
        text.value = hist[next]!
        void nextTick(() => {
          ta.setSelectionRange(text.value.length, text.value.length)
        })
      }
    }
  } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.isComposing && !hasSelection) {
    if (historyIdx.value < 0) return
    const afterCursor = ta.value.slice(ta.selectionStart)
    // R39 fix (MED): cursor 必须在最末位置
    if (!afterCursor.includes('\n') && ta.selectionStart === ta.value.length) {
      e.preventDefault()
      const next = historyIdx.value - 1
      if (next < 0) {
        historyIdx.value = -1
        text.value = draftBeforeBrowse.value ?? ''
        draftBeforeBrowse.value = null
      } else {
        historyIdx.value = next
        text.value = userHistory.value[next]!
      }
      void nextTick(() => {
        ta.setSelectionRange(text.value.length, text.value.length)
      })
    }
  } else if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
    // 任何其他按键 = 用户开始编辑 → 重置浏览态
    if (historyIdx.value >= 0) {
      historyIdx.value = -1
      draftBeforeBrowse.value = null
    }
  }
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})

onBeforeUnmount(() => {
  sttSession?.abort()
  if (dialog.replying) dialog.abort()
})
</script>

<template>
  <transition name="bar">
    <div class="input-bar">
      <span
        v-if="historyIdx >= 0"
        class="history-badge"
        :aria-label="`正在浏览历史第 ${historyIdx + 1} 条`"
      >↑ 历史 {{ historyIdx + 1 }}/{{ userHistory.length }}</span>
      <span
        v-if="estimatedTokens > 0 && historyIdx < 0"
        class="token-badge"
        :aria-label="`估算 ${estimatedTokens} tokens`"
        title="估算 LLM token 数 (中文 ≈ 1/字, 英文 ≈ 1/4 字)"
      >~{{ estimatedTokens }} tok</span>
      <textarea
        ref="inputRef"
        v-model="text"
        :placeholder="
          sttListening ? '正在听 ……'
          : dialog.replying ? '主人正在等回应……'
          : sttError ? sttError
          : placeholderTip
        "
        :disabled="dialog.replying"
        rows="1"
        class="input"
        @keydown="onKey"
      />
      <button
        v-if="sttSupported && !dialog.replying"
        class="mic"
        :class="{ listening: sttListening }"
        :title="sttListening ? '停止录音' : '语音输入 (中文识别)'"
        @click="toggleStt"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
      <button
        v-if="!dialog.replying"
        class="send"
        :disabled="!text.trim()"
        title="Enter 发送 / Shift+Enter 换行"
        @click="submit"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      </button>
      <button v-else class="abort" title="中止当前回复" @click="dialog.abort">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
      <button class="close" title="关闭 (Esc)" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  </transition>
</template>

<style scoped>
.input-bar {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: 14px;
  display: flex;
  gap: 6px;
  align-items: flex-end;
  pointer-events: auto;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  padding: 6px 6px 6px 8px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.input-bar:focus-within {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-md), var(--shadow-focus);
}
/* R42: 历史浏览角标 — 浮在 InputBar 左上方 */
.history-badge {
  position: absolute;
  top: -22px;
  left: 8px;
  padding: 2px 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 600;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  pointer-events: none;
  animation: badge-in 0.2s var(--ease-out-back);
}
/* R50: token 估算角标 — 浮在 InputBar 右上方 */
.token-badge {
  position: absolute;
  top: -22px;
  right: 8px;
  padding: 2px 8px;
  background: var(--color-bubble-surface);
  color: var(--color-muted);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  pointer-events: auto;
  cursor: help;
  animation: badge-in 0.2s var(--ease-out-back);
}
@keyframes badge-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.input {
  flex: 1;
  border: 0;
  outline: 0;
  resize: none;
  font: inherit;
  background: transparent;
  color: var(--color-bubble-text);
  min-height: 32px;
  max-height: 160px;
  padding: 8px 8px;
  line-height: 1.45;
  font-size: var(--text-sm);
  field-sizing: content;
}
.input::placeholder {
  color: var(--color-muted);
}
.input:disabled {
  opacity: 0.7;
  cursor: wait;
}
.send,
.abort {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  box-shadow: var(--shadow-sm);
  white-space: nowrap;
  flex-shrink: 0;
}
.send:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
}
.send:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--color-accent-hover);
  box-shadow: var(--shadow-md);
}
.abort {
  background: var(--color-danger);
  animation: abort-pulse 1.2s var(--ease-in-out) infinite;
}
.abort:hover {
  transform: scale(1.05);
}
@keyframes abort-pulse {
  0%, 100% { box-shadow: 0 0 0 0 oklch(60% 0.22 25 / 0); }
  50% { box-shadow: 0 0 0 6px oklch(60% 0.22 25 / 0.15); }
}
.mic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-bubble-border);
  flex-shrink: 0;
  transition: all 150ms;
}
.mic:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: oklch(95% 0.05 25 / 0.3);
}
.mic.listening {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
  animation: mic-pulse 1.2s var(--ease-in-out) infinite;
}
@keyframes mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 oklch(72% 0.18 18 / 0); }
  50% { box-shadow: 0 0 0 8px oklch(72% 0.18 18 / 0.15); }
}
.close {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--color-muted);
  flex-shrink: 0;
}
.close:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}

.bar-enter-active,
.bar-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.bar-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.98);
}
.bar-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.99);
}
</style>
