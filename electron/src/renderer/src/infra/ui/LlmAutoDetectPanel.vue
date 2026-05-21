<script setup lang="ts">
/**
 * R28: 从 OnboardingDialog 抽出的 LLM 自动检测 UI。
 *
 * 独立面板，自取数据 (window.api.llm.autoDetect)，用户选 model 后 emit('apply')
 * 把 endpoint + model 给父组件。
 *
 * 复用：onboarding / settings / 健康仪表 都可挂这个组件。
 */
import { ref } from 'vue'

interface DetectedItem {
  endpoint: string
  label: string
  models: string[]
  latencyMs: number
}

const emit = defineEmits<{
  (e: 'apply', payload: { endpoint: string; model: string }): void
}>()

const detecting = ref(false)
const detected = ref<DetectedItem[]>([])
const detectError = ref<string>('')

async function autoDetect(): Promise<void> {
  detecting.value = true
  detectError.value = ''
  detected.value = []
  try {
    const r = await window.api.llm.autoDetect({})
    detected.value = r.found
    if (r.found.length === 0) {
      detectError.value = '未发现本机 LLM 服务。请确认 Ollama / LM Studio / vLLM 已启动'
    }
  } catch (e) {
    detectError.value = `自动检测失败：${String(e).slice(0, 80)}`
  } finally {
    detecting.value = false
  }
}

function applyDetected(item: DetectedItem, model?: string): void {
  emit('apply', {
    endpoint: item.endpoint,
    model: model ?? item.models[0] ?? '',
  })
}
</script>

<template>
  <div class="auto-detect">
    <div class="auto-detect-row">
      <button
        class="detect-btn"
        :disabled="detecting"
        :aria-busy="detecting"
        :aria-label="detecting ? '正在扫描本机 LLM' : '自动检测本机 LLM'"
        @click="autoDetect"
      >
        {{ detecting ? '扫描中…' : '🔍 自动检测本机 LLM' }}
      </button>
      <span class="detect-hint">
        扫常见端口（Ollama / LM Studio / vLLM / llama.cpp）
      </span>
    </div>
    <div v-if="detected.length > 0" class="detected-list" aria-live="polite">
      <div v-for="d in detected" :key="d.endpoint" class="detected-item">
        <div class="detected-head">
          <span class="detected-label">✓ {{ d.label }}</span>
          <span class="detected-endpoint">{{ d.endpoint }}</span>
          <span class="detected-latency">{{ d.latencyMs }}ms</span>
        </div>
        <div v-if="d.models.length > 0" class="detected-models">
          <button
            v-for="m in d.models.slice(0, 6)"
            :key="m"
            class="model-chip"
            :aria-label="`使用模型 ${m}`"
            @click="applyDetected(d, m)"
          >
            {{ m }}
          </button>
          <span v-if="d.models.length > 6" class="model-more">
            +{{ d.models.length - 6 }}
          </span>
        </div>
        <div v-else class="detected-no-models">
          <span>未拉到模型列表 — </span>
          <button class="link-btn" @click="applyDetected(d)">仅用 endpoint</button>
        </div>
      </div>
    </div>
    <div v-if="detectError" class="detect-error">{{ detectError }}</div>
  </div>
</template>

<style scoped>
.auto-detect-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 10px;
}
.detect-btn {
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
  font-weight: 600;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast);
}
.detect-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.detect-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.detect-hint {
  font-size: 11px;
  color: var(--color-muted);
}
.detected-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.detected-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-bubble-border);
}
.detected-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: var(--text-sm);
  margin-bottom: 6px;
}
.detected-label {
  font-weight: 600;
  color: var(--color-success);
}
.detected-endpoint {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  color: var(--color-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detected-latency {
  font-size: 10px;
  color: var(--color-muted);
}
.detected-models {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.model-chip {
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: var(--color-bubble);
  font-size: 11px;
  border: 1px solid var(--color-bubble-border);
  transition: border-color var(--duration-fast), background var(--duration-fast);
}
.model-chip:hover {
  border-color: var(--color-accent);
  background: var(--color-bubble-surface-hover);
}
.model-more {
  font-size: 10px;
  color: var(--color-muted);
}
.detected-no-models {
  font-size: 11px;
  color: var(--color-muted);
}
.link-btn {
  background: transparent;
  color: var(--color-accent);
  text-decoration: underline;
  padding: 0;
  font-size: 11px;
}
.detect-error {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: oklch(60% 0.15 30 / 0.12);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--color-danger);
}
</style>
