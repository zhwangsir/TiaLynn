<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'

const emit = defineEmits<{ (e: 'close'): void }>()

const dialog = useDialogStore()
const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

async function submit(): Promise<void> {
  const v = text.value.trim()
  if (!v) return
  text.value = ''
  await dialog.send(v)
  await nextTick()
  inputRef.value?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
})

onBeforeUnmount(() => {
  // 中止流式对话（如有）
  if (dialog.replying) dialog.abort()
})
</script>

<template>
  <transition name="bar">
    <div class="input-bar">
      <textarea
        ref="inputRef"
        v-model="text"
        :placeholder="dialog.replying ? '主人正在等回应……' : '想说点什么？  Enter 发送 · Esc 关闭'"
        :disabled="dialog.replying"
        rows="1"
        class="input"
        @keydown="onKey"
      />
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
