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
        :placeholder="dialog.replying ? '主人正在等回应……' : '想说点什么？  Esc 关闭'"
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
        发送
      </button>
      <button v-else class="abort" title="中止当前回复" @click="dialog.abort">停</button>
      <button class="close" title="关闭 (Esc)" @click="emit('close')">×</button>
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
  gap: 8px;
  align-items: flex-end;
  pointer-events: auto;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  padding: 8px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
}
.input {
  flex: 1;
  border: 0;
  outline: 0;
  resize: none;
  font: inherit;
  background: transparent;
  color: var(--color-bubble-text);
  min-height: 28px;
  max-height: 160px;
  padding: 6px 8px;
  line-height: 1.45;
  font-size: var(--text-sm);
  field-sizing: content;
}
.input::placeholder {
  color: var(--color-muted);
}
.send,
.abort {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 600;
  background: var(--color-accent);
  color: var(--color-accent-text);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-fast), opacity var(--duration-fast);
  white-space: nowrap;
}
.send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.send:hover:not(:disabled) {
  transform: translateY(-1px);
}
.abort {
  background: var(--color-danger);
}
.close {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 18px;
  line-height: 1;
  color: var(--color-muted);
  flex-shrink: 0;
}
.close:hover {
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
}

.bar-enter-active,
.bar-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.bar-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.bar-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
