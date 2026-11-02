/** Shared catalog fetch — index.json is the single data plane (DEV §1). */
export interface MarketEntry {
  name: string
  slug: string
  type: string
  description?: { en?: string; zh?: string }
  category: string[]
  latestVersion?: string | null
  capabilities?: { scannedAt: string | null; findings: string[]; redFlags: string[] }
  verification?: { status: string; level?: string; verifiedAt?: string; opencodeVersion?: string }
  metrics?: { stars: number | null; npmDownloads30d: number | null }
}

export interface MarketIndex {
  version: string
  generatedAt: string
  plugins: MarketEntry[]
}

/** Default source: GitHub Pages. Overridable via plugin options later. */
export const DEFAULT_INDEX_URL =
  'https://terry2010.github.io/opencode-market-spike/index.json'

export async function fetchIndex(url = DEFAULT_INDEX_URL): Promise<MarketIndex> {
  // timeout guard — a sandboxed webview fetch that never settles must surface as an error
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
    return (await res.json()) as MarketIndex
  } finally {
    clearTimeout(t)
  }
}

/** Sorted rows for UI views (verified first, then unverified, redFlag last). */
export function rows(entries: MarketEntry[]): MarketEntry[] {
  const rank = (e: MarketEntry) =>
    e.verification?.status === 'verified' ? 0 : e.capabilities?.redFlags.length ? 2 : 1
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** Client-side search over name+description (case-insensitive substring). */
export function search(entries: MarketEntry[], q: string): MarketEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter(e =>
    e.name.toLowerCase().includes(needle) || (e.description?.en ?? '').toLowerCase().includes(needle))
}

/** Distinct categories across entries, sorted. */
export function categoriesOf(entries: MarketEntry[]): string[] {
  return [...new Set(entries.flatMap(e => e.category))].sort()
}

const sortKey = (e: MarketEntry, k: string): number | string => {
  switch (k) {
    case 'downloads': return -(e.metrics?.npmDownloads30d ?? 0)
    case 'stars': return -(e.metrics?.stars ?? 0)
    case 'name': return e.name
    default: { // verified first, then unverified, skipped, failed last
      const order: Record<string, number> = { verified: 0, unverified: 1, skipped: 2, failed: 3 }
      return order[e.verification?.status ?? 'unverified'] ?? 1
    }
  }
}

/** Stable sort by key — verified-first default, or metric desc, or name asc. */
export function sortEntries(entries: MarketEntry[], key: string): MarketEntry[] {
  return [...entries].sort((a, b) => {
    const ka = sortKey(a, key), kb = sortKey(b, key)
    return ka < kb ? -1 : ka > kb ? 1 : a.name.localeCompare(b.name)
  })
}
