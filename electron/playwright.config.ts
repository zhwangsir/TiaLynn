/**
 * Playwright E2E config — Electron Main Process smoke tests
 *
 * Task #18 / Round E:第一波 E2E 用 @playwright/test 的 `_electron` API
 * launch 真 Electron 进程,验证 main process 启动 + IPC ready 等。
 *
 * 跑法:
 *   pnpm -F tialynn-electron build    # 先 build production assets
 *   pnpm -F tialynn-electron e2e      # 跑全部 e2e
 *   pnpm -F tialynn-electron e2e -- --ui   # UI mode 调试
 *
 * 注意:
 *   - 不下载 chromium browser(Electron 自带)
 *   - testDir = e2e/(跟 src/ vitest 单测分离)
 *   - 全局 timeout 60s(electron 启动 + main process init ~ 10s 内通常 OK)
 *   - 单 worker(避免 electron 多实例端口冲突)
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1, // electron 单实例(避免 dev server 端口冲突 / userData 锁)
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // electron 自己管 webContents,不需要 baseURL / browserName
    trace: 'on-first-retry',
  },
})
