import { defineConfig, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import fs from 'node:fs'

const host = process.env.TAURI_DEV_HOST

/**
 * Live2D 多模型静态托管：
 *   URL：/live2d/<model_dir>/<file>
 *   解析顺序：项目根 → ~/.tialynn/models/ → ~/.tialynn/assets/
 *
 * 同时兼容旧版 URL（/live2d/<file>，无 model_dir 前缀），自动回退到项目根的
 * HuTao-Live2D（v0.1 默认）。
 */
function tialynnLive2DStatic(): PluginOption {
  const projectRoot = process.cwd()
  const home = process.env.HOME ?? ''
  const modelRoots = [
    projectRoot, // 含 HuTao-Live2D/、其他自带模型目录
    path.join(home, '.tialynn', 'models'),
    path.join(home, '.tialynn', 'assets'),
  ]

  function resolveAsset(rawPath: string): string | null {
    // raw 形如 "/MyModel/foo.png" 或 "/Hu Tao.model3.json"
    const decoded = decodeURIComponent(rawPath.split('?')[0]).replace(/\.\.+/g, '')
    const parts = decoded.split('/').filter(Boolean)
    if (parts.length === 0) return null

    // 1. 优先按 /<model_dir>/<file> 解析
    if (parts.length >= 2) {
      const [modelDir, ...rest] = parts
      const file = rest.join('/')
      for (const root of modelRoots) {
        const candidate = path.join(root, modelDir, file)
        if (
          candidate.startsWith(path.resolve(root)) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          return candidate
        }
      }
    }

    // 2. fallback：单段路径，按旧版默认模型查（HuTao-Live2D）
    if (parts.length === 1) {
      const file = parts[0]
      for (const root of modelRoots) {
        const candidate = path.join(root, 'HuTao-Live2D', file)
        if (
          candidate.startsWith(path.resolve(root)) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          return candidate
        }
      }
    }
    return null
  }

  function mimeFor(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    return (
      ({
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.moc3': 'application/octet-stream',
        '.moc': 'application/octet-stream',
        '.motion3': 'application/json',
      } as Record<string, string>)[ext] ?? 'application/octet-stream'
    )
  }

  return {
    name: 'tialynn-live2d-static',
    configureServer(server) {
      server.middlewares.use('/live2d', (req, res, next) => {
        try {
          if (!req.url) return next()
          const filePath = resolveAsset(req.url)
          if (!filePath) {
            res.statusCode = 404
            return res.end(`Live2D asset not found: ${req.url}`)
          }
          res.setHeader('Content-Type', mimeFor(filePath))
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          res.setHeader('Cache-Control', 'no-cache')
          fs.createReadStream(filePath).pipe(res)
        } catch (e) {
          res.statusCode = 500
          res.end(String(e))
        }
      })
    },
    // 生产 build：把项目根下所有看起来是 Live2D 的目录都拷到 dist/live2d/<dir>/
    closeBundle() {
      const distLive2d = path.join(projectRoot, 'dist', 'live2d')
      fs.mkdirSync(distLive2d, { recursive: true })
      for (const root of modelRoots) {
        if (!fs.existsSync(root)) continue
        for (const entry of fs.readdirSync(root)) {
          const src = path.join(root, entry)
          if (!fs.statSync(src).isDirectory()) continue
          // 跳过常见非模型目录
          if (
            [
              'node_modules',
              'src',
              'src-tauri',
              'dist',
              'docs',
              'public',
              'scripts',
              'sidecar',
              '.git',
              '.idea',
              '.vscode',
              'example_voice',
              'icons',
            ].includes(entry)
          )
            continue
          if (!fs.existsSync(path.join(src, ...findFirstModel3(src)))) continue
          const dst = path.join(distLive2d, entry)
          fs.mkdirSync(dst, { recursive: true })
          copyRecursive(src, dst)
        }
      }
    },
  }
}

function findFirstModel3(dir: string): string[] {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.model3.json')) return [f]
    }
  } catch {
    /* ignore */
  }
  return ['__MISSING__']
}

function copyRecursive(src: string, dst: string): void {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      // 跳过 macOS 隐藏文件
      if (entry === '.DS_Store') continue
      copyRecursive(path.join(src, entry), path.join(dst, entry))
    }
  } else if (stat.isFile()) {
    fs.copyFileSync(src, dst)
  }
}

export default defineConfig(async () => ({
  plugins: [vue(), tialynnLive2DStatic()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}))
