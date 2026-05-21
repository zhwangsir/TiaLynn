/**
 * R81: SpotlightSearch 等模糊搜索匹配高亮辅助。
 *
 * 把 text 按 query 子串拆段返回 [{ text, matched }] segments;
 * 不大小写敏感, 不正则 (用户输入直接 indexOf), 一次匹配第一次出现。
 * Vue 模板用 v-for 渲染, 不用 v-html → XSS-safe。
 */

export interface HighlightSegment {
  text: string
  matched: boolean
}

/**
 * 拆分: 'hello world' + query='lo' → [
 *   { text: 'hel', matched: false },
 *   { text: 'lo', matched: true },
 *   { text: ' world', matched: false },
 * ]
 *
 * 空 query 或无匹配 → 整段未匹配。
 */
export function highlightMatch(text: string, query: string): HighlightSegment[] {
  if (!text) return []
  const q = query.trim()
  if (!q) return [{ text, matched: false }]
  const lower = text.toLowerCase()
  const qLower = q.toLowerCase()
  const idx = lower.indexOf(qLower)
  if (idx === -1) return [{ text, matched: false }]
  const before = text.slice(0, idx)
  const match = text.slice(idx, idx + q.length)
  const after = text.slice(idx + q.length)
  const out: HighlightSegment[] = []
  if (before) out.push({ text: before, matched: false })
  out.push({ text: match, matched: true })
  if (after) out.push({ text: after, matched: false })
  return out
}
