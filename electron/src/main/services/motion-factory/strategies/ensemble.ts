/**
 * Ensemble 策略 — 并发跑 3 个 strategy，用 MotionScorer 选最优。
 * Token 量最高但质量最稳。
 */
import type { MotionDraft } from '@shared/motion'
import type { GenerationContext, IGenerationStrategy } from './index'
import { directLlmStrategy } from './direct-llm'
import { planRefineStrategy } from './plan-refine'
import { templateBasedStrategy } from './template-based'
import { scoreMotion } from '../scorer'

export const ensembleStrategy: IGenerationStrategy = {
  id: 'ensemble',
  display_name_zh: '组合（最佳，慢）',
  description: '并发跑 direct + plan_refine + template_based，自动评分选最优。质量最高，token 量 3x',
  cost: 'high',
  async generate(ctx: GenerationContext): Promise<MotionDraft> {
    const results = await Promise.allSettled([
      directLlmStrategy.generate(ctx),
      planRefineStrategy.generate(ctx),
      templateBasedStrategy.generate(ctx),
    ])

    const drafts: Array<{ draft: MotionDraft; from: string; score: number }> = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const from = ['direct_llm', 'plan_refine', 'template_based'][i]
      if (r.status === 'fulfilled') {
        const scoring = scoreMotion(r.value, ctx.summary)
        drafts.push({ draft: r.value, from, score: scoring.total })
      } else {
        console.warn(`[ensemble] ${from} failed:`, r.reason)
      }
    }

    if (drafts.length === 0) {
      const reasons = results
        .map((r, i) =>
          r.status === 'rejected'
            ? `${['direct_llm', 'plan_refine', 'template_based'][i]}: ${r.reason}`
            : '',
        )
        .filter(Boolean)
        .join('\n')
      throw new Error(`Ensemble 全部失败:\n${reasons}`)
    }

    drafts.sort((a, b) => b.score - a.score)
    const best = drafts[0]
    if (!best.draft.description) {
      best.draft.description = `${best.draft.name} (ensemble winner from ${best.from}, score=${best.score.toFixed(2)})`
    } else {
      best.draft.description += ` [ensemble winner: ${best.from}, score=${best.score.toFixed(2)}]`
    }
    return best.draft
  },
}
