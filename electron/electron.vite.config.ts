import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'out/renderer',
      // Electron 33 内置 Chromium 130 — 允许 top-level await（wlipsync@1.3.0 用到）
      target: 'chrome130',
      // Pixi + pixi-live2d-display 占 ~1MB，单 chunk 触发 500kb 警告
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          manualChunks(id): string | undefined {
            if (id.includes('node_modules')) {
              if (id.includes('pixi.js') || id.includes('@pixi')) return 'vendor-pixi'
              if (id.includes('pixi-live2d-display')) return 'vendor-live2d'
              if (id.includes('/vue/') || id.includes('@vue/') || id.includes('pinia') || id.includes('mitt')) {
                return 'vendor-vue'
              }
              return 'vendor-misc'
            }
            return undefined
          }
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    server: {
      port: 5173
    },
    plugins: [vue()],
    // dev 模式下 vite 也需要支持 top-level await（renderer.build.target 只管 build）
    optimizeDeps: {
      esbuildOptions: {
        target: 'chrome130'
      }
    },
    esbuild: {
      target: 'chrome130'
    }
  }
})
