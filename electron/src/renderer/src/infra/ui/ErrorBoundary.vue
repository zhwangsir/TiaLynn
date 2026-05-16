<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { bus } from '../eventbus'

const error = ref<Error | null>(null)
const detail = ref<string>('')

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err))
  detail.value = err instanceof Error ? (err.stack ?? err.message) : String(err)
  bus.emit('ui:toast', {
    kind: 'error',
    message: error.value.message || '渲染层崩溃',
    ttl_ms: 8000,
  })
  // 返回 false 阻止冒泡，避免 Vue 默认 reporter 重复
  return false
})

function reset(): void {
  error.value = null
  detail.value = ''
}

async function reload(): Promise<void> {
  location.reload()
}
</script>

<template>
  <slot v-if="!error" />
  <div v-else class="boundary">
    <div class="card" role="alert">
      <div class="head">
        <span class="dot" />
        <h2>她有点不舒服</h2>
      </div>
      <p class="msg">{{ error.message || '渲染层抛出未捕获错误' }}</p>
      <details>
        <summary>展开技术细节</summary>
        <pre>{{ detail }}</pre>
      </details>
      <div class="actions">
        <button class="ghost" @click="reset">尝试继续</button>
        <button class="primary" @click="reload">重启 renderer</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.boundary {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0% 0 0 / 0.4);
  backdrop-filter: blur(4px);
  pointer-events: auto;
  z-index: 2000;
}
.card {
  width: min(420px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
  padding: 18px 22px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  color: var(--color-bubble-text);
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.head h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-danger);
  box-shadow: 0 0 10px var(--color-danger);
}
.msg {
  margin: 6px 0 10px;
  color: oklch(40% 0.12 25);
  line-height: 1.5;
}
details {
  margin: 8px 0 14px;
}
summary {
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--color-muted);
}
pre {
  margin: 6px 0 0;
  padding: 10px;
  font-size: 11px;
  line-height: 1.5;
  background: oklch(94% 0.012 25 / 0.6);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  max-height: 32vh;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ghost,
.primary {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--duration-fast);
}
.ghost {
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
</style>
