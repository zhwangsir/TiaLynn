<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'

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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="input-bar">
    <textarea
      ref="inputRef"
      v-model="text"
      :placeholder="dialog.replying ? '主人正在等回应……' : '想说点什么？'"
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
      <span>发送</span>
    </button>
    <button v-else class="abort" title="中止当前回复" @click="dialog.abort">
      <span>停</span>
    </button>
  </div>
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
</style>
