/** Shared catalog fetch — index.json is the single data plane (DEV §1). */
export interface MarketEntry {
  name: string
  slug: string
  type: string
  description?: { en?: string; zh?: string }
  capabilities?: { scannedAt: string | null; findings: string[]; redFlags: string[] }
  verification?: { status: string; level?: string }
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
