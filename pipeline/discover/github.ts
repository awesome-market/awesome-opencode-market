/** GitHub discovery: topic search + repo metadata. Unauthenticated works (60 req/h); GH_TOKEN raises limits. */
import { withTimeout, readJsonCapped } from '../fetch/npm.ts'
import { mapPool } from '../pool.ts'

export const GH_API = 'https://api.github.com'
export const TOPICS = ['opencode-plugin', 'opencode', 'agent-skill', 'opencode-skill', 'opencode-mcp', 'opencode-config', 'opencode-theme'] as const

export interface GhRepo {
  fullName: string           // owner/repo
  description: string
  archived: boolean
  fork: boolean
  pushedAt: string | null
  stars: number
  defaultBranch: string
  id: number | null          // numeric repo id — repojacking detection, free from search results
  createdAt: string | null
  license: string | null
  topics: string[]
}

// field normalizers shared by the search surfaces — same malformed-doc
// contract as fetchPackument/fetchRepoMeta: `??` only covers null/undefined,
// a wrong-typed field is a type lie that crashes downstream (fullName feeds
// `.toLowerCase()` in discoverGithub; topics feeds `[...topics]` in run.ts)
const strOr = (x: unknown): string | null => (typeof x === 'string' ? x : null)
const numOr = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const strList = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
const spdxOr = (x: unknown): string | null => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const s = strOr((x as { spdx_id?: unknown }).spdx_id)
  return s && s !== 'NOASSERTION' ? s : null
}

export function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'opencode-market-pipeline',
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The repo-search API hard-caps ANY single query at 1000 results — a full
 *  tenth page is the window cutting us off, not discovery finishing. When a
 *  query's total_count exceeds it, the created-date range is bisected until
 *  every slice fits (each slice gets its own 1000 window). Half-open ranges
 *  `>=lo AND <hi` cover exhaustively without boundary dupes; GH_EPOCH
 *  predates GitHub so the first cover is total. MAX_SPLIT_DEPTH bounds the
 *  request count for a pathological topic. */
const SEARCH_WINDOW = 1000
const MAX_SPLIT_DEPTH = 8
const GH_EPOCH = Date.parse('2008-01-01T00:00:00Z')

// search/repositories and search/code share the same item-shape contract:
// non-object body or non-array items degrades to an empty page; each hit
// needs a string full_name — it is the dedupe key (`r.fullName
// .toLowerCase()` in discoverGithub), so a missing/wrong-typed name was a
// run-killer. Every carried field is normalized, not `??`-trusted.
const mapSearchItem = (r: Record<string, unknown>, fullName: string): GhRepo => ({
  fullName,
  description: strOr(r.description) ?? '',
  archived: r.archived === true,
  fork: r.fork === true,
  pushedAt: strOr(r.pushed_at),
  stars: numOr(r.stargazers_count) ?? 0,
  defaultBranch: strOr(r.default_branch) ?? 'HEAD',
  id: numOr(r.id),
  createdAt: strOr(r.created_at),
  license: spdxOr(r.license),
  topics: strList(r.topics),
})

export async function searchTopic(
  topic: string,
  opts: { token?: string | undefined; maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<GhRepo[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const maxPages = opts.maxPages ?? 10
  // fork:false is a zero-cost server-side filter — mirror forks only ever
  // produce duplicate content entries (submission-seeded forks still get in,
  // a human asked for those).
  const base = `topic:${topic} fork:false`
  const seen = new Map<string, GhRepo>()

  const fetchPage = async (q: string, page: number): Promise<{ items: GhRepo[]; total: number } | null> => {
    const url = `${GH_API}/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=100&page=${page}`
    let body: unknown
    try {
      const res = await f(url, { headers: ghHeaders(opts.token) })
      // a mid-pagination failure must be loud — the candidate tail silently
      // vanished otherwise (truncation telemetry). fetch throws and JSON
      // parse/oversize errors take the same path: run.ts awaits discovery
      // bare, so an uncaught rejection here kills the whole catalog run
      if (!res.ok) { console.warn(`[discover:github] '${topic}' page ${page} failed (${res.status}) — results truncated`); return null }
      body = await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
    } catch (e) {
      console.warn(`[discover:github] '${topic}' page ${page} failed (${e instanceof Error ? e.message : e}) — results truncated`)
      return null
    }
    const obj = body && typeof body === 'object' && !Array.isArray(body)
      ? body as { items?: unknown; total_count?: unknown } : null
    const raw = obj?.items
    const items = Array.isArray(raw) ? raw : []
    const out: GhRepo[] = []
    for (const it of items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue
      const r = it as Record<string, unknown>
      const fullName = strOr(r.full_name)
      if (!fullName) continue
      out.push(mapSearchItem(r, fullName))
    }
    return { items: out, total: numOr(obj?.total_count) ?? 0 }
  }

  // sweep one ≤window slice; fetchPage(page 1) already consumed by slice().
  // total=0 means the count was missing/unreadable — fall back to paging
  // until a short page, the pre-bisection semantics.
  const sweep = async (q: string, total: number, first: GhRepo[]): Promise<void> => {
    const windowTotal = total > 0 ? Math.min(total, SEARCH_WINDOW) : maxPages * 100
    let page = 1, items = first
    for (;;) {
      for (const r of items) seen.set(r.fullName.toLowerCase(), r)
      if (items.length < 100) return
      if (page >= Math.min(maxPages, Math.ceil(windowTotal / 100))) {
        // window-cap truncation warned by slice(); this is the page cap —
        // page*100 < windowTotal is exact for known totals, a full last
        // page is the best signal when the count never arrived
        const dropped = total > 0 ? page * 100 < windowTotal : items.length === 100
        if (dropped) console.warn(`[discover:github] '${topic}' page cap — tail results dropped`)
        return
      }
      const p = await fetchPage(q, page + 1)
      if (!p) return
      items = p.items; page++
    }
  }

  const slice = async (lo: number, hi: number, depth: number): Promise<void> => {
    const q = depth === 0 ? base : `${base} created:>=${isoDay(lo)} created:<${isoDay(hi)}`
    const p1 = await fetchPage(q, 1)
    if (!p1) return
    if (p1.total > SEARCH_WINDOW && depth < MAX_SPLIT_DEPTH && hi - lo > 86_400_000) {
      const mid = lo + (hi - lo) / 2
      await slice(lo, mid, depth + 1)
      await slice(mid, hi, depth + 1)
      return
    }
    if (p1.total > SEARCH_WINDOW)
      console.warn(`[discover:github] '${topic}' created:${isoDay(lo)}..${isoDay(hi)} still exceeds the search window (${p1.total}) — tail dropped`)
    await sweep(q, p1.total, p1.items)
  }
  await slice(GH_EPOCH, Date.now(), 0)
  return [...seen.values()]
}

/** Precision channel: repos that actually carry an opencode artifact
 *  (.opencode/ dir, opencode.json config, a SKILL.md mentioning opencode)
 *  regardless of what topics the owner set — the highest-precision signal
 *  the search API offers. Code search is rate-limited separately
 *  (~10 req/min authed, and REFUSED outright without a token), so the query
 *  set stays small, pages stay shallow, and calls run serially. */
// No `fork:` qualifier on purpose: it is a repo-search qualifier — on the
// code-search endpoint it makes the whole query 422 ("unable to parse").
// Code search simply never indexes forks, so nothing needs saying.
export const CODE_QUERIES = [
  'filename:opencode.json',
  'filename:opencode.jsonc',
  'path:.opencode',
  'filename:SKILL.md opencode',
] as const

export async function searchCode(
  query: string,
  opts: { token?: string | undefined; maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<GhRepo[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const out: GhRepo[] = []
  for (let page = 1; page <= (opts.maxPages ?? 2); page++) {
    const url = `${GH_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
    let body: unknown
    let retried = false
    for (;;) {
      try {
        const res = await f(url, { headers: ghHeaders(opts.token) })
        // mid-pagination failure must be loud — same truncation telemetry as
        // the topic path; throws/parse errors take the same warn+truncate
        // path (run.ts awaits discovery bare — an uncaught rejection kills
        // the run). 403/429 are the shared search budget talking — one
        // spaced retry recovers most of them; anything else truncates.
        if (!res.ok) {
          if ((res.status === 403 || res.status === 429) && !retried) {
            retried = true; await sleep(opts.fetchFn ? 0 : 15_000); continue
          }
          console.warn(`[discover:github] code search '${query}' page ${page} failed (${res.status}) — results truncated`)
          break
        }
        body = await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
      } catch (e) {
        console.warn(`[discover:github] code search '${query}' page ${page} failed (${e instanceof Error ? e.message : e}) — results truncated`)
        break
      }
      break
    }
    if (body === undefined) break
    // same malformed-doc contract as searchTopic — non-object body/items
    // degrades; each hit needs a string repository.full_name (the dedupe
    // key). Repository objects can be partial — fields the API omits stay
    // null/empty/'HEAD' and ghWorker's meta backfill fills them (repoId,
    // pushedAt, canonical casing) before the evidence gate judges.
    const raw = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { items?: unknown }).items : undefined
    const items = Array.isArray(raw) ? raw : []
    for (const it of items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue
      const repo = (it as Record<string, unknown>).repository
      if (!repo || typeof repo !== 'object' || Array.isArray(repo)) continue
      const r = repo as Record<string, unknown>
      const fullName = strOr(r.full_name)
      if (!fullName) continue
      out.push(mapSearchItem(r, fullName))
    }
    if (items.length < 100) break
  }
  return out
}

export async function discoverGithub(
  topics: readonly string[] = TOPICS,
  opts: Parameters<typeof searchTopic>[1] = {},
): Promise<Map<string, GhRepo & { discoveredVia: string[] }>> {
  const map = new Map<string, GhRepo & { discoveredVia: string[] }>()
  // map keys are canonical lowercase — the same repo seen as Owner/Repo in one
  // topic and owner/repo in another (or a seed typed differently) must dedupe
  // into ONE candidate, not two identity twins
  //
  // code-search precision channel FIRST, serial and paced: it is refused
  // outright without a token and has its own ~10 req/min pool — running it
  // before the topic burst means a fresh budget; after ~70 repo-search calls
  // it mostly drew 403/429. The pace keeps us under the per-minute pool.
  if (opts.token) {
    for (const q of CODE_QUERIES) {
      for (const r of await searchCode(q, opts)) {
        const key = r.fullName.toLowerCase()
        if (!map.has(key)) map.set(key, { ...r, discoveredVia: ['code-search'] })
      }
      await sleep(opts.fetchFn ? 0 : 2_000)
    }
  }
  // 2-way concurrency stays well under the search API's secondary rate limits
  await mapPool(topics, 2, async t => {
    for (const r of await searchTopic(t, opts)) {
      const key = r.fullName.toLowerCase()
      const ex = map.get(key)
      if (ex) {
        if (!ex.discoveredVia.includes('github-topic')) ex.discoveredVia.push('github-topic')
      } else {
        map.set(key, { ...r, discoveredVia: ['github-topic'] })
      }
    }
  })
  return map
}

/** Canonical repo identity is exactly `owner/repo` — two non-empty segments
 *  from the GitHub charset, neither a dot-segment. The value is interpolated
 *  RAW into api.github.com / raw.githubusercontent.com / codeload URLs, where
 *  WHATWG path normalization resolves `..`/`.` segments: '../x' or
 *  'github.com/../repos/o/r' would silently retarget the fetch at a DIFFERENT
 *  repo's endpoints (and mint a traversal-shaped slug). Reject at the boundary
 *  instead of trusting downstream consumers to re-validate. */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]+$/
const cleanRepo = (r: string): string | null => {
  const parts = r.split('/')
  if (parts.length !== 2) return null
  const [o, repo] = parts
  // GitHub owners are alnum+hyphen only — a dotted "owner" ('github.com/a'
  // parsed as owner/repo) is never a real repo and must not reach the API
  if (!o || !repo || o === '.' || o === '..' || repo === '.' || repo === '..') return null
  if (!OWNER_RE.test(o) || !REPO_RE.test(repo)) return null
  return r
}

/** Canonical repo URL extraction from an npm repository field (handles git+, git@, ssh, monorepo dir). */
export function normalizeRepoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  s = s.replace(/^git\+/, '').replace(/\.git\/?$/, '')
  s = s.replace(/^git@github\.com:/, 'https://github.com/')
  s = s.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
  // npm's repository shorthand — 'github:owner/repo' (optionally '#commit') is
  // as canonical a GitHub pointer as a full URL; gitlab:/bitbucket: still miss
  s = s.replace(/^github:/i, 'https://github.com/')
  // capture only repo-charset chars so prose can't smuggle spaces/commas
  // into the path ('github.com/o/r, it is nice' → 'o/r', not 'o/r, it…').
  // Repo-legal trailing chars still need cleanup: '.' is in the charset, so
  // 'o/r.' survives capture — strip sentence punctuation, then .git, then
  // punctuation again ('o/r..git' → 'o/r.'), then slashes. Legit repo names
  // never end in these chars.
  const clean = (p: string) => p
    .replace(/[.,;:!?)'"\]}>]+$/, '')
    .replace(/\.git$/, '')
    .replace(/[.,;:!?)'"\]}>]+$/, '')
    .replace(/\/+$/, '')
  const m = s.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9._-]+)/)
  if (m) return cleanRepo(clean(m[1]!))
  // bare owner/repo — submission seeds and terse repository fields
  const bare = s.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
  return bare ? cleanRepo(clean(bare[1]!)) : null
}
