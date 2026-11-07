/** GitHub fetch: repo metadata + file probes (SKILL.md, opencode.json, plugin entries). */
import { ghHeaders } from '../discover/github.ts'
import { withTimeout, readJsonCapped } from './npm.ts'

export interface RepoMeta {
  id: number | null              // numeric repo id — repojacking detection (id changes on recreation)
  stars: number
  archived: boolean
  /** true when the repo is a fork — submissions should nominate the canonical
   *  upstream; a fork inherits the parent's whole tree and would sail through
   *  the evidence gate on code it didn't write */
  fork: boolean
  pushedAt: string | null
  createdAt: string | null
  license: string | null
  topics: string[]
  defaultBranch: string | null
  /** canonical-cased full name — the API answers with the repo's real casing. */
  fullName: string | null
}

/** 'rate-limited' is distinct from 'error': quota exhaustion must be visible, not silent. */
export type RepoMetaStatus = 'ok' | 'not-found' | 'rate-limited' | 'error'
export interface RepoMetaResult { meta: RepoMeta | null; status: RepoMetaStatus }

function rateLimited(res: Response): boolean {
  return res.status === 429
    || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    // secondary/abuse limits: 403 + retry-after, remaining may not be 0
    || (res.status === 403 && res.headers.has('retry-after'))
}

export async function fetchRepoMeta(
  fullName: string,
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<RepoMetaResult> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  let res: Response
  try {
    res = await f(`https://api.github.com/repos/${fullName}`, { headers: ghHeaders(opts.token) })
  } catch {
    return { meta: null, status: 'error' }
  }
  if (res.status === 404) return { meta: null, status: 'not-found' }
  if (rateLimited(res)) return { meta: null, status: 'rate-limited' }
  if (!res.ok) return { meta: null, status: 'error' }
  let b: {
    id?: unknown
    stargazers_count?: unknown; archived?: unknown; fork?: unknown
    pushed_at?: unknown; created_at?: unknown
    license?: unknown; topics?: unknown; default_branch?: unknown
    full_name?: unknown
  }
  try {
    b = await readJsonCapped<typeof b>(res, 4 * 1024 * 1024)
  } catch {
    return { meta: null, status: 'error' }
  }
  // same malformed-doc contract as fetchPackument: a non-object body degrades
  // instead of rejecting, and `??` only covers null/undefined — a string/
  // number/object field is a type lie that crashes downstream ([...topics]
  // in run.ts classify args threw TypeError → per-candidate run-error)
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { meta: null, status: 'error' }
  const strOr = (x: unknown): string | null => (typeof x === 'string' ? x : null)
  const spdx = b.license && typeof b.license === 'object' && !Array.isArray(b.license)
    ? strOr((b.license as { spdx_id?: unknown }).spdx_id) : null
  return {
    meta: {
      id: typeof b.id === 'number' && Number.isFinite(b.id) ? b.id : null,
      stars: typeof b.stargazers_count === 'number' && Number.isFinite(b.stargazers_count) ? b.stargazers_count : 0,
      topics: Array.isArray(b.topics) ? b.topics.filter((x): x is string => typeof x === 'string') : [],
      archived: b.archived === true,
      fork: b.fork === true,
      pushedAt: strOr(b.pushed_at),
      createdAt: strOr(b.created_at),
      license: spdx && spdx !== 'NOASSERTION' ? spdx : null,
      defaultBranch: strOr(b.default_branch),
      fullName: strOr(b.full_name),
    },
    status: 'ok',
  }
}

export interface RepoTreeResult { paths: Set<string> | null; status: RepoMetaStatus; truncated: boolean; sha?: string | null }

/** One git-trees call returns every path — replaces per-file contents probes. */
export async function fetchRepoTree(
  fullName: string,
  branch = 'HEAD',
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<RepoTreeResult> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  let res: Response
  try {
    res = await f(`https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: ghHeaders(opts.token) })
  } catch {
    return { paths: null, status: 'error', truncated: false }
  }
  if (res.status === 404 || res.status === 409) return { paths: null, status: 'not-found', truncated: false }
  if (rateLimited(res)) return { paths: null, status: 'rate-limited', truncated: false }
  if (!res.ok) return { paths: null, status: 'error', truncated: false }
  let b: { tree?: unknown; truncated?: unknown; sha?: unknown }
  try {
    // GitHub truncates huge trees server-side (~7MB + truncated flag); the
    // cap is a second wall, not the primary bound
    b = await readJsonCapped<typeof b>(res, 16 * 1024 * 1024)
  } catch {
    return { paths: null, status: 'error', truncated: false }
  }
  // same malformed-doc contract as fetchPackument/fetchRepoMeta — non-object
  // body degrades. tree absent/null keeps the pinned "empty tree" semantics
  // (`?? []`); a PRESENT non-array tree was a `.map` TypeError → reject, now
  // an honest error status instead of a crash or a silent empty repo
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return { paths: null, status: 'error', truncated: false }
  }
  if (b.tree != null && !Array.isArray(b.tree)) {
    return { paths: null, status: 'error', truncated: false }
  }
  // truncated responses still contain the front of the tree — usable for root
  // probes, but deep SKILL.md paths may be missed (surfaced via `truncated`).
  // sha is the ref-RESOLVED commit hash, not the tree hash: GitHub's
  // git/trees endpoint answers a commit-ish query (HEAD, branch) with the
  // commit's sha in the response `sha` field (verified against the API — the
  // commit's own `commit.tree.sha` differs). Recorded on source.version it
  // doubles as the codeload pin (tar.gz/<sha>) — commits are immutable so
  // installed bytes = scanned bytes (archives aren't byte-deterministic, so
  // no SRI re-check exists).
  const tree = Array.isArray(b.tree) ? b.tree : []
  const paths = new Set(
    tree
      .map(t => (t && typeof t === 'object' ? (t as { path?: unknown }).path : undefined))
      .filter((p): p is string => typeof p === 'string' && p.length > 0))
  return { paths, status: 'ok', truncated: b.truncated === true, sha: typeof b.sha === 'string' ? b.sha : null }
}

/** repository.directory is attacker-controlled and lands RAW in a
 *  raw.githubusercontent.com path — WHATWG URL parsing resolves '.', '..'
 *  AND percent-encoded dot segments, treats '\' as '/', and strips
 *  tab/LF/CR, so a '/'-only '..' segment check misses every smuggle class
 *  ('a\..\b', '..%2f', '..\t/'). Allowlist instead: unicode letters/numbers
 *  plus the URL-safe path charset, '/' separators only, no dot-segments. */
export const unsafeRepoDir = (dir: string | null | undefined): boolean => {
  const d = (dir ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!d) return false
  return /[^\p{L}\p{N}._~/-]/u.test(d) || d.split('/').some(s => s === '.' || s === '..')
}

/** Cross-check npm↔repo correspondence: the repo's own package.json should name
 *  the npm package. Uses the raw CDN (does not consume api.github.com quota).
 *  `dir` handles monorepos (repository.directory). */
export async function fetchRepoPackageName(
  fullName: string,
  opts: { dir?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<{ pkgName: string | null; status: RepoMetaStatus }> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  if (unsafeRepoDir(opts.dir)) return { pkgName: null, status: 'error' }
  const clean = (opts.dir ?? '').replace(/^\/+|\/+$/g, '')
  const dir = clean ? `${clean}/` : ''
  try {
    const res = await f(`https://raw.githubusercontent.com/${fullName}/HEAD/${dir}package.json`)
    if (res.status === 404) return { pkgName: null, status: 'not-found' }
    if (rateLimited(res)) return { pkgName: null, status: 'rate-limited' }
    if (!res.ok) return { pkgName: null, status: 'error' }
    const b = await readJsonCapped<{ name?: unknown }>(res, 2 * 1024 * 1024)
    return { pkgName: typeof b.name === 'string' ? b.name : null, status: 'ok' }
  } catch {
    return { pkgName: null, status: 'error' }
  }
}

/** Repo-root package.json subset (main/exports/name + compat fields) — raw CDN, no API quota. */
export async function fetchRepoPackage(
  fullName: string,
  opts: { dir?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<{ pkg: { name?: string; main?: string; exports?: unknown; engines?: unknown; peerDependencies?: unknown } | null; status: RepoMetaStatus }> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  if (unsafeRepoDir(opts.dir)) return { pkg: null, status: 'error' }
  const clean = (opts.dir ?? '').replace(/^\/+|\/+$/g, '')
  const dir = clean ? `${clean}/` : ''
  try {
    const res = await f(`https://raw.githubusercontent.com/${fullName}/HEAD/${dir}package.json`)
    if (res.status === 404) return { pkg: null, status: 'not-found' }
    if (rateLimited(res)) return { pkg: null, status: 'rate-limited' }
    if (!res.ok) return { pkg: null, status: 'error' }
    const b = await readJsonCapped<{ name?: unknown; main?: unknown; exports?: unknown; engines?: unknown; peerDependencies?: unknown }>(res, 2 * 1024 * 1024)
    return {
      pkg: {
        ...(typeof b.name === 'string' ? { name: b.name } : {}),
        ...(typeof b.main === 'string' ? { main: b.main } : {}),
        ...(b.exports !== undefined ? { exports: b.exports } : {}),
        ...(b.engines !== undefined ? { engines: b.engines } : {}),
        ...(b.peerDependencies !== undefined ? { peerDependencies: b.peerDependencies } : {}),
      },
      status: 'ok',
    }
  } catch {
    return { pkg: null, status: 'error' }
  }
}

export interface MarketMeta {
  category?: string[]
  description?: { en?: string; zh?: string }
}

/** Author-declared metadata: repo-root `.opencode-market.json` (DEV §元数据约定). */
export async function fetchMarketMeta(
  fullName: string,
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<MarketMeta | null> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  try {
    const res = await f(`https://raw.githubusercontent.com/${fullName}/HEAD/.opencode-market.json`,
      { headers: ghHeaders(opts.token) })
    if (!res.ok) return null
    // author-controlled file — a hostile repo can serve an unbounded body
    const b = await readJsonCapped<{ category?: unknown; description?: unknown }>(res, 2 * 1024 * 1024)
    const out: MarketMeta = {}
    // author-declared, attacker-controlled — cap counts/lengths so a hostile
    // meta file can't bloat the catalog index
    if (Array.isArray(b.category) && b.category.every(c => typeof c === 'string')) {
      const cats = (b.category as string[]).map(c => c.slice(0, 80)).filter(Boolean).slice(0, 8)
      if (cats.length) out.category = cats
    }
    if (b.description && typeof b.description === 'object') {
      const d = b.description as Record<string, unknown>
      const desc: { en?: string; zh?: string } = {}
      if (typeof d.en === 'string' && d.en.trim()) desc.en = d.en.slice(0, 4_000)
      if (typeof d.zh === 'string' && d.zh.trim()) desc.zh = d.zh.slice(0, 4_000)
      if (desc.en || desc.zh) out.description = desc
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
