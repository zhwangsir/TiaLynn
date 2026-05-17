<script setup lang="ts">
/**
 * v0.13 首次启动引导对话框。
 *
 * 出现条件：config.json 不存在 OR llm_endpoint 为空。
 * 3 步：欢迎 → LLM 配置 → TTS 提示（可跳）。
 */
import { computed, ref } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import type { RuntimeConfig } from '@shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()
const cfg = useConfigStore()

const step = ref<1 | 2 | 3>(1)
const llmEndpoint = ref('')
const llmModel = ref('')
const llmApiKey = ref('')
const ttsSidecarUrl = ref('')
const checking = ref(false)
const checkResult = ref<{ ok: boolean; message: string } | null>(null)

interface Preset {
  id: string
  label: string
  endpoint: string
  hint: string
}
const presets: Preset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    hint: '本机 ollama serve — model 例：qwen2.5:14b',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    endpoint: 'http://127.0.0.1:1234/v1',
    hint: 'LM Studio 内置 server — model 用已加载模型 id',
  },
  {
    id: 'vllm',
    label: 'vLLM / 自定义',
    endpoint: '',
    hint: 'OpenAI-compatible 任意 endpoint',
  },
]

function applyPreset(p: Preset): void {
  llmEndpoint.value = p.endpoint
  checkResult.value = null
}

async function probeLlm(): Promise<void> {
  if (!llmEndpoint.value || !llmModel.value) {
    checkResult.value = { ok: false, message: '请先填 endpoint + model' }
    return
  }
  checking.value = true
  checkResult.value = null
  try {
    const r = await window.api.llm.test({
      provider: 'openai_compat',
      endpoint: llmEndpoint.value,
      model: llmModel.value,
      api_key: llmApiKey.value,
    })
    checkResult.value = r.ok
      ? { ok: true, message: `✓ ${r.message}` }
      : { ok: false, message: `✗ ${r.message}` }
  } catch (e) {
    checkResult.value = { ok: false, message: `✗ ${String(e).slice(0, 80)}` }
  } finally {
    checking.value = false
  }
}

const llmReady = computed(() => checkResult.value?.ok === true)

async function finish(): Promise<void> {
  const base = cfg.config ?? ({} as RuntimeConfig)
  const dto: RuntimeConfig = {
    ...base,
    llm_provider: 'openai_compat',
    llm_endpoint: llmEndpoint.value,
    llm_model: llmModel.value,
    llm_api_key: llmApiKey.value,
    tts_sidecar_url: ttsSidecarUrl.value || base.tts_sidecar_url || '',
  }
  await cfg.save(dto)
  bus.emit('ui:toast', { kind: 'success', message: '配置已保存，TiaLynn 已准备好', ttl_ms: 4000 })
  emit('close')
}

function skip(): void {
  bus.emit('ui:toast', {
    kind: 'info',
    message: '已跳过引导。可随时右键 → 设置 修改',
    ttl_ms: 5000,
  })
  emit('close')
}
</script>

<template>
  <transition name="onboard" appear>
    <div class="overlay" @click.self="skip">
      <div class="card">
        <header>
          <div class="step-dots">
            <span :class="['dot', { active: step === 1 }]"></span>
            <span :class="['dot', { active: step === 2 }]"></span>
            <span :class="['dot', { active: step === 3 }]"></span>
          </div>
          <button class="skip-btn" @click="skip">跳过</button>
        </header>

        <!-- Step 1: 欢迎 -->
        <div v-if="step === 1" class="body">
          <h1>欢迎来到 TiaLynn 💜</h1>
          <p class="lead">
            我是你的桌面 AI 伴侣。30 秒帮你配好，咱们就能开始对话了。
          </p>
          <ul class="feature-list">
            <li>🎭 1389 个 Live2D 模型 + 角色库</li>
            <li>🎙️ RVC 47 音色 + 流式 TTS</li>
            <li>🧠 本地 LLM + 主体性感知</li>
            <li>🔒 完全本地化 — 你的数据不离开本机</li>
          </ul>
          <footer>
            <button class="primary" @click="step = 2">开始配置 →</button>
          </footer>
        </div>

        <!-- Step 2: LLM 配置 -->
        <div v-if="step === 2" class="body">
          <h2>1/2 · 配 LLM endpoint</h2>
          <p class="hint">选个 preset，或手动填 OpenAI-compatible endpoint：</p>
          <div class="presets">
            <button
              v-for="p in presets"
              :key="p.id"
              class="preset-btn"
              @click="applyPreset(p)"
            >
              <span class="preset-label">{{ p.label }}</span>
              <span class="preset-hint">{{ p.hint }}</span>
            </button>
          </div>

          <label class="field">
            <span>Endpoint</span>
            <input
              v-model="llmEndpoint"
              placeholder="http://127.0.0.1:11434/v1"
              @input="checkResult = null"
            />
          </label>
          <label class="field">
            <span>Model</span>
            <input
              v-model="llmModel"
              placeholder="qwen2.5:14b"
              @input="checkResult = null"
            />
          </label>
          <label class="field">
            <span>API Key（可选）</span>
            <input v-model="llmApiKey" type="password" placeholder="本地端点通常留空" />
          </label>

          <div class="probe-row">
            <button class="ghost" :disabled="checking" @click="probeLlm">
              {{ checking ? '检测中…' : '🔌 检测连通' }}
            </button>
            <span v-if="checkResult" :class="['probe-status', checkResult.ok ? 'ok' : 'fail']">
              {{ checkResult.message }}
            </span>
          </div>

          <footer>
            <button class="ghost" @click="step = 1">← 返回</button>
            <button class="primary" :disabled="!llmReady" @click="step = 3">
              下一步 →
            </button>
          </footer>
        </div>

        <!-- Step 3: TTS（可选） -->
        <div v-if="step === 3" class="body">
          <h2>2/2 · 配 TTS sidecar（可选）</h2>
          <p class="hint">
            想让 TiaLynn 开口说话？需要先装 Python sidecar。不装也能正常文字对话。
          </p>
          <pre class="code">$ bash sidecar/install.sh
$ cd sidecar/qwen-tts-server
$ source .venv/bin/activate
$ uvicorn main:app --host 127.0.0.1 --port 8765</pre>

          <label class="field">
            <span>Sidecar URL（装好 sidecar 后填）</span>
            <input
              v-model="ttsSidecarUrl"
              placeholder="http://127.0.0.1:8765 — 留空则不启用 TTS"
            />
          </label>

          <footer>
            <button class="ghost" @click="step = 2">← 返回</button>
            <button class="primary strong" @click="finish">完成 ✓</button>
          </footer>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  backdrop-filter: blur(6px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 520px;
  max-height: 86vh;
  overflow: auto;
  border: 1px solid var(--color-bubble-border);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
.step-dots {
  display: flex;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: oklch(88% 0.012 25);
  transition: all var(--duration-fast);
}
.dot.active {
  background: var(--color-accent);
  width: 20px;
  border-radius: var(--radius-pill);
}
.skip-btn {
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: transparent;
  padding: 4px 8px;
}
.skip-btn:hover {
  color: var(--color-bubble-text);
}
.body {
  padding: 22px 24px 18px;
}
h1 {
  font-size: var(--text-xl);
  margin: 0 0 10px;
  font-weight: 700;
}
h2 {
  font-size: var(--text-lg);
  margin: 0 0 6px;
  font-weight: 600;
}
.lead {
  margin: 0 0 16px;
  font-size: var(--text-base);
  line-height: 1.55;
  color: var(--color-muted);
}
.hint {
  margin: 0 0 14px;
  font-size: var(--text-sm);
  color: var(--color-muted);
  line-height: 1.55;
}
.feature-list {
  list-style: none;
  padding: 0;
  margin: 0 0 18px;
}
.feature-list li {
  padding: 6px 0;
  font-size: var(--text-sm);
}
.presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: oklch(96% 0.012 25 / 0.7);
  text-align: left;
  transition: all var(--duration-fast);
  border: 1px solid transparent;
}
.preset-btn:hover {
  background: oklch(94% 0.015 25 / 0.9);
  border-color: var(--color-accent);
}
.preset-label {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-bottom: 2px;
}
.preset-hint {
  font-size: 10px;
  color: var(--color-muted);
  line-height: 1.3;
}
.field {
  display: block;
  margin-bottom: 10px;
}
.field span {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin-bottom: 4px;
}
.field input {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-bubble-border);
  background: oklch(98% 0.005 25);
  font-size: var(--text-sm);
  font-family: inherit;
  box-sizing: border-box;
}
.field input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}
.code {
  margin: 0 0 14px;
  padding: 10px 12px;
  background: oklch(20% 0.01 25 / 0.92);
  color: oklch(92% 0.01 145);
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.probe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 10px;
}
.probe-status {
  font-size: var(--text-xs);
}
.probe-status.ok {
  color: oklch(45% 0.15 145);
}
.probe-status.fail {
  color: oklch(45% 0.18 25);
}
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 18px;
}
.ghost,
.primary {
  padding: 8px 16px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--duration-fast);
}
.ghost {
  background: oklch(95% 0.012 25 / 0.7);
  color: var(--color-bubble-text);
}
.ghost:hover {
  background: oklch(92% 0.015 25 / 0.9);
}
.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
}
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.primary.strong {
  background: oklch(55% 0.2 145);
}

.onboard-enter-active,
.onboard-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.onboard-enter-from,
.onboard-leave-to {
  opacity: 0;
}
.onboard-enter-active .card,
.onboard-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-expo);
}
.onboard-enter-from .card,
.onboard-leave-to .card {
  transform: scale(0.96) translateY(8px);
}
</style>
