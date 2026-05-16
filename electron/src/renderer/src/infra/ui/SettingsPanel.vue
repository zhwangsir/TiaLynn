<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import type { RuntimeConfig } from '@shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const cfg = useConfigStore()

function blankConfig(): RuntimeConfig {
  return {
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
  }
}

const form = reactive<RuntimeConfig>(blankConfig())
const selectedModel = ref<string>('')
/** 用户是否已在面板上做过编辑（true 后停止从 store 覆盖，避免 IPC 推送把输入回退） */
const userEdited = ref(false)
/** 最近一次保存反馈 */
const saveStatus = ref<{ ok: boolean; message: string } | null>(null)

function loadFromStore(): void {
  if (cfg.config) Object.assign(form, JSON.parse(JSON.stringify(cfg.config)))
  if (cfg.soul?.avatar.model_dir) selectedModel.value = cfg.soul.avatar.model_dir
}

// 初始化：拷一份 store 当前值
loadFromStore()

// 打开面板时自动 rescan，确保 model meta 是最新的（v0.6.9 加了 meta 字段）
onMounted(() => {
  void cfg.rescanModels()
})

// 用户没动过表单时，store 变化可以镜像回 form（避免显示陈旧值）
watch(
  () => cfg.config,
  () => {
    if (!userEdited.value) loadFromStore()
  },
)
watch(
  () => cfg.soul?.avatar.model_dir,
  (v) => {
    if (!userEdited.value && v) selectedModel.value = v
  },
)

/** 任何字段被改动 → markDirty，停止外部覆盖 */
function markDirty(): void {
  userEdited.value = true
  saveStatus.value = null
}

const dirty = computed<boolean>(() => {
  if (!cfg.config) return false
  const a = JSON.stringify(form)
  const b = JSON.stringify(cfg.config)
  const modelChanged = !!selectedModel.value && selectedModel.value !== cfg.soul?.avatar.model_dir
  return a !== b || modelChanged
})

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

/**
 * 一键保存：先存 RuntimeConfig，再（如需）存 avatar。
 * 任一步失败 → 不关面板 + toast；全成功 → toast + 关面板。
 */
async function save(): Promise<void> {
  const errors: string[] = []
  let configSaved = false
  let avatarSaved = false

  try {
    await cfg.save(form)
    configSaved = true
  } catch (e) {
    errors.push(`运行配置：${e instanceof Error ? e.message : String(e)}`)
  }

  // 模型切换（如果选了一个跟当前不一样的）
  const targetDir = selectedModel.value
  if (cfg.soul && targetDir && targetDir !== cfg.soul.avatar.model_dir) {
    try {
      const target = cfg.models.find((m) => m.dir === targetDir)
      const ok = await cfg.saveAvatar({
        model_dir: targetDir,
        model_file: target?.model_file ?? cfg.soul.avatar.model_file,
      })
      if (ok) avatarSaved = true
      else errors.push('立绘配置写回 identity.yaml 失败（已在前端切换，但磁盘没生效）')
    } catch (e) {
      errors.push(`立绘配置：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (errors.length === 0) {
    saveStatus.value = { ok: true, message: '已保存' }
    const parts: string[] = []
    if (configSaved) parts.push('运行配置')
    if (avatarSaved) parts.push('立绘')
    bus.emit('ui:toast', {
      kind: 'success',
      message: parts.length > 0 ? `已保存：${parts.join(' + ')}` : '已保存',
      ttl_ms: 2500,
    })
    userEdited.value = false
    // 短暂展示「已保存」再关闭，比直接关闭更让人放心
    setTimeout(() => emit('close'), 350)
  } else {
    saveStatus.value = { ok: false, message: errors.join('；') }
    bus.emit('ui:toast', { kind: 'error', message: `保存失败：${errors[0]}`, ttl_ms: 8000 })
  }
}

async function testLlm(): Promise<void> {
  await cfg.testLlm(form)
}

async function rescan(): Promise<void> {
  await cfg.rescanModels()
  bus.emit('ui:toast', { kind: 'info', message: `已扫描，${cfg.models.length} 个模型`, ttl_ms: 2500 })
}

async function reloadSoul(): Promise<void> {
  await cfg.reloadSoul()
  bus.emit('ui:toast', { kind: 'info', message: '灵魂档案已重载', ttl_ms: 2000 })
}

async function openDataDir(): Promise<void> {
  await window.api.system.revealDataDir()
}

async function openModelsDir(): Promise<void> {
  await window.api.system.revealModelsDir()
}

function cancel(): void {
  if (dirty.value) {
    // 简单提示：丢弃改动；下次面板打开会从 store 重新读
    bus.emit('ui:toast', { kind: 'warn', message: '已放弃未保存的改动', ttl_ms: 2500 })
  }
  emit('close')
}

const providerOptions = [
  { v: 'anthropic', label: 'Anthropic Claude' },
  { v: 'openai_compat', label: 'OpenAI 兼容 (LM Studio / SiliconFlow / OpenAI)' },
  { v: 'ollama', label: 'Ollama 本地' },
] as const

const showIncomplete = ref(false)

const modelOptions = computed(() => {
  const list = [...cfg.models]
  list.sort((a, b) => {
    // 完整 cubism4 优先 → 不完整 cubism4 → cubism2
    const score = (m: typeof a): number => {
      if (m.cubism !== 'cubism4') return 2
      return m.meta?.complete ? 0 : 1
    }
    const sa = score(a)
    const sb = score(b)
    if (sa !== sb) return sa - sb
    return a.display.localeCompare(b.display)
  })

  return list
    .filter((m) => {
      if (showIncomplete.value) return true
      // 默认只显示「完整 cubism4」
      return m.cubism === 'cubism4' && m.meta?.complete
    })
    .map((m) => {
      const isCubism2 = m.cubism !== 'cubism4'
      const incomplete = !m.meta?.complete
      let suffix = ''
      let disabled = false
      if (isCubism2) {
        suffix = '（Cubism 2，暂不支持）'
        disabled = true
      } else if (incomplete) {
        suffix = `（${m.meta?.reason ?? '不完整'}）`
        // 仅 moc/texture 缺失才禁用；"无动作" 仍可加载（只是没动）
        disabled = !m.meta?.has_core
      } else {
        const parts: string[] = []
        if (m.meta) {
          if (m.meta.motion_count > 0) parts.push(`${m.meta.motion_count} 动作`)
          if (m.meta.expression_count > 0) parts.push(`${m.meta.expression_count} 表情`)
          if (m.meta.has_physics) parts.push('物理')
        }
        if (parts.length > 0) suffix = ` · ${parts.join(' · ')}`
      }
      return { value: m.dir, label: `${m.display}${suffix}`, disabled }
    })
})

const totalCount = computed(() => cfg.models.length)
const usableCount = computed(
  () => cfg.models.filter((m) => m.cubism === 'cubism4' && m.meta?.complete).length,
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
          <select v-model="form.llm_provider" @change="markDirty">
            <option v-for="o in providerOptions" :key="o.v" :value="o.v">{{ o.label }}</option>
          </select>
        </label>
        <label>
          <span>Endpoint</span>
          <input v-model="form.llm_endpoint" type="text" placeholder="https://api.anthropic.com / http://localhost:11434 / ..." @input="markDirty" />
        </label>
        <label>
          <span>Model</span>
          <input v-model="form.llm_model" type="text" placeholder="claude-sonnet-4-6 / qwen2.5-7b / gpt-4o-mini" @input="markDirty" />
        </label>
        <label>
          <span>API Key</span>
          <input v-model="form.llm_api_key" type="password" placeholder="（本地服务可留空）" @input="markDirty" />
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
          <select v-model="selectedModel" @change="markDirty">
            <option
              v-for="o in modelOptions"
              :key="o.value"
              :value="o.value"
              :disabled="o.disabled"
            >{{ o.label }}</option>
          </select>
        </label>
        <div class="row">
          <button class="ghost" @click="rescan">重扫</button>
          <button class="ghost" @click="openModelsDir">打开模型目录</button>
          <label class="inline-toggle" :title="`总共扫到 ${totalCount}，可用 ${usableCount}`">
            <input type="checkbox" v-model="showIncomplete" />
            显示不完整模型
          </label>
        </div>
        <p class="hint">
          已显示 {{ modelOptions.length }} / 总 {{ totalCount }} · 可用（cubism4 + 含动作）{{ usableCount }}
          。把任意 *.model3.json 的模型目录放到 ~/.tialynn/models / 项目根 / ~/Documents/Live2d-model-master 任一处。
        </p>
      </section>

      <section>
        <h3>声音 (TTS)</h3>
        <label>
          <span>方案</span>
          <select v-model="form.tts_provider" @change="markDirty">
            <option value="sidecar">本地 sidecar（FastAPI）</option>
            <option value="none">关闭语音</option>
          </select>
        </label>
        <label>
          <span>Sidecar URL</span>
          <input v-model="form.tts_sidecar_url" type="text" placeholder="http://localhost:8765" @input="markDirty" />
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
        <span v-if="saveStatus" :class="['save-status', saveStatus.ok ? 'ok' : 'bad']">
          {{ saveStatus.ok ? '✓' : '✗' }} {{ saveStatus.message }}
        </span>
        <span v-else-if="dirty" class="save-status dirty">有未保存的改动</span>
        <span class="spacer" />
        <button class="ghost" @click="cancel">取消</button>
        <button class="primary" @click="save" :disabled="cfg.saving || !dirty">
          {{ cfg.saving ? '保存中…' : dirty ? '保存' : '已是最新' }}
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
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--color-bubble-border);
  padding-top: 12px;
}
.spacer {
  flex: 1;
}
.inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  grid-template-columns: none;
  font-size: var(--text-xs);
  color: var(--color-muted);
  cursor: pointer;
}
.inline-toggle input {
  width: auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.save-status {
  font-size: var(--text-xs);
  padding: 3px 10px;
  border-radius: var(--radius-pill);
}
.save-status.ok {
  background: oklch(95% 0.06 145 / 0.6);
  color: oklch(40% 0.1 145);
}
.save-status.bad {
  background: oklch(95% 0.08 25 / 0.6);
  color: oklch(45% 0.15 25);
}
.save-status.dirty {
  background: oklch(95% 0.05 80 / 0.6);
  color: oklch(45% 0.12 80);
}
</style>
