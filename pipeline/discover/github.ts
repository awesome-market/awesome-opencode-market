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

export async function searchTopic(
  topic: string,
  opts: { token?: string | undefined; maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<GhRepo[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const out: GhRepo[] = []
  // fork:false is a zero-cost server-side filter — mirror forks only ever
  // produce duplicate content entries (submission-seeded forks still get in,
  // a human asked for those). maxPages 10 hits the search API's 1000-result cap.
  let hitPageCap = false
  for (let page = 1; page <= (opts.maxPages ?? 10); page++) {
    const url = `${GH_API}/search/repositories?q=topic:${encodeURIComponent(topic)}+fork:false&sort=updated&per_page=100&page=${page}`
    let body: unknown
    try {
      const res = await f(url, { headers: ghHeaders(opts.token) })
      // a mid-pagination failure must be loud — the candidate tail silently
      // vanished otherwise (truncation telemetry). fetch throws and JSON
      // parse/oversize errors take the same path: run.ts awaits discovery
      // bare, so an uncaught rejection here kills the whole catalog run
      if (!res.ok) { console.warn(`[discover:github] '${topic}' page ${page} failed (${res.status}) — results truncated`); break }
      body = await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
    } catch (e) {
      console.warn(`[discover:github] '${topic}' page ${page} failed (${e instanceof Error ? e.message : e}) — results truncated`)
      break
    }
    // non-object body or non-array items degrades to an empty page; each hit
    // needs a string full_name — it is the dedupe key (`r.fullName
    // .toLowerCase()` below), so a missing/wrong-typed name was a run-killer
    const raw = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { items?: unknown }).items : undefined
    const items = Array.isArray(raw) ? raw : []
    for (const it of items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue
      const r = it as Record<string, unknown>
      const fullName = strOr(r.full_name)
      if (!fullName) continue
      out.push({
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
    }
    if (items.length < 100) break
    if (page === (opts.maxPages ?? 10)) hitPageCap = true
  }
  // the search API hard-caps at 1000 results — a full last page means the
  // window itself cut us off, not that discovery is complete
  if (hitPageCap) console.warn(`[discover:github] '${topic}' hit the search window cap — tail results dropped`)
  return out
}

/** Precision channel: repos that actually carry an opencode artifact
 *  (.opencode/ dir, opencode.json config, a SKILL.md mentioning opencode)
 *  regardless of what topics the owner set — the highest-precision signal
 *  the search API offers. Code search is rate-limited separately
 *  (~10 req/min authed, and REFUSED outright without a token), so the query
 *  set stays small, pages stay shallow, and calls run serially. */
export const CODE_QUERIES = [
  'filename:opencode.json fork:false',
  'filename:opencode.jsonc fork:false',
  'path:/\\.opencode\\// fork:false',
  'filename:SKILL.md opencode fork:false',
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
    try {
      const res = await f(url, { headers: ghHeaders(opts.token) })
      // mid-pagination failure must be loud — same truncation telemetry as
      // the topic path; throws/parse errors take the same warn+truncate path
      // (run.ts awaits discovery bare — an uncaught rejection kills the run)
      if (!res.ok) { console.warn(`[discover:github] code search '${query}' page ${page} failed (${res.status}) — results truncated`); break }
      body = await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
    } catch (e) {
      console.warn(`[discover:github] code search '${query}' page ${page} failed (${e instanceof Error ? e.message : e}) — results truncated`)
      break
    }
    // same malformed-doc contract as searchTopic — non-object body/items
    // degrades; each hit needs a string repository.full_name (the dedupe
    // key), and every carried field is normalized, not `??`-trusted
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
      // code-search repository objects can be partial — fields the API omits
      // stay null/empty/'HEAD' and ghWorker's meta backfill fills them
      // (repoId, pushedAt, canonical casing) before the evidence gate judges
      out.push({
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
  // 2-way concurrency stays well under the search API's secondary rate limits
  await mapPool(topics, 2, async t => {
    for (const r of await searchTopic(t, opts)) {
      const key = r.fullName.toLowerCase()
      if (!map.has(key)) {
        map.set(key, { ...r, discoveredVia: ['github-topic'] })
      }
    }
  })
  // code-search precision channel — serial after the topic burst: it's
  // rate-limited separately (~10 req/min) and refused outright without a
  // token, so unauthenticated runs simply skip the channel.
  if (opts.token) {
    for (const q of CODE_QUERIES) {
      for (const r of await searchCode(q, opts)) {
        const key = r.fullName.toLowerCase()
        const ex = map.get(key)
        if (ex) {
          if (!ex.discoveredVia.includes('code-search')) ex.discoveredVia.push('code-search')
        } else {
          map.set(key, { ...r, discoveredVia: ['code-search'] })
        }
      }
    }
  }
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
