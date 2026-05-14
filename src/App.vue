<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import Live2DStage from './components/Live2DStage.vue'
import DialogBubble from './components/DialogBubble.vue'
import InputBar from './components/InputBar.vue'
import { useSoulStore } from './stores/soul'
import { useDialogStore } from './stores/dialog'
import { useEmotionStore } from './stores/emotion'
import { startAlphaHitTest, stopAlphaHitTest } from './alpha/sampler'

const soul = useSoulStore()
const dialog = useDialogStore()
const emotion = useEmotionStore()
const ready = ref(false)

onMounted(async () => {
  await soul.load()
  emotion.init(soul.config?.emotions?.initial ?? 'neutral')
  startAlphaHitTest()
  ready.value = true
})

onBeforeUnmount(() => {
  stopAlphaHitTest()
})
</script>

<template>
  <div class="relative w-screen h-screen">
    <Live2DStage v-if="ready" />
    <DialogBubble v-if="dialog.currentText" :text="dialog.currentText" />
    <InputBar v-if="ready" />
  </div>
</template>
