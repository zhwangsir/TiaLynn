/**
 * @tialynn/soul-loader — TiaLynn 三层人格灵魂配置纯函数包。
 *
 * 不读 fs，不依赖 yaml parser — 调用方传入已解析的对象，本包负责合并 + 渲染 system prompt。
 *
 * 使用:
 *   import yaml from 'js-yaml'
 *   import { mergeSoulPartials, buildSystemPrompt } from '@tialynn/soul-loader'
 *
 *   const identity = yaml.load(fs.readFileSync('identity.yaml', 'utf-8')) as any
 *   const personality = yaml.load(fs.readFileSync('personality.yaml', 'utf-8')) as any
 *   const soul = mergeSoulPartials({ identity, personality })
 *   const prompt = buildSystemPrompt(soul, { ragContext: '...' })
 */
export type { SoulConfig } from './types'
export { DEFAULT_SOUL } from './types'
export { mergeSoulPartials, mergeWithDefaults, type MergeInput } from './merger'
export { buildSystemPrompt, type BuildSystemPromptOptions } from './system-prompt'
