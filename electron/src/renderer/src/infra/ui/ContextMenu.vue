<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'close'): void
}>()

const menuRef = ref<HTMLDivElement | null>(null)

// 把菜单位置限制在窗口内（避免菜单出界）
const position = computed(() => {
  const w = menuRef.value?.offsetWidth ?? 200
  const h = menuRef.value?.offsetHeight ?? 240
  const winW = window.innerWidth
  const winH = window.innerHeight
  const x = Math.min(Math.max(props.x, 4), winW - w - 4)
  const y = Math.min(Math.max(props.y, 4), winH - h - 4)
  return { left: `${x}px`, top: `${y}px` }
})

function pick(item: MenuItem): void {
  if (item.disabled || item.separator) return
  emit('select', item.id)
  emit('close')
}

function onOutside(e: MouseEvent): void {
  if (!menuRef.value) return
  if (!props.open) return
  if (!menuRef.value.contains(e.target as Node)) emit('close')
}

function onEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close')
}

onMounted(() => {
  window.addEventListener('mousedown', onOutside, true)
  window.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onOutside, true)
  window.removeEventListener('keydown', onEsc)
})
</script>

<template>
  <transition name="menu">
    <div
      v-if="open"
      ref="menuRef"
      class="ctx-menu"
      role="menu"
      :style="position"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="item.id + i">
        <div v-if="item.separator" class="sep" />
        <button
          v-else
          class="item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          :disabled="item.disabled"
          role="menuitem"
          @click="pick(item)"
        >
          <span class="icon" v-html="item.icon ?? ''" />
          <span class="label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  min-width: 180px;
  padding: 6px;
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  user-select: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--color-bubble-text);
  text-align: left;
  background: transparent;
  transition: background var(--duration-fast), color var(--duration-fast),
    padding var(--duration-fast) var(--ease-out-expo);
}
.item:hover:not(.disabled) {
  background: var(--color-bubble-surface-hover);
  /* hover 时图标轻微右滑 — 微反馈 */
  padding-left: 12px;
  padding-right: 8px;
}
.item.danger {
  color: var(--color-danger);
}
.item.danger:hover:not(.disabled) {
  background: var(--color-danger-soft);
}
.item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--color-muted);
  transition: color var(--duration-fast);
}
.item:hover:not(.disabled) .icon {
  color: var(--color-accent);
}
.item.danger:hover:not(.disabled) .icon {
  color: var(--color-danger);
}
.icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.label {
  flex: 1;
  font-weight: 500;
}
.shortcut {
  font-size: var(--text-xs);
  color: var(--color-muted);
  padding: 1px 6px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-divider);
  border-radius: 4px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-divider);
}

.menu-enter-active,
.menu-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-expo),
    transform var(--duration-fast) var(--ease-out-expo);
  transform-origin: top left;
}
.menu-enter-from {
  opacity: 0;
  transform: scale(0.92) translateY(-4px);
}
.menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
