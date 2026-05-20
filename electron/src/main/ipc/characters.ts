/**
 * Character IPC (v0.14) — type-safe channels (Phase 1 G).
 */
import type { BrowserWindow } from 'electron'
import {
  charactersActive,
  charactersClone,
  charactersCreate,
  charactersDelete,
  charactersGet,
  charactersList,
  charactersReadSoulFile,
  charactersRecordChat,
  charactersSwitch,
  charactersUpdate,
  charactersWriteSoulFile,
} from '@shared/channels/characters'
import {
  cloneCharacter,
  createCharacter,
  deleteCharacter,
  getActiveCharacter,
  getCharacter,
  listCharacters,
  readCharacterSoulFile,
  recordChatInteraction,
  setActiveCharacterId,
  updateCharacter,
  writeCharacterSoulFile,
} from '../services/character-store'
import { reopenForActiveCharacter } from '../services/history-store'
import { onChatTurn as emotionalOnChatTurn } from '../services/emotional-state/store'
import { handleInvoke } from './channel-helpers'

export function registerCharactersIpc(getWindow: () => BrowserWindow | null): void {
  handleInvoke(charactersList, () => listCharacters())
  handleInvoke(charactersActive, () => getActiveCharacter())
  handleInvoke(charactersGet, (id) => getCharacter(id))

  handleInvoke(charactersCreate, (input) => {
    try {
      return { ok: true as const, character: createCharacter(input) }
    } catch (e) {
      return { ok: false as const, reason: String(e).slice(0, 300) }
    }
  })

  handleInvoke(charactersUpdate, (payload) => {
    const c = updateCharacter(payload.id, payload.patch)
    return c
      ? { ok: true as const, character: c }
      : { ok: false as const, reason: 'not_found' }
  })

  handleInvoke(charactersDelete, (id) => deleteCharacter(id))
  handleInvoke(charactersClone, (payload) =>
    cloneCharacter(payload.source_id, payload.new_name),
  )

  /** v0.14 T8: 读 character 灵魂目录的 yaml 文件 */
  handleInvoke(charactersReadSoulFile, (payload) =>
    readCharacterSoulFile(payload.id, payload.filename),
  )
  handleInvoke(charactersWriteSoulFile, (payload) => {
    const r = writeCharacterSoulFile(payload.id, payload.filename, payload.content)
    // 写完通知 renderer 重新 reload soul
    const win = getWindow()
    if (r.ok && win && !win.isDestroyed()) {
      win.webContents.send('soul:changed')
    }
    return r
  })

  /** v0.14 T5: 每轮对话完成后调用，更新 last_chat_at + total_chats + intimacy 成长。
   *  Phase 1 J: 同步触发 emotional-state.onChatTurn（清空 missing + 缓解 negative mood） */
  handleInvoke(charactersRecordChat, () => {
    const active = getActiveCharacter()
    if (!active) return { ok: false as const, reason: 'no_active' }
    recordChatInteraction(active.id)
    emotionalOnChatTurn(active.id)
    const updated = getCharacter(active.id)
    return { ok: true as const, character: updated }
  })

  handleInvoke(charactersSwitch, (id) => {
    const r = setActiveCharacterId(id)
    if (!r.ok) return r
    // 关键：切换后让 history-store 重新打开新 character 的 db
    reopenForActiveCharacter()
    // 通知 renderer 重新加载 soul / dialog 历史
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('character:switched', r.character)
    }
    return r
  })
}
