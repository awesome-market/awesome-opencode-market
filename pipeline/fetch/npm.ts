/** npm fetch: packument metadata + tarball bytes + package.json inspection. */

export interface Packument {
  name: string
  latest: string | null
  latestPublishedAt: string | null
  repository: string | null
  license: string | null
  tarballUrl: string | null
  deprecated: boolean
  keywords: string[]
  main: string | null
  exports: unknown
}

export async function fetchPackument(
  name: string,
  opts: { registry?: string; fetchFn?: typeof fetch } = {},
): Promise<Packument | null> {
  const f = opts.fetchFn ?? fetch
  const base = opts.registry ?? 'https://registry.npmjs.org'
  const res = await f(`${base}/${encodeURIComponent(name)}`)
  if (!res.ok) return null
  const doc = (await res.json()) as {
    'dist-tags'?: { latest?: string }
    versions?: Record<string, {
      repository?: string | { url?: string }
      license?: string | { type?: string }
      dist?: { tarball?: string }
      keywords?: string[]
      main?: string
      exports?: unknown
      deprecated?: string
    }>
    time?: Record<string, string>
  }
  const latest = doc['dist-tags']?.latest ?? null
  const v = latest ? doc.versions?.[latest] : undefined
  const repo = v?.repository
  const repoUrl = typeof repo === 'string' ? repo : repo?.url ?? null
  const lic = v?.license
  return {
    name,
    latest,
    latestPublishedAt: latest ? doc.time?.[latest] ?? null : null,
    repository: repoUrl,
    license: typeof lic === 'string' ? lic : lic?.type ?? null,
    tarballUrl: v?.dist?.tarball ?? null,
    deprecated: Boolean(v?.deprecated),
    keywords: v?.keywords ?? [],
    main: v?.main ?? null,
    exports: v?.exports ?? null,
  }
}

export async function fetchTarball(
  url: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<Buffer> {
  const f = opts.fetchFn ?? fetch
  const res = await f(url)
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** npm download counts, last-30-days window (field name stays honest: this is not installs). */
export async function fetchDownloads30d(
  name: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<number | null> {
  const f = opts.fetchFn ?? fetch
  const res = await f(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`)
  if (!res.ok) return null
  const body = (await res.json()) as { downloads?: number }
  return body.downloads ?? null
}
