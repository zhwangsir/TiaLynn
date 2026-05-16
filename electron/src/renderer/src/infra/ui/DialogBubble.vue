<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'

const HIDE_AFTER_MS = 8000

const dialog = useDialogStore()

const latest = computed(() => {
  const list = dialog.turns
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant') return list[i]
  }
  return null
})

const visible = ref(true)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    visible.value = false
  }, HIDE_AFTER_MS)
}

// 新消息到来或流式中 → 显示并重置计时
watch(
  () => [latest.value?.id, latest.value?.text],
  () => {
    if (!latest.value) return
    visible.value = true
    if (!latest.value.streaming) scheduleHide()
  },
  { immediate: true },
)

// 鼠标悬停时取消自动消失
function onMouseEnter(): void {
  if (hideTimer) clearTimeout(hideTimer)
}
function onMouseLeave(): void {
  if (latest.value && !latest.value.streaming) scheduleHide()
}

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})

const emotionTint: Record<string, string> = {
  neutral: 'oklch(96% 0.012 25 / 0.94)',
  happy: 'oklch(96% 0.06 80 / 0.94)',
  sad: 'oklch(95% 0.04 230 / 0.94)',
  angry: 'oklch(93% 0.08 25 / 0.94)',
  surprise: 'oklch(96% 0.07 65 / 0.94)',
  shy: 'oklch(96% 0.08 18 / 0.94)',
  tease: 'oklch(96% 0.08 320 / 0.94)',
  sleepy: 'oklch(94% 0.03 250 / 0.94)',
}
</script>

<template>
  <transition name="bubble">
    <div
      v-if="latest && latest.text && visible"
      class="bubble"
      :style="{ background: emotionTint[latest.emotion ?? 'neutral'] }"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <span v-if="latest.streaming" class="streaming-dot" />
      <span class="text">{{ latest.text }}</span>
      <span v-if="latest.emotion && latest.emotion !== 'neutral'" class="emo-tag">
        {{ latest.emotion }}
      </span>
    </div>
  </transition>
</template>

<style scoped>
.bubble {
  position: absolute;
  top: 18px;
  left: 18px;
  right: 18px;
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-bubble-border);
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  line-height: 1.55;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  pointer-events: auto;
  max-height: 38vh;
  overflow-y: auto;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
}
.bubble::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 30px;
  width: 16px;
  height: 16px;
  background: inherit;
  border-right: 1px solid var(--color-bubble-border);
  border-bottom: 1px solid var(--color-bubble-border);
  transform: rotate(45deg);
}
.text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}
.streaming-dot {
  width: 6px;
  height: 6px;
  background: var(--color-accent);
  border-radius: 999px;
  margin-top: 8px;
  animation: pulse 1s var(--ease-out-expo) infinite;
  flex-shrink: 0;
}
.emo-tag {
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding: 2px 8px;
  background: oklch(100% 0 0 / 0.5);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.bubble-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
.bubble-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}
</style>
