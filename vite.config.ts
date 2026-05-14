import { defineConfig, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import fs from 'node:fs'

const host = process.env.TAURI_DEV_HOST

/**
 * 把项目根的 HuTao-Live2D/ 映射到 /live2d/* —— 同时供 dev server 与生产 build 使用。
 * 解决：Tauri asset 协议解析含空格的相对路径会失败的问题。
 */
function tialynnLive2DStatic(): PluginOption {
  const projectRoot = process.cwd()
  // 候选目录：先项目根，再用户 ~/.tialynn/assets/HuTao-Live2D
  const candidates = [
    path.join(projectRoot, 'HuTao-Live2D'),
    path.join(process.env.HOME ?? '', '.tialynn', 'assets', 'HuTao-Live2D'),
  ]
  const liveDir = candidates.find((p) => fs.existsSync(p)) ?? candidates[0]

  return {
    name: 'tialynn-live2d-static',
    configureServer(server) {
      server.middlewares.use('/live2d', (req, res, next) => {
        try {
          if (!req.url) return next()
          const decoded = decodeURIComponent(req.url.split('?')[0])
          // 防止 ../ 越权
          const safe = decoded.replace(/\.\.+/g, '')
          const filePath = path.join(liveDir, safe)
          if (!filePath.startsWith(liveDir) || !fs.existsSync(filePath)) {
            res.statusCode = 404
            return res.end(`Live2D asset not found: ${safe}`)
          }
          const ext = path.extname(filePath).toLowerCase()
          const mime: Record<string, string> = {
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.moc3': 'application/octet-stream',
            '.moc': 'application/octet-stream',
            '.motion3': 'application/json',
          }
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          res.setHeader('Cache-Control', 'no-cache')
          fs.createReadStream(filePath).pipe(res)
        } catch (e) {
          res.statusCode = 500
          res.end(String(e))
        }
      })
    },
    // 生产构建后把 HuTao-Live2D 复制到 dist/live2d
    closeBundle() {
      if (!fs.existsSync(liveDir)) return
      const target = path.join(projectRoot, 'dist', 'live2d')
      fs.mkdirSync(target, { recursive: true })
      copyRecursive(liveDir, target)
    },
  }
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
