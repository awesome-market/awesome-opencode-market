/** npm registry discovery: keyword search with pagination + rank filtering. */

export const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'
export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** Configurable keyword net — wide on purpose, evidence filter comes later (DEV §4.5). */
export const KEYWORDS = ['opencode-plugin', 'opencode', 'opencode-ai'] as const

export interface NpmSearchResult {
  name: string
  version: string
  description: string
  keywords: string[]
  repoUrl: string | null
  publishedAt: string | null
}

interface NpmSearchObject {
  package: {
    name: string
    version: string
    description?: string
    keywords?: string[]
    links?: { repository?: string; npm?: string }
    date?: string
  }
}

export async function searchByKeyword(
  keyword: string,
  opts: { size?: number; maxPages?: number; fetchFn?: typeof fetch } = {},
): Promise<NpmSearchResult[]> {
  const f = opts.fetchFn ?? fetch
  const size = opts.size ?? 250
  const maxPages = opts.maxPages ?? 10 // registry caps ~1000 results anyway
  const out: NpmSearchResult[] = []
  for (let page = 0; page < maxPages; page++) {
    const url = `${NPM_SEARCH_URL}?text=keywords:${encodeURIComponent(keyword)}&size=${size}&from=${page * size}`
    const res = await f(url)
    if (!res.ok) break
    const body = (await res.json()) as { objects?: NpmSearchObject[]; total?: number }
    const objects = body.objects ?? []
    for (const o of objects) {
      const p = o.package
      out.push({
        name: p.name,
        version: p.version,
        description: p.description ?? '',
        keywords: p.keywords ?? [],
        repoUrl: p.links?.repository ?? null,
        publishedAt: p.date ?? null,
      })
    }
    if (objects.length < size) break
  }
  return out
}

export async function discoverNpm(
  keywords: readonly string[] = KEYWORDS,
  opts: Parameters<typeof searchByKeyword>[1] = {},
): Promise<Map<string, NpmSearchResult & { discoveredVia: string[] }>> {
  const map = new Map<string, NpmSearchResult & { discoveredVia: string[] }>()
  for (const kw of keywords) {
    for (const r of await searchByKeyword(kw, opts)) {
      if (!map.has(r.name)) {
        map.set(r.name, { ...r, discoveredVia: ['npm-keyword'] })
      }
    }
  }
  return map
}
