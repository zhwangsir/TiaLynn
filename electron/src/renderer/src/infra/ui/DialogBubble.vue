<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDialogStore } from '../../brain/stores/dialog'
import { useThemeMode } from './useThemeMode'
import { bus } from '../eventbus'

/** 按文字长度动态：保底 5 秒，每字 +250ms，上限 18 秒（防止超长文本永驻） */
function hideMsFor(text: string | undefined): number {
  const len = text?.length ?? 0
  return Math.min(18_000, Math.max(5_000, 5_000 + len * 250))
}

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
  }, hideMsFor(latest.value?.text))
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
  mql?.removeEventListener('change', systemListener)
})

/* v0.17：不透明度从 0.94 降到 0.82 — 桌面颜色能透一点过来，强化"飘在桌面"而非"实色 panel" */
const emotionTint: Record<string, string> = {
  neutral: 'oklch(97% 0.012 25 / 0.82)',
  happy: 'oklch(97% 0.06 80 / 0.82)',
  sad: 'oklch(96% 0.04 230 / 0.82)',
  angry: 'oklch(95% 0.08 25 / 0.82)',
  surprise: 'oklch(97% 0.07 65 / 0.82)',
  shy: 'oklch(97% 0.08 18 / 0.82)',
  tease: 'oklch(97% 0.08 320 / 0.82)',
  sleepy: 'oklch(95% 0.03 250 / 0.82)',
}

const emotionTintDark: Record<string, string> = {
  neutral: 'oklch(28% 0.012 25 / 0.82)',
  happy: 'oklch(32% 0.08 80 / 0.82)',
  sad: 'oklch(28% 0.05 230 / 0.82)',
  angry: 'oklch(30% 0.1 25 / 0.82)',
  surprise: 'oklch(32% 0.09 65 / 0.82)',
  shy: 'oklch(32% 0.1 18 / 0.82)',
  tease: 'oklch(32% 0.1 320 / 0.82)',
  sleepy: 'oklch(28% 0.04 250 / 0.82)',
}

// R38 fix: 联动 R33 主题切换 — 用户强制 light/dark 时尊重设定，auto 时跟系统
const theme = useThemeMode()
const systemDark = ref(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
)
let mql: MediaQueryList | null = null
const systemListener = (e: MediaQueryListEvent): void => {
  systemDark.value = e.matches
}
onMounted(() => {
  if (typeof window === 'undefined') return
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', systemListener)
})
const isDark = computed(() => {
  if (theme.mode.value === 'light') return false
  if (theme.mode.value === 'dark') return true
  return systemDark.value
})

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

// R38: 复制 LLM reply — hover 时显示按钮
async function copyText(): Promise<void> {
  const t = latest.value?.text
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    bus.emit('ui:toast', { kind: 'success', message: '✓ 已复制', ttl_ms: 1500 })
  } catch (e) {
    bus.emit('ui:toast', {
      kind: 'warn',
      message: `复制失败：${String(e).slice(0, 60)}`,
      ttl_ms: 3000,
    })
  }
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
      <button
        v-if="latest.text && !latest.streaming"
        class="copy-btn"
        title="复制这条 (Cmd+C)"
        aria-label="复制对话"
        @click.stop="copyText"
      >📋</button>
    </div>
  </transition>
</template>

<style scoped>
/* v0.17：气泡漂浮在立绘头顶 — 漫画气泡风（不像 toast 通知） */
.bubble {
  position: absolute;
  top: clamp(12px, 6%, 56px);
  left: 50%;
  right: auto;
  bottom: auto;
  /* v0.17：translate 和 scale 必须同 transform 内合写，否则 global ui-scale 会单独覆盖 translateX */
  transform: translateX(-50%) scale(var(--ui-scale, 1));
  transform-origin: top center;
  max-width: min(320px, 86%);
  padding: 9px 16px;
  /* 漫画风：圆滑大圆角 + 不规则 border-radius 让形状更"软" */
  border-radius: 22px 22px 22px 8px;
  border: 1.5px solid var(--color-bubble-border);
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  line-height: 1.45;
  /* drop-shadow 跟随气泡形状（不规则 border-radius）显得更自然 */
  filter: drop-shadow(0 4px 10px oklch(0% 0 0 / 0.18))
          drop-shadow(0 1px 3px oklch(0% 0 0 / 0.12));
  /* 去掉 box-shadow（drop-shadow 已经管） + 去掉 backdrop-filter（panel-like glass 感破坏融入）*/
  box-shadow: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  pointer-events: auto;
  max-height: min(28vh, 220px);
  overflow-y: auto;
  z-index: 1500;
  transition: background var(--duration-normal) var(--ease-in-out);
}

@media (max-height: 360px) {
  .bubble { padding: 6px 10px; font-size: var(--text-sm); max-height: 24vh; }
  .bubble::after { display: none; }
}

/* 箭头朝下指向立绘头顶 */
.bubble::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 14px;
  height: 14px;
  background: inherit;
  border-right: 1px solid var(--color-bubble-border);
  border-bottom: 1px solid var(--color-bubble-border);
  transform: translateX(-50%) rotate(45deg);
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
/* R38: 复制按钮 — hover bubble 时浮出 */
.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: oklch(100% 0 0 / 0.6);
  font-size: 11px;
  opacity: 0;
  transition: opacity var(--duration-fast), background var(--duration-fast);
  flex-shrink: 0;
  cursor: pointer;
}
.bubble:hover .copy-btn,
.copy-btn:focus-visible {
  opacity: 1;
}
.copy-btn:hover {
  background: oklch(100% 0 0 / 0.85);
}
@media (prefers-color-scheme: dark) {
  .copy-btn {
    background: oklch(0% 0 0 / 0.4);
  }
  .copy-btn:hover {
    background: oklch(0% 0 0 / 0.6);
  }
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo),
    transform var(--duration-normal) var(--ease-out-expo);
}
.bubble-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px) scale(calc(var(--ui-scale, 1) * 0.92));
}
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px) scale(calc(var(--ui-scale, 1) * 0.96));
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
