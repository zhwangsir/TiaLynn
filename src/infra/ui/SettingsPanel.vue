<script setup lang="ts">
import { ref, reactive, watch, onMounted, computed } from 'vue'
import { useConfigStore, type ConfigDto } from '@/infra/stores/config'
import { useSoulStore } from '@/brain/stores/soul'

const open = ref(false)
const activeTab = ref<'llm' | 'model' | 'behavior' | 'tts' | 'system'>('llm')
const config = useConfigStore()
const soul = useSoulStore()

const EMOTIONS = ['neutral', 'happy', 'shy', 'angry', 'sad', 'sleepy', 'possessive'] as const

const form = reactive<ConfigDto>({
  llm_provider: 'openai_compat',
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  tts_provider: 'sidecar',
  tts_sidecar_url: 'http://127.0.0.1:5050',
  idle_min_sec: 8,
  idle_max_sec: 15,
  autocomment_interval_sec: 300,
  emotion_decay_per_minute: 0.05,
  flip_probability: 0.15,
  emotion_voice_map: {},
  embedding_endpoint: '',
  embedding_model: 'text-embedding-3-small',
})

const dirty = ref(false)
const clearedHint = ref<string | null>(null)
const distillResult = ref<string | null>(null)

onMounted(async () => {
  await config.load()
  await Promise.all([
    config.scanModels(),
    config.loadSidecarStatus(),
    config.loadVoices(),
    config.listSearchPaths(),
  ])
  if (config.config) Object.assign(form, config.config)
  if (!form.emotion_voice_map) form.emotion_voice_map = {}
  for (const e of EMOTIONS) {
    if (!form.emotion_voice_map[e]) form.emotion_voice_map[e] = 'edge_xiaoxiao'
  }
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

watch(
  () => [form.idle_min_sec, form.idle_max_sec],
  ([min, max]) => {
    if (max < min) form.idle_max_sec = min
  },
)

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

async function onDistill() {
  distillResult.value = '凝练中…'
  const n = await config.distill()
  distillResult.value = n > 0 ? `已写入 ${n} 条长期记忆` : '没有值得记忆的新内容'
  setTimeout(() => (distillResult.value = null), 4000)
}

async function onRevealData() {
  await config.revealDataDir()
}
async function onRevealModels() {
  await config.revealModelsDir()
  setTimeout(() => config.scanModels(), 200)
}
async function onRescanModels() {
  await config.scanModels()
}
async function onAddModelSearchPath() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选一个包含 Live2D 模型的目录',
    })
    if (typeof selected === 'string') {
      await config.addSearchPath(selected)
      await config.scanModels()
    }
  } catch (e) {
    console.warn('[settings] add path failed:', e)
  }
}
async function onRemoveModelSearchPath(path: string) {
  await config.removeSearchPath(path)
  await config.scanModels()
}
async function onStartSidecar() {
  await config.startSidecar()
  await config.loadVoices()
}
async function onStopSidecar() {
  await config.stopSidecar()
}
async function onRefreshSidecar() {
  await config.loadSidecarStatus()
  await config.loadVoices()
}
async function onRegisterExampleVoices() {
  await config.registerExampleVoices()
}

const currentModelDisplay = computed(() => {
  return soul.config?.appearance?.live2d_model_dir
    ? `${soul.config.appearance.live2d_model_dir} / ${soul.config.appearance.model_file}`
    : '(未加载)'
})

const tabs = computed(() => [
  { id: 'llm' as const, label: 'LLM' },
  { id: 'model' as const, label: '外观 / 模型' },
  { id: 'behavior' as const, label: '行为' },
  { id: 'tts' as const, label: '语音' },
  { id: 'system' as const, label: '系统' },
])

const sidecarLabel = computed(() => {
  const st = config.sidecar?.status
  switch (st) {
    case 'External':
      return 'Sidecar：外部进程（已连通）'
    case 'Spawned':
      return 'Sidecar：已由 TiaLynn 启动'
    case 'Probing':
      return 'Sidecar：探测中…'
    case 'Failed':
      return 'Sidecar：失败'
    default:
      return 'Sidecar：未启动'
  }
})

const sidecarBadgeClass = computed(() => {
  const st = config.sidecar?.status
  if (st === 'Spawned' || st === 'External') return 'ok'
  if (st === 'Failed') return 'err'
  return 'warn'
})

function emotionLabel(id: string): string {
  return (
    {
      neutral: '😐 平静',
      happy: '😄 开心',
      shy: '😳 害羞',
      angry: '😠 生气',
      sad: '😢 伤心',
      sleepy: '😴 困倦',
      possessive: '🩸 占有',
    } as Record<string, string>
  )[id] ?? id
}
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
      <h3>本地 / 云端 LLM</h3>
      <label>Provider</label>
      <select v-model="form.llm_provider">
        <option value="openai_compat">OpenAI-compatible（Ollama / vLLM / LM Studio）</option>
        <option value="anthropic">Anthropic Claude</option>
        <option value="ollama">Ollama 原生</option>
      </select>

      <label>Endpoint</label>
      <input
        v-model="form.llm_endpoint"
        placeholder="OpenAI: http://x:1234/v1 | Claude: https://api.anthropic.com | Ollama: http://127.0.0.1:11434"
      />

      <label>Model</label>
      <input v-model="form.llm_model" placeholder="claude-sonnet-4-6 / qwen2.5:14b / kimi 等" />

      <label>API Key（Claude 必填，本地可空）</label>
      <input v-model="form.llm_api_key" type="password" placeholder="（无则留空）" />

      <div class="actions">
        <button class="ghost" type="button" :disabled="config.testing" @click="onTest">
          {{ config.testing ? '测试中…' : '测试连通' }}
        </button>
      </div>
      <div v-if="config.testResult" class="hint">{{ config.testResult }}</div>

      <h3 style="margin-top: 14px">Embedding（长期记忆，可选）</h3>
      <label>Embedding Endpoint</label>
      <input
        v-model="form.embedding_endpoint"
        placeholder="http://192.168.x.x:1234/v1（留空则不启用记忆召回）"
      />
      <label>Embedding Model</label>
      <input v-model="form.embedding_model" placeholder="text-embedding-3-small / bge-m3" />
    </section>

    <!-- 外观 / 模型 -->
    <section v-show="activeTab === 'model'">
      <h3>Live2D 模型 <span class="hint-inline">共 {{ config.models.length }} 个</span></h3>

      <div class="hint" style="margin-bottom: 6px">
        当前：<strong>{{ currentModelDisplay }}</strong><br>
        v0.4 起：模型选择请编辑 <code>soul/identity.yaml</code> 的 <code>avatar.model_dir/model_file</code>，
        热重载生效。
      </div>

      <div class="model-list">
        <div v-for="m in config.models" :key="`${m.root_id}/${m.dir}/${m.model_file}`" class="model-item">
          <div class="model-name">{{ m.display || m.dir }}</div>
          <div class="model-meta">
            <span class="badge" :class="{ c2: m.cubism === 'cubism2' }">
              {{ m.cubism === 'cubism2' ? 'Cubism 2' : 'Cubism 4' }}
            </span>
            <span class="badge" :class="{ external: m.source.startsWith('external') }">
              {{ m.source === 'builtin' ? '内置' : m.source === 'user' ? '用户' : '外部' }}
            </span>
          </div>
        </div>
        <div v-if="config.models.length === 0" class="empty">
          未发现可用模型。下方添加搜索路径。
        </div>
      </div>

      <div class="actions">
        <button class="ghost" type="button" @click="onRescanModels">重新扫描</button>
        <button class="ghost" type="button" @click="onRevealModels">打开默认模型目录</button>
        <button class="ghost" type="button" @click="onAddModelSearchPath">+ 添加搜索路径</button>
      </div>

      <div v-if="config.searchPaths.length > 0" style="margin-top: 12px">
        <h3 style="font-size: 11px">已添加的搜索路径</h3>
        <div v-for="p in config.searchPaths" :key="p" class="path-row">
          <span class="path-text" :title="p">{{ p }}</span>
          <button class="path-remove" type="button" title="移除" @click="onRemoveModelSearchPath(p)">×</button>
        </div>
        <div class="hint" style="margin-top: 6px">
          注：新增路径后需重启 TiaLynn（vite 静态根仅启动时加载）
        </div>
      </div>
    </section>

    <!-- 行为 -->
    <section v-show="activeTab === 'behavior'">
      <h3>Idle 微动作 / 主动开口</h3>
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
      <input v-model.number="form.emotion_decay_per_minute" type="range" min="0" max="0.3" step="0.005" />
      <label>反差变量触发概率 ({{ (form.flip_probability * 100).toFixed(0) }}%)</label>
      <input v-model.number="form.flip_probability" type="range" min="0" max="0.5" step="0.01" />

      <div class="hint" style="margin-top: 8px">
        自主散步（M5 重做）暂不可用。当前 idle 仅为微动作（眨眼、视线跟随）。
      </div>
    </section>

    <!-- 语音 -->
    <section v-show="activeTab === 'tts'">
      <h3>语音 (TTS)</h3>
      <label>提供方</label>
      <select v-model="form.tts_provider">
        <option value="sidecar">Sidecar（edge-tts / Qwen3-TTS / 自定义）</option>
        <option value="macos_say">macOS 内置 say（中文女声）</option>
      </select>

      <label>Sidecar URL</label>
      <input v-model="form.tts_sidecar_url" placeholder="http://127.0.0.1:5050" />

      <div class="row" style="margin-top: 6px">
        <span class="badge" :class="sidecarBadgeClass">{{ sidecarLabel }}</span>
        <button class="ghost" type="button" style="margin-left: auto" @click="onRefreshSidecar">刷新</button>
        <button class="ghost" type="button" @click="onStartSidecar">启动</button>
        <button class="ghost" type="button" @click="onStopSidecar">停止</button>
      </div>
      <div v-if="config.sidecar?.last_error" class="hint">{{ config.sidecar.last_error }}</div>

      <h3 style="margin-top: 14px">情绪 → 音色路由</h3>
      <div class="row">
        <button class="ghost" type="button" @click="onRegisterExampleVoices">
          从 example_voice/ 一键注册
        </button>
      </div>
      <div class="emotion-map">
        <div v-for="e in EMOTIONS" :key="e" class="emotion-row">
          <span class="emotion-label">{{ emotionLabel(e) }}</span>
          <select v-model="form.emotion_voice_map[e]">
            <option v-for="v in config.voices" :key="v.id" :value="v.id">
              {{ v.id }} {{ v.note ? `(${v.note})` : '' }}
            </option>
            <option v-if="config.voices.length === 0" value="edge_xiaoxiao">
              edge_xiaoxiao（启动 sidecar 后会有更多）
            </option>
          </select>
        </div>
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
        <button class="ghost" type="button" @click="onDistill">凝练为长期记忆</button>
        <span v-if="distillResult" class="hint-inline ok">{{ distillResult }}</span>
      </div>

      <div class="row">
        <button class="ghost danger" type="button" @click="onClearHistory">清空对话历史</button>
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
.settings-panel header { display: flex; align-items: center; justify-content: space-between; }
.settings-panel h2 { font-size: 15px; font-weight: 600; margin: 0; }
.settings-panel .close { background: none; border: none; font-size: 20px; line-height: 1; cursor: pointer; color: rgba(42, 28, 28, 0.5); }
.tabs { display: flex; gap: 4px; margin: 10px 0 8px; border-bottom: 1px solid rgba(168, 36, 42, 0.15); padding-bottom: 6px; flex-wrap: wrap; }
.tabs button { padding: 4px 10px; font-size: 12px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: rgba(42, 28, 28, 0.6); cursor: pointer; }
.tabs button:hover { background: rgba(168, 36, 42, 0.06); color: #2a1c1c; }
.tabs button.active { background: #a8242a; color: white; }
.settings-panel section { padding-top: 4px; }
.settings-panel h3 { font-size: 12px; font-weight: 600; color: #a8242a; margin: 0 0 8px; letter-spacing: 0.5px; }
.settings-panel label { display: block; margin: 8px 0 4px; font-size: 12px; color: rgba(42, 28, 28, 0.7); }
.settings-panel input[type='text'], .settings-panel input[type='password'], .settings-panel input:not([type]), .settings-panel select {
  width: 100%; padding: 7px 10px; font-size: 13px; border-radius: 8px; border: 1px solid rgba(168, 36, 42, 0.25); background: white; outline: none; color: #2a1c1c;
}
.settings-panel input[type='range'] { width: 100%; accent-color: #a8242a; }
.settings-panel input:focus, .settings-panel select:focus { border-color: #a8242a; }
.actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
.settings-panel button.ghost { padding: 6px 12px; font-size: 12px; border-radius: 8px; border: 1px solid rgba(168, 36, 42, 0.4); background: transparent; color: #a8242a; cursor: pointer; }
.settings-panel button.ghost:hover { background: rgba(168, 36, 42, 0.08); }
.settings-panel button.ghost.danger { border-color: rgba(220, 38, 38, 0.6); color: #b91c1c; }
.settings-panel button.ghost.danger:hover { background: rgba(220, 38, 38, 0.08); }
.settings-panel button.primary { padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 999px; background: #a8242a; color: white; border: none; cursor: pointer; }
.settings-panel button.primary:hover:not(:disabled) { background: #8a1d22; }
.settings-panel button.primary:disabled { background: #b89999; cursor: not-allowed; }
.settings-panel .hint { margin-top: 6px; padding: 6px 10px; font-size: 12px; border-radius: 6px; background: rgba(168, 36, 42, 0.08); color: #2a1c1c; }
.settings-panel .hint-inline { font-size: 11px; color: rgba(42, 28, 28, 0.55); margin-left: 8px; }
.settings-panel .hint-inline.ok { color: #166534; }
.settings-panel .row { display: flex; align-items: center; margin: 6px 0; }
.settings-panel footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(168, 36, 42, 0.12); display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.dirty { font-size: 11px; color: #b45309; }
.model-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; margin-top: 6px; }
.model-item { padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(168, 36, 42, 0.2); background: white; }
.model-name { font-size: 13px; font-weight: 500; }
.model-meta { margin-top: 2px; font-size: 11px; color: rgba(42, 28, 28, 0.55); display: flex; align-items: center; gap: 6px; }
.badge { padding: 1px 6px; font-size: 10px; border-radius: 4px; background: rgba(168, 36, 42, 0.12); color: #a8242a; }
.badge.c2 { background: rgba(120, 80, 20, 0.15); color: #7a5a18; }
.badge.external { background: rgba(80, 100, 180, 0.15); color: #3b5bdb; }
.badge.ok { background: rgba(22, 101, 52, 0.12); color: #166534; }
.badge.warn { background: rgba(180, 83, 9, 0.12); color: #b45309; }
.badge.err { background: rgba(185, 28, 28, 0.12); color: #b91c1c; }
.empty { padding: 16px; text-align: center; font-size: 12px; color: rgba(42, 28, 28, 0.5); border: 1px dashed rgba(168, 36, 42, 0.25); border-radius: 8px; }
.path-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; margin-bottom: 4px; background: rgba(168, 36, 42, 0.05); border-radius: 6px; border: 1px solid rgba(168, 36, 42, 0.1); }
.path-text { flex: 1; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: #2a1c1c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.path-remove { width: 22px; height: 22px; border-radius: 999px; border: 1px solid rgba(168, 36, 42, 0.3); background: transparent; color: #a8242a; cursor: pointer; font-size: 14px; line-height: 1; }
.path-remove:hover { background: rgba(168, 36, 42, 0.1); }
.emotion-map { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.emotion-row { display: flex; align-items: center; gap: 8px; }
.emotion-label { width: 70px; font-size: 12px; color: rgba(42, 28, 28, 0.7); flex-shrink: 0; }
.emotion-row select { flex: 1; }
</style>
