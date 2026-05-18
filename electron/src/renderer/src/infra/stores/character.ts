/**
 * Character store (v0.14) — 当前 active character + 列表 + 切换 action。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Character, CreateCharacterInput } from '@shared/character'
import { bus } from '../eventbus'

export const useCharacterStore = defineStore('character', () => {
  const active = ref<Character | null>(null)
  const all = ref<Character[]>([])
  const switching = ref(false)

  async function bootstrap(): Promise<void> {
    try {
      const [a, list] = await Promise.all([
        window.api.characters.active(),
        window.api.characters.list(),
      ])
      active.value = a
      all.value = list
    } catch (e) {
      console.error('[character] bootstrap failed', e)
    }
    // 监听主进程切角色通知
    window.api.characters.onSwitched((c) => {
      active.value = c
      bus.emit('character:switched', { character: c })
    })
    // 监听对话结束 → 刷新当前 character (拿最新 intimacy / last_chat_at)
    bus.on('brain:reply-end', () => {
      void refreshActive()
    })
  }

  async function refreshActive(): Promise<void> {
    try {
      const a = await window.api.characters.active()
      if (a) active.value = a
    } catch {
      /* skip */
    }
  }

  async function refresh(): Promise<void> {
    try {
      all.value = await window.api.characters.list()
      active.value = await window.api.characters.active()
    } catch (e) {
      console.warn('[character] refresh failed', e)
    }
  }

  async function switchTo(id: string): Promise<{ ok: boolean; reason?: string }> {
    if (switching.value) return { ok: false, reason: 'already-switching' }
    switching.value = true
    try {
      const r = await window.api.characters.switch(id)
      if (r.ok && r.character) {
        active.value = r.character
        await refresh()
      }
      return r
    } finally {
      switching.value = false
    }
  }

  async function create(input: CreateCharacterInput): Promise<
    { ok: true; character: Character } | { ok: false; reason: string }
  > {
    const r = await window.api.characters.create(input)
    if (r.ok) await refresh()
    return r
  }

  async function remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await window.api.characters.delete(id)
    if (r.ok) await refresh()
    return r
  }

  return {
    active,
    all,
    switching,
    bootstrap,
    refresh,
    switchTo,
    create,
    remove,
  }
})
