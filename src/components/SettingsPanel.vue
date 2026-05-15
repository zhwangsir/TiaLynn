<script setup lang="ts">
import { ref, reactive, watch, onMounted, computed } from 'vue'
import { useConfigStore, type ConfigDto } from '@/stores/config'

const open = ref(false)
const activeTab = ref<'llm' | 'model' | 'behavior' | 'tts' | 'system'>('llm')
const config = useConfigStore()

const form = reactive<ConfigDto>({
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  tts_provider: 'macos_say',
  tts_sidecar_url: 'http://127.0.0.1:5050',
  live2d_model_dir: 'HuTao-Live2D',
  live2d_model_file: 'Hu Tao.model3.json',
  live2d_scale: 0.35,
  live2d_offset_y: 50,
  idle_min_sec: 8,
  idle_max_sec: 15,
  autocomment_interval_sec: 300,
  emotion_decay_per_minute: 0.05,
  flip_probability: 0.15,
})

const dirty = ref(false)
const clearedHint = ref<string | null>(null)

onMounted(async () => {
  await config.load()
  await config.scanModels()
  if (config.config) Object.assign(form, config.config)
})

watch(
  () => config.config,
  (c) => {
    if (c) {
      Object.assign(form, c)
      dirty.value = false
    }
  },
)

watch(form, () => {
  dirty.value = true
})

async function onSave() {
  await config.save({ ...form })
  dirty.value = false
}

async function onTest() {
  await config.testLlm({ ...form })
}

async function onClearHistory() {
  const ok = confirm('确定清空所有对话历史？此操作不可撤销。')
  if (!ok) return
  const n = await config.clearHistory()
  clearedHint.value = `已清空 ${n} 条对话`
  setTimeout(() => (clearedHint.value = null), 3000)
}

async function onRevealData() {
  await config.revealDataDir()
}

async function onRevealModels() {
  await config.revealModelsDir()
  // 模型可能刚被添加，重新扫描
  setTimeout(() => config.scanModels(), 200)
}

async function onRescanModels() {
  await config.scanModels()
}

function pickModel(m: { dir: string; model_file: string }) {
  form.live2d_model_dir = m.dir
  form.live2d_model_file = m.model_file
}

const isModelSelected = (dir: string, file: string) =>
  form.live2d_model_dir === dir && form.live2d_model_file === file

// 把 idle min/max 双向约束（max >= min）
watch(
  () => form.idle_min_sec,
  (v) => {
    if (form.idle_max_sec < v) form.idle_max_sec = v
  },
)
watch(
  () => form.idle_max_sec,
  (v) => {
    if (form.idle_min_sec > v) form.idle_min_sec = v
  },
)

const tabs = computed(() => [
  { id: 'llm' as const, label: 'LLM' },
  { id: 'model' as const, label: '外观 / 模型' },
  { id: 'behavior' as const, label: '行为' },
  { id: 'tts' as const, label: '语音' },
  { id: 'system' as const, label: '系统' },
])
</script>

<template>
  <button
    class="settings-fab"
    data-uichrome="1"
    :class="{ active: open }"
    type="button"
    aria-label="设置"
    @click="open = !open"
  >
    <span class="cog">⚙</span>
  </button>

  <div v-if="open" class="settings-panel" data-uichrome="1">
    <header>
      <h2>设置</h2>
      <button class="close" type="button" @click="open = false">×</button>
    </header>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        :class="{ active: activeTab === t.id }"
        type="button"
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </nav>

    <!-- LLM -->
    <section v-show="activeTab === 'llm'">
      <h3>本地 LLM (OpenAI-compatible)</h3>
      <label>Endpoint</label>
      <input v-model="form.llm_endpoint" placeholder="http://192.168.x.x:1234/v1" />

      <label>Model</label>
      <input v-model="form.llm_model" placeholder="qwen2.5:14b / kimi 等" />

      <label>API Key（可选）</label>
      <input v-model="form.llm_api_key" type="password" placeholder="（无则留空）" />

      <div class="actions">
        <button class="ghost" type="button" :disabled="config.testing" @click="onTest">
          {{ config.testing ? '测试中…' : '测试连通' }}
        </button>
      </div>
      <div v-if="config.testResult" class="hint">{{ config.testResult }}</div>
    </section>

    <!-- 外观 / 模型 -->
    <section v-show="activeTab === 'model'">
      <h3>Live2D 模型</h3>
      <div class="model-list">
        <div
          v-for="m in config.models"
          :key="`${m.dir}/${m.model_file}`"
          class="model-item"
          :class="{ active: isModelSelected(m.dir, m.model_file) }"
          @click="pickModel(m)"
        >
          <div class="model-name">{{ m.dir }}</div>
          <div class="model-meta">
            <span class="badge">{{ m.source === 'builtin' ? '内置' : '用户' }}</span>
            <span>{{ m.model_file }}</span>
          </div>
        </div>
        <div v-if="config.models.length === 0" class="empty">
          未发现可用模型。点击下方"打开模型目录"放入 Live2D Cubism 4 模型。
        </div>
      </div>

      <div class="actions">
        <button class="ghost" type="button" @click="onRescanModels">重新扫描</button>
        <button class="ghost" type="button" @click="onRevealModels">打开模型目录</button>
      </div>

      <label>缩放 ({{ form.live2d_scale.toFixed(2) }})</label>
      <input
        v-model.number="form.live2d_scale"
        type="range"
        min="0.1"
        max="1.0"
        step="0.01"
      />

      <label>垂直偏移 ({{ form.live2d_offset_y.toFixed(0) }}px)</label>
      <input
        v-model.number="form.live2d_offset_y"
        type="range"
        min="-200"
        max="300"
        step="2"
      />
    </section>

    <!-- 行为 -->
    <section v-show="activeTab === 'behavior'">
      <h3>自主行为节奏</h3>

      <label>Idle 动作最小间隔 ({{ form.idle_min_sec }}s)</label>
      <input v-model.number="form.idle_min_sec" type="range" min="3" max="60" step="1" />

      <label>Idle 动作最大间隔 ({{ form.idle_max_sec }}s)</label>
      <input v-model.number="form.idle_max_sec" type="range" min="5" max="120" step="1" />

      <label>主动开口间隔 ({{ form.autocomment_interval_sec }}s)</label>
      <input
        v-model.number="form.autocomment_interval_sec"
        type="range"
        min="60"
        max="1800"
        step="30"
      />

      <label>情绪衰减率 (/分钟，{{ form.emotion_decay_per_minute.toFixed(3) }})</label>
      <input
        v-model.number="form.emotion_decay_per_minute"
        type="range"
        min="0"
        max="0.3"
        step="0.005"
      />

      <label>反差变量触发概率 ({{ (form.flip_probability * 100).toFixed(0) }}%)</label>
      <input
        v-model.number="form.flip_probability"
        type="range"
        min="0"
        max="0.5"
        step="0.01"
      />
    </section>

    <!-- 语音 -->
    <section v-show="activeTab === 'tts'">
      <h3>语音 (TTS)</h3>
      <label>提供方</label>
      <select v-model="form.tts_provider">
        <option value="macos_say">macOS 内置 say（中文女声）</option>
        <option value="sidecar">Sidecar（Qwen3-TTS / 自定义）</option>
      </select>

      <label>Sidecar URL</label>
      <input v-model="form.tts_sidecar_url" placeholder="http://127.0.0.1:5050" />

      <div class="hint" style="margin-top: 8px">
        Qwen3-TTS voice clone（情绪→音色路由）将在 v0.2.x 完整支持。
      </div>
    </section>

    <!-- 系统 -->
    <section v-show="activeTab === 'system'">
      <h3>系统</h3>

      <div class="row">
        <button class="ghost" type="button" @click="onRevealData">打开数据目录</button>
        <span class="hint-inline">memory.db / config.json</span>
      </div>

      <div class="row">
        <button class="ghost" type="button" @click="onRevealModels">打开模型目录</button>
        <span class="hint-inline">~/.tialynn/models/</span>
      </div>

      <div class="row">
        <button class="ghost danger" type="button" @click="onClearHistory">
          清空对话历史
        </button>
        <span v-if="clearedHint" class="hint-inline ok">{{ clearedHint }}</span>
      </div>

      <div class="row" style="margin-top: 12px">
        <span class="hint-inline">版本：v{{ config.version }}</span>
      </div>
    </section>

    <footer>
      <span v-if="dirty" class="dirty">未保存</span>
      <button class="primary" type="button" :disabled="config.saving || !dirty" @click="onSave">
        {{ config.saving ? '保存中…' : '保存设置' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.settings-fab {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(168, 36, 42, 0.3);
  box-shadow: 0 4px 12px rgba(42, 28, 28, 0.18);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #a8242a;
  transition: transform 200ms, background 200ms;
  pointer-events: auto;
}
.settings-fab:hover {
  background: #fff;
  transform: rotate(45deg);
}
.settings-fab.active {
  background: #a8242a;
  color: white;
  transform: rotate(90deg);
}

.settings-panel {
  position: absolute;
  top: 60px;
  right: 14px;
  width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 14px 16px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(168, 36, 42, 0.25);
  box-shadow: 0 12px 28px rgba(42, 28, 28, 0.22);
  pointer-events: auto;
  font-size: 13px;
  color: #2a1c1c;
}
.settings-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.settings-panel h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.settings-panel .close {
  background: none;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: rgba(42, 28, 28, 0.5);
}

.tabs {
  display: flex;
  gap: 4px;
  margin: 10px 0 8px;
  border-bottom: 1px solid rgba(168, 36, 42, 0.15);
  padding-bottom: 6px;
  flex-wrap: wrap;
}
.tabs button {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(42, 28, 28, 0.6);
  cursor: pointer;
}
.tabs button:hover {
  background: rgba(168, 36, 42, 0.06);
  color: #2a1c1c;
}
.tabs button.active {
  background: #a8242a;
  color: white;
}

.settings-panel section {
  padding-top: 4px;
}
.settings-panel h3 {
  font-size: 12px;
  font-weight: 600;
  color: #a8242a;
  margin: 0 0 8px;
  letter-spacing: 0.5px;
}
.settings-panel label {
  display: block;
  margin: 8px 0 4px;
  font-size: 12px;
  color: rgba(42, 28, 28, 0.7);
}
.settings-panel input[type='text'],
.settings-panel input[type='password'],
.settings-panel input:not([type]),
.settings-panel select {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid rgba(168, 36, 42, 0.25);
  background: white;
  outline: none;
  color: #2a1c1c;
}
.settings-panel input[type='range'] {
  width: 100%;
  accent-color: #a8242a;
}
.settings-panel input:focus,
.settings-panel select:focus {
  border-color: #a8242a;
}

.actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.settings-panel button.ghost {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid rgba(168, 36, 42, 0.4);
  background: transparent;
  color: #a8242a;
  cursor: pointer;
}
.settings-panel button.ghost:hover {
  background: rgba(168, 36, 42, 0.08);
}
.settings-panel button.ghost.danger {
  border-color: rgba(220, 38, 38, 0.6);
  color: #b91c1c;
}
.settings-panel button.ghost.danger:hover {
  background: rgba(220, 38, 38, 0.08);
}
.settings-panel button.primary {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 999px;
  background: #a8242a;
  color: white;
  border: none;
  cursor: pointer;
}
.settings-panel button.primary:hover:not(:disabled) {
  background: #8a1d22;
}
.settings-panel button.primary:disabled {
  background: #b89999;
  cursor: not-allowed;
}
.settings-panel .hint {
  margin-top: 6px;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 6px;
  background: rgba(168, 36, 42, 0.08);
  color: #2a1c1c;
  white-space: pre-wrap;
}
.settings-panel .hint-inline {
  font-size: 11px;
  color: rgba(42, 28, 28, 0.55);
  margin-left: 8px;
}
.settings-panel .hint-inline.ok {
  color: #166534;
}
.settings-panel .row {
  display: flex;
  align-items: center;
  margin: 6px 0;
}
.settings-panel footer {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid rgba(168, 36, 42, 0.12);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}
.dirty {
  font-size: 11px;
  color: #b45309;
}

/* 模型列表 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 6px;
}
.model-item {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(168, 36, 42, 0.2);
  background: white;
  cursor: pointer;
  transition: all 120ms;
}
.model-item:hover {
  border-color: #a8242a;
}
.model-item.active {
  background: #a8242a;
  color: white;
  border-color: #a8242a;
}
.model-item.active .badge,
.model-item.active .model-meta {
  color: rgba(255, 255, 255, 0.85);
}
.model-name {
  font-size: 13px;
  font-weight: 500;
}
.model-meta {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(42, 28, 28, 0.55);
  display: flex;
  align-items: center;
  gap: 6px;
}
.badge {
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 4px;
  background: rgba(168, 36, 42, 0.12);
  color: #a8242a;
}
.empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: rgba(42, 28, 28, 0.5);
  border: 1px dashed rgba(168, 36, 42, 0.25);
  border-radius: 8px;
}
</style>
