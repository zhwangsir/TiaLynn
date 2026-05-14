<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { useConfigStore, type ConfigDto } from '@/stores/config'

const open = ref(false)
const config = useConfigStore()

const form = reactive<ConfigDto>({
  llm_endpoint: '',
  llm_model: '',
  llm_api_key: '',
  tts_provider: 'macos_say',
  tts_sidecar_url: 'http://127.0.0.1:5050',
})

onMounted(async () => {
  await config.load()
  if (config.config) Object.assign(form, config.config)
})

watch(
  () => config.config,
  (c) => {
    if (c) Object.assign(form, c)
  },
)

async function onSave() {
  await config.save({ ...form })
}

async function onTest() {
  await config.testLlm({ ...form })
}
</script>

<template>
  <!-- 齿轮触发器 -->
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

  <!-- 面板 -->
  <div v-if="open" class="settings-panel" data-uichrome="1">
    <header>
      <h2>设置</h2>
      <button class="close" type="button" @click="open = false">×</button>
    </header>

    <section>
      <h3>本地 LLM (OpenAI-compatible)</h3>
      <label>Endpoint</label>
      <input v-model="form.llm_endpoint" placeholder="http://192.168.x.x:1234/v1" />

      <label>Model</label>
      <input v-model="form.llm_model" placeholder="qwen2.5:14b" />

      <label>API Key（可选）</label>
      <input v-model="form.llm_api_key" type="password" placeholder="（无则留空）" />

      <div class="actions">
        <button class="ghost" type="button" :disabled="config.testing" @click="onTest">
          {{ config.testing ? '测试中…' : '测试连通' }}
        </button>
      </div>

      <div v-if="config.testResult" class="hint">{{ config.testResult }}</div>
    </section>

    <section>
      <h3>语音 (TTS)</h3>
      <label>提供方</label>
      <select v-model="form.tts_provider">
        <option value="macos_say">macOS 内置 say（中文女声）</option>
        <option value="sidecar">Sidecar（Qwen3-TTS / 自定义）</option>
      </select>

      <label>Sidecar URL</label>
      <input v-model="form.tts_sidecar_url" placeholder="http://127.0.0.1:5050" />
    </section>

    <footer>
      <button class="primary" type="button" :disabled="config.saving" @click="onSave">
        {{ config.saving ? '保存中…' : '保存' }}
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
  width: 320px;
  max-height: 76vh;
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
  margin-bottom: 8px;
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

.settings-panel section {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(168, 36, 42, 0.12);
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
.settings-panel input,
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
.settings-panel input:focus,
.settings-panel select:focus {
  border-color: #a8242a;
}
.settings-panel .actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
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
.settings-panel button.primary {
  width: 100%;
  margin-top: 12px;
  padding: 9px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 999px;
  background: #a8242a;
  color: white;
  border: none;
  cursor: pointer;
}
.settings-panel button.primary:hover {
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
.settings-panel footer {
  margin-top: 10px;
}
</style>
