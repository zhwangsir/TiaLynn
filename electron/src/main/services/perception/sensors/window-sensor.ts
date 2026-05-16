/**
 * 活动窗口 sensor — 检测用户当前聚焦的应用 + 窗口标题。
 *
 * 实现：
 * - macOS: AppleScript via osascript（无需 native deps）
 * - Windows: 暂用 ps + Get-Process（粗略；后续可用 active-win lib）
 * - Linux: xdotool（若有）
 *
 * 频率：1.5s 一次。变化时 publish app_focus_changed。
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { perception } from '../bus'
import type { PerceptionConfig } from '@shared/perception'

const execAsync = promisify(exec)
const POLL_INTERVAL_MS = 1500

interface State {
  last_app: string
  last_title: string
}

export class WindowSensor {
  private state: State = { last_app: '', last_title: '' }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private config: PerceptionConfig) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  updateConfig(config: PerceptionConfig): void {
    this.config = config
  }

  private async tick(): Promise<void> {
    const info = await this.getActiveWindow()
    if (!info) return
    if (info.app !== this.state.last_app || info.title !== this.state.last_title) {
      const isBlacklisted = this.config.vision_blacklist_apps.some(
        (b) => info.app.toLowerCase().includes(b.toLowerCase()) ||
          info.title.toLowerCase().includes(b.toLowerCase()),
      )
      perception.publish({
        type: 'app_focus_changed',
        t: Date.now(),
        app_name: info.app,
        window_title: info.title,
        is_blacklisted: isBlacklisted,
      })
      this.state.last_app = info.app
      this.state.last_title = info.title
    }
  }

  private async getActiveWindow(): Promise<{ app: string; title: string } | null> {
    try {
      if (process.platform === 'darwin') {
        return this.getMac()
      }
      if (process.platform === 'win32') {
        return this.getWin()
      }
      // Linux 或其他 — 暂不支持
      return null
    } catch (e) {
      // 失败不要噪音 — 用户可能没装 osascript / 没权限
      return null
    }
  }

  private async getMac(): Promise<{ app: string; title: string } | null> {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        try
          set winName to name of first window of frontApp
        on error
          set winName to ""
        end try
      end tell
      return appName & "||" & winName
    `
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 1500,
    })
    const [app, title] = stdout.trim().split('||')
    if (!app) return null
    return { app, title: title ?? '' }
  }

  private async getWin(): Promise<{ app: string; title: string } | null> {
    // Powershell 简版 — 取前台进程
    const cmd =
      `powershell -Command "Add-Type @' using System; using System.Runtime.InteropServices; public class W { [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count); [DllImport(\\"user32.dll\\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int procId); } '@; $h = [W]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 256; [W]::GetWindowText($h, $sb, 256) | Out-Null; $pid = 0; [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; $p = Get-Process -Id $pid; Write-Host ($p.ProcessName + '||' + $sb.ToString())"`
    const { stdout } = await execAsync(cmd, { timeout: 2000 })
    const [app, title] = stdout.trim().split('||')
    return { app: app ?? '', title: title ?? '' }
  }
}
