/** Shared catalog fetch — index.json is the single data plane (DEV §1). */
import { skillId } from './hostx.js'

export interface MarketEntry {
  uncataloged?: boolean
  features?: ('server' | 'tui' | 'gui' | 'rpc')[]
  name: string
  slug: string
  type: string
  contains?: ('plugin' | 'skill' | 'mcp' | 'command' | 'agent' | 'hook')[]
  description?: { en?: string; zh?: string }
  category: string[]
  latestVersion?: string | null
  publishedAt?: string | null
  firstSeenAt?: string
  /** approval state (hold-by-default index); absent = pre-approval index = legacy */
  approval?: 'approved' | 'pending' | 'legacy'
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

/** Strip C0/C1 control chars + ANSI/OSC escape sequences from untrusted index
 *  strings before they reach a terminal (B-2: index.json is raw untrusted input). */
export function sanitize(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')              // OSC ... BEL/ST
    .replace(/\x1b[@-Z\\-_]|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')          // ESC + CSI
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')                   // remaining C0/C1
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(sanitize) : []
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? sanitize(v) : null)

/** index.json is untrusted network data: drop entries without a usable
 *  name/slug, sanitize EVERY string field that can reach a terminal/DOM
 *  (incl. version/metrics timestamps/verification strings/findings), and
 *  tolerate missing array fields instead of crashing the whole catalog. */
export function sanitizeIndex(idx: MarketIndex): MarketIndex {
  const plugins = (Array.isArray(idx?.plugins) ? idx.plugins : [])
    .filter((e): e is MarketEntry => !!e && typeof e.name === 'string' && typeof e.slug === 'string')
    .map(e => {
      const caps = e.capabilities
      const v = e.verification
      return {
        ...e,
        name: sanitize(e.name),
        slug: sanitize(e.slug),
        ...(typeof e.latestVersion === 'string' ? { latestVersion: sanitize(e.latestVersion) } : {}),
        ...(typeof e.publishedAt === 'string' ? { publishedAt: sanitize(e.publishedAt) } : {}),
        ...(typeof e.firstSeenAt === 'string' ? { firstSeenAt: sanitize(e.firstSeenAt) } : {}),
        ...(e.description
          ? { description: { ...(e.description.en ? { en: sanitize(e.description.en) } : {}), ...(e.description.zh ? { zh: sanitize(e.description.zh) } : {}) } }
          : {}),
        category: strArr(e.category),
        ...(Array.isArray(e.features) ? { features: e.features.filter((f): f is NonNullable<MarketEntry['features']>[number] => ['server', 'tui', 'gui', 'rpc'].includes(String(f))) } : {}),
        ...(caps ? { capabilities: { scannedAt: strOrNull(caps.scannedAt), findings: strArr(caps.findings), redFlags: strArr(caps.redFlags) } } : {}),
        ...(v ? { verification: {
            status: typeof v.status === 'string' ? sanitize(v.status) : '',
            ...(typeof v.level === 'string' ? { level: sanitize(v.level) } : {}),
            ...(typeof v.verifiedAt === 'string' ? { verifiedAt: sanitize(v.verifiedAt) } : {}),
            ...(typeof v.opencodeVersion === 'string' ? { opencodeVersion: sanitize(v.opencodeVersion) } : {}),
          } } : {}),
      }
    })
  return { ...idx, plugins }
}

/** User-visible entries only — pending (under-review) entries never reach the
 *  UI or install paths. Absent approval = old index = treat as visible (legacy). */
export function isVisible(e: MarketEntry): boolean {
  return e.approval !== 'pending'
}

/** The npm spec users should install: pinned to the catalog-approved version
 *  so `plugin add` resolves exactly what review passed (implicit-latest is a
 *  bypass — a pending version must never reach a user machine). A version
 *  with anything outside semver-ish chars is index-corruption, not a pin —
 *  fall back to the bare name rather than building an unsafe spec. */
const VER_SAFE = /^[A-Za-z0-9._+~-]+$/
export function pinSpec(e: Pick<MarketEntry, 'name' | 'latestVersion'>): string {
  return e.latestVersion && VER_SAFE.test(e.latestVersion) ? `${e.name}@${e.latestVersion}` : e.name
}

/** Tarball URL for the catalog-APPROVED version only — never dist-tags.latest:
 *  latest is the pendingUpdate users must not receive yet (hold semantics).
 *  All skill-install paths (TUI, GUI, site catalog) go through this rule.
 *  https only — a packument-returned http: (or odder scheme) is rejected. */
export function approvedTarballUrl(
  pk: { versions?: Record<string, { dist?: { tarball?: string } }> },
  e: Pick<MarketEntry, 'latestVersion'>,
): string | null {
  if (!e.latestVersion) return null
  const url = pk.versions?.[e.latestVersion]?.dist?.tarball
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null
}

export async function fetchIndex(url = DEFAULT_INDEX_URL): Promise<MarketIndex> {
  // timeout guard — a sandboxed webview fetch that never settles must surface as an error
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
    const idx = sanitizeIndex((await res.json()) as MarketIndex)
    return { ...idx, plugins: idx.plugins.filter(isVisible) }
  } finally {
    clearTimeout(t)
  }
}

/** Sorted rows for UI views (verified first, then unverified, redFlag last). */
export function rows(entries: MarketEntry[]): MarketEntry[] {
  const rank = (e: MarketEntry) =>
    e.verification?.status === 'verified' ? 0 : e.capabilities?.redFlags?.length ? 2 : 1
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** Client-side search over name+description (case-insensitive substring). */
export function search(entries: MarketEntry[], q: string): MarketEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter(e =>
    e.name.toLowerCase().includes(needle) || (e.description?.en ?? '').toLowerCase().includes(needle))
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
  lang?: LangMode                     // UI language override (default 'auto' → navigator.language)
  skillVers?: Record<string, string>  // pkg name → version installed via market (enables real update checks)
}
export const EMPTY_STATE: LocalState = { favorites: {}, groups: {}, notes: {} }

const LS_KEY = 'opencode-market.state.v1'
export function loadState(): LocalState {
  try { return { ...EMPTY_STATE, ...sanitizeState(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')) } }
  catch { return { ...EMPTY_STATE } }
}

/** Validate a backup/storage blob → LocalState. Rejects non-object roots and
 *  malformed field shapes (backup paste / corrupt localStorage / hostile
 *  index-adjacent JSON must not poison groups/notes/skillVers). */
export function sanitizeState(x: unknown): LocalState {
  const s: LocalState = { favorites: {}, groups: {}, notes: {} }
  if (typeof x !== 'object' || x === null) return s
  const o = x as Record<string, unknown>
  const strMap = (v: unknown): Record<string, string> =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, val]) => typeof val === 'string'))
      : {}
  const fav = o.favorites
  s.favorites = fav && typeof fav === 'object' && !Array.isArray(fav)
    ? Object.fromEntries(Object.entries(fav).filter(([, v]) => !!v).map(([k]) => [k, true as const]))
    : {}
  s.groups = strMap(o.groups)
  s.notes = strMap(o.notes)
  s.skillVers = strMap(o.skillVers)
  if (typeof o.devlog === 'boolean') s.devlog = o.devlog
  if (o.lang === 'auto' || o.lang === 'zh' || o.lang === 'en') s.lang = o.lang
  return s
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
export async function fetchIndexCached(url = DEFAULT_INDEX_URL, force = false): Promise<MarketIndex> {
  let cached: CachedIndex | null = null
  try { cached = JSON.parse(localStorage.getItem(LS_IDX) ?? 'null') } catch { /* noop */ }
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.index
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

/** Minimal i18n — zh/en user-facing strings. */
import { createSignal } from 'solid-js'

export type LangMode = 'auto' | 'zh' | 'en'
export const [langMode, setLangMode] = createSignal<LangMode>('auto')
const browserZh = () => /zh/i.test(typeof navigator !== 'undefined' ? navigator.language : 'en')
const zhNow = () => langMode() === 'auto' ? browserZh() : langMode() === 'zh'

export type I18nKey = 'verified'|'failed'|'skipped'|'unverified'|'noInstallTarget'|'installed'|'search'|'back'|'loading'|'update'|'reinstall'|'add'|'cancel'|'exportLog'|'activated'|'restartNeeded'|'favorites'|'allCategories'|'allGroups'|'group'|'note'|'noMatch'|'fetchFailed'|'redFlags'|'findings'|'notSafe'|'market'|'uninstall'|'confirmUninstall'|'retry'|'loadMore'|'lang'|'langAuto'|'langZh'|'langEn'
const EN: Record<I18nKey, string> = { verified: 'verified', failed: 'failed', skipped: 'skipped', unverified: 'unverified', noInstallTarget: 'no installable package', installed: 'installed', search: 'search…', back: '← back', loading: 'loading…', update: 'update', reinstall: 'reinstall', add: 'add', cancel: 'cancel', exportLog: 'export log', activated: 'activated', restartNeeded: 'restart to activate', favorites: 'favorites', allCategories: 'all categories', allGroups: 'all groups', group: 'group', note: 'note', noMatch: 'no match', fetchFailed: 'fetch failed', redFlags: 'red flags', findings: 'findings', notSafe: 'not found — this does not mean safe', market: 'opencode market', uninstall: 'uninstall', confirmUninstall: 'confirm uninstall?', retry: 'retry', loadMore: 'load more', lang: 'language', langAuto: 'system', langZh: '中文', langEn: 'English' }
// AGENTS.md 检验规则：状态文案必须用规约原话，不能自造弱化版
const ZH: Record<I18nKey, string> = { verified: '已实测可装可用', failed: '装不上或加载失败', skipped: '有高危信号没跑', unverified: '还没验', noInstallTarget: '没有可安装的包', installed: '已安装', search: '搜索…', back: '← 返回', loading: '加载中…', update: '更新', reinstall: '重装', add: '安装', cancel: '取消', exportLog: '导出日志', activated: '已激活', restartNeeded: '重启后生效', favorites: '收藏', allCategories: '全部分类', allGroups: '全部分组', group: '分组', note: '备注', noMatch: '没搜到', fetchFailed: '拉取失败', redFlags: '高危信号', findings: '扫描提示', notSafe: '没扫到——这不等于安全', market: 'opencode 市场', uninstall: '卸载', confirmUninstall: '确认卸载？', retry: '重试', loadMore: '加载更多', lang: '语言', langAuto: '跟随系统', langZh: '中文', langEn: 'English' }
export function t(key: I18nKey): string {
  return (zhNow() ? ZH : EN)[key]
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
  ['开发流程', /git|commit|review|test|lint|ci|deploy|release|debug|refactor|scaffold|spec|project|template|starter|suite|kit|workflow|task[-_ ]?runner/i],
  ['工具与能力', /tool|command|search|fetch|browse|file|terminal|shell|exec|agent|skill|mcp|manage|track|monitor|watch|dashboard|status|quota|limit|metric/i],
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

// ── installed skill detection ────────────────────────────────────────────
/** Scan skill source dirs → `__skill_<id>` keys. `ls`/`hasFile` are injected so
 *  this stays environment-neutral (main injects node:fs; tests inject fakes).
 *  A dir counts when it has any non-hidden content — marketplace packages keep
 *  their `<basename>` dir as an install marker even after skills are lifted to
 *  the source root. Top-level .md files are file-skills. Hidden dirs and _dl
 *  staging are skipped (opencode semantics). */
export function scanSkillKeys(bases: string[], ls: (dir: string) => string[], hasFile: (p: string) => boolean): Record<string, string> {
  const map: Record<string, string> = {}
  for (const base of bases) {
    let names: string[]
    try { names = ls(base) } catch { continue }
    for (const d of names) {
      if (d.startsWith('.') || d.startsWith('_')) continue
      if (d.endsWith('.md')) { map[`__skill_${d.slice(0, -3)}`] = 'local'; continue }
      let kids: string[] = []
      try { kids = ls(`${base}/${d}`).filter(k => !k.startsWith('.')) } catch { /* a file */ }
      if (kids.length || hasFile(`${base}/${d}/SKILL.md`)) map[`__skill_${d}`] = 'local'
    }
  }
  return map
}

/** Installed-version lookup for a skill package: plugin key, `__skill_<id>`
 *  dir key (namespaced when a same-basename package was present, else the
 *  bare basename), or `<id>-*` sibling dirs for lifted multi-skill packages. */
export function skillInstalledVer(installed: Record<string, string>, pkgName: string): string | undefined {
  const base = `__skill_${skillId(pkgName)}`
  if (installed[pkgName]) return installed[pkgName]
  if (installed[base]) return installed[base]
  const bare = `__skill_${pkgName.split('/').pop() ?? pkgName}`
  if (bare !== base && installed[bare]) return installed[bare]
  const keys = Object.keys(installed)
  if (keys.some(k => k.startsWith(`${base}-`))) return 'local'
  if (bare !== base && keys.some(k => k.startsWith(`${bare}-`))) return 'local'
  return undefined
}

// ── dev log ring buffer (localStorage, opt-in) ─────────────────────────
const LOG_KEY = 'opencode-market.devlog.v1'
export function appendLog(line: string): void {
  try {
    const cur = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as string[]
    cur.push(`${new Date().toLocaleString('sv-SE')} ${line}`)
    localStorage.setItem(LOG_KEY, JSON.stringify(cur.slice(-300)))
  } catch { /* quota/no LS */ }
}
export function readLog(): string[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') } catch { return [] }
}
export function clearLog(): void { try { localStorage.removeItem(LOG_KEY) } catch { /* noop */ } }
