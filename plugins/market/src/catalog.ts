/** Shared catalog fetch — index.json is the single data plane (DEV §1). */
import { skillId } from './hostx.js'

export interface MarketEntry {
  uncataloged?: boolean
  features?: ('server' | 'tui' | 'gui' | 'rpc')[]
  name: string
  slug: string
  type: string
  source?: { kind?: string; id?: string; repo?: string; version?: string }
  aliases?: string[]
  contains?: ('plugin' | 'skill' | 'mcp' | 'command' | 'agent' | 'hook')[]
  description?: { en?: string; zh?: string }
  category: string[]
  latestVersion?: string | null
  /** SRI of the approved-version artifact — install drift check */
  integrity?: string | null
  modifiedAt?: string | null           // github-kind: pushedAt = version marker
  publishedAt?: string | null
  firstSeenAt?: string
  createdAt?: string | null            // packument birth — re-registration signal
  license?: string | null
  deprecated?: boolean
  deprecatedMessage?: string | null
  replacement?: string | null          // parsed from deprecatedMessage upstream
  maintainers?: string[]
  compat?: { engines?: string; peer?: string }
  /** held-back newer version (hold-by-default) — display only, never installed */
  pendingUpdate?: { version?: string; heldAt?: string; reason?: string; verification?: { status?: string } } | null
  /** approval state (hold-by-default index); absent = pre-approval index = legacy */
  approval?: 'approved' | 'pending' | 'legacy'
  capabilities?: { scannedAt: string | null; findings: string[]; redFlags: string[] }
  verification?: { status: string; level?: string; verifiedAt?: string; opencodeVersion?: string; runUrl?: string; logExcerpt?: string }
  metrics?: { stars: number | null; npmDownloads30d: number | null }
  /** npm dist-tags as published (latest/beta/…) — display-only context; the
   *  install pin always comes from latestVersion, never dist-tags.latest */
  distTags?: Record<string, string>
}

/** Tombstone — an entry that disappeared from the catalog with a recorded cause. */
export interface RemovedEntry { slug?: string; name?: string; disappearedAt?: string; reason?: string }

export interface MarketIndex {
  version: string
  generatedAt: string
  /** bilingual category dictionary shipped by the pipeline — display names for
   *  category ids; consulted by catLabel before the hardcoded fallback table */
  categories?: Record<string, { en?: string; zh?: string }>
  plugins: MarketEntry[]
  removed?: RemovedEntry[]
}

export const VERIFICATION_STATUSES = ['verified', 'unverified', 'skipped', 'failed'] as const

/** Default source: GitHub Pages. Overridable via plugin options later. */
export const DEFAULT_INDEX_URL =
  'https://terry2010.github.io/awesome-opencode-market/index.json'

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
      const pu = e.pendingUpdate
      return {
        ...e,
        name: sanitize(e.name),
        slug: sanitize(e.slug),
        ...(typeof e.latestVersion === 'string' ? { latestVersion: sanitize(e.latestVersion) } : {}),
        ...(typeof e.publishedAt === 'string' ? { publishedAt: sanitize(e.publishedAt) } : {}),
        ...(typeof e.firstSeenAt === 'string' ? { firstSeenAt: sanitize(e.firstSeenAt) } : {}),
        ...(typeof e.createdAt === 'string' ? { createdAt: sanitize(e.createdAt) } : {}),
        ...(typeof e.license === 'string' ? { license: sanitize(e.license) } : {}),
        ...(typeof e.deprecatedMessage === 'string' ? { deprecatedMessage: sanitize(e.deprecatedMessage) } : {}),
        ...(typeof e.replacement === 'string' ? { replacement: sanitize(e.replacement) } : {}),
        ...(Array.isArray(e.maintainers) ? { maintainers: strArr(e.maintainers) } : {}),
        ...(e.compat && typeof e.compat === 'object' ? { compat: {
            ...(typeof e.compat.engines === 'string' ? { engines: sanitize(e.compat.engines) } : {}),
            ...(typeof e.compat.peer === 'string' ? { peer: sanitize(e.compat.peer) } : {}),
          } } : {}),
        ...(e.description
          ? { description: { ...(e.description.en ? { en: sanitize(e.description.en) } : {}), ...(e.description.zh ? { zh: sanitize(e.description.zh) } : {}) } }
          : {}),
        category: strArr(e.category),
        ...(Array.isArray(e.aliases) ? { aliases: strArr(e.aliases) } : {}),
        ...(typeof e.integrity === 'string' ? { integrity: sanitize(e.integrity) } : {}),
        ...(typeof e.modifiedAt === 'string' ? { modifiedAt: sanitize(e.modifiedAt) } : {}),
        ...(pu && typeof pu === 'object'
          ? { pendingUpdate: {
              ...(typeof pu.version === 'string' ? { version: sanitize(pu.version) } : {}),
              ...(typeof pu.heldAt === 'string' ? { heldAt: sanitize(pu.heldAt) } : {}),
              ...(typeof pu.reason === 'string' ? { reason: sanitize(pu.reason) } : {}),
              ...(pu.verification && typeof pu.verification === 'object' && typeof pu.verification.status === 'string'
                ? { verification: { status: sanitize(pu.verification.status) } }
                : {}),
            } }
          : {}),
        ...(e.source ? { source: {
            ...(typeof e.source.kind === 'string' ? { kind: sanitize(e.source.kind) } : {}),
            ...(typeof e.source.id === 'string' ? { id: sanitize(e.source.id) } : {}),
            ...(typeof e.source.repo === 'string' ? { repo: sanitize(e.source.repo) } : {}),
            ...(typeof e.source.version === 'string' ? { version: sanitize(e.source.version) } : {}),
          } } : {}),
        ...(Array.isArray(e.features) ? { features: e.features.filter((f): f is NonNullable<MarketEntry['features']>[number] => ['server', 'tui', 'gui', 'rpc'].includes(String(f))) } : {}),
        ...(e.distTags && typeof e.distTags === 'object' && !Array.isArray(e.distTags)
          ? { distTags: Object.fromEntries(Object.entries(e.distTags as Record<string, unknown>).filter((kv): kv is [string, string] => typeof kv[1] === 'string').map(([k, v]) => [sanitize(k), sanitize(v)])) }
          : {}),
        ...(caps ? { capabilities: { scannedAt: strOrNull(caps.scannedAt), findings: strArr(caps.findings), redFlags: strArr(caps.redFlags) } } : {}),
        ...(v ? { verification: {
            // enum-clamped, not just sanitized — a crafted status must not
            // produce an empty badge (t() lookup of an arbitrary string)
            status: typeof v.status === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(v.status) ? v.status : 'unverified',
            ...(typeof v.level === 'string' ? { level: sanitize(v.level) } : {}),
            ...(typeof v.verifiedAt === 'string' ? { verifiedAt: sanitize(v.verifiedAt) } : {}),
            ...(typeof v.opencodeVersion === 'string' ? { opencodeVersion: sanitize(v.opencodeVersion) } : {}),
            ...(typeof v.runUrl === 'string' ? { runUrl: sanitize(v.runUrl) } : {}),
            ...(typeof v.logExcerpt === 'string' ? { logExcerpt: sanitize(v.logExcerpt) } : {}),
          } } : {}),
      }
    })
  const categories: MarketIndex['categories'] = {}
  if (idx?.categories && typeof idx.categories === 'object')
    for (const [k, v] of Object.entries(idx.categories)) {
      if (!v || typeof v !== 'object') continue
      const c = v as { en?: unknown; zh?: unknown }
      categories[k] = { ...(typeof c.en === 'string' ? { en: sanitize(c.en) } : {}), ...(typeof c.zh === 'string' ? { zh: sanitize(c.zh) } : {}) }
    }
  const removed = (Array.isArray(idx?.removed) ? idx.removed : [])
    .filter((r): r is RemovedEntry => !!r && typeof r === 'object' && (typeof r.name === 'string' || typeof r.slug === 'string'))
    .map(r => ({
      ...(typeof r.slug === 'string' ? { slug: sanitize(r.slug) } : {}),
      ...(typeof r.name === 'string' ? { name: sanitize(r.name) } : {}),
      ...(typeof r.disappearedAt === 'string' ? { disappearedAt: sanitize(r.disappearedAt) } : {}),
      ...(typeof r.reason === 'string' ? { reason: sanitize(r.reason) } : {}),
    }))
  return {
    ...idx,
    // top-level strings reach the TUI header via indexAge — sanitize too
    generatedAt: typeof idx?.generatedAt === 'string' ? sanitize(idx.generatedAt) : '',
    categories,
    plugins,
    removed,
  }
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
 *  throwing beats falling back to the bare name, which would resolve
 *  dist-tags.latest (the UNAPPROVED pending version) and silently bypass
 *  the hold gate. */
const VER_SAFE = /^[A-Za-z0-9._+~-]+$/
export function pinSpec(e: Pick<MarketEntry, 'name' | 'latestVersion'>): string {
  if (e.latestVersion && !VER_SAFE.test(e.latestVersion))
    throw new Error(`unsafe version in catalog entry: ${e.latestVersion.slice(0, 40)}`)
  return e.latestVersion ? `${e.name}@${e.latestVersion}` : e.name
}

/** Minimal npm packument shape the client reads — dist.integrity feeds the
 *  post-download drift check (the bytes the catalog reviewed). */
export interface Packument { versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }> }

/** Tarball URL for the catalog-APPROVED version only — never dist-tags.latest:
 *  latest is the pendingUpdate users must not receive yet (hold semantics).
 *  All skill-install paths (TUI, GUI, site catalog) go through this rule.
 *  https only — a packument-returned http: (or odder scheme) is rejected. */
export function approvedTarballUrl(
  pk: Packument,
  e: Pick<MarketEntry, 'latestVersion'>,
): string | null {
  if (!e.latestVersion) return null
  const url = pk.versions?.[e.latestVersion]?.dist?.tarball
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null
}

export async function fetchIndex(url = DEFAULT_INDEX_URL): Promise<MarketIndex> {
  // delegates to the sha-verified path — a plain fetch+parse must not exist
  // as a way to bypass the published-manifest check (S-14)
  return fetchIndexCached(url, /*force*/ true)
}

// ── index URL resolution + manifest-first fetch ──────────────────────────
/** catalog URL: https anywhere, http ONLY on loopback — a local dev index
 *  (http://localhost:8000/index.json) is a legitimate dev loop; anything else
 *  plaintext stays rejected. */
const INDEX_URL_RE = /^https:\/\/\S+$/
const LOOPBACK_INDEX_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/
export function isIndexUrl(u: unknown): u is string {
  return typeof u === 'string' && (INDEX_URL_RE.test(u) || LOOPBACK_INDEX_RE.test(u))
}
/** catalog source: opencode.json plugin options > env > published default. */
export function resolveIndexUrl(options?: { indexUrl?: unknown } | null): string {
  const o = options?.indexUrl
  if (isIndexUrl(o)) return o
  try {
    const env = (globalThis as { process?: { env?: { OPENCODE_MARKET_INDEX?: string } } }).process?.env?.OPENCODE_MARKET_INDEX
    if (isIndexUrl(env)) return env
  } catch { /* webview has no process */ }
  return DEFAULT_INDEX_URL
}
/** health.json sits next to index.json — the sha256 manifest the conditional
 *  fetch checks before pulling the multi-MB index. */
export function healthUrl(indexUrl: string): string {
  try { return new URL('health.json', indexUrl).href } catch { return '' }
}
/** HTTP skill catalog endpoint — same site root, `skills/` namespace. */
export function skillsUrl(indexUrl: string): string {
  try { return new URL('skills/', indexUrl).href } catch {
    return 'https://terry2010.github.io/awesome-opencode-market/skills/'
  }
}
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

/** Client-side search — name hits rank above alias hits above description hits
 *  (a "session" query should surface the packages CALLED session first);
 *  aliases cover renamed packages. Case-insensitive substring. */
export function search(entries: MarketEntry[], q: string): MarketEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return entries
  const rank = (e: MarketEntry): number =>
    e.name.toLowerCase().includes(needle) ? 0
    : (e.aliases ?? []).some(a => a.toLowerCase().includes(needle)) || (e.slug ?? '').toLowerCase().includes(needle) ? 1
    : (e.description?.en ?? '').toLowerCase().includes(needle) || (e.description?.zh ?? '').toLowerCase().includes(needle) ? 2
    : 3
  return entries
    .map(e => [rank(e), e] as const)
    .filter(([r]) => r < 3)
    .sort(([ra, a], [rb, b]) => ra - rb || a.name.localeCompare(b.name))
    .map(([, e]) => e)
}

const sortKey = (e: MarketEntry, k: string): number | string => {
  switch (k) {
    case 'downloads': return -(e.metrics?.npmDownloads30d ?? 0)
    case 'stars': return -(e.metrics?.stars ?? 0)
    case 'name': return e.name
    default: { // verified first, then unverified, skipped, failed — flagged sink to
      // the very bottom (DATA-FLOWS contract: verified 优先·红旗沉底); a
      // red-flagged entry is demoted below every unflagged one regardless of
      // verification status
      if (e.capabilities?.redFlags?.length) return 9
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
  devlog?: boolean                    // write detailed debug logs (default off)
  lang?: LangMode                     // UI language override (default 'auto' → navigator.language)
  skillVers?: Record<string, string>  // pkg name → version installed via market (enables real update checks)
}
export const EMPTY_STATE: LocalState = { favorites: {} }

const LS_KEY = 'opencode-market.state.v1'
export function loadState(): LocalState {
  try { return { ...EMPTY_STATE, ...sanitizeState(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')) } }
  catch { return { ...EMPTY_STATE } }
}

/** Validate a backup/storage blob → LocalState. Rejects non-object roots and
 *  malformed field shapes (backup paste / corrupt localStorage / hostile
 *  index-adjacent JSON must not poison groups/notes/skillVers). */
export function sanitizeState(x: unknown): LocalState {
  const s: LocalState = { favorites: {} }
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
  s.skillVers = strMap(o.skillVers)
  if (typeof o.devlog === 'boolean') s.devlog = o.devlog
  if (o.lang === 'auto' || o.lang === 'zh' || o.lang === 'en') s.lang = o.lang
  return s
}
export function saveState(s: LocalState): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}


const LS_IDX = 'opencode-market.index.v1'
const TTL_MS = 3600_000

interface CachedIndex { at: number; index: MarketIndex; sha?: string }

/** Storage backend — localStorage in the webview; a module-level slot on
 *  Node (TUI/main have no localStorage, so without this every dialog open
 *  refetches the full index). In-memory still honors TTL + snapshot fallback
 *  within the process lifetime. */
// resolved per call — the webview can expose localStorage after module load,
// and tests swap globalThis.localStorage between cases (N-9)
const lsIdx = (): Storage | null => {
  try { const l = globalThis.localStorage; if (l) { l.getItem(LS_IDX); return l } } catch { /* node or disabled */ }
  return null
}
let memIdx: CachedIndex | null = null
const readIdxCache = (): CachedIndex | null => {
  try { const l = lsIdx(); return l ? JSON.parse(l.getItem(LS_IDX) ?? 'null') as CachedIndex | null : memIdx } catch { return null }
}
const writeIdxCache = (c: CachedIndex) => {
  const l = lsIdx()
  if (l) { try { l.setItem(LS_IDX, JSON.stringify(c)) } catch { /* quota */ } }
  else memIdx = c
}

/** What the last fetchIndexCached call did — UIs can say "already latest"
 *  instead of pretending a refresh happened. */
export type FetchOutcome = 'first' | 'updated' | 'fresh' | 'stale' | 'mismatch'
let lastOutcome: FetchOutcome = 'first'
export const fetchOutcome = (): FetchOutcome => lastOutcome

/** Manifest-first cached fetch: the tiny health.json carries the published
 *  index's sha256 — an unchanged catalog costs ~100 bytes, not a multi-MB
 *  re-download. On a moved hash the downloaded bytes are hashed and compared,
 *  so CDN edge staleness can't pin a mismatched pair into the cache. If the
 *  manifest is unreachable the code falls back to plain TTL behavior. */
/** index.json is untrusted input — bound the download before parsing so a
 *  hostile/broken custom indexUrl can't balloon the webview/main memory. */
export const MAX_INDEX_BYTES = 32 * 1024 * 1024

export async function fetchIndexCached(url = DEFAULT_INDEX_URL, force = false): Promise<MarketIndex> {
  const cached = readIdxCache()
  let healthSha: string | null = null
  const hUrl = healthUrl(url)
  if (hUrl) {
    try {
      const res = await fetch(hUrl, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const htext = await res.text()
        if (htext.length > 1_000_000) throw new Error('health.json too large')
        const h = JSON.parse(htext) as { sha256?: unknown }
        if (typeof h.sha256 === 'string' && /^[0-9a-f]{64}$/.test(h.sha256)) healthSha = h.sha256
      }
    } catch { /* manifest missing → fall back to full fetch */ }
  }
  if (healthSha && cached?.sha === healthSha) {
    writeIdxCache({ ...cached, at: Date.now() })
    lastOutcome = 'fresh'
    return cached.index
  }
  // a moved manifest hash means the publication changed — fresher data beats
  // the TTL heuristic, so only hash-stable or manifest-less caches skip on TTL
  const moved = !!(healthSha && cached?.sha && cached.sha !== healthSha)
  if (!force && !moved && cached && Date.now() - cached.at < TTL_MS) {
    lastOutcome = 'fresh'
    return cached.index
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
    const cl = Number(res.headers.get('content-length') ?? 0)
    if (cl > MAX_INDEX_BYTES) throw new Error(`catalog index too large (${cl} bytes)`)
    const text = await res.text()
    if (text.length > MAX_INDEX_BYTES) throw new Error(`catalog index too large (${text.length} bytes)`)
    let sha: string | undefined
    if (healthSha) {
      const got = await sha256Hex(text)
      if (got && got !== healthSha) {
        // the edge node served bytes older/newer than the announced manifest —
        // refuse to cache a pair we can't prove belongs together
        lastOutcome = 'mismatch'
        if (cached) return cached.index
        throw new Error('catalog hash mismatch — published manifest and index disagree; retry shortly')
      }
      // subtle crypto unavailable → can't verify, don't pin the pair either
      sha = got ?? undefined
    }
    const idx = sanitizeIndex(JSON.parse(text) as MarketIndex)
    const out = { ...idx, plugins: idx.plugins.filter(isVisible) }
    setCatDict(out.categories)
    writeIdxCache({ at: Date.now(), index: out, ...(sha ? { sha } : {}) })
    lastOutcome = cached ? 'updated' : 'first'
    return out
  } catch (e) {
    if (lastOutcome !== 'mismatch') lastOutcome = cached ? 'stale' : lastOutcome
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

export type I18nKey =
  'verified'|'failed'|'skipped'|'unverified'|'noInstallTarget'|'installed'|'search'|'back'|'loading'|'update'|'reinstall'|'add'|'cancel'|'exportLog'|'activated'|'restartNeeded'|'favorites'|'allCategories'|'noMatch'|'fetchFailed'|'redFlags'|'findings'|'notSafe'|'market'|'uninstall'|'confirmUninstall'|'retry'|'loadMore'|'lang'|'langAuto'|'langZh'|'langEn'|
  'partsHint'|'installing'|'installFailed'|'failedRetry'|'verifying'|'installedPending'|'skill'|'plugin'|'uncataloged'|'updateAll'|'needRestartDesk'|'allLatest'|'updatingN'|'updatedOk'|'updatedMix'|
  'tabDiscover'|'tabPlugins'|'tabSkills'|'tabFavorites'|'tabInstalled'|'tabMySkills'|'tabAdvanced'|'filter'|'sortField'|'sortDownloads'|'sortStars'|'sortName'|'sortVerified'|'sortDirLabel'|'sortDesc'|'sortAsc'|'publishRange'|'rangeAll'|'range1d'|'range7d'|'range30d'|'range90d'|'range1y'|'allN'|
  'refreshData'|'refreshing'|'refreshedN'|'refreshFailed'|'timeout25'|'backupRestore'|'backupDesc'|'exportBackup'|'exportedN'|'pasteBackup'|'restore'|'restored'|'restoreInvalid'|'clearData'|'confirmClear'|'cleared'|'devlogLabel'|'devlogDesc'|'noLogs'|'clearLogs'|
  'cat'|'keysHint'|'menuSettings'|'exportBackupTui'|'restoreTui'|'restorePrompt'|'clearDataTui'|'confirmClearTui'|'clearConfirm'|'devlogTui'|'devlogOn'|'devlogOff'|'viewLogs'|'devlogMenu'|'useHttpCatalog'|'retryKey'|'updateN'|'confirmEnter'|
  'all'|'expand'|'installingN'|'updatedN'|'removedN'|'installFailN'|'uninstallFail'|'uninstallPartial'|'updateFail'|'exportFail'|'restoreFail'|'catalogFail'|'catalogAlready'|'catalogEnabled'|'cancelled'|'heldReview'|'dataFresh'|'integrityFail'|
  'deprecated'|'replacedBy'|'legacy'|'removedFrom'|'reasonNpm404'|'reasonRepo404'|'reasonFiltered'|'reasonCapped'|'reasonManual'|'reasonUnknown'|'viewOnSite'|'compat'|'heldReason'|'verifyLevel'|'verifyLog'|'verifyRun'|'permTitle'|'permAllow'|'permAsk'|'permDeny'|'permOff'|'disable'|'revertTo'|'featFilter'|'installRunning'|'catalogDisabled'
const EN: Record<I18nKey, string> = { verified: 'verified', failed: 'failed', skipped: 'skipped', unverified: 'unverified', noInstallTarget: 'no installable package', installed: 'installed', search: 'search…', back: '← back', loading: 'loading…', update: 'update', reinstall: 'reinstall', add: 'add', cancel: 'cancel', exportLog: 'export log', activated: 'activated', restartNeeded: 'restart to activate', favorites: 'favorites', allCategories: 'all categories', noMatch: 'no match', fetchFailed: 'fetch failed', redFlags: 'red flags', findings: 'findings', notSafe: 'not found — this does not mean safe', market: 'opencode market', uninstall: 'uninstall', confirmUninstall: 'confirm uninstall?', retry: 'retry', loadMore: 'load more', lang: 'language', langAuto: 'system', langZh: '中文', langEn: 'English',
  partsHint: '{k} parts (multi-select)', installing: 'installing…', installFailed: 'install failed', failedRetry: 'failed — retry', verifying: 'verifying…', installedPending: 'installed (verify pending)', skill: 'skill', plugin: 'plugin', uncataloged: 'uncataloged', updateAll: 'update all', needRestartDesk: 'restart desktop required', allLatest: 'all up to date', updatingN: 'updating {n}/{total}…', updatedOk: 'updated {ok}', updatedMix: 'updated {ok}, {fail} failed',
  tabDiscover: 'discover', tabPlugins: 'plugins', tabSkills: 'skills', tabFavorites: 'favorites', tabInstalled: 'my plugins', tabMySkills: 'my skills', tabAdvanced: 'settings', filter: 'filter', sortField: 'sort by', sortDownloads: 'npm downloads (30d)', sortStars: 'stars', sortName: 'name', sortVerified: 'verification', sortDirLabel: 'direction', sortDesc: 'descending', sortAsc: 'ascending', publishRange: 'published', rangeAll: 'all time', range1d: 'last 1 day', range7d: 'last 7 days', range30d: 'last 30 days', range90d: 'last 90 days', range1y: 'last year', allN: 'all({n})',
  refreshData: 'refresh data (force index reload)', refreshing: 'refreshing…', refreshedN: 'refreshed {n} entries', refreshFailed: 'refresh failed: {err}', timeout25: 'timeout 25s', backupRestore: 'backup & restore', backupDesc: 'favorites live in localStorage. Export a backup as JSON; paste it back to restore.', exportBackup: 'export backup', exportedN: 'exported {file}', pasteBackup: 'paste backup JSON…', restore: 'restore', restored: 'restored', restoreInvalid: 'restore failed: not a valid backup JSON', clearData: 'clear data', confirmClear: 'clear all favorites?', cleared: 'cleared', devlogLabel: 'dev log', devlogDesc: 'record debug logs (install stages + errors, stored locally)', noLogs: 'no logs yet', clearLogs: 'clear logs',
  cat: 'category', keysHint: '←↑↓→/hjkl select · enter detail · i install · u uninstall · * fav · / search · f filter · c category · 1-7/tab switch · esc back', menuSettings: 'settings', exportBackupTui: 'export backup → ~/opencode-market-backup.json', restoreTui: 'restore (enter backup file path)', restorePrompt: 'restore', clearDataTui: 'clear data (favorites)', confirmClearTui: 'clear data — irreversible, confirm?', clearConfirm: '✗ clear', devlogTui: 'dev log', devlogOn: 'on', devlogOff: 'off', viewLogs: 'view logs', devlogMenu: 'dev log (esc to close)', useHttpCatalog: 'use HTTP catalog source', retryKey: 'press {key} to retry', updateN: 'updating {n} items…', confirmEnter: 'enter confirm · esc cancel',
  all: 'all', expand: 'expand', installingN: 'installing {name}…', updatedN: '{name} updated', removedN: '{name} removed', installFailN: '{name} install failed{exit} — press {key} to retry', uninstallFail: 'uninstall failed: {err} — press {key} to retry', uninstallPartial: '{name} removed — skill dir kept: {err}', updateFail: 'update failed: {err}', exportFail: 'export failed: {err}', restoreFail: 'restore failed: {err} — check the backup file and retry', catalogFail: 'catalog source failed: {err} — check {cfg} and retry', catalogAlready: 'already enabled', catalogEnabled: 'enabled', cancelled: 'cancelled', heldReview: 'v{v} pending review — not installable yet', dataFresh: 'already up to date', integrityFail: 'downloaded bytes do not match the reviewed artifact — retry, or report if it persists',
  deprecated: 'deprecated', replacedBy: 'use {name} instead', legacy: 'legacy', removedFrom: 'removed from catalog', reasonNpm404: 'gone from npm', reasonRepo404: 'repository gone', reasonFiltered: 'filtered out', reasonCapped: 'over catalog cap', reasonManual: 'removed by maintainer', reasonUnknown: 'reason unknown', viewOnSite: 'view on site', compat: 'requires', heldReason: 'reason', verifyLevel: 'level', verifyLog: 'verify log', verifyRun: 'verify run', permTitle: 'skill permissions', permAllow: 'allow', permAsk: 'ask', permDeny: 'deny', permOff: 'clear', disable: 'disable', revertTo: 'revert to approved', featFilter: 'parts', installRunning: 'install already running', catalogDisabled: 'disabled' }
// AGENTS.md 检验规则：状态文案必须用规约原话，不能自造弱化版
const ZH: Record<I18nKey, string> = { verified: '已实测可装可用', failed: '装不上或加载失败', skipped: '有高危信号没跑', unverified: '还没验', noInstallTarget: '没有可安装的包', installed: '已安装', search: '搜索…', back: '← 返回', loading: '加载中…', update: '更新', reinstall: '重装', add: '安装', cancel: '取消', exportLog: '导出日志', activated: '已激活', restartNeeded: '重启后生效', favorites: '收藏', allCategories: '全部分类', noMatch: '没搜到', fetchFailed: '拉取失败', redFlags: '高危信号', findings: '扫描提示', notSafe: '没扫到——这不等于安全', market: 'opencode 市场', uninstall: '卸载', confirmUninstall: '确认卸载？', retry: '重试', loadMore: '加载更多', lang: '语言', langAuto: '跟随系统', langZh: '中文', langEn: 'English',
  partsHint: '{k} 部件（可多选）', installing: '安装中…', installFailed: '安装失败', failedRetry: '失败 — 重试', verifying: '验证中…', installedPending: '已安装（等待验证）', skill: '技能', plugin: '插件', uncataloged: '未收录', updateAll: '全部更新', needRestartDesk: '需重启桌面端', allLatest: '全部已是最新', updatingN: '更新中 {n}/{total}…', updatedOk: '已更新 {ok} 个', updatedMix: '更新 {ok} 成功 {fail} 失败',
  tabDiscover: '发现', tabPlugins: '插件', tabSkills: '技能', tabFavorites: '收藏', tabInstalled: '我的插件', tabMySkills: '我的技能', tabAdvanced: '设置', filter: '筛选', sortField: '排序字段', sortDownloads: 'npm 下载量（近 30 天）', sortStars: 'Star 数', sortName: '名称', sortVerified: '验证状态', sortDirLabel: '排序方向', sortDesc: '降序', sortAsc: '升序', publishRange: '发布时间范围', rangeAll: '全部时间', range1d: '最近 1 天', range7d: '最近 7 天', range30d: '最近 30 天', range90d: '最近 90 天', range1y: '最近 1 年', allN: '全部({n})',
  refreshData: '更新数据（强制刷新索引）', refreshing: '刷新中…', refreshedN: '已刷新 {n} 条', refreshFailed: '刷新失败: {err}', timeout25: '超时 25s', backupRestore: '备份与恢复', backupDesc: '收藏存在本机 localStorage。备份导出为 JSON，恢复时粘贴内容即可。', exportBackup: '导出备份', exportedN: '已导出 {file}', pasteBackup: '粘贴备份 JSON…', restore: '恢复', restored: '已恢复', restoreInvalid: '恢复失败：不是有效的备份 JSON', clearData: '清空数据', confirmClear: '清空所有收藏？', cleared: '已清空', devlogLabel: '开发日志', devlogDesc: '记录调试日志（装包各阶段+错误，存本机）', noLogs: '暂无日志', clearLogs: '清空日志',
  cat: '分类', keysHint: '←↑↓→/hjkl 选择 · enter 详情 · i 装 · u 卸 · * 收藏 · / 搜索 · f 筛选 · c 分类 · 1-7/tab 切页 · esc 返回', menuSettings: '设置', exportBackupTui: '导出备份 → ~/opencode-market-backup.json', restoreTui: '恢复（输入备份文件路径）', restorePrompt: '恢复', clearDataTui: '清空数据（收藏）', confirmClearTui: '清空数据 — 不可撤销，确认？', clearConfirm: '✗ 清空', devlogTui: '开发日志', devlogOn: '开', devlogOff: '关', viewLogs: '查看日志', devlogMenu: '开发日志（esc 关闭）', useHttpCatalog: '使用 HTTP catalog 源', retryKey: '按 {key} 重试', updateN: '更新 {n} 项…', confirmEnter: 'enter 确认 · esc 取消',
  all: '全部', expand: '展开', installingN: '{name} 安装中…', updatedN: '{name} 已更新', removedN: '{name} 已卸载', installFailN: '{name} 安装失败{exit} — 按 {key} 重试', uninstallFail: '卸载失败: {err} — 按 {key} 重试', uninstallPartial: '{name} 已卸载——技能目录保留：{err}', updateFail: '更新失败: {err}', exportFail: '导出失败: {err}', restoreFail: '恢复失败: {err} — 检查备份文件后重试', catalogFail: 'catalog 源失败: {err} — 检查 {cfg} 后重试', catalogAlready: '已开启', catalogEnabled: '已启用', cancelled: '已取消', heldReview: 'v{v} 在审——暂不可装', dataFresh: '数据已是最新', integrityFail: '下载的字节与评审过的产物不一致——重试，持续出现请反馈',
  deprecated: '已弃用', replacedBy: '建议改用 {name}', legacy: '门禁前收录', removedFrom: '已从目录移除', reasonNpm404: 'npm 上已消失', reasonRepo404: '仓库已消失', reasonFiltered: '被入场过滤移除', reasonCapped: '超出目录上限', reasonManual: '被人工移除', reasonUnknown: '原因未知', viewOnSite: '站点详情', compat: '要求', heldReason: '原因', verifyLevel: '阶段', verifyLog: '验证日志', verifyRun: '验证记录', permTitle: '技能权限', permAllow: '允许', permAsk: '询问', permDeny: '拒绝', permOff: '清除', disable: '关闭', revertTo: '回退到批准版', featFilter: '部件', installRunning: '安装进行中', catalogDisabled: '已关闭' }
export function t(key: I18nKey): string {
  return (zhNow() ? ZH : EN)[key]
}
/** Interpolated variant — `{name}` placeholders in the dict string. */
export function tf(key: I18nKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m))
}
/** Localized catalog description — zh text when zh mode and available, en fallback. */
export function descOf(e: MarketEntry): string {
  return (zhNow() ? e.description?.zh ?? e.description?.en : e.description?.en) ?? ''
}

/** The string an install records as "what version is on disk" — npm version,
 *  or the github commit sha that was installed (pushedAt only for pre-sha data). */
export function verMarker(e: MarketEntry): string | undefined {
  return e.latestVersion ?? (e.source?.kind === 'github' ? e.source.version ?? e.modifiedAt ?? undefined : undefined)
}

/** Ordering compare for version markers: semver-ish strings compare part-wise
 *  (suffix differences fall back to lexicographic); ISO dates compare
 *  chronologically; unorderable pairs (commit sha vs sha) return 0 — we never
 *  claim a downgrade we can't prove. */
export function versionCmp(a: string, b: string): number {
  if (a === b) return 0
  const sem = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]*)?$/
  if (sem.test(a) && sem.test(b)) {
    // numeric core first; a release outranks its own prereleases
    // (1.0.0 > 1.0.0-beta.1 — the old part-wise compare read '0-beta' as 0
    // and ranked the prerelease NEWER, mislabeling reverts as updates)
    const core = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0]!.split('.').map(x => parseInt(x, 10))
    const pre = (v: string) => {
      const s = v.replace(/^v/, '')
      const i = s.indexOf('-')
      return i < 0 ? '' : s.slice(i + 1).split('+')[0]!
    }
    const na = core(a), nb = core(b)
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const d = (na[i] || 0) - (nb[i] || 0)
      if (d) return d
    }
    const pa = pre(a), pb = pre(b)
    if (!pa && !pb) return 0                       // identical modulo build metadata
    if (!pa) return 1                              // release > prerelease
    if (!pb) return -1
    // semver prerelease: dot-separated ids — numeric < alphanumeric, numeric
    // ids compare numerically, a shorter id list loses to a longer one
    const ia = pa.split('.'), ib = pb.split('.')
    for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
      const x = ia[i], y = ib[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      if (x === y) continue
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
      if (nx && ny) return Number(x) - Number(y) < 0 ? -1 : 1
      if (nx) return -1
      if (ny) return 1
      return x < y ? -1 : 1
    }
    return 0
  }
  const da = Date.parse(a), db = Date.parse(b)
  if (!isNaN(da) && !isNaN(db)) return da - db
  return 0
}

/** Newer-than-installed compare — works for both npm versions and github
 *  pushedAt markers. 'local' (dir installs without a version) can't compare. */
export function hasUpdate(e: MarketEntry, installedVer?: string): boolean {
  if (!installedVer || installedVer === 'local') return false
  const target = verMarker(e)
  return !!target && target !== installedVer
}

/** Installed version is NEWER than the approved target — the "update" is
 *  actually a revert-to-approved (hold semantics). Only reported when the
 *  ordering is provable; ambiguous markers stay false. */
export function isDowngrade(e: MarketEntry, installedVer?: string): boolean {
  if (!installedVer || installedVer === 'local') return false
  const target = verMarker(e)
  return !!target && versionCmp(installedVer, target) > 0
}

/** Install routing: which parts of an entry can this client actually deliver.
 *  'plugin' needs an npm spec (github plugins have no install path here);
 *  'skill' resolves to npm tarball or github codeload. */
export interface InstallPlan { plugin: boolean; skill: 'npm' | 'github' | null }
export function installPlan(e: MarketEntry): InstallPlan {
  // an explicit `contains` — including [] — is authoritative ([] = no
  // installable payload); only a MISSING field (legacy) falls back on type.
  // Same rule as the site's installHint — the routing sites must not drift.
  const parts = e.contains !== undefined ? e.contains
    : e.type === 'skill' ? ['skill']
    : e.type === 'plugin' ? ['plugin']
    : []
  const gh = e.source?.kind === 'github'
  const ghRepo = gh && /^[\w.-]+\/[\w.-]+$/.test(e.source?.repo ?? '') ? e.source!.repo! : null
  return {
    plugin: parts.includes('plugin') && !gh && !!e.latestVersion,
    skill: !parts.includes('skill') ? null : gh ? (ghRepo ? 'github' : null) : (e.latestVersion ? 'npm' : null),
  }
}
/** codeload ref for github-kind skills: the pipeline pins the scanned tree
 *  sha (content identity — verified to resolve on codeload). Only lowercase
 *  hex object ids may pin bytes to what was reviewed: a MISSING pin falls
 *  back to HEAD (documented legacy behavior), a MALFORMED one is index
 *  corruption and fails closed instead of sliding a branch name past the
 *  scan. */
const GIT_SHA_RE = /^[0-9a-f]{7,64}$/
export function gitPinRef(version: string | null | undefined): string {
  if (version == null || version === '') return 'HEAD'
  if (!GIT_SHA_RE.test(version)) throw new Error(`invalid source pin in catalog: ${version.slice(0, 40)}`)
  return version
}

/** Per-half install state — plugin spec and skill dir are independent
 *  surfaces, so "installed"/"outdated" must be computed per half. The old
 *  merged-version check let a current plugin half mask a stale skill half
 *  (and vice versa): updates silently skipped whichever half lagged. */
export interface HalfState {
  pluginOn: boolean    // a plugin spec/dir is present (any source type)
  pluginOut: boolean   // plugin half installed AND provably outdated
  skillOn: boolean     // a skill dir/key is present (incl. foreign 'local')
  skillOut: boolean    // skill half installed AND provably outdated
  anyOn: boolean
  anyOut: boolean
  /** merged version marker for labels — plugin version wins over skill's */
  ver: string | undefined
}
/** Strict skill-half probe for halfState — unlike skillInstalledVer this
 *  never falls back to the plugin key: a plugin spec alone is NOT evidence a
 *  skill half exists (that fallback exists for merged-version labels, where
 *  ambiguity is cosmetic; here it would resurrect/mask halves wrongly). */
function skillHalfVer(installed: Record<string, string>, pkgName: string): string | undefined {
  const base = `__skill_${skillId(pkgName)}`
  if (installed[base]) return installed[base]
  const bare = `__skill_${pkgName.split('/').pop() ?? pkgName}`
  if (bare !== base && installed[bare]) return installed[bare]
  const keys = Object.keys(installed)
  if (keys.some(k => k.startsWith(`${base}-`))) return 'local'
  if (bare !== base && keys.some(k => k.startsWith(`${bare}-`))) return 'local'
  return undefined
}

export function halfState(e: MarketEntry, installed: Record<string, string>, skillVers?: Record<string, string>): HalfState {
  const plan = installPlan(e)
  const pVer = installed[e.name]
  const sDisk = skillHalfVer(installed, e.name)
  const sVer = skillVers?.[e.name] ?? sDisk
  const pluginOn = !!pVer, skillOn = !!sVer
  // 'out' additionally requires the half to be deliverable — a git-installed
  // plugin matching a github-kind entry has no market update path, and an
  // npm entry without an approved version can't be pinned either
  const pluginOut = pluginOn && plan.plugin && hasUpdate(e, pVer!)
  const skillOut = skillOn && plan.skill !== null && hasUpdate(e, sVer!)
  return {
    pluginOn, pluginOut, skillOn, skillOut,
    anyOn: pluginOn || skillOn,
    anyOut: pluginOut || skillOut,
    ver: pVer ?? sVer,
  }
}

/** Which halves an install/update action should touch:
 *  - nothing installed → every deliverable half (fresh install)
 *  - partially/fully installed → only halves that are installed AND outdated
 *    (missing halves are NOT auto-added — a deliberate uninstall or failed
 *    install shouldn't be silently resurrected by an unrelated update) */
export function halvesToSync(e: MarketEntry, hs: HalfState): { plugin: boolean; skill: boolean } {
  const plan = installPlan(e)
  const fresh = !hs.anyOn
  return {
    plugin: !!(plan.plugin && (fresh || (hs.pluginOn && hs.pluginOut))),
    skill: plan.skill !== null && (fresh || (hs.skillOn && hs.skillOut)),
  }
}

export function canInstall(e: MarketEntry): boolean {
  const p = installPlan(e)
  return p.plugin || p.skill !== null
}

/** Catalog detail page on the site — same dir as index.json, `p/<slug>.html`.
 *  Carries the audit trail (verify run link, log excerpt, full findings) the
 *  client detail view only summarizes. */
export function siteDetailUrl(e: Pick<MarketEntry, 'slug'>, indexUrl: string): string | null {
  try { return new URL(`p/${encodeURIComponent(e.slug)}.html`, indexUrl).href } catch { return null }
}

const REMOVED_REASON_KEY = {
  'npm-404': 'reasonNpm404', 'repo-404': 'reasonRepo404', filtered: 'reasonFiltered',
  capped: 'reasonCapped', manual: 'reasonManual',
} as const
export function removedReasonLabel(reason: string | undefined): string {
  return t((REMOVED_REASON_KEY as Record<string, I18nKey>)[reason ?? ''] ?? 'reasonUnknown')
}

/** Compact count for metric chips — ↓1.2k beats ↓1234. */
export const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

// ── packument metadata + artifact integrity ──────────────────────────────
const pkMetaCache = new Map<string, { at: number; pk: Packument }>()
/** Bound the packument cache — entries are only TTL-checked on READ, so
 *  without a cap every distinct package ever installed pins its packument
 *  (up to MBs each) for the process lifetime. LRU order via delete+set. */
const PK_META_MAX = 100
export async function fetchPkgVersionMeta(name: string, ver: string): Promise<{ tarball: string | null; integrity: string | null }> {
  const hit = pkMetaCache.get(name)
  let pk = hit && Date.now() - hit.at < 600_000 ? hit.pk : null
  if (hit) { pkMetaCache.delete(name); pkMetaCache.set(name, hit) }
  if (!pk) {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`packument fetch failed: ${res.status}`)
    pk = (await res.json()) as Packument
    pkMetaCache.set(name, { at: Date.now(), pk })
    if (pkMetaCache.size > PK_META_MAX) pkMetaCache.delete(pkMetaCache.keys().next().value!)
  }
  const d = pk.versions?.[ver]?.dist
  return {
    tarball: approvedTarballUrl(pk, { latestVersion: ver }),
    integrity: typeof d?.integrity === 'string' ? d.integrity : null,
  }
}

/** sha512 SRI check for a downloaded artifact against the index-announced
 *  integrity. null = can't verify (no integrity / no subtle crypto) — the
 *  caller decides whether unverifiable is acceptable. */
export async function integrityMatches(buf: Uint8Array, sri: string | null | undefined): Promise<boolean | null> {
  const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(sri ?? '')
  if (!m || !globalThis.crypto?.subtle) return null
  const digest = await globalThis.crypto.subtle.digest('SHA-512', buf as BufferSource)
  let bin = ''
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b)
  return btoa(bin) === m[1]
}

/** Keyword category classifier — catalog entries mostly ship category:[],
 *  the UI derives display categories at render time (dsh-style chips).
 *  English ids are canonical (mirrors src/categories.ts in the pipeline);
 *  CAT_NAMES holds the bilingual display names. */
const CAT_NAMES: Record<string, { en: string; zh: string }> = {
  appearance: { en: 'appearance', zh: '主题与外观' },
  models: { en: 'models & providers', zh: '模型与接入' },
  sessions: { en: 'sessions', zh: '会话与消息' },
  memory: { en: 'memory', zh: '记忆' },
  notifications: { en: 'notifications', zh: '通知' },
  security: { en: 'security & permissions', zh: '安全与权限' },
  workflow: { en: 'dev workflow', zh: '开发流程' },
  tools: { en: 'tools & capabilities', zh: '工具与能力' },
  integrations: { en: 'integrations', zh: '集成与移动' },
  other: { en: 'other', zh: '其他' },
}
/** Category dictionary shipped inside index.json — consulted by catLabel
 *  before the hardcoded CAT_NAMES so pipeline-added categories render names,
 *  not raw ids. fetchIndexCached refills it on every successful fetch. */
let catDict: Record<string, { en?: string; zh?: string }> = {}
export function setCatDict(c: MarketIndex['categories']): void { catDict = c ?? {} }

const ZH_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(CAT_NAMES).map(([id, d]) => [d.zh, id]))
const CAT_RULES: [string, RegExp][] = [
  ['appearance', /theme|color|icon|font|appearance|ui-|css|style/i],
  ['models', /model|provider|llm|gpt|claude|deepseek|ollama|api[-_ ]key|pricing|token|usage|cost|billing/i],
  ['sessions', /session|chat|conversation|message|history|compaction|context/i],
  ['memory', /memory|remember|recall|knowledge|note|persist/i],
  ['notifications', /notif|alert|toast|sound|remind|bell/i],
  ['security', /secur|guard|permission|policy|audit|sandbox|auth|firewall|protect/i],
  ['workflow', /git|commit|review|test|lint|ci|deploy|release|debug|refactor|scaffold|spec|project|template|starter|suite|kit|workflow|task[-_ ]?runner/i],
  ['tools', /tool|command|search|fetch|browse|file|terminal|shell|exec|agent|skill|mcp|manage|track|monitor|watch|dashboard|status|quota|limit|metric/i],
  ['integrations', /integrat|qq|wechat|slack|discord|telegram|feishu|mobile|remote|browser|chrome/i],
]
/** zh descriptions carry the same signal in Chinese — a zh-only entry used
 *  to fall through to 'other' because the rules only knew English keywords. */
const ZH_CAT_RULES: [string, RegExp][] = [
  ['appearance', /主题|配色|图标|字体|外观|样式/],
  ['models', /模型|提供商|服务商|用量|计费|成本|额度/],
  ['sessions', /会话|对话|消息|历史|压缩|上下文/],
  ['memory', /记忆|知识|笔记|持久/],
  ['notifications', /通知|提醒|警报|铃声/],
  ['security', /安全|权限|审计|沙箱|防护/],
  ['workflow', /提交|审查|测试|部署|发布|调试|重构|脚手架|模板|工作流/],
  ['tools', /工具|命令|搜索|抓取|浏览|文件|终端|代理|技能|监控|仪表盘|状态/],
  ['integrations', /集成|移动|浏览器|远程|微信|飞书|钉钉|telegram|discord|slack/],
]
export function categoriesOf(e: MarketEntry): string[] {
  if (e.category?.length) return e.category
  const hay = `${e.name} ${e.slug ?? ''} ${e.description?.en ?? ''}`
  const hits = CAT_RULES.filter(([, r]) => r.test(hay)).map(([c]) => c)
  const zh = e.description?.zh
  if (zh) for (const [c, r] of ZH_CAT_RULES) if (r.test(zh) && !hits.includes(c)) hits.push(c)
  return hits.length ? hits.slice(0, 2) : ['other']
}
export function allCategories(entries: MarketEntry[]): string[] {
  const s = new Set<string>()
  for (const e of entries) for (const c of categoriesOf(e)) s.add(c)
  return [...s].sort()
}
/** Category display name — raw values are english ids (canonical) or legacy
 *  zh labels from pre-id data; both resolve through the bilingual table.
 *  Unknown/custom categories pass through untouched. */
export function catLabel(c: string): string {
  const d = catDict[c] ?? CAT_NAMES[c] ?? CAT_NAMES[ZH_TO_ID[c] ?? '']
  return d ? ((zhNow() ? d.zh ?? d.en : d.en) ?? c) : c
}

/** Entries touched within N days. npm: publishedAt; github-kind: pushedAt
 *  lands in modifiedAt (a repo with no new push is not "new"); firstSeenAt
 *  is the last resort for entries missing both. */
export function inDays(e: MarketEntry, days: number): boolean {
  const at = Date.parse(e.publishedAt ?? e.modifiedAt ?? e.firstSeenAt ?? '')
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
