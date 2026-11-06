/** Seed ingestion: awesome-list README → high-star repos → npm-candidate list → import into pipeline. */
import { ghHeaders, normalizeRepoUrl } from './github.ts'
import { withTimeout, readJsonCapped } from '../fetch/npm.ts'

export const AWESOME_URL = 'https://raw.githubusercontent.com/awesome-opencode/awesome-opencode/main/README.md'

/** Extract github repo links from markdown. */
export function extractRepos(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
    const repo = m[1]!.replace(/\.git$/, '').replace(/\/$/, '')
    if (!repo.includes('awesome-opencode') && repo.split('/').every(s => s.length > 0)) out.add(repo)
  }
  return [...out]
}

/** Fetch repo stars, keep ≥ minStars, return sorted list (default branch carried for repoToNpm). */
export async function filterByStars(
  repos: string[], minStars: number,
  opts: { token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<{ repo: string; stars: number; branch: string | null }[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const out: { repo: string; stars: number; branch: string | null }[] = []
  for (const repo of repos) {
    const res = await f(`https://api.github.com/repos/${repo}`, { headers: ghHeaders(opts.token) })
    if (!res.ok) continue
    const b = await readJsonCapped<{ stargazers_count?: number; archived?: boolean; default_branch?: string }>(res, 4 * 1024 * 1024)
    if (!b.archived && (b.stargazers_count ?? 0) >= minStars)
      out.push({ repo, stars: b.stargazers_count!, branch: b.default_branch ?? null })
  }
  return out.sort((a, b) => b.stars - a.stars)
}

/** Repo → npm name probe: package.json name field from repo root. */
export async function repoToNpm(
  repo: string,
  opts: { token?: string | undefined; branch?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  for (const br of [...new Set([opts.branch, 'main', 'master'].filter((b): b is string => !!b))]) {
    const res = await f(`https://raw.githubusercontent.com/${repo}/${br}/package.json`)
    if (!res.ok) continue
    try {
      const pkg = await readJsonCapped<{ name?: string }>(res, 2 * 1024 * 1024)
      if (pkg.name) return pkg.name
    } catch { /* not json */ }
  }
  return null
}

/** Full seed flow: awesome md → repos → star filter → npm names → seed list lines. */
export async function buildSeedList(
  opts: { url?: string; minStars?: number; token?: string | undefined; fetchFn?: typeof fetch } = {},
): Promise<string[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const res = await f(opts.url ?? AWESOME_URL)
  if (!res.ok) throw new Error(`awesome fetch failed: ${res.status}`)
  const repos = extractRepos(await res.text())
  const starred = await filterByStars(repos, opts.minStars ?? 50, opts)
  const names: string[] = []
  for (const { repo, branch } of starred) {
    const npm = await repoToNpm(repo, { ...opts, ...(branch ? { branch } : {}) })
    names.push(npm ?? `github:${repo.toLowerCase()}`)
  }
  return names
}

/* v8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const minStars = Number(process.argv[3] ?? 50)
  const list = await buildSeedList({ token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, minStars, ...(process.argv[2] ? { url: process.argv[2] } : {}) })
  console.log(list.join('\n'))
}
