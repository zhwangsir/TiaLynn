/**
 * 动作工坊 IPC handlers.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { summarizeModelMotions } from '../services/motion-factory/parser'
import { generateMotion } from '../services/motion-factory/llm-generate'
import { writeMotion } from '../services/motion-factory/writer'
import type { ModelMotionSummary, MotionDraft } from '@shared/motion'

export function registerMotionFactoryIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('motion:summarize', (_evt, modelDir: string): ModelMotionSummary => {
    return summarizeModelMotions(modelDir)
  })

  ipcMain.handle(
    'motion:generate',
    async (
      _evt,
      payload: {
        model_dir: string
        description: string
        style?: string
        examples?: number
      },
    ): Promise<{ ok: boolean; draft?: MotionDraft; reason?: string }> => {
      try {
        const summary = summarizeModelMotions(payload.model_dir)
        if (summary.params.length === 0) {
          return {
            ok: false,
            reason: '该模型还没有任何动作可供参考（无法学习参数范围）；请先用 Editor 做 1-2 个示例动作',
          }
        }
        const draft = await generateMotion({
          summary,
          description: payload.description,
          style: payload.style,
          examples: payload.examples,
        })
        return { ok: true, draft }
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  ipcMain.handle(
    'motion:write',
    (
      _evt,
      payload: { model_json_path: string; draft: MotionDraft; group?: string },
    ): { ok: boolean; motion_path?: string; reason?: string } => {
      const result = writeMotion(payload.model_json_path, payload.draft, payload.group)
      if (result.ok) {
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('motion:written', {
            model_json_path: payload.model_json_path,
            motion_relative: result.motion_relative,
          })
        }
      }
      return result
    },
  )
}
