<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'reload-model'): void
}>()

const pinned = ref(true)

async function togglePin(): Promise<void> {
  pinned.value = !pinned.value
  await window.api.window.togglePin(pinned.value)
}

async function close(): Promise<void> {
  await window.api.window.close()
}

async function minimize(): Promise<void> {
  await window.api.window.minimize()
}
</script>

<template>
  <div class="dock">
    <button class="dock-btn" title="设置" @click="emit('open-settings')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
    <button class="dock-btn" title="重载模型" @click="emit('reload-model')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
    <button
      class="dock-btn"
      :class="{ 'on': pinned }"
      :title="pinned ? '取消置顶' : '置顶'"
      @click="togglePin"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v6" />
        <path d="m6 8 6-6 6 6" />
        <path d="M9 12h6" />
        <path d="M12 8v14" />
      </svg>
    </button>
    <button class="dock-btn" title="收起" @click="minimize">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round">
        <path d="M5 12h14" />
      </svg>
    </button>
    <button class="dock-btn danger" title="关闭" @click="close">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.dock {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
}
.dock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: var(--color-bubble-text);
  transition: background var(--duration-fast), transform var(--duration-fast),
    color var(--duration-fast);
}
.dock-btn:hover {
  background: oklch(95% 0.025 25 / 0.7);
  transform: scale(1.08);
}
.dock-btn.on {
  color: var(--color-accent);
  background: oklch(95% 0.04 25 / 0.6);
}
.dock-btn.danger:hover {
  background: oklch(92% 0.1 25 / 0.6);
  color: var(--color-danger);
}
</style>
