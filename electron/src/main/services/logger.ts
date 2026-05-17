/**
 * v0.13: electron-log 统一日志（audit M2）。
 *
 * 接管 console.* → 自动同时输出到控制台 + 写文件到 ~/.tialynn/logs/main.log。
 * 业务代码完全不需要改，所有现有 console.log/warn/error 立即获得文件持久化。
 *
 * 文件轮转：单文件 10 MB 上限，超过自动归档到 main.old.log。
 */
import log from 'electron-log/main'
import { join } from 'node:path'
import { getPaths } from './paths'

let initialized = false

export function initializeLogger(): void {
  if (initialized) return
  initialized = true

  // 1. 让 electron-log 启用所有进程接管（main + renderer）
  log.initialize({ preload: true })

  // 2. 文件路径：~/.tialynn/logs/main.log
  const logDir = join(getPaths().userDataDir, 'logs')
  log.transports.file.resolvePathFn = () => join(logDir, 'main.log')
  log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  // 3. 控制台保持现有格式（开发体验不变）
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}'

  // 4. 关键：把 console.* 接管 → 所有现有 console.log/warn/error 自动写文件
  Object.assign(console, log.functions)

  log.info('[logger] initialized — file:', logDir)
}

/** 显式 logger 实例，新代码可以直接 import 用 */
export const logger = log
