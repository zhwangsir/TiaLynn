/**
 * character-pack export/import integration tests (P5).
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

const { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } = await import('node:fs')
const { join } = await import('node:path')
const {
  createCharacter,
  charactersRoot,
  characterDir,
  characterSoulDir,
  listCharacters,
  setActiveCharacterId,
  deleteCharacter,
} = await import('./character-store')
const {
  exportCharacterPack,
  importCharacterPack,
  CHARACTER_PACK_VERSION,
} = await import('./character-pack')

afterAll(() => ctx.cleanup())

beforeEach(() => {
  // 清干净
  if (existsSync(charactersRoot())) {
    rmSync(charactersRoot(), { recursive: true, force: true })
  }
  const activeIdPath = join(ctx.userDataDir, 'active-character.json')
  if (existsSync(activeIdPath)) rmSync(activeIdPath)
  const thumbsDir = join(ctx.userDataDir, 'thumbs')
  if (existsSync(thumbsDir)) rmSync(thumbsDir, { recursive: true, force: true })
})

function makeFixture(): { id: string; name: string } {
  const c = createCharacter({
    name: 'Source',
    call_master_as: '大人',
    live2d_model_dir: 'Hu Tao',
    live2d_model_file: 'hutao.model3.json',
    template: 'custom',
  })
  // 写一些真实数据 (soul / preferences / emotional / thumb)
  writeFileSync(
    join(characterSoulDir(c.id), 'identity.yaml'),
    `name: Source
master: M
call_master_as: 大人
avatar:
  model_dir: 'Hu Tao'
  model_file: 'hutao.model3.json'`,
  )
  writeFileSync(
    join(characterDir(c.id), 'emotional-state.json'),
    JSON.stringify({
      character_id: c.id,
      baseline_mood: 'calm',
      current_mood: 'happy',
      mood_intensity: 0.7,
      missing_intensity: 0.1,
      last_chat_at: Date.now(),
      updated_at: Date.now(),
      topic_imprints: { 工作: { topic: '工作', sentiment: -0.4, count: 3, last_at: Date.now() } },
      mood_history: [{ ts: Date.now(), mood: 'happy', trigger: 'init' }],
    }),
  )
  // 缩略图
  const thumbsDir = join(charactersRoot(), '..', 'thumbs')
  mkdirSync(thumbsDir, { recursive: true })
  writeFileSync(join(thumbsDir, `${c.id}.webp`), Buffer.from([0x52, 0x49, 0x46, 0x46])) // 假 WebP magic
  return { id: c.id, name: c.name }
}

describe('exportCharacterPack', () => {
  it('打包真实 character → 返回 Buffer + 完整 meta', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id)
    expect(r.ok).toBe(true)
    expect(r.buffer).toBeInstanceOf(Buffer)
    expect(r.buffer!.length).toBeGreaterThan(100)
    expect(r.meta).toBeDefined()
    expect(r.meta!.version).toBe(CHARACTER_PACK_VERSION)
    expect(r.meta!.source_id).toBe(fx.id)
    expect(r.meta!.source_name).toBe('Source')
    expect(r.meta!.contents.soul).toBe(true)
    expect(r.meta!.contents.preferences).toBe(true)
    expect(r.meta!.contents.emotional).toBe(true)
    expect(r.meta!.contents.thumb).toBe(true)
  })

  it('不存在的 id → ok=false', () => {
    const r = exportCharacterPack('nope')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('character not found')
  })

  it('opts.includeEmotional=false → 跳过 emotional', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeEmotional: false })
    expect(r.ok).toBe(true)
    expect(r.meta!.contents.emotional).toBe(false)
  })

  it('opts.includeThumb=false → 跳过 thumb', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeThumb: false })
    expect(r.meta!.contents.thumb).toBe(false)
  })

  it('appVersion 写入 meta', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { appVersion: '0.18.0' })
    expect(r.meta!.app_version).toBe('0.18.0')
  })

  it('memory.db 默认 NOT 包含（隐私敏感）', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('FAKE_SQLITE'))
    const r = exportCharacterPack(fx.id)
    expect(r.meta!.contents.memory).toBe(false)
  })

  it('opts.includeMemory=true 显式 opt-in 才包含', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('FAKE_SQLITE_DATA'))
    const r = exportCharacterPack(fx.id, { includeMemory: true })
    expect(r.meta!.contents.memory).toBe(true)
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(r.buffer!)
    expect(zip.getEntry('memory.db')).not.toBeNull()
    expect(zip.getEntry('memory.db')!.getData().toString()).toBe('FAKE_SQLITE_DATA')
  })

  it('memory.db 不存在时 includeMemory=true 也不报错 (meta.memory=false)', () => {
    const fx = makeFixture()
    const r = exportCharacterPack(fx.id, { includeMemory: true })
    expect(r.ok).toBe(true)
    expect(r.meta!.contents.memory).toBe(false)
  })
})

describe('importCharacterPack', () => {
  it('import 自己刚 export 的 pack → 新 character 创建成功', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    // 删原 character 模拟"换机器" scenario
    setActiveCharacterId(fx.id)
    // can't delete active — set someone else first
    const dummy = createCharacter({
      name: 'Dummy',
      call_master_as: '主人',
      live2d_model_dir: 'x',
      live2d_model_file: 'x.model3.json',
      template: 'custom',
    })
    setActiveCharacterId(dummy.id)
    deleteCharacter(fx.id)
    expect(listCharacters().find((c) => c.id === fx.id)).toBeUndefined()

    const imp = importCharacterPack(exp.buffer!)
    if (!imp.ok) console.error('[test] import reason:', imp.reason)
    expect(imp.ok).toBe(true)
    expect(imp.character).toBeDefined()
    expect(imp.character!.name).toBe('Source')
    expect(imp.character!.call_master_as).toBe('大人')
    expect(imp.character!.live2d_model_dir).toBe('Hu Tao')
    // 源已删 → 新 id 可以复用源 id 也可以不（generateId 行为）
  })

  it('源 character 还在时 import 同名 → 新 id 自动 dedup', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    // 源不删，直接 import
    const imp = importCharacterPack(exp.buffer!)
    expect(imp.ok).toBe(true)
    // generateId 应 dedup（虽然实际取决于 character-store 实现）— 我们只验证
    // listCharacters 有 2 个名字相同的，且 id 不冲突
    const sources = listCharacters().filter((c) => c.name === 'Source')
    expect(sources.length).toBe(2)
    expect(sources[0]!.id).not.toBe(sources[1]!.id)
  })

  it('import 用 newName 覆盖', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!, { newName: '改名版' })
    expect(imp.ok).toBe(true)
    expect(imp.character!.name).toBe('改名版')
  })

  it('import 复制 soul/*.yaml', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const soulFile = join(characterSoulDir(imp.character!.id), 'identity.yaml')
    expect(existsSync(soulFile)).toBe(true)
    const content = readFileSync(soulFile, 'utf-8')
    expect(content).toContain('Source')
  })

  it('import emotional state + 重写 character_id', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const esFile = join(characterDir(imp.character!.id), 'emotional-state.json')
    expect(existsSync(esFile)).toBe(true)
    const es = JSON.parse(readFileSync(esFile, 'utf-8'))
    // 关键: character_id 应该是新 id 而不是 source id
    expect(es.character_id).toBe(imp.character!.id)
    expect(es.character_id).not.toBe(fx.id)
    // 其他字段保留
    expect(es.current_mood).toBe('happy')
    expect(es.topic_imprints['工作']).toBeDefined()
  })

  it('import includeEmotional=false → 不写 emotional-state.json', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!, { includeEmotional: false })
    expect(
      existsSync(join(characterDir(imp.character!.id), 'emotional-state.json')),
    ).toBe(false)
  })

  it('import thumb → 写到 thumbs/', () => {
    const fx = makeFixture()
    const exp = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp.buffer!)
    const thumbPath = join(charactersRoot(), '..', 'thumbs', `${imp.character!.id}.webp`)
    expect(existsSync(thumbPath)).toBe(true)
  })

  it('损坏 zip → ok=false', () => {
    const imp = importCharacterPack(Buffer.from('not a zip'))
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/zip/i)
  })

  it('zip 但缺 meta.json → 拒绝', () => {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    zip.addFile('soul/identity.yaml', Buffer.from('name: X'))
    const imp = importCharacterPack(zip.toBuffer())
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/meta\.json/)
  })

  it('zip 缺 identity.yaml → 拒绝（无法确定模型）', () => {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip()
    zip.addFile(
      'meta.json',
      Buffer.from(
        JSON.stringify({
          version: '1.0',
          source_id: 'x',
          source_name: 'X',
          exported_at: 0,
          contents: { soul: false, preferences: false, emotional: false, thumb: false },
        }),
      ),
    )
    const imp = importCharacterPack(zip.toBuffer())
    expect(imp.ok).toBe(false)
    expect(imp.reason).toMatch(/identity\.yaml/)
  })

  it('import memory.db 复制到新 characterDir', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('ROUND_TRIP_MEMORY'))
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const imp = importCharacterPack(exp.buffer!)
    const newMem = join(characterDir(imp.character!.id), 'memory.db')
    expect(existsSync(newMem)).toBe(true)
    expect(readFileSync(newMem).toString()).toBe('ROUND_TRIP_MEMORY')
  })

  it('import includeMemory=false → 不复制 memory.db', () => {
    const fx = makeFixture()
    writeFileSync(join(characterDir(fx.id), 'memory.db'), Buffer.from('SKIP_ME'))
    const exp = exportCharacterPack(fx.id, { includeMemory: true })
    const imp = importCharacterPack(exp.buffer!, { includeMemory: false })
    expect(existsSync(join(characterDir(imp.character!.id), 'memory.db'))).toBe(false)
  })

  it('round-trip: export → import → export 第二次内容字节一致', () => {
    const fx = makeFixture()
    const exp1 = exportCharacterPack(fx.id)
    const imp = importCharacterPack(exp1.buffer!)
    const exp2 = exportCharacterPack(imp.character!.id)
    // soul/identity.yaml + preferences.json + emotional 内容应一致 (除 character_id)
    const AdmZip = require('adm-zip')
    const z1 = new AdmZip(exp1.buffer!)
    const z2 = new AdmZip(exp2.buffer!)
    const id1 = z1.getEntry('soul/identity.yaml')!.getData().toString('utf-8')
    const id2 = z2.getEntry('soul/identity.yaml')!.getData().toString('utf-8')
    expect(id1).toBe(id2)
  })
})
