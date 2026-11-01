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
  const res = await fetch(url)
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
  return (await res.json()) as MarketIndex
}
