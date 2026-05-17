<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useConfigStore } from '../stores/config'
import { bus } from '../eventbus'
import { ThumbGenerator, type ThumbProgress } from '../../avatar/render/thumb-generator'

const cfg = useConfigStore()
const emit = defineEmits<{ (e: 'close'): void }>()
// v0.11: 被资源商店嵌入时，外层不需要 fixed 定位 + close 按钮（store 自己有）
defineProps<{ embedded?: boolean }>()

// v0.10 缩略图：character_id → file:// URL
const thumbUrls = reactive<Record<string, string>>({})
const thumbProgress = ref<ThumbProgress | null>(null)
let thumbGen: ThumbGenerator | null = null

// v0.12 LLM enrichment：character_id → { chinese_name, intro, tags }
const enriched = reactive<Record<string, {
  chinese_name: string
  intro_one_line: string
  tags: string[]
}>>({})
const enrichProgress = ref<import('@shared/api').EnrichProgress | null>(null)
let unbindEnrichProgress: (() => void) | null = null

// v0.12 收藏 + 最近
const favorites = ref<Set<string>>(new Set())
const recentDirs = ref<string[]>([])
const viewMode = ref<'all' | 'favorites' | 'recent'>('all')

async function refreshFavorites(): Promise<void> {
  const r = await window.api.models.favorites()
  favorites.value = new Set(r.favorites)
  recentDirs.value = r.recent.map((x) => x.dir)
}

async function refreshEnriched(): Promise<void> {
  try {
    const r = await window.api.models.enrichCached()
    Object.keys(enriched).forEach((k) => delete enriched[k])
    for (const [cid, v] of Object.entries(r)) {
      enriched[cid] = {
        chinese_name: v.chinese_name,
        intro_one_line: v.intro_one_line,
        tags: v.tags,
      }
    }
  } catch (e) {
    console.warn('[enrich] load cache failed:', e)
  }
}

async function toggleFavorite(dir: string): Promise<void> {
  const r = await window.api.models.toggleFavorite(dir)
  if (r.is_favorite) favorites.value.add(dir)
  else favorites.value.delete(dir)
}

async function startEnrichment(): Promise<void> {
  if (enrichProgress.value && enrichProgress.value.done < enrichProgress.value.total) {
    bus.emit('ui:toast', { kind: 'info', message: '已在生成中', ttl_ms: 2000 })
    return
  }
  unbindEnrichProgress?.()
  unbindEnrichProgress = window.api.models.onEnrichProgress((p) => {
    enrichProgress.value = p
    // 每次进度变化 reload 一次 cache 让 UI 显示新内容
    if (p.done > 0 && p.done % 5 === 0) void refreshEnriched()
    if (p.error) {
      bus.emit('ui:toast', { kind: 'error', message: `补全失败：${p.error}`, ttl_ms: 8000 })
    }
    if (p.done === p.total && p.total > 0) {
      void refreshEnriched() // 最终一次
      bus.emit('ui:toast', { kind: 'success', message: `补全完成 ${p.done} 个角色`, ttl_ms: 5000 })
    }
  })
  await window.api.models.enrichStart()
  bus.emit('ui:toast', { kind: 'info', message: '🤖 LLM 后台补全中…（约 30 分钟）', ttl_ms: 5000 })
}

async function abortEnrichment(): Promise<void> {
  await window.api.models.enrichAbort()
  enrichProgress.value = null
  bus.emit('ui:toast', { kind: 'info', message: '已中止补全', ttl_ms: 2000 })
}

async function loadCachedThumbs(): Promise<void> {
  const ids = [...new Set(cfg.models.map((m) => m.meta?.character_id).filter(Boolean) as string[])]
  await Promise.all(
    ids.map(async (cid) => {
      const r = await window.api.thumbs.get(cid)
      if (r.exists && r.url) thumbUrls[cid] = r.url
    }),
  )
}

async function generateMissingThumbs(): Promise<void> {
  // 收集需要生成的 character → 选 grade 最高的那个 view 当代表
  const byChar = new Map<string, (typeof cfg.models)[number]>()
  for (const m of cfg.models) {
    if (m.cubism !== 'cubism4' || !m.meta?.has_core || !m.meta?.character_id) continue
    const cid = m.meta.character_id
    if (!byChar.has(cid) || gradeRank(m) < gradeRank(byChar.get(cid)!)) {
      byChar.set(cid, m)
    }
  }
  const allIds = [...byChar.keys()]
  const missing = await window.api.thumbs.listMissing(allIds)
  if (missing.length === 0) {
    thumbProgress.value = null
    return
  }
  const jobs = missing.map((cid) => ({
    character_id: cid,
    file_url: byChar.get(cid)!.file_url,
  }))
  thumbGen = new ThumbGenerator()
  await thumbGen.run(jobs, async (p) => {
    thumbProgress.value = p
    // 每完成一个，重新拉它的 URL（让卡片立刻刷新）
    if (p.current) {
      const r = await window.api.thumbs.get(p.current)
      if (r.exists && r.url) thumbUrls[p.current] = r.url
    }
  })
  thumbProgress.value = null
}

async function regenerateAllThumbs(): Promise<void> {
  if (thumbGen) thumbGen.cancel()
  await window.api.thumbs.clearAll()
  Object.keys(thumbUrls).forEach((k) => delete thumbUrls[k])
  void generateMissingThumbs()
}

/** 加载中的 model dir — 用于卡片显示 spinner */
const loadingDir = ref<string | null>(null)
const loadError = ref<string | null>(null)

function onModelLoaded(): void {
  loadingDir.value = null
  loadError.value = null
}
function onModelError(payload: { reason: string }): void {
  loadingDir.value = null
  loadError.value = payload.reason
}
bus.on('avatar:model-loaded', onModelLoaded)
bus.on('avatar:model-error', onModelError)

onBeforeUnmount(() => {
  bus.off('avatar:model-loaded', onModelLoaded)
  bus.off('avatar:model-error', onModelError)
  if (thumbGen) thumbGen.cancel()
  unbindEnrichProgress?.()
})

const search = ref('')
const gradeFilter = ref<'all' | 'A' | 'B' | 'C' | 'D'>('all')
const hideUnusable = ref(true)
const sortBy = ref<'motion' | 'expression' | 'name' | 'grade'>('motion')
const focused = ref<typeof cfg.models[number] | null>(null)

/** dir → AI 生成的介绍，跟 main 进程 cache 同步 */
const descriptions = ref<Record<string, string>>({})
const describing = ref<Set<string>>(new Set())

/** 哪些 IP section 是展开的 */
const expandedIps = ref<Set<string>>(new Set())

function extractIp(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  // v0.9: 模型库迁到 electron/models-library/，旧路径 Live2d-model-master 仍兼容
  const ix = parts.findIndex(
    (p) => p === 'models-library' || p.includes('Live2d-model-master'),
  )
  return ix >= 0 && ix + 1 < parts.length ? parts[ix + 1]! : parts[0] ?? '(root)'
}

// v0.9: IP info 知识库（关键词 → 介绍/类型/出品方）— 与 main/services/ip-knowledge.ts 同步
// 这里维护轻量副本仅供 UI 显示，主进程那份是单一真相源
const IP_INFO: Array<{ keywords: string[]; intro: string; kind: string }> = [
  { keywords: ['bang dream', 'bandori'], intro: '少女乐队跨媒体企划，Live2D 多取自手游 Girls Band Party!', kind: 'BushiRoad 手游' },
  { keywords: ['destiny_child', '天命之子'], intro: 'Shift Up 出品的韩系角色养成手游，原 Nikke 团队', kind: '韩系手游' },
  { keywords: ['galgame'], intro: '日系视觉小说 Live2D 立绘合集', kind: 'PC galgame' },
  { keywords: ['hutao'], intro: '《原神》璃月七星之一，往生堂第七十七代堂主', kind: 'miHoYo 二创' },
  { keywords: ['live2d', 'cubism'], intro: 'Cubism SDK 官方示例（Haru / Hiyori / Mark / Wanko）', kind: 'Live2D 官方' },
  { keywords: ['sacred sword'], intro: '韩系奇幻女武神 RPG', kind: '韩系手游' },
  { keywords: ['七大罪', 'sin '], intro: '基于《七大罪》小说改编，魔王拟人化', kind: '日系 galgame' },
  { keywords: ['アンノウン', 'unknown bride'], intro: '日本 ユニフィニ 婚姻 + 战斗策略手游', kind: '日系手游' },
  { keywords: ['venusscramble', 'venus scramble'], intro: 'Cybird 神话女神拟人化 RPG', kind: '日系手游' },
  { keywords: ['宝石研'], intro: '宝石拟人化的国创 RPG 手游', kind: '中文手游' },
  { keywords: ['崩坏学园'], intro: 'miHoYo 崩坏系列起点作品，校园+末世横版动作', kind: 'miHoYo 手游' },
  { keywords: ['碧蓝航线', 'azur', 'azue lane'], intro: '中日合作舰娘射击养成手游，画师阵容豪华', kind: 'Yostar 手游' },
  { keywords: ['凍京', 'toukyo nerco'], intro: 'Nitro+ 赛博朋克视觉小说', kind: 'Nitro+ 游戏' },
  { keywords: ['方舟指令', 'ark order'], intro: 'GREE 神魔大乱斗卡牌 RPG', kind: '日系卡牌' },
  { keywords: ['魂器学院', '炼铜'], intro: '国创魂器拟人化校园战斗手游', kind: '中文手游' },
  { keywords: ['机动战队'], intro: '机娘战术编队手游', kind: '机娘手游' },
  { keywords: ['イモコネ', 'imocone'], intro: '日系纯爱视觉小说，妹系校园题材', kind: '日系 galgame' },
  { keywords: ['诺亚幻想'], intro: '幻想风国创卡牌养成手游', kind: '中文卡牌' },
  { keywords: ['少女次元'], intro: '校园放置养成手游', kind: '中文手游' },
  { keywords: ['少女咖啡枪', 'cafe gun'], intro: '咖啡店 + 枪娘 + 校园题材国创二次元', kind: '中文手游' },
  { keywords: ['少女前线', '少女前線', 'girls frontline'], intro: '武器拟人化策略 RPG，国创军武娘代表', kind: '云母组手游' },
  { keywords: ['食物语'], intro: '中华美食拟人化国创卡牌 RPG', kind: '心动手游' },
  { keywords: ['konosuba', 'fantastic days', '为美好的世界'], intro: '《为美好的世界献上祝福》官方手游', kind: '动画改编手游' },
  { keywords: ['战舰少女'], intro: '早期国创舰娘养成手游', kind: '幻萌手游' },
]

function matchIpInfo(ipName: string): { intro: string; kind: string } | null {
  const norm = ipName.toLowerCase()
  for (const { keywords, intro, kind } of IP_INFO) {
    for (const kw of keywords) if (norm.includes(kw.toLowerCase())) return { intro, kind }
  }
  return null
}

/** Character cluster：character_id → views[] */
interface CharacterCluster {
  character_id: string
  primary: (typeof cfg.models)[number] // 显示用主 view（grade 最高 / motion 最多）
  views: (typeof cfg.models)
}

function clusterByCharacter(models: typeof cfg.models): CharacterCluster[] {
  const byCharId = new Map<string, typeof cfg.models>()
  for (const m of models) {
    const cid = m.meta?.character_id || m.dir // 没 character_id 时把自己当独立 character
    if (!byCharId.has(cid)) byCharId.set(cid, [])
    byCharId.get(cid)!.push(m)
  }
  const clusters: CharacterCluster[] = []
  for (const [character_id, views] of byCharId) {
    const sorted = [...views].sort(
      (a, b) =>
        gradeRank(a) - gradeRank(b) ||
        (b.meta?.motion_count ?? 0) - (a.meta?.motion_count ?? 0),
    )
    clusters.push({ character_id, primary: sorted[0]!, views: sorted })
  }
  return clusters
}

/** 按 IP 分组 → 每 IP 内按 character cluster + filter + sort
 * v0.12: 未在 IP_INFO 知识库的 IP 合并到「📦 其他」，默认折叠减少视觉噪音
 */
const UNKNOWN_IP_BUCKET = '📦 其他（未识别的小众 IP）'

const groupedByIp = computed(() => {
  const q = search.value.trim().toLowerCase()
  const groupsRaw = new Map<string, typeof cfg.models>()
  // v0.12 viewMode：只看收藏/最近时先 filter
  const allowDir = new Set<string>()
  if (viewMode.value === 'favorites') {
    favorites.value.forEach((d) => allowDir.add(d))
  } else if (viewMode.value === 'recent') {
    recentDirs.value.forEach((d) => allowDir.add(d))
  }
  for (const m of cfg.models) {
    if (viewMode.value !== 'all' && !allowDir.has(m.dir)) continue
    if (hideUnusable.value && m.cubism !== 'cubism4') continue
    if (hideUnusable.value && !m.meta?.has_core) continue
    if (gradeFilter.value !== 'all' && m.meta?.grade !== gradeFilter.value) continue
    if (q) {
      // v0.12: 搜索范围扩到 enriched 中文名 + tags
      const cid = m.meta?.character_id ?? ''
      const en = enriched[cid]
      const hit =
        m.display.toLowerCase().includes(q) ||
        m.dir.toLowerCase().includes(q) ||
        (descriptions.value[m.dir] ?? '').toLowerCase().includes(q) ||
        (en?.chinese_name ?? '').toLowerCase().includes(q) ||
        (en?.intro_one_line ?? '').toLowerCase().includes(q) ||
        (en?.tags ?? []).some((t) => t.toLowerCase().includes(q))
      if (!hit) continue
    }
    const rawIp = extractIp(m.dir)
    const ip = matchIpInfo(rawIp) ? rawIp : UNKNOWN_IP_BUCKET
    if (!groupsRaw.has(ip)) groupsRaw.set(ip, [])
    groupsRaw.get(ip)!.push(m)
  }
  const out: Array<{
    ip: string
    clusters: CharacterCluster[]
    count: number
    char_count: number
    aSum: number
  }> = []
  for (const [ip, models] of groupsRaw) {
    const clusters = clusterByCharacter(models)
    // cluster 内排序
    clusters.sort((a, b) => {
      switch (sortBy.value) {
        case 'motion':
          return (
            (b.primary.meta?.motion_count ?? 0) - (a.primary.meta?.motion_count ?? 0)
          )
        case 'expression':
          return (
            (b.primary.meta?.expression_count ?? 0) - (a.primary.meta?.expression_count ?? 0)
          )
        case 'grade':
          return gradeRank(a.primary) - gradeRank(b.primary)
        case 'name':
          return a.primary.display.localeCompare(b.primary.display)
      }
    })
    out.push({
      ip,
      clusters,
      count: models.length,
      char_count: clusters.length,
      aSum: models.filter((m) => m.meta?.grade === 'A' || m.meta?.grade === 'B').length,
    })
  }
  out.sort((a, b) => b.aSum - a.aSum || b.count - a.count || a.ip.localeCompare(b.ip))
  return out
})

function gradeRank(m: (typeof cfg.models)[number]): number {
  const g = m.meta?.grade
  return g === 'A' ? 0 : g === 'B' ? 1 : g === 'C' ? 2 : 3
}

const stats = computed(() => {
  const total = cfg.models.length
  const c4 = cfg.models.filter((m) => m.cubism === 'cubism4').length
  const a = cfg.models.filter((m) => m.meta?.grade === 'A').length
  const b = cfg.models.filter((m) => m.meta?.grade === 'B').length
  const c = cfg.models.filter((m) => m.meta?.grade === 'C').length
  const d = cfg.models.filter((m) => m.meta?.grade === 'D').length
  return { total, c4, a, b, c, d }
})

function toggleIp(ip: string): void {
  if (expandedIps.value.has(ip)) expandedIps.value.delete(ip)
  else expandedIps.value.add(ip)
}

async function applyModel(m: (typeof cfg.models)[number]): Promise<void> {
  if (m.cubism !== 'cubism4' || !m.meta?.has_core) {
    bus.emit('ui:toast', { kind: 'warn', message: '该模型不可用', ttl_ms: 3000 })
    return
  }
  // 立刻反馈 — 不等 IPC 往返就把卡片置 loading 态
  loadingDir.value = m.dir
  loadError.value = null
  // 8 秒兜底超时：renderer 没回事件就清掉，避免卡死
  const timer = window.setTimeout(() => {
    if (loadingDir.value === m.dir) loadingDir.value = null
  }, 8000)
  try {
    await cfg.saveAvatar({ model_dir: m.dir, model_file: m.model_file })
    bus.emit('avatar:reload-model')
    // v0.12: 标记最近使用
    void window.api.models.markRecent(m.dir).then(() => refreshFavorites()).catch(() => {})
  } catch (e) {
    loadingDir.value = null
    bus.emit('ui:toast', { kind: 'error', message: `切换失败：${String(e)}`, ttl_ms: 5000 })
  } finally {
    // 清掉 timeout 由事件接管（model-loaded 或 model-error）
    void timer
  }
}

async function describe(m: (typeof cfg.models)[number]): Promise<void> {
  if (descriptions.value[m.dir]) return
  if (describing.value.has(m.dir)) return
  describing.value.add(m.dir)
  try {
    const r = await window.api.models.describe({
      model_dir: m.dir,
      model_json_path: m.absolute_path,
      display: m.display,
      ip: extractIp(m.dir),
      motion_count: m.meta?.motion_count ?? 0,
      expression_count: m.meta?.expression_count ?? 0,
    })
    if (r.ok && r.text) {
      descriptions.value[m.dir] = r.text
    } else {
      bus.emit('ui:toast', { kind: 'error', message: r.reason ?? '生成失败', ttl_ms: 5000 })
    }
  } finally {
    describing.value.delete(m.dir)
  }
}

async function describeBatch(models: (typeof cfg.models)): Promise<void> {
  // 并发限制 4，避免一次发太多 LLM 请求
  const queue = models.filter((m) => !descriptions.value[m.dir]).slice(0, 30)
  const concurrency = 4
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < queue.length) {
      const i = idx++
      await describe(queue[i]!)
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker))
  bus.emit('ui:toast', { kind: 'success', message: `批量生成完成`, ttl_ms: 3000 })
}

const rescanning = ref(false)
async function rescan(): Promise<void> {
  rescanning.value = true
  try {
    await cfg.rescanModels()
    bus.emit('ui:toast', { kind: 'info', message: `扫到 ${cfg.models.length} 个模型`, ttl_ms: 3000 })
  } finally {
    rescanning.value = false
  }
}

onMounted(async () => {
  // 加载所有 cached 描述
  try {
    descriptions.value = await window.api.models.cachedDescriptions()
  } catch {
    /* skip */
  }
  // v0.10: 拉已缓存的缩略图 → 后台开始生成缺失的（不阻塞 UI）
  if (cfg.models.length > 0) {
    await loadCachedThumbs()
    void generateMissingThumbs()
  }
  // v0.12: 拉已 enriched + favorites
  void refreshEnriched()
  void refreshFavorites()
})

// 模型列表变化时（首次 rescan 或新加模型）触发拉缓存 + 补生成
watch(
  () => cfg.models.length,
  async (n) => {
    if (n > 0) {
      await loadCachedThumbs()
      void generateMissingThumbs()
    }
  },
)

watch(groupedByIp, (groups) => {
  // 自动选第一个 IP / 第一个 cluster 的第一个 view
  if (!focused.value && groups.length > 0) {
    const firstGroup = groups[0]!
    const firstCluster = firstGroup.clusters[0]
    if (firstCluster && firstCluster.views.length > 0) {
      focused.value = firstCluster.views[0] ?? null
      expandedIps.value.add(firstGroup.ip)
    }
  }
  // v0.12: 自动展开所有「已识别 IP」，「其他」桶默认折叠
  for (const g of groups) {
    if (g.ip !== UNKNOWN_IP_BUCKET && !expandedIps.value.has(g.ip)) {
      expandedIps.value.add(g.ip)
    }
  }
})
</script>

<template>
  <div class="library-panel" :class="{ 'library-embedded': embedded }" @click.stop>
    <header>
      <div v-if="!embedded" class="title-row">
        <h2>🎭 模型库 — 按 IP 分组</h2>
        <div class="stats">
          总 {{ stats.total }} | Cubism4 {{ stats.c4 }} |
          <span class="g-a">A {{ stats.a }}</span> /
          <span class="g-b">B {{ stats.b }}</span> /
          <span class="g-c">C {{ stats.c }}</span> /
          <span class="g-d">D {{ stats.d }}</span>
        </div>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>
      <div v-else class="title-row embedded-stats">
        <span class="stats">
          总 {{ stats.total }} | Cubism4 {{ stats.c4 }} |
          <span class="g-a">A {{ stats.a }}</span> /
          <span class="g-b">B {{ stats.b }}</span> /
          <span class="g-c">C {{ stats.c }}</span> /
          <span class="g-d">D {{ stats.d }}</span>
        </span>
      </div>
      <div class="filter-row">
        <input v-model="search" placeholder="搜索名字/描述..." class="search-input" />
        <select v-model="gradeFilter" class="select">
          <option value="all">所有等级</option>
          <option value="A">A 级 (≥15 动作)</option>
          <option value="B">B 级 (≥8 动作)</option>
          <option value="C">C 级 (≥3 动作)</option>
          <option value="D">D 级 (静态)</option>
        </select>
        <select v-model="sortBy" class="select">
          <option value="motion">按动作数 ↓</option>
          <option value="expression">按表情数 ↓</option>
          <option value="grade">按等级 ↓</option>
          <option value="name">按名字 A→Z</option>
        </select>
        <label class="toggle"><input type="checkbox" v-model="hideUnusable" /> 只显示可用</label>
        <button class="ghost" @click="rescan" :disabled="rescanning">
          {{ rescanning ? '扫描中…' : '🔄 重扫' }}
        </button>
        <button
          class="ghost"
          @click="
            groupedByIp.forEach((g) =>
              g.ip ? expandedIps.has(g.ip) ? expandedIps.delete(g.ip) : expandedIps.add(g.ip) : null,
            )
          "
        >
          🔽 全部展开/收起
        </button>
        <button class="ghost" @click="regenerateAllThumbs" title="清空缩略图缓存并重建">
          🖼️ 重建缩略图
        </button>
        <button
          class="ghost"
          @click="enrichProgress && enrichProgress.done < enrichProgress.total ? abortEnrichment() : startEnrichment()"
          :title="enrichProgress && enrichProgress.done < enrichProgress.total ? '点击中止' : '用 LLM 给 1389 个角色推中文名+介绍（~30 分钟）'"
        >
          {{ enrichProgress && enrichProgress.done < enrichProgress.total ? '⏹ 中止补全' : '🤖 补全角色名' }}
        </button>
      </div>
      <!-- v0.12: viewMode 切换 -->
      <div class="viewmode-row">
        <button :class="['vm', { active: viewMode === 'all' }]" @click="viewMode = 'all'">
          📚 全部 <span class="vm-count">{{ cfg.models.length }}</span>
        </button>
        <button
          :class="['vm', { active: viewMode === 'favorites' }]"
          @click="viewMode = 'favorites'"
        >
          ⭐ 收藏 <span class="vm-count">{{ favorites.size }}</span>
        </button>
        <button :class="['vm', { active: viewMode === 'recent' }]" @click="viewMode = 'recent'">
          🕐 最近 <span class="vm-count">{{ recentDirs.length }}</span>
        </button>
      </div>
      <!-- v0.10: 缩略图生成进度 -->
      <div v-if="thumbProgress && thumbProgress.done < thumbProgress.total" class="thumb-progress">
        <div class="thumb-bar" :style="{ width: ((thumbProgress.done / thumbProgress.total) * 100).toFixed(1) + '%' }" />
        <span class="thumb-text">
          🖼️ 生成缩略图 {{ thumbProgress.done }} / {{ thumbProgress.total }}
          <span v-if="thumbProgress.failed > 0" class="thumb-fail">（{{ thumbProgress.failed }} 失败）</span>
          <span v-if="thumbProgress.current" class="thumb-cur" :title="thumbProgress.current">
            • {{ (thumbProgress.current.length > 30 ? thumbProgress.current.slice(0, 30) + '…' : thumbProgress.current) }}
          </span>
        </span>
      </div>
      <!-- v0.12: LLM enrichment 进度 -->
      <div v-if="enrichProgress && enrichProgress.done < enrichProgress.total" class="thumb-progress enrich">
        <div class="thumb-bar enrich-bar" :style="{ width: ((enrichProgress.done / enrichProgress.total) * 100).toFixed(1) + '%' }" />
        <span class="thumb-text">
          🤖 LLM 补全角色名 {{ enrichProgress.done }} / {{ enrichProgress.total }}
          <span v-if="enrichProgress.failed > 0" class="thumb-fail">（{{ enrichProgress.failed }} 失败）</span>
          <span v-if="enrichProgress.current" class="thumb-cur" :title="enrichProgress.current">
            • {{ (enrichProgress.current.length > 24 ? enrichProgress.current.slice(0, 24) + '…' : enrichProgress.current) }}
          </span>
        </span>
      </div>
    </header>

    <div class="body">
      <section v-for="g in groupedByIp" :key="g.ip" class="ip-section">
        <div class="ip-head" @click="toggleIp(g.ip)">
          <span class="ip-arrow">{{ expandedIps.has(g.ip) ? '▼' : '▶' }}</span>
          <div class="ip-title">
            <span class="ip-name">{{ g.ip }}</span>
            <span v-if="matchIpInfo(g.ip)" class="ip-kind">{{ matchIpInfo(g.ip)!.kind }}</span>
          </div>
          <span class="ip-count">
            {{ g.char_count }} 角色 · {{ g.count }} 个 model
          </span>
          <button
            v-if="expandedIps.has(g.ip)"
            class="ip-btn"
            @click.stop="describeBatch(g.clusters.slice(0, 30).map((c) => c.primary))"
            title="为该 IP 下前 30 个角色批量生成 AI 介绍"
          >
            ✨ 批量介绍
          </button>
        </div>
        <!-- v0.9: 展开 IP 时显示该 IP 的简介，让来源一眼可辨 -->
        <div v-if="expandedIps.has(g.ip) && matchIpInfo(g.ip)" class="ip-banner">
          {{ matchIpInfo(g.ip)!.intro }}
        </div>
        <div v-if="expandedIps.has(g.ip)" class="grid">
          <div
            v-for="c in g.clusters.slice(0, 60)"
            :key="c.character_id"
            class="card"
            :class="{
              'card-current': c.views.some((v) => cfg.soul?.avatar.model_dir === v.dir),
              'card-loading': c.views.some((v) => loadingDir === v.dir),
              [`card-grade-${(c.primary.meta?.grade ?? 'd').toLowerCase()}`]: true,
            }"
            @click="focused = c.primary"
            @dblclick="applyModel(c.primary)"
          >
            <div v-if="c.views.some((v) => loadingDir === v.dir)" class="card-spinner">
              <div class="spinner-ring" />
              <span>加载中…</span>
            </div>
            <!-- v0.10: 缩略图 — 有就显示真实，没有就显示占位 -->
            <div class="card-thumb">
              <img
                v-if="c.character_id && thumbUrls[c.character_id]"
                :src="thumbUrls[c.character_id]"
                :alt="c.primary.display"
                class="thumb-img"
                loading="lazy"
              />
              <div v-else class="thumb-placeholder">
                <span class="thumb-icon">🎭</span>
                <span class="thumb-hint">等待生成…</span>
              </div>
            </div>
            <div class="card-head">
              <span class="grade-tag">{{ c.primary.meta?.grade ?? '?' }}</span>
              <span class="stat">🎬{{ c.primary.meta?.motion_count ?? 0 }}</span>
              <span class="stat">😊{{ c.primary.meta?.expression_count ?? 0 }}</span>
              <span v-if="c.primary.meta?.has_physics" class="stat">⚡</span>
              <span v-if="c.views.length > 1" class="views-tag">{{ c.views.length }} views</span>
            </div>
            <!-- v0.12: 优先 enriched 中文名，否则用原 dir 名 -->
            <div class="card-name-row">
              <div class="card-name" :title="c.primary.display">
                {{ enriched[c.character_id]?.chinese_name || c.primary.display }}
              </div>
              <button
                class="fav-btn"
                :class="{ on: favorites.has(c.primary.dir) }"
                @click.stop="toggleFavorite(c.primary.dir)"
                :title="favorites.has(c.primary.dir) ? '取消收藏' : '收藏'"
              >
                {{ favorites.has(c.primary.dir) ? '⭐' : '☆' }}
              </button>
            </div>
            <!-- 拼音原名（当 enriched 中文名 != 原 display 时显示，让用户对照） -->
            <div
              v-if="enriched[c.character_id]?.chinese_name !== c.primary.display && enriched[c.character_id]"
              class="card-pinyin"
            >
              {{ c.primary.display }}
            </div>
            <!-- 同角色多 view 显示 chip 列表 -->
            <div v-if="c.views.length > 1" class="views-row">
              <button
                v-for="v in c.views"
                :key="v.dir"
                class="view-chip"
                :class="{
                  active: cfg.soul?.avatar.model_dir === v.dir,
                  loading: loadingDir === v.dir,
                }"
                @click.stop="applyModel(v)"
                :disabled="loadingDir === v.dir"
                :title="v.meta?.view_label || v.display"
              >
                <span v-if="loadingDir === v.dir" class="chip-dot" />
                {{ v.meta?.view_label || '主' }}
              </button>
            </div>
            <!-- v0.12: enriched 一句话介绍 -->
            <div v-if="enriched[c.character_id]" class="card-desc enriched">
              {{ enriched[c.character_id]?.intro_one_line }}
            </div>
            <div v-else-if="descriptions[c.primary.dir]" class="card-desc">
              {{ descriptions[c.primary.dir] }}
            </div>
            <div v-else-if="describing.has(c.primary.dir)" class="card-desc dim">生成中…</div>
            <!-- v0.12: enriched tags -->
            <div v-if="enriched[c.character_id]?.tags?.length" class="card-tags">
              <span v-for="t in enriched[c.character_id]?.tags" :key="t" class="tag">{{ t }}</span>
            </div>
          </div>
          <div v-if="g.clusters.length > 60" class="more-hint">
            该 IP 共 {{ g.char_count }} 角色，显示前 60
          </div>
        </div>
      </section>
    </div>

    <aside v-if="focused" class="detail">
      <h3>{{ focused.display }}</h3>
      <div class="detail-ip">IP: {{ extractIp(focused.dir) }}</div>
      <div v-if="descriptions[focused.dir]" class="ai-desc">
        <div class="ai-desc-label">✨ AI 介绍</div>
        <div class="ai-desc-text">{{ descriptions[focused.dir] }}</div>
      </div>
      <button v-else class="primary" @click="describe(focused)" :disabled="describing.has(focused.dir)">
        {{ describing.has(focused.dir) ? '生成中…' : '✨ 生成 AI 介绍' }}
      </button>
      <div class="detail-meta">
        <div>等级：<b>{{ focused.meta?.grade ?? '?' }}</b></div>
        <div>动作：<b>{{ focused.meta?.motion_count ?? 0 }}</b></div>
        <div>表情：<b>{{ focused.meta?.expression_count ?? 0 }}</b></div>
        <div>物理：<b>{{ focused.meta?.has_physics ? '✓' : '✗' }}</b></div>
        <div>moc3：<b>{{ Math.round((focused.meta?.moc_kb ?? 0) / 1024 * 10) / 10 }}MB</b></div>
        <div>贴图：<b>{{ Math.round((focused.meta?.texture_kb ?? 0) / 1024) }}MB</b></div>
      </div>
      <div class="detail-actions">
        <button class="primary" @click="applyModel(focused)">切到此模型</button>
      </div>
      <div class="dir-path" :title="focused.absolute_path">{{ focused.absolute_path }}</div>
    </aside>
  </div>
</template>

<style scoped>
.library-panel {
  position: fixed; inset: 4%; z-index: 3000;
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 1fr 340px;
  grid-template-areas: 'header header' 'body detail';
  background: oklch(98% 0.005 25 / 0.96);
  border: 1px solid oklch(85% 0.02 25 / 0.6); border-radius: 16px;
  box-shadow: 0 24px 60px oklch(0% 0 0 / 0.3);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
}
/* v0.11: 嵌入到资源商店时，去掉 fixed/shadow/border，flex 内填充 */
.library-panel.library-embedded {
  position: relative;
  inset: auto;
  flex: 1;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.embedded-stats {
  padding: 8px 24px;
  font-size: 12px;
  color: oklch(50% 0.05 250);
}
.embedded-stats .stats { font-family: monospace; }
.library-panel.library-embedded :deep(.body),
.library-panel.library-embedded :deep(.detail) {
  background: transparent;
}
.library-panel {
  pointer-events: auto; overflow: hidden; color: oklch(20% 0.01 25);
}
header { grid-area: header; padding: 14px 18px; border-bottom: 1px solid oklch(85% 0.02 25 / 0.4); }
.title-row { display: flex; align-items: center; gap: 16px; }
.title-row h2 { margin: 0; font-size: 18px; font-weight: 600; }
.stats { font-size: 12px; color: oklch(50% 0.01 25); flex: 1; }
.g-a { color: oklch(45% 0.18 145); font-weight: 600; }
.g-b { color: oklch(55% 0.16 70); font-weight: 600; }
.g-c { color: oklch(60% 0.14 50); }
.g-d { color: oklch(60% 0.05 30); }
.close-btn { width: 28px; height: 28px; border-radius: 999px; border: none; background: oklch(92% 0.02 25); cursor: pointer; font-size: 14px; }
.close-btn:hover { background: oklch(88% 0.04 25); }
.filter-row { display: flex; gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
.search-input, .select { padding: 6px 10px; border: 1px solid oklch(85% 0.02 25 / 0.7); border-radius: 8px; background: oklch(99% 0.002 25); font-size: 13px; }
.search-input { flex: 1; min-width: 200px; }
.toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.ghost { padding: 6px 12px; border: 1px solid oklch(85% 0.02 25 / 0.6); background: transparent; border-radius: 8px; cursor: pointer; font-size: 12px; }
.ghost:hover { background: oklch(95% 0.02 25); }

.body { grid-area: body; padding: 8px 16px 16px; overflow-y: auto; }

.ip-section {
  margin-top: 12px; border: 1px solid oklch(90% 0.015 25 / 0.5);
  border-radius: 12px; overflow: hidden;
  background: oklch(99% 0.002 25 / 0.5);
}
.ip-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; cursor: pointer;
  background: oklch(96% 0.01 250 / 0.5);
  border-bottom: 1px solid oklch(90% 0.015 25 / 0.5);
  user-select: none;
}
.ip-head:hover { background: oklch(94% 0.02 250 / 0.6); }
.ip-arrow { font-size: 10px; color: oklch(45% 0.05 250); }
.ip-title { flex: 1; display: flex; align-items: baseline; gap: 8px; }
.ip-name { font-weight: 600; font-size: 14px; }
.ip-kind {
  font-size: 11px;
  color: oklch(55% 0.12 250);
  background: oklch(92% 0.03 250 / 0.7);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.ip-count { font-size: 12px; color: oklch(50% 0.01 25); }
.ip-banner {
  margin: -4px 8px 12px 32px;
  padding: 10px 14px;
  background: linear-gradient(135deg, oklch(96% 0.025 250 / 0.6), oklch(94% 0.04 280 / 0.4));
  border-left: 3px solid oklch(60% 0.18 250);
  border-radius: 0 8px 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: oklch(40% 0.04 250);
}
.ip-btn {
  padding: 4px 10px; border: 1px solid oklch(70% 0.18 280 / 0.5);
  background: oklch(96% 0.04 280); border-radius: 6px; cursor: pointer; font-size: 11px;
  color: oklch(35% 0.18 280);
}
.ip-btn:hover { background: oklch(92% 0.06 280); }

.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px; padding: 12px;
}
.card {
  padding: 10px; background: white;
  border: 2px solid transparent; border-radius: 10px;
  cursor: pointer; transition: transform 0.1s, box-shadow 0.1s;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 110px;
}
.card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px oklch(0% 0 0 / 0.1); }
.card-current { border-color: oklch(60% 0.18 250); box-shadow: 0 0 0 3px oklch(85% 0.06 250 / 0.5); }
.card-grade-a { border-left: 4px solid oklch(45% 0.18 145); }
.card-grade-b { border-left: 4px solid oklch(55% 0.16 70); }
.card-grade-c { border-left: 4px solid oklch(60% 0.14 50); }
.card-grade-d { border-left: 4px solid oklch(60% 0.05 30); opacity: 0.6; }
.card-head { display: flex; gap: 6px; align-items: center; font-size: 11px; flex-wrap: wrap; }
.views-tag {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  background: oklch(94% 0.05 280);
  color: oklch(35% 0.15 280);
  border-radius: 4px;
}
.views-row { display: flex; flex-wrap: wrap; gap: 4px; }
.view-chip {
  padding: 2px 8px; border: 1px solid oklch(85% 0.02 25 / 0.6);
  background: white; border-radius: 4px; cursor: pointer;
  font-size: 10px; color: oklch(40% 0.02 25);
}
.view-chip:hover { background: oklch(95% 0.02 25); }
.view-chip.active {
  background: oklch(55% 0.2 250); color: white; border-color: oklch(55% 0.2 250);
}
.grade-tag { font-weight: 700; padding: 1px 6px; border-radius: 4px; background: oklch(94% 0.04 25); color: oklch(30% 0.04 25); }
.stat { color: oklch(40% 0.02 25); }
.card-name {
  font-size: 13px; font-weight: 500; line-height: 1.3;
  overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.card-desc { font-size: 11px; color: oklch(35% 0.02 250); line-height: 1.4; }
.card-desc.dim { color: oklch(60% 0.01 25); font-style: italic; }
.ai-btn {
  align-self: flex-start; padding: 2px 8px;
  border: 1px solid oklch(75% 0.12 280 / 0.5); background: oklch(97% 0.03 280);
  border-radius: 5px; cursor: pointer; font-size: 10px; color: oklch(40% 0.15 280);
}
.ai-btn:hover { background: oklch(94% 0.05 280); }

.more-hint { grid-column: 1/-1; text-align: center; font-size: 11px; color: oklch(50% 0.01 25); font-style: italic; padding: 8px; }

.detail {
  grid-area: detail; padding: 16px;
  border-left: 1px solid oklch(85% 0.02 25 / 0.4); background: oklch(99% 0.003 25);
  overflow-y: auto;
}
.detail h3 { margin: 0 0 4px; font-size: 15px; }
.detail-ip { font-size: 11px; color: oklch(45% 0.05 250); margin-bottom: 12px; }
.ai-desc {
  margin-bottom: 12px; padding: 10px; background: oklch(97% 0.03 280); border-radius: 8px;
}
.ai-desc-label { font-size: 11px; color: oklch(40% 0.15 280); font-weight: 600; margin-bottom: 4px; }
.ai-desc-text { font-size: 13px; line-height: 1.5; color: oklch(25% 0.02 280); }
.detail-meta {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  font-size: 12px; margin: 12px 0;
}
.detail-actions { display: flex; gap: 8px; margin: 12px 0; }
.primary {
  flex: 1; padding: 8px 12px;
  background: oklch(55% 0.2 250); color: white;
  border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500;
}
.primary:hover { background: oklch(50% 0.22 250); }
.primary:disabled { opacity: 0.5; cursor: wait; }
.dir-path { margin-top: 12px; font-size: 10px; color: oklch(50% 0.01 25); word-break: break-all; font-family: monospace; }

/* v0.9: 切模型 spinner — 立刻反馈避免「点了没反应」感 */
.card { position: relative; }

/* v0.10: 缩略图 */
.card-thumb {
  width: 100%;
  aspect-ratio: 3 / 4;
  background: linear-gradient(135deg, oklch(96% 0.012 250 / 0.5), oklch(94% 0.025 280 / 0.4));
  border-radius: 10px;
  margin-bottom: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-placeholder {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 4px;
  color: oklch(60% 0.05 250);
}
.thumb-icon { font-size: 32px; opacity: 0.6; }
.thumb-hint { font-size: 10px; opacity: 0.7; }

/* 进度条 */
.thumb-progress {
  position: relative;
  margin-top: 10px;
  height: 22px;
  background: oklch(94% 0.02 250 / 0.6);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 11px;
  color: oklch(35% 0.05 250);
}
.thumb-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, oklch(70% 0.15 250 / 0.4), oklch(65% 0.18 280 / 0.5));
  transition: width 300ms ease;
}
.thumb-text {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.thumb-fail { color: oklch(55% 0.2 25); }
.thumb-cur { opacity: 0.7; font-family: monospace; font-size: 10px; }
.card-loading { opacity: 0.7; }
.card-spinner {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center;
  background: oklch(98% 0.005 250 / 0.85);
  backdrop-filter: blur(4px);
  border-radius: 12px;
  font-size: 11px; color: oklch(45% 0.05 250);
  pointer-events: none;
}
.spinner-ring {
  width: 24px; height: 24px;
  border: 2.5px solid oklch(85% 0.02 250);
  border-top-color: oklch(55% 0.2 250);
  border-radius: 50%;
  animation: spinner-rotate 0.7s linear infinite;
}
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
.view-chip.loading {
  background: oklch(92% 0.04 250);
  color: oklch(50% 0.1 250);
  cursor: wait;
}
.chip-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%;
  background: oklch(55% 0.2 250);
  margin-right: 4px;
  animation: chip-pulse 0.8s ease-in-out infinite;
}
@keyframes chip-pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

/* v0.12: viewMode tab */
.viewmode-row { display: flex; gap: 6px; margin-top: 10px; padding-bottom: 8px; }
.vm {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 999px;
  background: oklch(96% 0.01 250 / 0.5);
  font-size: 12px; font-weight: 500;
  color: oklch(45% 0.05 250);
  transition: all 150ms;
}
.vm:hover { background: oklch(93% 0.025 250 / 0.7); }
.vm.active {
  background: oklch(55% 0.2 250);
  color: white;
}
.vm-count {
  font-size: 10px;
  background: oklch(100% 0 0 / 0.4);
  padding: 1px 6px;
  border-radius: 999px;
  color: inherit;
  font-weight: 600;
}
.vm.active .vm-count { background: oklch(100% 0 0 / 0.3); }

/* v0.12: enrich 进度条颜色区分 */
.thumb-progress.enrich {
  margin-top: 6px;
  background: oklch(94% 0.04 280 / 0.5);
}
.thumb-bar.enrich-bar {
  background: linear-gradient(90deg, oklch(70% 0.18 280 / 0.5), oklch(65% 0.2 320 / 0.55));
}

/* v0.12: 卡片名字 + 收藏星 */
.card-name-row {
  display: flex; align-items: flex-start; gap: 6px;
  justify-content: space-between;
}
.card-name-row .card-name { flex: 1; }
.fav-btn {
  width: 22px; height: 22px;
  border-radius: 6px;
  font-size: 14px;
  color: oklch(60% 0.15 70);
  background: transparent;
  transition: all 150ms;
}
.fav-btn:hover { background: oklch(96% 0.05 70 / 0.5); }
.fav-btn.on { color: oklch(60% 0.2 70); }
.card-pinyin {
  font-size: 10px;
  color: oklch(58% 0.04 250);
  font-family: monospace;
  margin-top: -3px;
  margin-bottom: 4px;
  opacity: 0.75;
}
.card-desc.enriched {
  background: linear-gradient(135deg, oklch(96% 0.03 280 / 0.5), oklch(94% 0.04 250 / 0.4));
  border-left: 2.5px solid oklch(65% 0.18 280);
  padding: 6px 10px;
  border-radius: 0 6px 6px 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: oklch(30% 0.06 250);
  margin-top: 4px;
}
.card-tags {
  display: flex; gap: 4px; flex-wrap: wrap;
  margin-top: 6px;
}
.tag {
  font-size: 9px;
  padding: 1px 6px;
  background: oklch(92% 0.05 250 / 0.6);
  color: oklch(40% 0.12 250);
  border-radius: 999px;
  font-weight: 500;
}
</style>
