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

/** Injected fetch is the only reliable test signal: run.ts always forwards
 *  its own `f`, which IS the global fetch in production — so
 *  `opts.fetchFn ? 0 : delay` collapsed every rate-limit sleep to 0 for the
 *  real run (that is what let a >1000-result topic's bisection burst past
 *  the search pool and cascade into page-after-page 403s). Only tests ever
 *  pass a fetch that isn't `fetch`. */
const testish = (opts: { fetchFn?: typeof fetch }): boolean =>
  opts.fetchFn !== undefined && opts.fetchFn !== fetch

/** Shared pacing across EVERY search call — the authed search pool is
 *  30 req/min (10 req/min for code search, refused outright unauthenticated)
 *  and secondary limits punish bursts. A >1000-result topic's created-date
 *  bisection probes a page-1 per slice; without a global floor the 2-way
 *  topic pool plus slices burst past the budget and the rest of the crawl
 *  403s out. Reservation is atomic because the bump runs before the await. */
const SEARCH_GAP_MS = 2_200
const CODE_SEARCH_GAP_MS = 6_100
let nextSearchSlot = 0
const paceSearch = async (gapMs: number): Promise<void> => {
  const now = Date.now()
  const slot = Math.max(now, nextSearchSlot)
  nextSearchSlot = slot + gapMs
  if (slot > now) await sleep(slot - now)
}

const MAX_SEARCH_RETRIES = 3

/** Header-aware throttle wait: Retry-After wins; a spent primary budget
 *  (remaining 0) waits for its reset window; anything else backs off
 *  exponentially into the ~60s secondary-limit cooldown. */
export const retryWaitMs = (
  res: { headers: { get(k: string): string | null } },
  attempt: number,
): number => {
  const ra = Number(res.headers.get('retry-after'))
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 90_000)
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (reset > 0) return Math.min(Math.max(reset * 1000 - Date.now(), 1_000), 90_000)
  }
  return Math.min(15_000 * 2 ** attempt, 90_000)
}

/** One paced + retried search GET shared by topic and code search. Errors
 *  warn-and-truncate (run.ts awaits discovery bare — a throw kills the
 *  whole catalog run); the failed body is drained so keep-alive sockets
 *  recycle instead of stalling the pool. */
const fetchSearchJson = async (
  url: string,
  label: string,
  opts: { token?: string | undefined; fetchFn?: typeof fetch },
  gapMs: number,
): Promise<unknown | null> => {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const test = testish(opts)
  for (let attempt = 0; ; attempt++) {
    if (!test) await paceSearch(gapMs)
    let res: Response
    try {
      res = await f(url, { headers: ghHeaders(opts.token) })
    } catch (e) {
      console.warn(`${label} failed (${e instanceof Error ? e.message : e}) — results truncated`)
      return null
    }
    if (res.ok) {
      try {
        return await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
      } catch (e) {
        console.warn(`${label} failed (${e instanceof Error ? e.message : e}) — results truncated`)
        return null
      }
    }
    await res.arrayBuffer().catch(() => undefined)
    // 403/429 are the shared search budget; 5xx is GitHub's flaky search
    // backend — both are transient and worth the spaced retry budget
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < MAX_SEARCH_RETRIES) {
      const waitMs = test ? 0 : retryWaitMs(res, attempt)
      console.warn(`${label} throttled (${res.status}) — retry ${attempt + 1}/${MAX_SEARCH_RETRIES} in ${Math.ceil(waitMs / 1000)}s`)
      await sleep(waitMs)
      continue
    }
    console.warn(`${label} failed (${res.status}) — results truncated`)
    return null
  }
}

/** The repo-search API hard-caps ANY single query at 1000 results — a full
 *  tenth page is the window cutting us off, not discovery finishing. When a
 *  query's total_count exceeds it, the created-date range is bisected until
 *  every slice fits (each slice gets its own 1000 window). The range MUST
 *  use `created:A..B` — `created:>=`/`created:<` qualifiers are silently
 *  dropped by GitHub's search parser (no error, unfiltered items AND
 *  total_count), which degenerates every slice into the same full query.
 *  `..` ranges are inclusive at day precision, so adjacent slices overlap
 *  on the boundary day — the `seen` map dedupes the handful of repos that
 *  double-report; coverage stays complete. GH_EPOCH predates GitHub so the
 *  first cover is total. MAX_SPLIT_DEPTH bounds the request count for a
 *  pathological topic. */
const SEARCH_WINDOW = 1000
const MAX_SPLIT_DEPTH = 10                  // ~6.7-day leaves over the epoch — dense topics (~200 repos/day peaks) fit under the window; deeper only buys request burn
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
  const maxPages = opts.maxPages ?? 10
  // fork:false is a zero-cost server-side filter — mirror forks only ever
  // produce duplicate content entries (submission-seeded forks still get in,
  // a human asked for those).
  const base = `topic:${topic} fork:false`
  const seen = new Map<string, GhRepo>()

  const fetchPage = async (q: string, page: number, order: 'asc' | 'desc' = 'desc'): Promise<{ items: GhRepo[]; total: number } | null> => {
    const url = `${GH_API}/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=${order}&per_page=100&page=${page}`
    // a mid-pagination failure must be loud — the candidate tail silently
    // vanished otherwise (truncation telemetry lives in fetchSearchJson)
    const body = await fetchSearchJson(
      url, `[discover:github] '${topic}' page ${page}${order === 'asc' ? ' (asc)' : ''}`, opts,
      opts.token ? SEARCH_GAP_MS : CODE_SEARCH_GAP_MS,
    )
    if (body === null) return null
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

  // sweep one slice in ONE ordering direction; fetchPage(page 1) already
  // consumed by slice(). Returns whether the window cut a tail — the caller
  // decides whether the opposite end recovers it before any warn.
  // total=0 means the count was missing/unreadable — fall back to paging
  // until a short page, the pre-bisection semantics.
  const sweep = async (q: string, total: number, first: GhRepo[], order: 'asc' | 'desc'): Promise<boolean> => {
    const windowTotal = total > 0 ? Math.min(total, SEARCH_WINDOW) : maxPages * 100
    let page = 1, items = first
    for (;;) {
      for (const r of items) seen.set(r.fullName.toLowerCase(), r)
      if (items.length < 100) return false
      if (page >= Math.min(maxPages, Math.ceil(windowTotal / 100))) {
        // page*100 < windowTotal is exact for known totals; a full last
        // page is the best signal when the count never arrived
        return total > 0 ? page * 100 < windowTotal : items.length === 100
      }
      const p = await fetchPage(q, page + 1, order)
      if (!p) return true
      items = p.items; page++
    }
  }

  const slice = async (lo: number, hi: number, depth: number): Promise<void> => {
    // `created:A..B` is the ONLY date syntax GitHub's repo search actually
    // applies — the `>=`/`<` qualifier pair is silently ignored (verified:
    // `topic:x created:>=2008 created:<2009` returns the unfiltered topic).
    // hi-1: `..` is inclusive, and `hi` at exact midnight must not pull the
    // next day's repos in — over-covering beats a coverage hole.
    const q = depth === 0 ? base : `${base} created:${isoDay(lo)}..${isoDay(hi - 1)}`
    const p1 = await fetchPage(q, 1)
    if (!p1) return
    if (p1.total > SEARCH_WINDOW && depth < MAX_SPLIT_DEPTH && hi - lo > 86_400_000) {
      const mid = lo + (hi - lo) / 2
      await slice(lo, mid, depth + 1)
      await slice(mid, hi, depth + 1)
      return
    }
    if (p1.total > SEARCH_WINDOW) {
      // A leaf that still outgrows the window at the depth floor gets BOTH
      // ends of the updated ordering — desc's 1000 most-recently-updated
      // plus asc's 1000 least-recently-updated, deduped by `seen`. Only the
      // middle beyond 2000 can still drop, and that is what the warn counts.
      console.warn(`[discover:github] '${topic}' created:${isoDay(lo)}..${isoDay(hi - 1)} exceeds the window (${p1.total}) — sweeping both ends`)
      // total > window means desc's own window always truncates — the asc
      // end runs unconditionally; real loss = a fetch died or the middle
      // beyond both windows (slice > 2×1000)
      const descFailed = await sweep(q, p1.total, p1.items, 'desc')
      const a1 = await fetchPage(q, 1, 'asc')
      const dropped = descFailed || !a1 || await sweep(q, a1.total, a1.items, 'asc')
        || p1.total > 2 * SEARCH_WINDOW
      if (dropped) console.warn(`[discover:github] '${topic}' created:${isoDay(lo)}..${isoDay(hi - 1)} still exceeds both windows (${p1.total}) — tail dropped`)
      return
    }
    if (await sweep(q, p1.total, p1.items, 'desc'))
      console.warn(`[discover:github] '${topic}' page cap — tail results dropped`)
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
  const out: GhRepo[] = []
  for (let page = 1; page <= (opts.maxPages ?? 2); page++) {
    const url = `${GH_API}/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
    const body = await fetchSearchJson(
      url, `[discover:github] code search '${query}' page ${page}`, opts, CODE_SEARCH_GAP_MS,
    )
    if (body === null) break
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
      await sleep(testish(opts) ? 0 : 2_000)
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
