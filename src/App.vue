<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import Live2DStage from '@/avatar/components/Live2DStage.vue'
import DialogBubble from '@/brain/components/DialogBubble.vue'
import InputBar from '@/brain/components/InputBar.vue'
import SettingsPanel from '@/infra/ui/SettingsPanel.vue'
import { useSoulStore } from '@/brain/stores/soul'
import { useDialogStore } from '@/brain/stores/dialog'
import { useEmotionStore } from '@/brain/stores/emotion'
import { useConfigStore } from '@/infra/stores/config'
import { useSttStore } from '@/presence/stores/stt'
import { startAlphaHitTest, stopAlphaHitTest } from '@/avatar/interaction/drag'
import { startEmotionTick } from '@/brain/emotion/decayTick'
import { startDistillTick } from '@/brain/memory/distillTick'

const soul = useSoulStore()
const dialog = useDialogStore()
const emotion = useEmotionStore()
const config = useConfigStore()
const stt = useSttStore()
const ready = ref(false)
void stt // 触发 store 初始化（事件监听）

let stopEmotionTick: (() => void) | null = null
let stopDistillTick: (() => void) | null = null

onMounted(async () => {
  await Promise.all([soul.load(), config.load()])
  emotion.init(soul.config?.emotions?.initial ?? 'neutral')
  startAlphaHitTest()
  stopEmotionTick = startEmotionTick()
  stopDistillTick = startDistillTick()
  ready.value = true
})

onBeforeUnmount(() => {
  stopAlphaHitTest()
  stopEmotionTick?.()
  stopDistillTick?.()
})

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
