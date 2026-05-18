/**
 * Character IPC (v0.14) — 列表 / 切换 / 创建 / 删除 / 更新。
 */
import { ipcMain, type BrowserWindow } from 'electron'
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
import type { Character, CreateCharacterInput } from '@shared/character'

export function registerCharactersIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('characters:list', () => listCharacters())
  ipcMain.handle('characters:active', () => getActiveCharacter())

  ipcMain.handle('characters:get', (_evt, id: string) => getCharacter(id))

  ipcMain.handle('characters:create', (_evt, input: CreateCharacterInput) => {
    try {
      return { ok: true as const, character: createCharacter(input) }
    } catch (e) {
      return { ok: false as const, reason: String(e).slice(0, 300) }
    }
  })

  ipcMain.handle('characters:update', (_evt, payload: { id: string; patch: Partial<Character> }) => {
    const c = updateCharacter(payload.id, payload.patch)
    return c ? { ok: true as const, character: c } : { ok: false as const, reason: 'not_found' }
  })

  ipcMain.handle('characters:delete', (_evt, id: string) => deleteCharacter(id))
  ipcMain.handle('characters:clone', (_evt, payload: { source_id: string; new_name?: string }) => {
    return cloneCharacter(payload.source_id, payload.new_name)
  })

  /** v0.14 T8: 读 character 灵魂目录的 yaml 文件 */
  ipcMain.handle('characters:read-soul-file', (_evt, payload: { id: string; filename: string }) => {
    return readCharacterSoulFile(payload.id, payload.filename)
  })
  ipcMain.handle(
    'characters:write-soul-file',
    (_evt, payload: { id: string; filename: string; content: string }) => {
      const r = writeCharacterSoulFile(payload.id, payload.filename, payload.content)
      // 写完通知 renderer 重新 reload soul
      const win = getWindow()
      if (r.ok && win && !win.isDestroyed()) {
        win.webContents.send('soul:changed')
      }
      return r
    },
  )

  /** v0.14 T5: 每轮对话完成后调用，更新 last_chat_at + total_chats + intimacy 成长 */
  ipcMain.handle('characters:record-chat', () => {
    const active = getActiveCharacter()
    if (!active) return { ok: false as const, reason: 'no_active' }
    recordChatInteraction(active.id)
    const updated = getCharacter(active.id)
    return { ok: true as const, character: updated }
  })

  ipcMain.handle('characters:switch', (_evt, id: string) => {
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
