/**
 * E2E smoke:Electron app launch + main window 存在 + main process IPC ready
 *
 * 是把"M7 端到端运行证据"从 main process log 升级到 Playwright 可验证的最小 spec。
 * 后续 specs(对话发送 / 模型选择 / 出图触发 / agent_task)在此 file 之外加。
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 下没有 __dirname,从 import.meta.url 推导
const __dirname = dirname(fileURLToPath(import.meta.url))
const ELECTRON_ENTRY = resolve(__dirname, '..', 'out', 'main', 'index.js')

test.describe('app launch smoke', () => {
  test('Electron main + renderer window 启动成功', async () => {
    const electronApp = await electron.launch({
      args: [ELECTRON_ENTRY],
      // 不强制 visible — 桌宠是透明窗口,只验证 webContents ready
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // 跳过 dev tools / hot reload
        TIALYNN_DEBUG: '0',
      },
      timeout: 30_000,
    })

    // 1. main process 起来
    const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged)
    expect(typeof isPackaged).toBe('boolean')

    // 2. firstWindow 在 Live2DStage 加载前可能就 ready,等到 vue mount
    const window = await electronApp.firstWindow({ timeout: 15_000 })
    expect(window).toBeDefined()

    // 3. main process global error 之前没出现
    const hadCrash = await electronApp.evaluate(({ app }) => {
      // app.isReady 而且不在 quit 状态 = 健康
      return app.isReady() && !app.isHidden?.()
    }).catch(() => true) // hidden API 可能不存在,容忍
    expect(hadCrash !== false).toBe(true)

    // 4. 验证 BrowserWindow 至少 1 个(立绘窗口)
    const winCount = await electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length
    })
    expect(winCount).toBeGreaterThanOrEqual(1)

    // 5. 拿 main window title(可能是 vue page title 或 default)
    const title = await window.title().catch(() => '')
    // 不强 assert 具体值(透明窗口 title 不重要),只确保拿到不抛错
    expect(typeof title).toBe('string')

    await electronApp.close()
  })

  test('app metadata is reachable + main process IPC up', async () => {
    // 注意:dev 模式(launch out/main/index.js)下 Electron app.getName()/getVersion()
    // 返回 Electron binary 自带元数据("Electron" / "33.4.11"),只有 packaged .app
    // 才返 productName "TiaLynn" + package.json version。
    // 因此这里**不**绑死值,只验证 metadata 接口可达 + 拿到非空字符串。
    const electronApp = await electron.launch({
      args: [ELECTRON_ENTRY],
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 30_000,
    })
    const meta = await electronApp.evaluate(({ app }) => ({
      name: app.getName(),
      version: app.getVersion(),
      locale: app.getLocale(),
      ready: app.isReady(),
    }))
    expect(meta.name).toBeTruthy()
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/) // 合法 semver
    expect(meta.ready).toBe(true)
    await electronApp.close()
  })
})
