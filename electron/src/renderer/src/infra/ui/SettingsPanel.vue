<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import type { RuntimeConfig } from '@shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const cfg = useConfigStore()
const form = reactive<RuntimeConfig>({
  llm_provider: 'openai_compat',
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  tts_provider: 'sidecar',
  tts_sidecar_url: '',
  idle_min_sec: 60,
  idle_max_sec: 180,
  autocomment_interval_sec: 600,
  emotion_decay_per_minute: 0.1,
  flip_probability: 0.15,
  emotion_voice_map: {},
  embedding_endpoint: '',
  embedding_model: '',
})

const selectedModel = ref<string>('')

watch(
  () => cfg.config,
  (v) => {
    if (!v) return
    Object.assign(form, JSON.parse(JSON.stringify(v)))
  },
  { immediate: true },
)
watch(
  () => cfg.soul?.avatar.model_dir,
  (v) => {
    if (v) selectedModel.value = v
  },
  { immediate: true },
)

const ttsHealth = ref<{ ok: boolean; status?: number; reason?: string } | null>(null)

async function probeTts(): Promise<void> {
  ttsHealth.value = await window.api.tts.probe()
}

const dataDir = ref<string>('')
async function bootstrapMeta(): Promise<void> {
  const paths = await window.api.system.paths()
  dataDir.value = paths.userDataDir
}
bootstrapMeta()

async function save(): Promise<void> {
  await cfg.save(form)
}

async function testLlm(): Promise<void> {
  await cfg.testLlm(form)
}

async function switchModel(): Promise<void> {
  if (!selectedModel.value || !cfg.soul) return
  const target = cfg.models.find((m) => m.dir === selectedModel.value)
  const ok = await cfg.saveAvatar({
    model_dir: selectedModel.value,
    model_file: target?.model_file ?? cfg.soul.avatar.model_file,
  })
  if (!ok) {
    // 至少前端 mutate，让 watch 触发重新加载
    cfg.soul.avatar.model_dir = selectedModel.value
  }
}

async function rescan(): Promise<void> {
  await cfg.rescanModels()
}

async function reloadSoul(): Promise<void> {
  await cfg.reloadSoul()
}

async function openDataDir(): Promise<void> {
  await window.api.system.revealDataDir()
}

async function openModelsDir(): Promise<void> {
  await window.api.system.revealModelsDir()
}

const providerOptions = [
  { v: 'anthropic', label: 'Anthropic Claude' },
  { v: 'openai_compat', label: 'OpenAI 兼容 (LM Studio / SiliconFlow / OpenAI)' },
  { v: 'ollama', label: 'Ollama 本地' },
] as const

const modelOptions = computed(() =>
  cfg.models.map((m) => ({ value: m.dir, label: `${m.display} (${m.cubism})` })),
)
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header>
        <h2 id="settings-title">设置 · v{{ cfg.version || '0.6' }}</h2>
        <button class="close" @click="emit('close')" title="关闭设置">×</button>
      </header>

      <section>
        <h3>大脑 (LLM)</h3>
        <label>
          <span>提供商</span>
          <select v-model="form.llm_provider">
            <option v-for="o in providerOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
          </select>
        </label>
        <label>
          <span>Endpoint</span>
          <input v-model="form.llm_endpoint" type="text" placeholder="https://api.anthropic.com / http://localhost:11434 / ..." />
        </label>
        <label>
          <span>Model</span>
          <input v-model="form.llm_model" type="text" placeholder="claude-sonnet-4-6 / qwen2.5-7b / gpt-4o-mini" />
        </label>
        <label>
          <span>API Key</span>
          <input v-model="form.llm_api_key" type="password" placeholder="（本地服务可留空）" />
        </label>
        <div class="row">
          <button class="ghost" @click="testLlm" :disabled="cfg.testing">
            {{ cfg.testing ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="cfg.testResult" :class="['result', cfg.testResult.ok ? 'ok' : 'bad']">
            {{ cfg.testResult.ok ? '✓' : '✗' }} {{ cfg.testResult.message }}
          </span>
        </div>
      </section>

      <section>
        <h3>立绘 (Avatar)</h3>
        <label>
          <span>模型</span>
          <select v-model="selectedModel">
            <option value="">（保持当前）</option>
            <option v-for="o in modelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <div class="row">
          <button class="ghost" @click="rescan">重扫</button>
          <button class="ghost" @click="switchModel" :disabled="!selectedModel">应用</button>
          <button class="ghost" @click="openModelsDir">打开模型目录</button>
        </div>
        <p class="hint">把任意 *.model3.json / *.model.json 的模型目录放到 ~/.tialynn/models / 项目根 / ~/Documents/Live2d-model-master 任一处即可。</p>
      </section>

      <section>
        <h3>声音 (TTS)</h3>
        <label>
          <span>方案</span>
          <select v-model="form.tts_provider">
            <option value="sidecar">本地 sidecar（FastAPI）</option>
            <option value="none">关闭语音</option>
          </select>
        </label>
        <label>
          <span>Sidecar URL</span>
          <input v-model="form.tts_sidecar_url" type="text" placeholder="http://localhost:8765" />
        </label>
        <div class="row">
          <button class="ghost" @click="probeTts">探测</button>
          <span v-if="ttsHealth" :class="['result', ttsHealth.ok ? 'ok' : 'bad']">
            {{ ttsHealth.ok ? `✓ ${ttsHealth.status}` : `✗ ${ttsHealth.reason ?? ttsHealth.status}` }}
          </span>
        </div>
      </section>

      <section>
        <h3>灵魂 (Soul)</h3>
        <p class="hint">{{ cfg.soul?.name }} · 主人「{{ cfg.soul?.master }}」 · 称呼「{{ cfg.soul?.call_master_as }}」</p>
        <p class="hint" v-if="dataDir">数据目录：<code>{{ dataDir }}</code></p>
        <div class="row">
          <button class="ghost" @click="reloadSoul">重载灵魂</button>
          <button class="ghost" @click="openDataDir">打开数据目录</button>
        </div>
      </section>

      <footer>
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" @click="save" :disabled="cfg.saving">
          {{ cfg.saving ? '保存中…' : '保存' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  background: oklch(0% 0 0 / 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  backdrop-filter: blur(2px);
  animation: fadein var(--duration-fast) var(--ease-out-expo);
}
@keyframes fadein {
  from { opacity: 0; }
  to { opacity: 1; }
}
.panel {
  width: min(420px, 90vw);
  max-height: 92vh;
  overflow-y: auto;
  background: oklch(99% 0.008 25 / 0.98);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--color-bubble-text);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-bubble-border);
  padding-bottom: 8px;
}
header h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: 0.02em;
}
.close {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 18px;
  line-height: 1;
  color: var(--color-muted);
}
.close:hover {
  background: oklch(95% 0.015 25 / 0.6);
  color: var(--color-bubble-text);
}
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
section h3 {
  margin: 0 0 4px 0;
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accent);
}
label {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 10px;
}
label > span {
  font-size: var(--text-xs);
  color: var(--color-muted);
}
input,
select {
  font: inherit;
  font-size: var(--text-sm);
  padding: 6px 10px;
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-sm);
  background: white;
  color: var(--color-bubble-text);
  outline: none;
  transition: border-color var(--duration-fast);
}
input:focus,
select:focus {
  border-color: var(--color-accent);
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
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
.ghost:hover {
  background: oklch(92% 0.015 25 / 0.9);
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
  opacity: 0.5;
  cursor: not-allowed;
}
.result {
  font-size: var(--text-xs);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
}
.result.ok {
  background: oklch(95% 0.06 145 / 0.6);
  color: oklch(40% 0.1 145);
}
.result.bad {
  background: oklch(95% 0.08 25 / 0.6);
  color: oklch(45% 0.15 25);
}
.hint {
  font-size: var(--text-xs);
  color: var(--color-muted);
  margin: 4px 0;
}
code {
  background: oklch(94% 0.01 25 / 0.6);
  padding: 1px 6px;
  border-radius: 4px;
}
footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  border-top: 1px solid var(--color-bubble-border);
  padding-top: 12px;
}
</style>
