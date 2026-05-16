<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { bus } from '../eventbus'

interface Toast {
  id: number
  kind: 'info' | 'warn' | 'error' | 'success'
  message: string
}

const toasts = ref<Toast[]>([])
let nextId = 1
const MAX_VISIBLE = 4

let offHandler: (() => void) | null = null

function push(kind: Toast['kind'], message: string, ttl: number): void {
  const id = nextId++
  toasts.value.push({ id, kind, message })
  if (toasts.value.length > MAX_VISIBLE) {
    toasts.value.splice(0, toasts.value.length - MAX_VISIBLE)
  }
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, ttl)
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

onMounted(() => {
  const handler = ({
    kind,
    message,
    ttl_ms,
  }: {
    kind: Toast['kind']
    message: string
    ttl_ms?: number
  }): void => {
    push(kind, message, ttl_ms ?? 4000)
  }
  bus.on('ui:toast', handler)
  offHandler = () => bus.off('ui:toast', handler)
})

onBeforeUnmount(() => {
  offHandler?.()
})

const iconFor: Record<Toast['kind'], string> = {
  info: 'ℹ',
  warn: '⚠',
  error: '✕',
  success: '✓',
}
</script>

<template>
  <div class="stack" aria-live="polite">
    <transition-group name="toast" tag="div">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.kind"
        role="status"
        @click="dismiss(t.id)"
      >
        <span class="icon">{{ iconFor[t.kind] }}</span>
        <span class="msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.stack {
  position: fixed;
  right: 18px;
  bottom: 80px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1500;
  pointer-events: none;
  max-width: 320px;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  color: var(--color-bubble-text);
  font-size: var(--text-sm);
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  transition: transform var(--duration-fast);
}
.toast:hover {
  transform: translateX(-2px);
}
.toast.error {
  border-color: oklch(80% 0.12 25 / 0.7);
  color: oklch(40% 0.15 25);
}
.toast.warn {
  border-color: oklch(80% 0.1 80 / 0.7);
  color: oklch(45% 0.12 80);
}
.toast.success {
  border-color: oklch(80% 0.1 145 / 0.7);
  color: oklch(40% 0.12 145);
}
.icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.msg {
  flex: 1;
  line-height: 1.4;
  word-break: break-word;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
