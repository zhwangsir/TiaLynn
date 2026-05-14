<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <div
    class="bubble"
    :style="{
      top: '60px',
      left: '50%',
      transform: 'translateX(-50%)',
    }"
  >
    {{ text }}
  </div>
</template>
