/**
 * character-store fs integration tests (P4.1).
 *
 * 覆盖:
 *   - create / list / get / update / delete CRUD
 *   - clone (intimacy 重置 / 新 id)
 *   - readCharacterSoulFile / writeCharacterSoulFile 安全 (path traversal)
 *   - recordChatInteraction intimacy 增长曲线
 *   - active character switch
 *   - getActiveCharacter no-match fallback
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeTmpUserData,
  mockElectronModule,
  mockPaths,
} from './test-helpers/electron-mock'

const ctx = makeTmpUserData()
vi.mock('electron', () => mockElectronModule(ctx.userDataDir))
vi.mock('./paths', () => ({ getPaths: () => mockPaths(ctx.userDataDir) }))

const {
  charactersRoot,
  cloneCharacter,
  createCharacter,
  deleteCharacter,
  getActiveCharacter,
  getActiveCharacterId,
  getCharacter,
  listCharacters,
  readCharacterSoulFile,
  recordChatInteraction,
  setActiveCharacterId,
  updateCharacter,
  writeCharacterSoulFile,
} = await import('./character-store')
const { rmSync, existsSync } = await import('node:fs')

afterAll(() => ctx.cleanup())

beforeEach(() => {
  // 清空所有角色 + active id
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
  const activeIdPath = `${ctx.userDataDir}/active-character.json`
  if (existsSync(activeIdPath)) rmSync(activeIdPath)
})

const minimal = {
  name: 'TestChar',
  call_master_as: '主人',
  live2d_model_dir: 'Hu Tao',
  live2d_model_file: 'hutao.model3.json',
  template: 'custom' as const,
}

describe('createCharacter', () => {
  it('创建后能 listCharacters + getCharacter 拿到', () => {
    const c = createCharacter(minimal)
    expect(c.name).toBe('TestChar')
    expect(c.id).toBeTruthy()
    expect(c.intimacy_level).toBe(0)
    expect(c.total_chats).toBe(0)
    const list = listCharacters()
    expect(list.length).toBe(1)
    expect(list[0]!.id).toBe(c.id)
    const got = getCharacter(c.id)
    expect(got?.name).toBe('TestChar')
  })

  it('id 自动从 name 生成', () => {
    const c1 = createCharacter({ ...minimal, name: 'Hu Tao' })
    expect(c1.id).toMatch(/hu-tao/)
  })

  it('指定 id 冲突 → throw', () => {
    createCharacter({ ...minimal, id: 'fixed-id' })
    expect(() => createCharacter({ ...minimal, id: 'fixed-id' })).toThrow(/已存在/)
  })

  it('创建后 soul/ + preferences.json 写盘', () => {
    const c = createCharacter(minimal)
    expect(existsSync(`${charactersRoot()}/${c.id}/soul`)).toBe(true)
    expect(existsSync(`${charactersRoot()}/${c.id}/preferences.json`)).toBe(true)
  })
})

describe('updateCharacter', () => {
  it('部分 patch 不影响其他字段', () => {
    const c = createCharacter(minimal)
    const updated = updateCharacter(c.id, { description: 'new desc' })
    expect(updated?.description).toBe('new desc')
    expect(updated?.name).toBe('TestChar')
    expect(updated?.intimacy_level).toBe(0)
  })

  it('不存在的 id → null', () => {
    expect(updateCharacter('nope', { description: 'x' })).toBeNull()
  })
})

describe('deleteCharacter', () => {
  it('删除后 listCharacters 不含 + 目录被清', async () => {
    const c = createCharacter(minimal)
    const dir = `${charactersRoot()}/${c.id}`
    expect(existsSync(dir)).toBe(true)
    const r = await deleteCharacter(c.id)
    expect(r.ok).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(listCharacters().length).toBe(0)
  })

  it('不存在的 id → ok=false reason', async () => {
    const r = await deleteCharacter('nope')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('cloneCharacter', () => {
  it('克隆生成新 id + intimacy 重置 + total_chats 重置', () => {
    const orig = createCharacter(minimal)
    updateCharacter(orig.id, { intimacy_level: 88, total_chats: 100 })
    const r = cloneCharacter(orig.id, '克隆体')
    expect(r.ok).toBe(true)
    expect(r.character?.id).not.toBe(orig.id)
    expect(r.character?.name).toBe('克隆体')
    expect(r.character?.intimacy_level).toBe(0)
    expect(r.character?.total_chats).toBe(0)
  })

  it('克隆复制 soul/ 目录', () => {
    const orig = createCharacter(minimal)
    const r = cloneCharacter(orig.id)
    expect(existsSync(`${charactersRoot()}/${r.character!.id}/soul`)).toBe(true)
  })

  it('不存在 source → fail', () => {
    const r = cloneCharacter('nope')
    expect(r.ok).toBe(false)
  })
})

describe('readCharacterSoulFile / writeCharacterSoulFile path-traversal 安全', () => {
  it('正常 yaml 文件名 → ok', () => {
    const c = createCharacter(minimal)
    const w = writeCharacterSoulFile(c.id, 'identity.yaml', 'name: X')
    expect(w.ok).toBe(true)
    const r = readCharacterSoulFile(c.id, 'identity.yaml')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('name: X')
  })

  it('路径穿越 ../../etc/passwd → 拒绝', () => {
    const c = createCharacter(minimal)
    const r = readCharacterSoulFile(c.id, '../../../../etc/passwd')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/非法文件名/)
  })

  it('绝对路径 /etc/passwd → 拒绝', () => {
    const c = createCharacter(minimal)
    const r = readCharacterSoulFile(c.id, '/etc/passwd')
    expect(r.ok).toBe(false)
  })

  it('非 yaml 扩展名 → 拒绝', () => {
    const c = createCharacter(minimal)
    expect(readCharacterSoulFile(c.id, 'shell.sh').ok).toBe(false)
    expect(readCharacterSoulFile(c.id, 'identity.txt').ok).toBe(false)
    expect(writeCharacterSoulFile(c.id, 'malware.exe', '...').ok).toBe(false)
  })

  it('含特殊字符的 yaml 名 → 拒绝', () => {
    const c = createCharacter(minimal)
    expect(readCharacterSoulFile(c.id, '../identity.yaml').ok).toBe(false)
    expect(readCharacterSoulFile(c.id, 'with spaces.yaml').ok).toBe(false)
    expect(readCharacterSoulFile(c.id, 'with;rce.yaml').ok).toBe(false)
  })
})

describe('recordChatInteraction', () => {
  it('每次 intimacy 增长，sqrt decay', () => {
    const c = createCharacter(minimal)
    recordChatInteraction(c.id)
    const after1 = getCharacter(c.id)
    expect(after1?.intimacy_level).toBeGreaterThan(0)
    expect(after1?.total_chats).toBe(1)
    recordChatInteraction(c.id)
    const after2 = getCharacter(c.id)
    expect(after2?.total_chats).toBe(2)
    // sqrt 衰减 — 第 2 次增量应 < 第 1 次
    const delta1 = after1!.intimacy_level - 0
    const delta2 = after2!.intimacy_level - after1!.intimacy_level
    expect(delta2).toBeLessThan(delta1)
  })

  it('intimacy 上限 100', () => {
    const c = createCharacter(minimal)
    updateCharacter(c.id, { intimacy_level: 99.9 })
    for (let i = 0; i < 50; i++) recordChatInteraction(c.id)
    expect(getCharacter(c.id)!.intimacy_level).toBeLessThanOrEqual(100)
  })
})

describe('Active character', () => {
  it('未设 active + 列表为空 → null', () => {
    expect(getActiveCharacterId()).toBeNull()
    expect(getActiveCharacter()).toBeNull()
  })

  it('未设 active + 列表非空 → 自动 fallback 第一个并 set', () => {
    const c = createCharacter(minimal)
    expect(getActiveCharacterId()).toBeNull() // 文件还没写
    const active = getActiveCharacter()
    expect(active?.id).toBe(c.id)
    expect(getActiveCharacterId()).toBe(c.id) // fallback 后已写盘
  })

  it('setActiveCharacterId 后读得到', () => {
    const c = createCharacter(minimal)
    const r = setActiveCharacterId(c.id)
    expect(r.ok).toBe(true)
    expect(getActiveCharacterId()).toBe(c.id)
    expect(getActiveCharacter()?.id).toBe(c.id)
  })

  it('set 不存在 id → fail', () => {
    const r = setActiveCharacterId('nope')
    expect(r.ok).toBe(false)
  })

  it('deleteCharacter 当前 active → 拒绝（保护机制）', async () => {
    const c = createCharacter(minimal)
    setActiveCharacterId(c.id)
    const r = await deleteCharacter(c.id)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('cannot_delete_active')
    expect(getActiveCharacter()?.id).toBe(c.id) // 还在
  })

  it('切到其他 active 再删 → 成功 + fallback', async () => {
    const c1 = createCharacter(minimal)
    const c2 = createCharacter({ ...minimal, name: 'Other' })
    setActiveCharacterId(c1.id)
    // 先切到 c2 → 然后才能删 c1
    setActiveCharacterId(c2.id)
    const r = await deleteCharacter(c1.id)
    expect(r.ok).toBe(true)
    expect(getActiveCharacter()?.id).toBe(c2.id)
  })
})
