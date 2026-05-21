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
 * 不主动 polling — 监听 bus 'service:status' reactive 更新。
 * dialog/TTS handler 在成功/失败时显式 emit service:status，避免从 toast 文本反推。
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

  // R21 fix (HIGH): 改听 service:status 显式事件，不再靠 toast 文本反推
  const onServiceStatus = (payload: {
    service: 'llm' | 'tts' | 'vision'
    status: 'ok' | 'down' | 'unconfigured'
    reason?: string
  }): void => {
    const target =
      payload.service === 'llm'
        ? llmState
        : payload.service === 'tts'
          ? ttsState
          : visionState
    // 已 unconfigured 时 ok 信号不覆盖（避免下次 enable 前误显示绿）
    if (target.value.status === 'unconfigured' && payload.status === 'ok') return
    target.value = {
      status: payload.status === 'unconfigured' ? 'unconfigured' : payload.status,
      ...(payload.reason !== undefined && { reason: payload.reason.slice(0, 100) }),
      ts: Date.now(),
    }
  }
  bus.on('service:status', onServiceStatus)
  cleanupHandlers.push(() => bus.off('service:status', onServiceStatus))

  // R30: 启动后主动一次 health probe，让 dot 立即显示真实状态（不用等用户发消息）
  void initialProbe()
})

/** R30: 启动时的一次性轻量 ping — 不重启每次重载，只 mount 触发一次 */
async function initialProbe(): Promise<void> {
  const c = cfg.config
  if (!c) return
  // LLM probe — 复用已有 healthCheck（test_vision: false 略过最重测试）
  if (c.llm_endpoint && c.llm_model) {
    try {
      const r = await window.api.llm.healthCheck({ test_vision: false })
      bus.emit('service:status', {
        service: 'llm',
        status: r.overall_ok ? 'ok' : 'down',
        ...(!r.overall_ok && {
          reason: r.results.find((x) => !x.ok)?.detail ?? 'health-check failed',
        }),
      })
    } catch (e) {
      bus.emit('service:status', {
        service: 'llm',
        status: 'down',
        reason: String(e).slice(0, 100),
      })
    }
  }
  // TTS probe — 本机 sidecar 直 fetch，2s 超时
  const ttsUrl = Array.isArray(c.tts_sidecar_url)
    ? c.tts_sidecar_url.find((u) => u && u.trim())
    : c.tts_sidecar_url
  if (ttsUrl) {
    try {
      const r = await fetch(`${ttsUrl.replace(/\/+$/, '')}/`, {
        signal: AbortSignal.timeout(2000),
      })
      bus.emit('service:status', {
        service: 'tts',
        status: r.ok ? 'ok' : 'down',
        ...(!r.ok && { reason: `HTTP ${r.status}` }),
      })
    } catch (e) {
      bus.emit('service:status', {
        service: 'tts',
        status: 'down',
        reason: String(e).slice(0, 100),
      })
    }
  }
}

onBeforeUnmount(() => {
  cleanupHandlers.forEach((fn) => fn())
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
  <button class="pill" :title="tooltip" :aria-label="tooltip" @click="openSettings">
    <span
      class="dot"
      :style="{ background: colorOf(llmState.status) }"
      :aria-label="labelOf('llm', llmState.status)"
      role="status"
      @mouseenter="hovered = 'llm'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(ttsState.status) }"
      :aria-label="labelOf('tts', ttsState.status)"
      role="status"
      @mouseenter="hovered = 'tts'"
      @mouseleave="hovered = null"
    ></span>
    <span
      class="dot"
      :style="{ background: colorOf(visionState.status) }"
      :aria-label="labelOf('vision', visionState.status)"
      role="status"
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
