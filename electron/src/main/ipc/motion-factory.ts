/**
 * 动作工坊 IPC handlers.
 *
 * 涵盖：解析 / 语义识别 / LLM 生成 / 写盘 / 模板库 / 校验 / 评分 / 历史
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { summarizeModelMotions } from '../services/motion-factory/parser'
import { generateMotion } from '../services/motion-factory/llm-generate'
import { writeMotion } from '../services/motion-factory/writer'
import { introspect } from '../services/motion-factory/parameter-introspector'
import { dumpIntrospection } from '../services/motion-factory/parameter-introspector.test-runner'
import * as library from '../services/motion-factory/library-loader'
import { renderTemplateToDraft } from '../services/motion-factory/template-renderer'
import type { ModelMotionSummary, MotionDraft } from '@shared/motion'
import type { SemanticsMap } from '@shared/motion-semantics'
import type { ApplyResult, LibrarySummary, MotionTemplate } from '@shared/motion-library'

export function registerMotionFactoryIpc(getWindow: () => BrowserWindow | null): void {
  // === 解析 ===
  ipcMain.handle('motion:summarize', (_evt, modelDir: string): ModelMotionSummary => {
    return summarizeModelMotions(modelDir)
  })

  // === 语义识别 ===
  ipcMain.handle('motion:introspect', (_evt, modelDir: string): SemanticsMap => {
    return introspect(modelDir)
  })

  ipcMain.handle('motion:introspect-debug', (_evt, modelDir: string): string => {
    return dumpIntrospection(modelDir)
  })

  // === LLM 生成 ===
  ipcMain.handle(
    'motion:generate',
    async (
      _evt,
      payload: {
        model_dir: string
        description: string
        style?: string
        examples?: number
        strategy?: string // 'direct_llm' | 'plan_refine' | 'template_based' | 'ensemble'
      },
    ): Promise<{ ok: boolean; draft?: MotionDraft; reason?: string; strategy_used?: string }> => {
      try {
        const summary = summarizeModelMotions(payload.model_dir)
        if (summary.params.length === 0) {
          return {
            ok: false,
            reason: '该模型还没有任何动作可供参考（无法学习参数范围）；请先用 Editor 做 1-2 个示例动作',
          }
        }
        // strategy 路由（v0.7.4 strategy registry 后会更完整）
        const draft = await generateMotion({
          summary,
          description: payload.description,
          style: payload.style,
          examples: payload.examples,
          strategy: payload.strategy,
        })
        return { ok: true, draft, strategy_used: payload.strategy ?? 'direct_llm' }
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // === 写盘 ===
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

  // === MotionLibrary 模板库 ===
  ipcMain.handle('library:summary', (): LibrarySummary => library.summary())
  ipcMain.handle('library:list', (): MotionTemplate[] => library.list())
  ipcMain.handle('library:get', (_evt, id: string): MotionTemplate | undefined => library.get(id))
  ipcMain.handle('library:reload', (): LibrarySummary => {
    library.reload()
    return library.summary()
  })
  ipcMain.handle(
    'library:apply',
    (
      _evt,
      payload: {
        template_id: string
        model_dir: string
        speed_scale?: number
        intensity_scale?: number
        name_suffix?: string
      },
    ): ApplyResult => {
      const tmpl = library.get(payload.template_id)
      if (!tmpl) return { ok: false, reason: `模板未找到：${payload.template_id}` }
      return renderTemplateToDraft(tmpl, payload.model_dir, {
        speed_scale: payload.speed_scale,
        intensity_scale: payload.intensity_scale,
        name_suffix: payload.name_suffix,
      })
    },
  )
}
