<script setup lang="ts">
/**
 * v0.14: CharacterPicker — 卡片网格切换角色。
 *
 * 点击卡片 → 1 秒切换（立绘+音色+灵魂+对话历史同步切）
 * 底部「+ 创建新的她」入口 → CharacterCreator (T4)
 * 卡片右下角「删除」按钮（builtin 不可删 + 不能删 active）
 */
import { computed, ref } from 'vue'
import { useCharacterStore } from '../stores/character'
import { bus } from '../eventbus'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-creator'): void
}>()

const character = useCharacterStore()

const filter = ref<'all' | 'recent'>('all')
const switchingId = ref<string | null>(null)

const visible = computed(() => {
  const list = [...character.all]
  if (filter.value === 'recent') {
    return list.filter((c) => c.last_chat_at > 0).slice(0, 12)
  }
  return list
})

async function pick(id: string): Promise<void> {
  if (id === character.active?.id) {
    emit('close')
    return
  }
  switchingId.value = id
  const r = await character.switchTo(id)
  switchingId.value = null
  if (r.ok) {
    emit('close')
  } else {
    bus.emit('ui:toast', { kind: 'error', message: `切换失败: ${r.reason ?? ''}`, ttl_ms: 4000 })
  }
}

async function clone(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  const src = character.all.find((c) => c.id === id)
  if (!src) return
  const r = await character.clone(id)
  if (r.ok && r.character) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已克隆 ${src.name} → ${r.character.name}（亲密度重置）`,
      ttl_ms: 4000,
    })
  } else {
    bus.emit('ui:toast', { kind: 'error', message: `克隆失败: ${r.reason}`, ttl_ms: 4000 })
  }
}

async function remove(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  const target = character.all.find((c) => c.id === id)
  if (!target) return
  if (!confirm(`确定删除 ${target.name}？\n这个角色的所有对话历史也会被删除（不可恢复）。`)) return
  const r = await character.remove(id)
  if (!r.ok) {
    const reasons: Record<string, string> = {
      builtin_protected: '内置角色不能删',
      cannot_delete_active: '不能删除当前正在用的角色，先切到别的',
      not_found: '没找到这个角色',
    }
    bus.emit('ui:toast', {
      kind: 'error',
      message: reasons[r.reason ?? ''] ?? r.reason ?? '删除失败',
      ttl_ms: 5000,
    })
  } else {
    bus.emit('ui:toast', { kind: 'success', message: `已删除 ${target.name}`, ttl_ms: 3000 })
  }
}

function relativeTime(ts: number): string {
  if (!ts) return '从未对话'
  const dt = Date.now() - ts
  const min = dt / 60_000
  if (min < 1) return '刚刚'
  if (min < 60) return `${Math.round(min)} 分钟前`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} 小时前`
  const d = h / 24
  if (d < 30) return `${Math.round(d)} 天前`
  return new Date(ts).toLocaleDateString()
}

function intimacyColor(lv: number): string {
  if (lv >= 80) return 'oklch(70% 0.2 25)'
  if (lv >= 60) return 'oklch(72% 0.18 18)'
  if (lv >= 40) return 'oklch(72% 0.16 50)'
  if (lv >= 20) return 'oklch(72% 0.12 145)'
  return 'oklch(72% 0.08 250)'
}

function initials(name: string): string {
  return name.slice(0, 2)
}
</script>

<template>
  <transition name="picker" appear>
    <div class="overlay" @click.self="emit('close')">
      <div class="card">
        <header>
          <div class="header-left">
            <h2>选个她</h2>
            <span class="count">{{ visible.length }} 个</span>
          </div>
          <div class="filter-tabs">
            <button :class="['filter-tab', { active: filter === 'all' }]" @click="filter = 'all'">
              全部
            </button>
            <button :class="['filter-tab', { active: filter === 'recent' }]" @click="filter = 'recent'">
              最近
            </button>
          </div>
          <button class="x-btn" @click="emit('close')">✕</button>
        </header>

        <div class="grid" v-if="visible.length > 0">
          <button
            v-for="c in visible"
            :key="c.id"
            class="char-card"
            :class="{
              active: c.id === character.active?.id,
              switching: c.id === switchingId,
            }"
            :disabled="!!switchingId"
            @click="pick(c.id)"
          >
            <div class="card-top">
              <span class="card-avatar" :style="{ borderColor: intimacyColor(c.intimacy_level) }">
                <img v-if="c.avatar_thumb_url" :src="c.avatar_thumb_url" :alt="c.name" />
                <span v-else class="card-initials">{{ initials(c.name) }}</span>
              </span>
              <span v-if="c.id === character.active?.id" class="active-dot" title="当前角色"></span>
            </div>
            <div class="card-name">{{ c.name }}</div>
            <div class="card-desc" v-if="c.description">{{ c.description }}</div>
            <div class="card-meta">
              <span class="meta-intimacy" :style="{ color: intimacyColor(c.intimacy_level) }">
                ♡ {{ Math.round(c.intimacy_level) }}
              </span>
              <span class="meta-time">{{ relativeTime(c.last_chat_at) }}</span>
            </div>
            <div class="card-actions">
              <button
                class="action-btn clone-btn"
                title="克隆 (复制灵魂 + 偏好，重置亲密度)"
                @click="clone(c.id, $event)"
              >
                ⎘
              </button>
              <button
                v-if="!c.builtin && c.id !== character.active?.id"
                class="action-btn remove-btn"
                title="删除"
                @click="remove(c.id, $event)"
              >
                ✕
              </button>
            </div>
          </button>
        </div>

        <div class="empty" v-else>
          <div class="empty-icon">👤</div>
          <div class="empty-text">还没有任何角色</div>
          <div class="empty-sub">点下面创建第一个她</div>
        </div>

        <footer>
          <button class="create-btn" @click="emit('open-creator')">
            <span class="create-icon">＋</span>
            <span>创建新的她</span>
          </button>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1950;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 680px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}

header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-divider);
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.count {
  font-size: var(--text-xs);
  color: var(--color-muted);
  font-feature-settings: 'tnum';
}
.filter-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.filter-tab {
  padding: 5px 12px;
  font-size: var(--text-xs);
  border-radius: var(--radius-pill);
  color: var(--color-muted);
  background: transparent;
  transition: color var(--duration-fast), background var(--duration-fast);
}
.filter-tab:hover {
  color: var(--color-bubble-text);
  background: var(--color-bubble-surface);
}
.filter-tab.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  font-weight: 600;
}
.x-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: var(--color-muted);
}
.x-btn:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding: 18px 20px;
  overflow-y: auto;
}

.char-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 12px 12px;
  background: var(--color-bubble-surface);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast), background var(--duration-fast),
    transform var(--duration-fast);
  text-align: center;
  gap: 4px;
  min-height: 160px;
}
.char-card:hover:not(:disabled) {
  background: var(--color-bubble-surface-hover);
  border-color: var(--color-accent-soft);
  transform: translateY(-2px);
}
.char-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.char-card.switching {
  animation: card-pulse 0.6s var(--ease-in-out) infinite;
}
.char-card:disabled {
  cursor: wait;
}
.char-card:not(.switching):disabled {
  opacity: 0.5;
}
@keyframes card-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.card-top {
  position: relative;
}
.card-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-bubble);
  border: 2px solid var(--color-accent);
  overflow: hidden;
  font-weight: 700;
  font-size: 18px;
  color: var(--color-accent);
}
.card-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-initials {
  letter-spacing: -1px;
}
.active-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-success);
  border: 2px solid var(--color-bubble);
}

.card-name {
  font-weight: 600;
  font-size: var(--text-sm);
  margin-top: 6px;
}
.card-desc {
  font-size: 10px;
  color: var(--color-muted);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 10px;
  width: 100%;
  justify-content: center;
}
.meta-intimacy {
  font-weight: 600;
  font-feature-settings: 'tnum';
}
.meta-time {
  color: var(--color-muted);
}

.card-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 3px;
  opacity: 0;
  transition: opacity var(--duration-fast);
}
.char-card:hover .card-actions {
  opacity: 1;
}
.action-btn {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: oklch(0% 0 0 / 0.06);
  color: var(--color-muted);
  font-size: 11px;
  transition: color var(--duration-fast), background var(--duration-fast);
}
.clone-btn:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.remove-btn:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}
.empty-icon {
  font-size: 48px;
  opacity: 0.4;
  margin-bottom: 12px;
}
.empty-text {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-sub {
  font-size: var(--text-sm);
  color: var(--color-muted);
}

footer {
  padding: 14px 20px;
  border-top: 1px solid var(--color-divider);
  display: flex;
  justify-content: center;
}
.create-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 22px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
  font-size: var(--text-sm);
  box-shadow: var(--shadow-sm);
  transition: background var(--duration-fast), transform var(--duration-fast),
    box-shadow var(--duration-fast);
}
.create-btn:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.create-icon {
  font-size: 16px;
  line-height: 1;
}

.picker-enter-active,
.picker-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
}
.picker-enter-active .card,
.picker-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.picker-enter-from .card,
.picker-leave-to .card {
  transform: scale(0.92) translateY(20px);
}
</style>
