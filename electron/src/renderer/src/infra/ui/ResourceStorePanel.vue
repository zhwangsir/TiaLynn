<script setup lang="ts">
/**
 * TiaLynn 资源商店（v0.12）
 *
 * 整合 Live2D 立绘 + RVC 音色 + 在线下载为统一 UI。
 *
 * 结构：
 *   ├ Tab bar：[立绘 | 音色 | 在线]
 *   └ Tab 内容：
 *       - 立绘 → ModelLibraryPanel embedded
 *       - 音色 → RvcVoiceTab
 *       - 在线 → OnlineStoreTab（RVC + Live2D 推荐 repo 浏览 + 一键装）
 */
import { ref } from 'vue'
import { useConfigStore } from '../stores/config'
import ModelLibraryPanel from './ModelLibraryPanel.vue'
import RvcVoiceTab from './RvcVoiceTab.vue'
import OnlineStoreTab from './OnlineStoreTab.vue'

const cfg = useConfigStore()
const emit = defineEmits<{ (e: 'close'): void }>()

type TabId = 'avatars' | 'voices' | 'online'
const activeTab = ref<TabId>('avatars')
</script>

<template>
  <div class="store-panel" @click.stop @click.right.prevent>
    <header class="store-header">
      <h2>🎁 TiaLynn 资源商店</h2>
      <button class="close-btn" @click="emit('close')">✕</button>
    </header>

    <!-- Tab bar -->
    <div class="tabbar">
      <button :class="['tab', { active: activeTab === 'avatars' }]" @click="activeTab = 'avatars'">
        🎭 立绘 <span class="badge">{{ cfg.models.length }}</span>
      </button>
      <button :class="['tab', { active: activeTab === 'voices' }]" @click="activeTab = 'voices'">
        🎙️ 音色
      </button>
      <button :class="['tab', { active: activeTab === 'online' }]" @click="activeTab = 'online'">
        ☁️ 在线
      </button>
    </div>

    <!-- Tab body -->
    <div class="tab-body">
      <ModelLibraryPanel
        v-if="activeTab === 'avatars'"
        :embedded="true"
        @close="emit('close')"
      />
      <RvcVoiceTab v-else-if="activeTab === 'voices'" />
      <OnlineStoreTab v-else-if="activeTab === 'online'" />
    </div>
  </div>
</template>

<style scoped>
.store-panel {
  position: fixed;
  inset: 24px;
  z-index: 3000;
  background: oklch(99% 0.003 250 / 0.97);
  backdrop-filter: blur(28px) saturate(1.6);
  -webkit-backdrop-filter: blur(28px) saturate(1.6);
  border-radius: 24px;
  border: 1px solid oklch(85% 0.02 250 / 0.5);
  box-shadow: 0 20px 80px oklch(0% 0 0 / 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}
.store-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
}
.store-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: oklch(25% 0.05 250);
}
.close-btn {
  width: 32px; height: 32px;
  border-radius: 999px;
  font-size: 16px;
  color: oklch(45% 0.05 25);
  background: oklch(94% 0.02 25 / 0.5);
  transition: all 150ms;
}
.close-btn:hover { background: oklch(90% 0.05 25 / 0.7); }

/* Tab bar */
.tabbar {
  display: flex;
  gap: 4px;
  padding: 16px 24px 0;
  border-bottom: 1px solid oklch(90% 0.01 250 / 0.4);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: 10px 10px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: oklch(45% 0.05 250);
  transition: all 150ms;
}
.tab:hover { background: oklch(94% 0.02 250 / 0.5); }
.tab.active {
  color: oklch(25% 0.1 250);
  background: oklch(96% 0.025 250 / 0.7);
  font-weight: 600;
}
.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  background: oklch(92% 0.05 250);
  color: oklch(40% 0.1 250);
  border-radius: 999px;
}
.badge.soon {
  background: oklch(94% 0.06 80);
  color: oklch(40% 0.12 80);
}

.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
  color: oklch(50% 0.05 250);
}
.ph-icon { font-size: 56px; opacity: 0.6; }
.ph-title { font-size: 18px; font-weight: 600; color: oklch(35% 0.08 250); }
.placeholder p {
  max-width: 480px;
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}
</style>
