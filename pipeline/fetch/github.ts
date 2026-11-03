/** GitHub fetch: repo metadata + file probes (SKILL.md, opencode.json, plugin entries). */
import { ghHeaders } from '../discover/github.ts'

export interface RepoMeta {
  id: number | null              // numeric repo id — repojacking detection (id changes on recreation)
  stars: number
  archived: boolean
  pushedAt: string | null
  createdAt: string | null
  license: string | null
  topics: string[]
  defaultBranch: string | null
}

/** 'rate-limited' is distinct from 'error': quota exhaustion must be visible, not silent. */
export type RepoMetaStatus = 'ok' | 'not-found' | 'rate-limited' | 'error'
export interface RepoMetaResult { meta: RepoMeta | null; status: RepoMetaStatus }

function rateLimited(res: Response): boolean {
  return res.status === 429
    || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
}

export async function fetchRepoMeta(
  fullName: string,
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<RepoMetaResult> {
  const f = opts.fetchFn ?? fetch
  let res: Response
  try {
    res = await f(`https://api.github.com/repos/${fullName}`, { headers: ghHeaders(opts.token) })
  } catch {
    return { meta: null, status: 'error' }
  }
  if (res.status === 404) return { meta: null, status: 'not-found' }
  if (rateLimited(res)) return { meta: null, status: 'rate-limited' }
  if (!res.ok) return { meta: null, status: 'error' }
  const b = (await res.json()) as {
    id?: number
    stargazers_count?: number; archived?: boolean; pushed_at?: string; created_at?: string
    license?: { spdx_id?: string }; topics?: string[]; default_branch?: string
  }
  return {
    meta: {
      id: b.id ?? null,
      stars: b.stargazers_count ?? 0,
      topics: b.topics ?? [],
      archived: b.archived ?? false,
      pushedAt: b.pushed_at ?? null,
      createdAt: b.created_at ?? null,
      license: b.license?.spdx_id && b.license.spdx_id !== 'NOASSERTION' ? b.license.spdx_id : null,
      defaultBranch: b.default_branch ?? null,
    },
    status: 'ok',
  }
}

export interface RepoTreeResult { paths: Set<string> | null; status: RepoMetaStatus }

/** One git-trees call returns every path — replaces per-file contents probes. */
export async function fetchRepoTree(
  fullName: string,
  branch = 'HEAD',
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<RepoTreeResult> {
  const f = opts.fetchFn ?? fetch
  let res: Response
  try {
    res = await f(`https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: ghHeaders(opts.token) })
  } catch {
    return { paths: null, status: 'error' }
  }
  if (res.status === 404 || res.status === 409) return { paths: null, status: 'not-found' }
  if (rateLimited(res)) return { paths: null, status: 'rate-limited' }
  if (!res.ok) return { paths: null, status: 'error' }
  const b = (await res.json()) as { tree?: Array<{ path?: string }>; truncated?: boolean }
  // truncated responses still contain the front of the tree — usable for root probes
  return { paths: new Set((b.tree ?? []).map(t => t.path).filter((p): p is string => !!p)), status: 'ok' }
}

/** Cross-check npm↔repo correspondence: the repo's own package.json should name
 *  the npm package. Uses the raw CDN (does not consume api.github.com quota).
 *  `dir` handles monorepos (repository.directory). */
export async function fetchRepoPackageName(
  fullName: string,
  opts: { dir?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<{ pkgName: string | null; status: RepoMetaStatus }> {
  const f = opts.fetchFn ?? fetch
  const dir = opts.dir ? `${opts.dir.replace(/^\/+|\/+$/g, '')}/` : ''
  try {
    const res = await f(`https://raw.githubusercontent.com/${fullName}/HEAD/${dir}package.json`)
    if (res.status === 404) return { pkgName: null, status: 'not-found' }
    if (rateLimited(res)) return { pkgName: null, status: 'rate-limited' }
    if (!res.ok) return { pkgName: null, status: 'error' }
    const b = (await res.json()) as { name?: unknown }
    return { pkgName: typeof b.name === 'string' ? b.name : null, status: 'ok' }
  } catch {
    return { pkgName: null, status: 'error' }
  }
}

/** Probe whether a path exists in a repo (default branch). */
export async function repoFileExists(
  fullName: string,
  path: string,
  opts: { token?: string | undefined; branch?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  const f = opts.fetchFn ?? fetch
  const url = `https://api.github.com/repos/${fullName}/contents/${path}${opts.branch ? `?ref=${opts.branch}` : ''}`
  try {
    const res = await f(url, { headers: ghHeaders(opts.token), method: 'HEAD' })
    return res.ok
  } catch {
    return false
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
  const f = opts.fetchFn ?? fetch
  try {
    const res = await f(`https://raw.githubusercontent.com/${fullName}/HEAD/.opencode-market.json`,
      { headers: ghHeaders(opts.token) })
    if (!res.ok) return null
    const b = (await res.json()) as { category?: unknown; description?: unknown }
    const out: MarketMeta = {}
    if (Array.isArray(b.category) && b.category.every(c => typeof c === 'string')) {
      out.category = b.category as string[]
    }
    if (b.description && typeof b.description === 'object') {
      const d = b.description as Record<string, unknown>
      const desc: { en?: string; zh?: string } = {}
      if (typeof d.en === 'string') desc.en = d.en
      if (typeof d.zh === 'string') desc.zh = d.zh
      if (desc.en || desc.zh) out.description = desc
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
