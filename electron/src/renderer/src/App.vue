<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Live2DStage from './avatar/components/Live2DStage.vue'
import DialogBubble from './infra/ui/DialogBubble.vue'
import InputBar from './infra/ui/InputBar.vue'
import ControlDock from './infra/ui/ControlDock.vue'
import SettingsPanel from './infra/ui/SettingsPanel.vue'
import { useConfigStore } from './infra/stores/config'
import { useDialogStore } from './brain/stores/dialog'
import { useSpeechStore } from './presence/stores/speech'
import { bus } from './infra/eventbus'

const cfg = useConfigStore()
const dialog = useDialogStore()
const speech = useSpeechStore()

const settingsOpen = ref(false)
const passthroughEnabled = ref(true)
const ready = ref(false) // 等 cfg.bootstrap 完成（含 soul + models）后才挂 Live2DStage，避免 race

onMounted(async () => {
  await cfg.bootstrap()
  dialog.bootstrap()
  speech.bootstrap()
  dialog.injectGreeting()
  ready.value = true // 现在才允许 Live2DStage 挂载

  bus.on('ui:toast', ({ kind, message }) => {
    console[kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'log']('[toast]', message)
  })
})

function openSettings(): void {
  settingsOpen.value = true
  passthroughEnabled.value = false
}

function closeSettings(): void {
  settingsOpen.value = false
  passthroughEnabled.value = true
}

async function reloadModel(): Promise<void> {
  await cfg.rescanModels()
  await cfg.reloadSoul()
}
</script>

<template>
  <div class="root">
    <Live2DStage v-if="ready" :passthrough-enabled="passthroughEnabled" />
    <DialogBubble v-if="ready" />
    <ControlDock v-if="ready" @open-settings="openSettings" @reload-model="reloadModel" />
    <InputBar v-if="ready" />
    <SettingsPanel v-if="settingsOpen" @close="closeSettings" />
    <div v-if="!ready" class="boot-hint">召唤 TiaLynn 中…</div>
  </div>
</template>

<style scoped>
.root {
  position: relative;
  width: 100%;
  height: 100%;
  background: transparent;
  pointer-events: auto;
}
.boot-hint {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: 12px;
  color: var(--color-muted);
  background: var(--color-bubble);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
}
</style>
