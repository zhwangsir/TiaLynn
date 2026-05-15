<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useDialogStore } from '@/stores/dialog'
import { useSttStore } from '@/stores/stt'

const dialog = useDialogStore()
const stt = useSttStore()
const text = ref('')

function onSubmit() {
  const t = text.value.trim()
  if (!t || dialog.streaming) return
  dialog.send(t)
  text.value = ''
}

async function onMicClick() {
  try {
    await invoke('stt_toggle')
  } catch (e) {
    console.warn('[stt] toggle failed:', e)
  }
}

const placeholder = computed(() => {
  if (stt.status === 'Recording') return '🎤 录音中… 再按 F8 或点麦克风停止'
  if (stt.status === 'Transcribing') return '识别中…'
  return '跟 TiaLynn 说点什么…… (F8 语音)'
})

const micClass = computed(() => ({
  active: stt.status === 'Recording',
  busy: stt.status === 'Transcribing',
}))
</script>

<template>
  <form class="input-bar" data-uichrome="1" @submit.prevent="onSubmit">
    <button
      type="button"
      class="mic"
      :class="micClass"
      :title="stt.status === 'Recording' ? '停止录音' : '按住空格或 F8 录音'"
      @click="onMicClick"
    >
      {{ stt.status === 'Recording' ? '⏹' : '🎤' }}
    </button>
    <input
      v-model="text"
      type="text"
      :placeholder="placeholder"
      :disabled="dialog.streaming"
    />
    <button type="submit" :disabled="dialog.streaming || !text.trim()">
      {{ dialog.streaming ? '...' : '发送' }}
    </button>
  </form>
</template>

<style scoped>
.mic {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(168, 36, 42, 0.3);
  background: transparent;
  color: #a8242a;
  font-size: 14px;
  cursor: pointer;
  margin-right: 4px;
  transition: all 160ms;
}
.mic:hover {
  background: rgba(168, 36, 42, 0.08);
}
.mic.active {
  background: #a8242a;
  color: white;
  animation: pulse 1.2s infinite;
}
.mic.busy {
  background: #fbbf24;
  color: #2a1c1c;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}
</style>
