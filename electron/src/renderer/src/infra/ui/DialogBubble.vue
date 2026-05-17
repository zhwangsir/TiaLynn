<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'

const HIDE_AFTER_MS = 8000

const dialog = useDialogStore()

const latest = computed(() => {
  const list = dialog.turns
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.role === 'assistant') return list[i]!
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
/* v0.8.2+: 浮在窗口底部偏右；bottom 与 right 都用 clamp 自适应窗口大小 — */
/* 大窗时往下沉，小窗时上抬，避免遮挡 InputBar / 角色脸 */
.bubble {
  position: absolute;
  bottom: clamp(72px, 12vh, 140px);
  right: clamp(8px, 2vw, 24px);
  left: auto;
  top: auto;
  max-width: min(360px, 70vw);
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid oklch(85% 0.02 25 / 0.5);
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  line-height: 1.55;
  box-shadow: 0 8px 32px oklch(0% 0 0 / 0.2), 0 2px 8px oklch(0% 0 0 / 0.1);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  pointer-events: auto;
  max-height: min(40vh, 320px);
  overflow-y: auto;
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  z-index: 1500;
}

/* 极小窗（< 320px 宽 或 < 480px 高）— 改为顶部居中显示，气泡更小 */
@media (max-height: 480px), (max-width: 320px) {
  .bubble {
    bottom: auto;
    top: 8px;
    right: 8px;
    left: 8px;
    max-width: none;
    max-height: 30vh;
    padding: 8px 12px;
    font-size: var(--text-sm, 13px);
  }
  .bubble::after { display: none; }
}
/* 箭头指向左侧（人物方向） */
.bubble::after {
  content: '';
  position: absolute;
  left: -7px;
  top: 24px;
  width: 14px;
  height: 14px;
  background: inherit;
  border-left: 1px solid oklch(85% 0.02 25 / 0.5);
  border-bottom: 1px solid oklch(85% 0.02 25 / 0.5);
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
