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

watch(
  () => [latest.value?.id, latest.value?.text],
  () => {
    if (!latest.value) return
    visible.value = true
    if (!latest.value.streaming) scheduleHide()
  },
  { immediate: true },
)

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

const emotionTintDark: Record<string, string> = {
  neutral: 'oklch(28% 0.012 25 / 0.94)',
  happy: 'oklch(32% 0.08 80 / 0.94)',
  sad: 'oklch(28% 0.05 230 / 0.94)',
  angry: 'oklch(30% 0.1 25 / 0.94)',
  surprise: 'oklch(32% 0.09 65 / 0.94)',
  shy: 'oklch(32% 0.1 18 / 0.94)',
  tease: 'oklch(32% 0.1 320 / 0.94)',
  sleepy: 'oklch(28% 0.04 250 / 0.94)',
}

const isDark = ref(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
)
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    isDark.value = e.matches
  })
}

function bubbleBg(emotion: string | undefined): string {
  const e = emotion ?? 'neutral'
  return isDark.value
    ? emotionTintDark[e] ?? emotionTintDark.neutral!
    : emotionTint[e] ?? emotionTint.neutral!
}

const emotionLabel: Record<string, { icon: string; label: string }> = {
  happy: { icon: '😊', label: '开心' },
  sad: { icon: '😢', label: '难过' },
  angry: { icon: '😠', label: '生气' },
  surprise: { icon: '😲', label: '惊讶' },
  shy: { icon: '😳', label: '害羞' },
  tease: { icon: '😈', label: '撒娇' },
  sleepy: { icon: '😴', label: '困' },
}
</script>

<template>
  <transition name="bubble">
    <div
      v-if="latest && (latest.text || latest.streaming) && visible"
      class="bubble"
      :style="{ background: bubbleBg(latest.emotion) }"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <span v-if="latest.text" class="text">{{ latest.text }}</span>
      <span v-if="latest.streaming" class="typing-indicator" aria-label="正在输入">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
      <span
        v-if="latest.emotion && latest.emotion !== 'neutral' && emotionLabel[latest.emotion]"
        class="emo-tag"
        :title="latest.emotion"
      >
        <span class="emo-icon">{{ emotionLabel[latest.emotion]!.icon }}</span>
        <span class="emo-text">{{ emotionLabel[latest.emotion]!.label }}</span>
      </span>
    </div>
  </transition>
</template>

<style scoped>
.bubble {
  position: absolute;
  bottom: clamp(72px, 12vh, 140px);
  right: clamp(8px, 2vw, 24px);
  left: auto;
  top: auto;
  max-width: min(360px, 70vw);
  padding: 12px 16px;
  border-radius: 18px;
  border: 1px solid var(--color-bubble-border);
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  line-height: 1.55;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  pointer-events: auto;
  max-height: min(40vh, 320px);
  overflow-y: auto;
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  z-index: 1500;
  transition: background var(--duration-normal) var(--ease-in-out);
}

@media (max-height: 480px), (max-width: 320px) {
  .bubble {
    bottom: auto;
    top: 8px;
    right: 8px;
    left: 8px;
    max-width: none;
    max-height: 30vh;
    padding: 8px 12px;
    font-size: var(--text-sm);
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
  border-left: 1px solid var(--color-bubble-border);
  border-bottom: 1px solid var(--color-bubble-border);
  transform: rotate(45deg);
}

.text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}

/* v0.13 UX polish: 3 点 typing 指示器（取代单点 pulse）— 更经典的 IM 视觉 */
.typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  flex-shrink: 0;
}
.typing-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--color-accent);
  border-radius: 999px;
  opacity: 0.6;
  animation: typing-bounce 1.2s var(--ease-in-out) infinite;
}
.typing-indicator .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-indicator .dot:nth-child(3) {
  animation-delay: 0.3s;
}

.emo-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding: 3px 8px 3px 6px;
  background: oklch(100% 0 0 / 0.5);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  align-self: center;
}
@media (prefers-color-scheme: dark) {
  .emo-tag {
    background: oklch(0% 0 0 / 0.25);
  }
}
.emo-icon {
  font-size: 13px;
  line-height: 1;
}
.emo-text {
  font-weight: 500;
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

@keyframes typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
