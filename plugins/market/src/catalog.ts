/** Shared catalog fetch — index.json is the single data plane (DEV §1). */
export interface MarketEntry {
  name: string
  slug: string
  type: string
  contains?: ('plugin' | 'skill' | 'mcp' | 'command' | 'agent' | 'hook')[]
  description?: { en?: string; zh?: string }
  category: string[]
  latestVersion?: string | null
  publishedAt?: string | null
  firstSeenAt?: string
  capabilities?: { scannedAt: string | null; findings: string[]; redFlags: string[] }
  verification?: { status: string; level?: string; verifiedAt?: string; opencodeVersion?: string }
  metrics?: { stars: number | null; npmDownloads30d: number | null }
}

export interface MarketIndex {
  version: string
  generatedAt: string
  plugins: MarketEntry[]
}

/** Default source: GitHub Pages. Overridable via plugin options later. */
export const DEFAULT_INDEX_URL =
  'https://terry2010.github.io/opencode-market-spike/index.json'

export async function fetchIndex(url = DEFAULT_INDEX_URL): Promise<MarketIndex> {
  // timeout guard — a sandboxed webview fetch that never settles must surface as an error
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
    return (await res.json()) as MarketIndex
  } finally {
    clearTimeout(t)
  }
}

/** Sorted rows for UI views (verified first, then unverified, redFlag last). */
export function rows(entries: MarketEntry[]): MarketEntry[] {
  const rank = (e: MarketEntry) =>
    e.verification?.status === 'verified' ? 0 : e.capabilities?.redFlags.length ? 2 : 1
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** Client-side search over name+description (case-insensitive substring). */
export function search(entries: MarketEntry[], q: string): MarketEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter(e =>
    e.name.toLowerCase().includes(needle) || (e.description?.en ?? '').toLowerCase().includes(needle))
}

/** Distinct categories across entries, sorted. */
function rawCategoriesOf(entries: MarketEntry[]): string[] {
  return [...new Set(entries.flatMap(e => e.category))].sort()
}

const sortKey = (e: MarketEntry, k: string): number | string => {
  switch (k) {
    case 'downloads': return -(e.metrics?.npmDownloads30d ?? 0)
    case 'stars': return -(e.metrics?.stars ?? 0)
    case 'name': return e.name
    default: { // verified first, then unverified, skipped, failed last
      const order: Record<string, number> = { verified: 0, unverified: 1, skipped: 2, failed: 3 }
      return order[e.verification?.status ?? 'unverified'] ?? 1
    }
  }
}

/** Stable sort by key — verified-first default, or metric desc, or name asc. */
export function sortEntries(entries: MarketEntry[], key: string): MarketEntry[] {
  return [...entries].sort((a, b) => {
    const ka = sortKey(a, key), kb = sortKey(b, key)
    return ka < kb ? -1 : ka > kb ? 1 : a.name.localeCompare(b.name)
  })
}

/** Redact secrets/home paths from process output for export (dsh-style). */
export function redactLog(text: string): string {
  return text
    .replace(/([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/\s:]+/g, '<home>')
    .replace(/(token|apikey|api[_-]?key|secret|password|passwd|authorization)[=:]\s*\S+/gi, '$1=<redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>')
}

/** Pick the informative lines out of a stderr blob (dsh P1-5 key-lines idea). */
export function keyLines(text: string, max = 8): string[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const interesting = lines.filter(l =>
    /error|err!|e404|eacces|enoent|not found|denied|timeout|failed|npm error|certificate|network/i.test(l))
  return (interesting.length ? interesting : lines).slice(-max)
}

export interface LocalState {
  favorites: Record<string, true>
  groups: Record<string, string>      // plugin name → group name
  notes: Record<string, string>       // plugin name → note
  devlog?: boolean                    // write detailed debug logs (default off)
  skillVers?: Record<string, string>  // pkg name → version installed via market (enables real update checks)
}
export const EMPTY_STATE: LocalState = { favorites: {}, groups: {}, notes: {} }

const LS_KEY = 'opencode-market.state.v1'
export function loadState(): LocalState {
  try { return { ...EMPTY_STATE, ...(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')) } }
  catch { return { ...EMPTY_STATE } }
}
export function saveState(s: LocalState): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}
export function allGroups(s: LocalState): string[] {
  return [...new Set(Object.values(s.groups))].sort()
}

const LS_IDX = 'opencode-market.index.v1'
const TTL_MS = 3600_000

interface CachedIndex { at: number; index: MarketIndex }

/** TTL-cached fetch with snapshot fallback (dsh registry.ts pattern). */
export async function fetchIndexCached(url = DEFAULT_INDEX_URL): Promise<MarketIndex> {
  let cached: CachedIndex | null = null
  try { cached = JSON.parse(localStorage.getItem(LS_IDX) ?? 'null') } catch { /* noop */ }
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index
  try {
    const idx = await fetchIndex(url)
    try { localStorage.setItem(LS_IDX, JSON.stringify({ at: Date.now(), index: idx })) } catch { /* quota */ }
    return idx
  } catch (e) {
    if (cached) return cached.index          // snapshot fallback beats failure
    throw e
  }
}

/** Freshness label for the UI header — "data from N min ago". */
export function indexAge(idx: MarketIndex | null): string {
  return idx?.generatedAt ? idx.generatedAt.slice(0, 16).replace('T', ' ') : ''
}

const zh = /zh/i.test(typeof navigator !== 'undefined' ? navigator.language : 'en')
/** Minimal i18n — zh/en user-facing strings. */
export type I18nKey = 'verified'|'failed'|'skipped'|'unverified'|'installed'|'search'|'back'|'loading'|'update'|'reinstall'|'add'|'cancel'|'exportLog'|'activated'|'restartNeeded'|'favorites'|'allCategories'|'allGroups'|'group'|'note'|'noMatch'|'fetchFailed'|'redFlags'|'findings'|'notSafe'|'market'
const EN: Record<I18nKey, string> = { verified: 'verified', failed: 'failed', skipped: 'skipped', unverified: 'unverified', installed: 'installed', search: 'search…', back: '← back', loading: 'loading…', update: 'update', reinstall: 'reinstall', add: 'add', cancel: 'cancel', exportLog: 'export log', activated: 'activated', restartNeeded: 'restart to activate', favorites: 'favorites', allCategories: 'all categories', allGroups: 'all groups', group: 'group', note: 'note', noMatch: 'no match', fetchFailed: 'fetch failed', redFlags: 'red flags', findings: 'findings', notSafe: 'not found — this does not mean safe', market: 'opencode market' }
const ZH: Record<I18nKey, string> = { verified: '已实测可装', failed: '装不上/加载失败', skipped: '有高危信号未跑', unverified: '未验证', installed: '已安装', search: '搜索…', back: '← 返回', loading: '加载中…', update: '更新', reinstall: '重装', add: '安装', cancel: '取消', exportLog: '导出日志', activated: '已激活', restartNeeded: '重启后生效', favorites: '收藏', allCategories: '全部分类', allGroups: '全部分组', group: '分组', note: '备注', noMatch: '没搜到', fetchFailed: '拉取失败', redFlags: '高危信号', findings: '扫描提示', notSafe: '没扫到——这不等于安全', market: 'opencode 市场' }
export function t(key: I18nKey): string {
  return (zh ? ZH : EN)[key]
}

/** Latest-version compare for the update button. */
export function hasUpdate(e: MarketEntry, installedVer?: string): boolean {
  if (!installedVer || installedVer === 'local' || !e.latestVersion) return false   // local dir installs can't compare
  return e.latestVersion !== installedVer
}

/** Does the packument look installable-as-plugin (has exports/opencode field)? */
export function looksLikePlugin(pk: { exports?: Record<string, unknown>; opencode?: unknown; main?: string } | null): 'plugin' | 'maybe' | 'no' {
  if (!pk) return 'maybe'
  if (pk.opencode) return 'plugin'
  const ex = pk.exports ?? {}
  const keys = Object.keys(ex)
  if (keys.some(k => /opencode|plugin|tui|gui|server/.test(k))) return 'plugin'
  if (pk.main || keys.length) return 'maybe'
  return 'no'
}

/** Keyword category classifier — catalog entries mostly ship category:[], so
 *  the UI derives display categories at render time (dsh-style chips). */
const CAT_RULES: [string, RegExp][] = [
  ['主题与外观', /theme|color|icon|font|appearance|ui-|css|style/i],
  ['模型与接入', /model|provider|llm|gpt|claude|deepseek|ollama|api[-_ ]key|pricing|token|usage|cost|billing/i],
  ['会话与消息', /session|chat|conversation|message|history|compaction|context/i],
  ['记忆', /memory|remember|recall|knowledge|note|persist/i],
  ['通知', /notif|alert|toast|sound|remind|bell/i],
  ['安全与权限', /secur|guard|permission|policy|audit|sandbox|auth|firewall|protect/i],
  ['开发流程', /git|commit|review|test|lint|ci|deploy|release|debug|refactor|scaffold|spec/i],
  ['工具与能力', /tool|command|search|fetch|browse|file|terminal|shell|exec|agent|skill|mcp/i],
  ['集成与移动', /integrat|qq|wechat|slack|discord|telegram|feishu|mobile|remote|browser|chrome/i],
]
export function categoriesOf(e: MarketEntry): string[] {
  if (e.category?.length) return e.category
  const hay = `${e.name} ${e.slug ?? ''} ${e.description?.en ?? ''}`
  const hits = CAT_RULES.filter(([, r]) => r.test(hay)).map(([c]) => c)
  return hits.length ? hits.slice(0, 2) : ['其他']
}
export function allCategories(entries: MarketEntry[]): string[] {
  const s = new Set<string>()
  for (const e of entries) for (const c of categoriesOf(e)) s.add(c)
  return [...s].sort()
}

/** Entries published within N days (publishedAt ?? firstSeenAt). */
export function inDays(e: MarketEntry, days: number): boolean {
  const at = Date.parse(e.publishedAt ?? e.firstSeenAt ?? '')
  return !isNaN(at) && Date.now() - at < days * 86400_000
}

// ── dev log ring buffer (localStorage, opt-in) ─────────────────────────
const LOG_KEY = 'opencode-market.devlog.v1'
export function appendLog(line: string): void {
  try {
    const cur = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as string[]
    cur.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
    localStorage.setItem(LOG_KEY, JSON.stringify(cur.slice(-300)))
  } catch { /* quota/no LS */ }
}
export function readLog(): string[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') } catch { return [] }
}
export function clearLog(): void { try { localStorage.removeItem(LOG_KEY) } catch { /* noop */ } }
