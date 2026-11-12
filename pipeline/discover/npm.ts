/** npm registry discovery: keyword search with pagination + rank filtering. */
import { withTimeout, readJsonCapped } from '../fetch/npm.ts'
import { mapPool } from '../pool.ts'

export const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'
export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** Configurable keyword net — wide on purpose, evidence filter comes later (DEV §4.5).
 *  Covers the opencode-* family observed on the registry; keyword-only hits
 *  never admit without artifact evidence downstream. */
export const KEYWORDS = ['opencode-plugin', 'opencode', 'opencode-ai', 'opencode-skill', 'opencode-mcp', 'opencode-config'] as const

export interface NpmSearchResult {
  name: string
  version: string
  description: string
  keywords: string[]
  repoUrl: string | null
  publishedAt: string | null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function searchByKeyword(
  keyword: string,
  opts: { size?: number; maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<NpmSearchResult[]> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const size = opts.size ?? 250
  const maxPages = opts.maxPages ?? 10 // registry caps ~1000 results anyway
  const out: NpmSearchResult[] = []
  let hitPageCap = false
  for (let page = 0; page < maxPages; page++) {
    const url = `${NPM_SEARCH_URL}?text=keywords:${encodeURIComponent(keyword)}&size=${size}&from=${page * size}`
    let body: unknown
    let retried = false
    for (;;) {
      try {
        const res = await f(url)
        // a mid-pagination failure must be loud — the candidate tail silently
        // vanished otherwise (truncation telemetry). fetch throws and JSON
        // parse/oversize errors take the same path: run.ts awaits discovery
        // bare, so an uncaught rejection here kills the whole catalog run.
        // 429/5xx are rate/transient — one spaced retry per page recovers
        // most truncations; honor Retry-After when the registry sends one.
        if (!res.ok) {
          if ((res.status === 429 || res.status >= 500) && !retried) {
            retried = true
            const ra = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
            const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) : 3
            await sleep(opts.fetchFn ? 0 : wait * 1000)
            continue
          }
          console.warn(`[discover:npm] '${keyword}' page ${page} failed (${res.status}) — results truncated`)
          break
        }
        body = await readJsonCapped<unknown>(res, 8 * 1024 * 1024)
      } catch (e) {
        console.warn(`[discover:npm] '${keyword}' page ${page} failed (${e instanceof Error ? e.message : e}) — results truncated`)
        break
      }
      break
    }
    if (body === undefined) break
    // same malformed-doc contract as fetchPackument: non-object body or a
    // non-array `objects` degrades to an empty page. Each hit needs a string
    // package.name — it is the dedupe key (`map.set(r.name)` in discoverNpm
    // and `c.name.split` in run.ts), so a missing/wrong-typed name was a
    // run-killer, not a bad row
    const raw = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { objects?: unknown }).objects : undefined
    const objects = Array.isArray(raw) ? raw : []
    for (const o of objects) {
      const p = o && typeof o === 'object' && !Array.isArray(o)
        ? (o as { package?: unknown }).package : undefined
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue
      const pkg = p as Record<string, unknown>
      const name = typeof pkg.name === 'string' ? pkg.name : null
      if (!name) continue
      const links = pkg.links && typeof pkg.links === 'object' && !Array.isArray(pkg.links)
        ? pkg.links as Record<string, unknown> : null
      out.push({
        name,
        version: typeof pkg.version === 'string' ? pkg.version : '',
        description: typeof pkg.description === 'string' ? pkg.description : '',
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter((k): k is string => typeof k === 'string') : [],
        repoUrl: links && typeof links.repository === 'string' ? links.repository : null,
        publishedAt: typeof pkg.date === 'string' ? pkg.date : null,
      })
    }
    if (objects.length < size) break
    if (page === maxPages - 1) hitPageCap = true
  }
  if (hitPageCap) console.warn(`[discover:npm] '${keyword}' exhausted ${maxPages} full pages — tail results dropped`)
  return out
}

export async function discoverNpm(
  keywords: readonly string[] = KEYWORDS,
  opts: Parameters<typeof searchByKeyword>[1] = {},
): Promise<Map<string, NpmSearchResult & { discoveredVia: string[] }>> {
  const map = new Map<string, NpmSearchResult & { discoveredVia: string[] }>()
  // keywords run a few at a time — each keyword still pages serially, but the
  // per-page 15s worst case stops compounding across the whole keyword list
  await mapPool(keywords, 3, async kw => {
    for (const r of await searchByKeyword(kw, opts)) {
      if (!map.has(r.name)) {
        map.set(r.name, { ...r, discoveredVia: ['npm-keyword'] })
      }
    }
  })
  return map
}
