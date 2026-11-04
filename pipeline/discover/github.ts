/** GitHub discovery: topic search + repo metadata. Unauthenticated works (60 req/h); GH_TOKEN raises limits. */
import { withTimeout } from '../fetch/npm.ts'

export const GH_API = 'https://api.github.com'
export const TOPICS = ['opencode-plugin', 'opencode', 'agent-skill', 'opencode-skill'] as const

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
  for (let page = 1; page <= (opts.maxPages ?? 5); page++) {
    const url = `${GH_API}/search/repositories?q=topic:${encodeURIComponent(topic)}&sort=updated&per_page=100&page=${page}`
    const res = await f(url, { headers: ghHeaders(opts.token) })
    if (!res.ok) break
    const body = (await res.json()) as {
      items?: Array<{
        full_name: string; description: string | null; archived: boolean
        fork: boolean; pushed_at: string | null; stargazers_count: number; default_branch: string
        id?: number; created_at?: string | null
        license?: { spdx_id?: string } | null; topics?: string[]
      }>
    }
    const items = body.items ?? []
    for (const it of items) {
      out.push({
        fullName: it.full_name,
        description: it.description ?? '',
        archived: it.archived,
        fork: it.fork,
        pushedAt: it.pushed_at,
        stars: it.stargazers_count,
        defaultBranch: it.default_branch,
        id: it.id ?? null,
        createdAt: it.created_at ?? null,
        license: it.license?.spdx_id && it.license.spdx_id !== 'NOASSERTION' ? it.license.spdx_id : null,
        topics: it.topics ?? [],
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
  for (const t of topics) {
    for (const r of await searchTopic(t, opts)) {
      if (!map.has(r.fullName)) {
        map.set(r.fullName, { ...r, discoveredVia: ['github-topic'] })
      }
    }
  }
  return map
}

/** Canonical repo URL extraction from an npm repository field (handles git+, git@, ssh, monorepo dir). */
export function normalizeRepoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  s = s.replace(/^git\+/, '').replace(/\.git$/, '')
  s = s.replace(/^git@github\.com:/, 'https://github.com/')
  s = s.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
  const m = s.match(/github\.com\/([^/]+\/[^/#?]+)/)
  if (!m) return null
  return m[1]!.replace(/\/$/, '')
}
