/** GitHub fetch: repo metadata + file probes (SKILL.md, opencode.json, plugin entries). */
import { ghHeaders } from '../discover/github.ts'

export async function fetchRepoMeta(
  fullName: string,
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<{ stars: number; archived: boolean; pushedAt: string | null; license: string | null } | null> {
  const f = opts.fetchFn ?? fetch
  const res = await f(`https://api.github.com/repos/${fullName}`, { headers: ghHeaders(opts.token) })
  if (!res.ok) return null
  const b = (await res.json()) as {
    stargazers_count?: number; archived?: boolean; pushed_at?: string; license?: { spdx_id?: string }
  }
  return {
    stars: b.stargazers_count ?? 0,
    archived: b.archived ?? false,
    pushedAt: b.pushed_at ?? null,
    license: b.license?.spdx_id && b.license.spdx_id !== 'NOASSERTION' ? b.license.spdx_id : null,
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
  const res = await f(url, { headers: ghHeaders(opts.token), method: 'HEAD' })
  return res.ok
}
