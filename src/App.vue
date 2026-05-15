<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import Live2DStage from './components/Live2DStage.vue'
import DialogBubble from './components/DialogBubble.vue'
import InputBar from './components/InputBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { useSoulStore } from './stores/soul'
import { useDialogStore } from './stores/dialog'
import { useEmotionStore } from './stores/emotion'
import { useConfigStore } from './stores/config'
import { useSttStore } from './stores/stt'
import { startAlphaHitTest, stopAlphaHitTest } from './alpha/sampler'
import { startEmotionTick } from './behavior/emotionTick'
import { startAutoComment } from './behavior/autoComment'
import { startDistillTick } from './behavior/distillTick'

const soul = useSoulStore()
const dialog = useDialogStore()
const emotion = useEmotionStore()
const config = useConfigStore()
const stt = useSttStore()
const ready = ref(false)
void stt // 触发 store 初始化（事件监听）

let stopEmotionTick: (() => void) | null = null
let stopAutoComment: (() => void) | null = null
let stopDistillTick: (() => void) | null = null

onMounted(async () => {
  await Promise.all([soul.load(), config.load()])
  emotion.init(soul.config?.emotions?.initial ?? 'neutral')
  startAlphaHitTest()
  stopEmotionTick = startEmotionTick()
  stopAutoComment = startAutoComment()
  stopDistillTick = startDistillTick()
  ready.value = true
})

onBeforeUnmount(() => {
  stopAlphaHitTest()
  stopEmotionTick?.()
  stopAutoComment?.()
  stopDistillTick?.()
})

// 抑制 TS 未使用变量警告
void dialog
</script>

<template>
  <div class="relative w-screen h-screen">
    <Live2DStage v-if="ready" />
    <DialogBubble v-if="dialog.currentText" :text="dialog.currentText" />
    <InputBar v-if="ready" />
    <SettingsPanel />
  </div>
</template>
