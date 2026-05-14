<script setup lang="ts">
import { ref } from 'vue'
import { useDialogStore } from '@/stores/dialog'

const dialog = useDialogStore()
const text = ref('')

function onSubmit() {
  const t = text.value.trim()
  if (!t || dialog.streaming) return
  dialog.send(t)
  text.value = ''
}
</script>

<template>
  <form class="input-bar" @submit.prevent="onSubmit">
    <input
      v-model="text"
      type="text"
      placeholder="跟 TiaLynn 说点什么……"
      :disabled="dialog.streaming"
    />
    <button type="submit" :disabled="dialog.streaming || !text.trim()">
      {{ dialog.streaming ? '...' : '发送' }}
    </button>
  </form>
</template>
