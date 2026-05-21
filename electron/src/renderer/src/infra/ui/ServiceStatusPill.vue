<script setup lang="ts">
/**
 * UX R21: 服务健康状态指示灯。
 *
 * 浮在窗口右下角的小 pill，三个 dot：LLM / TTS / Vision。
 * 颜色语义：
 *   - 绿 = 最近调用成功 / cfg 已配且没失败过
 *   - 灰 = cfg 未配置
 *   - 红 = 最近一次调用失败（hover tooltip 显示原因）
 *   - 黄 = 配置了但还没尝试过
 *
 * 不主动 polling — 监听 bus 事件（brain:reply-end / brain:reply-error /
 * presence:tts-start / ui:toast）reactive 更新。
 *
 * click 任一 dot → 打开设置面板。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'

type DotStatus = 'ok' | 'down' | 'unconfigured' | 'untested'
interface ServiceState {
  status: DotStatus
  reason?: string
  /** 最近一次状态变化时间戳（用于 5min 自动恢复 untested） */
  ts: number
}

const emit = defineEmits<{ (e: 'open-settings'): void }>()
const cfg = useConfigStore()

const llmState = ref<ServiceState>({ status: 'untested', ts: Date.now() })
const ttsState = ref<ServiceState>({ status: 'untested', ts: Date.now() })
const visionState = ref<ServiceState>({ status: 'untested', ts: Date.now() })

const hovered = ref<'llm' | 'tts' | 'vision' | null>(null)

// 从 cfg 派生初始 unconfigured 状态
function recomputeFromCfg(): void {
  const c = cfg.config
  if (!c) return
  if (!c.llm_endpoint || !c.llm_model) {
    llmState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (llmState.value.status === 'unconfigured') {
    llmState.value = { status: 'untested', ts: Date.now() }
  }
  const ttsUrl = Array.isArray(c.tts_sidecar_url)
    ? c.tts_sidecar_url.find((u) => u && u.trim())
    : c.tts_sidecar_url
  if (!ttsUrl) {
    ttsState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (ttsState.value.status === 'unconfigured') {
    ttsState.value = { status: 'untested', ts: Date.now() }
  }
  if (!c.vision_enabled) {
    visionState.value = { status: 'unconfigured', ts: Date.now() }
  } else if (visionState.value.status === 'unconfigured') {
    visionState.value = { status: 'untested', ts: Date.now() }
  }
}

const cleanupHandlers: Array<() => void> = []

onMounted(() => {
  recomputeFromCfg()

  const onConfigChange = (): void => recomputeFromCfg()
  bus.on('infra:config-changed', onConfigChange)
  cleanupHandlers.push(() => bus.off('infra:config-changed', onConfigChange))

  // LLM 成功：reply-end
  const onReplyEnd = (): void => {
    if (llmState.value.status !== 'unconfigured') {
      llmState.value = { status: 'ok', ts: Date.now() }
    }
  }
  bus.on('brain:reply-end', onReplyEnd)
  cleanupHandlers.push(() => bus.off('brain:reply-end', onReplyEnd))

  // LLM 失败：reply-error
  const onReplyError = (payload: { error: string }): void => {
    llmState.value = {
      status: 'down',
      reason: payload.error.slice(0, 100),
      ts: Date.now(),
    }
  }
  bus.on('brain:reply-error', onReplyError)
  cleanupHandlers.push(() => bus.off('brain:reply-error', onReplyError))

  // TTS 成功：能开播说明 ok
  const onTtsStart = (): void => {
    if (ttsState.value.status !== 'unconfigured') {
      ttsState.value = { status: 'ok', ts: Date.now() }
    }
  }
  bus.on('presence:tts-start', onTtsStart)
  cleanupHandlers.push(() => bus.off('presence:tts-start', onTtsStart))

  // Toast error 推断：包含 'TTS' / 'sidecar' / 'tts' → tts down
  const onToast = (payload: { kind: string; message: string }): void => {
    if (payload.kind !== 'error' && payload.kind !== 'warn') return
    const msg = payload.message
    if (/tts|sidecar|语音/i.test(msg) && ttsState.value.status !== 'unconfigured') {
      ttsState.value = { status: 'down', reason: msg.slice(0, 100), ts: Date.now() }
    }
    if (/vision|视觉|看到|看不到/i.test(msg) && visionState.value.status !== 'unconfigured') {
      visionState.value = { status: 'down', reason: msg.slice(0, 100), ts: Date.now() }
    }
  }
  bus.on('ui:toast', onToast)
  cleanupHandlers.push(() => bus.off('ui:toast', onToast))
})

onBeforeUnmount(() => {
  cleanupHandlers.forEach((fn) => fn())
  cleanupHandlers.length = 0
})

function colorOf(s: DotStatus): string {
  switch (s) {
    case 'ok':
      return 'oklch(70% 0.18 145)' // 绿
    case 'down':
      return 'oklch(60% 0.22 25)' // 红
    case 'unconfigured':
      return 'oklch(60% 0.01 250 / 0.45)' // 灰
    case 'untested':
      return 'oklch(75% 0.16 90)' // 黄
  }
}

function labelOf(svc: 'llm' | 'tts' | 'vision', s: DotStatus): string {
  const svcName = svc === 'llm' ? 'LLM' : svc === 'tts' ? 'TTS' : 'Vision'
  switch (s) {
    case 'ok':
      return `${svcName}: ✓ 工作正常`
    case 'down':
      return `${svcName}: ✗ 上次调用失败`
    case 'unconfigured':
      return `${svcName}: ◯ 未配置`
    case 'untested':
      return `${svcName}: … 已配置，尚未测试`
  }
}

const tooltip = computed<string>(() => {
  if (!hovered.value) {
    // 默认显示总体摘要
    const downCount = [llmState.value, ttsState.value, visionState.value].filter(
      (s) => s.status === 'down',
    ).length
    if (downCount > 0) return `${downCount} 项服务异常 — 点击查看`
    return '服务健康状态 — 点击打开设置'
  }
  const st =
    hovered.value === 'llm'
      ? llmState.value
      : hovered.value === 'tts'
        ? ttsState.value
        : visionState.value
  const base = labelOf(hovered.value, st.status)
  if (st.reason && (st.status === 'down')) return `${base}\n${st.reason}`
  return base
})

function openSettings(): void {
  emit('open-settings')
}
</script>

<template>
  <button class="pill" :title="tooltip" @click="openSettings">
    <span
      class="dot"
      :style="{ background: colorOf(llmState.status) }"
      @mouseenter="hovered = 'llm'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(ttsState.status) }"
      @mouseenter="hovered = 'tts'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(visionState.status) }"
      @mouseenter="hovered = 'vision'"
      @mouseleave="hovered = null"
    ></span>
  </button>
</template>

<style scoped>
.pill {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 1500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  pointer-events: auto;
  cursor: pointer;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast),
    opacity var(--duration-fast);
  opacity: 0.85;
  animation: pill-in 0.6s var(--ease-out-back) backwards;
}
.pill:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}
.pill:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
@keyframes pill-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.95);
  }
  to {
    opacity: 0.85;
    transform: none;
  }
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background var(--duration-normal), transform var(--duration-fast);
}
.dot:hover {
  transform: scale(1.4);
}
</style>
