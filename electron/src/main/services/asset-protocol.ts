/**
 * 自定义资源协议 — 替代 file:// 跨目录访问，实现 webSecurity 不关 (审计 H1)。
 *
 * 设计:
 * - scheme `tialynn-asset://` 加到 privileged schemes (standard + secure + supportFetchAPI)
 * - app.whenReady 后注册 handler，解析 URL → file system read → Response
 * - 限制访问范围：只允许读 (1) electron/models-library (2) ~/.tialynn (3) Live2d-model-master
 *   防止 renderer 通过 `tialynn-asset:///etc/passwd` 这类路径遍历
 *
 * URL 格式: tialynn-asset:///absolute/path/to/file
 * 注意三斜杠 — 跟 file:// 一致便于 toFileUrl 直接复用编码逻辑
 */
import { protocol, net } from 'electron'
import { resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { getPaths } from './paths'

const SCHEME = 'tialynn-asset'

/** 必须在 app.whenReady 之前调 */
export function registerAssetSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: false,
      },
    },
  ])
}

/** 缓存允许的根目录前缀 (lazy init after getPaths()) */
let allowedRoots: string[] | null = null
function getAllowedRoots(): string[] {
  if (allowedRoots) return allowedRoots
  const paths = getPaths()
  const roots = [
    paths.userDataDir,
    paths.projectRoot,
    resolve(homedir(), '.tialynn'),
    ...paths.modelSearchPaths,
  ]
  // 规范化路径 (resolve + 末尾 sep) 防 prefix 误匹配
  allowedRoots = roots.map((p) => resolve(p) + sep)
  return allowedRoots
}

/** path 是否落在白名单根下 */
function isAllowedPath(absPath: string): boolean {
  const norm = resolve(absPath) + sep
  return getAllowedRoots().some((root) => norm.startsWith(root))
}

export function registerAssetProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    let absPath: string
    try {
      const url = new URL(request.url)
      // URL.pathname 含前导 / — Windows 下需要去掉 leading slash (`/C:/...` → `C:/...`)
      let p = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      absPath = resolve(p)
    } catch (e) {
      console.warn(`[asset-protocol] bad URL ${request.url}:`, e)
      return new Response('Bad URL', { status: 400 })
    }
    if (!isAllowedPath(absPath)) {
      console.warn(`[asset-protocol] denied (outside whitelist): ${absPath}`)
      return new Response('Forbidden', { status: 403 })
    }
    // 委托给 net.fetch 处理 file:// — 拿到 stream + 正确 mime
    return net.fetch(`file://${encodeURI(absPath.split(sep).join('/'))}`)
  })
}

/** 生成 tialynn-asset:// URL — 替代 toFileUrl */
export function toAssetUrl(absolute: string): string {
  const normalized = absolute.split(sep).map(encodeURIComponent).join('/')
  return `${SCHEME}:///${normalized.replace(/^\//, '')}`
}
