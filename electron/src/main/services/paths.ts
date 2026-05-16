/**
 * 路径解析 —— TiaLynn 数据目录、soul 目录、模型目录。
 *
 * 用户数据目录优先级（仿 src-tauri/src/infra/config.rs）：
 *   1. ~/.tialynn/
 *   2. Electron 默认 app.getPath('userData')
 *
 * Soul 目录优先级：
 *   1. ~/.tialynn/soul/
 *   2. <projectRoot>/soul/
 *   3. 兜底默认（内置 default soul）
 */
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface TialynnPaths {
  /** 项目根（开发期为 git 仓库根；生产期为 resources/） */
  projectRoot: string
  /** 用户数据目录（~/.tialynn 优先） */
  userDataDir: string
  /** soul 配置目录 */
  soulDir: string
  /** 模型搜索路径列表（带优先级） */
  modelSearchPaths: string[]
  /** 历史与记忆 SQLite 文件 */
  historyDbPath: string
}

let cached: TialynnPaths | null = null

export function getPaths(): TialynnPaths {
  if (cached) return cached

  const home = homedir()
  const homeData = join(home, '.tialynn')
  const userDataDir = ensureDir(existsSync(homeData) ? homeData : app.getPath('userData'))

  // 项目根：开发期为 cwd，生产期 process.resourcesPath
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : resolve(__dirname, '..', '..', '..')

  // soul 目录：~/.tialynn/soul → projectRoot/soul → projectRoot/../soul（仓库根）
  const candidateSoul = [
    join(userDataDir, 'soul'),
    join(projectRoot, 'soul'),
    join(projectRoot, '..', 'soul'),
  ]
  const soulDir = candidateSoul.find((p) => existsSync(p)) ?? candidateSoul[0]

  // 模型搜索路径：项目根 + electron 父级（仓库根）+ ~/.tialynn/models + 默认 Live2d-model-master
  const modelSearchPaths = uniq([
    projectRoot,
    resolve(projectRoot, '..'),
    join(userDataDir, 'models'),
    join(home, 'Documents', 'Live2d-model-master'),
  ])

  cached = {
    projectRoot,
    userDataDir,
    soulDir,
    modelSearchPaths,
    historyDbPath: join(userDataDir, 'history.sqlite'),
  }
  return cached
}

function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr))
}
