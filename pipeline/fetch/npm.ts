/** npm fetch: packument metadata + tarball bytes + package.json inspection. */

export interface Packument {
  name: string
  latest: string | null
  latestPublishedAt: string | null
  /** package-level creation/modified timestamps — name-reuse detection */
  createdAt: string | null
  modifiedAt: string | null
  repository: string | null
  repositoryDir: string | null     // monorepo subdirectory, e.g. "packages/foo"
  license: string | null
  tarballUrl: string | null
  deprecated: boolean
  deprecatedMessage: string | null
  keywords: string[]
  main: string | null
  exports: unknown
  maintainers: string[]
  distTags: Record<string, string>
  /** package readme (capped) — readme-install evidence check */
  readme: string | null
  /** per-version dist.integrity (SRI sha512) — install-time drift check */
  integrityOf: Record<string, string>
  /** per-version dist.tarball — a pinned hold re-scan needs the HELD
   *  version's tarball, which `tarballUrl` (latest only) can't give */
  tarballOf: Record<string, string>
}

export type PackumentStatus = 'ok' | 'not-found' | 'error'
export interface PackumentResult { pk: Packument | null; status: PackumentStatus }

/** Default fetch wrapper: timeout guard — a hung registry/repo response must
 *  not stall a worker for the whole 60-minute job budget. Custom fetchFn
 *  (tests, proxies) is passed the signal too; implementations may ignore it. */
export const withTimeout = (f: typeof fetch, timeoutMs: number): typeof fetch =>
  (input, init) => f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) })

export async function fetchPackument(
  name: string,
  opts: { registry?: string; fetchFn?: typeof fetch; abbreviated?: boolean } = {},
): Promise<PackumentResult> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const base = opts.registry ?? 'https://registry.npmjs.org'
  let res: Response
  try {
    // gone-check probes only need existence + dist.tarball — the install-v1
    // abbreviated document carries both and is a fraction of the full
    // packument's size (readme/maintainers/time trimmed server-side)
    res = await f(`${base}/${encodeURIComponent(name)}`,
      opts.abbreviated ? { headers: { Accept: 'application/vnd.npm.install-v1+json' } } : undefined)
  } catch {
    return { pk: null, status: 'error' }
  }
  if (res.status === 404) return { pk: null, status: 'not-found' }
  if (!res.ok) return { pk: null, status: 'error' }
  let doc: {
    'dist-tags'?: { latest?: string } & Record<string, string>
    maintainers?: Array<{ name?: string } | string>
    versions?: Record<string, {
      repository?: string | { url?: string; directory?: string }
      license?: string | { type?: string }
      dist?: { tarball?: string; integrity?: string }
      keywords?: string[]
      main?: string
      exports?: unknown
      deprecated?: string
    }>
    time?: Record<string, string>
    readme?: string
  }
  try {
    doc = (await res.json()) as typeof doc
  } catch {
    return { pk: null, status: 'error' }
  }
  const distTags = (doc['dist-tags'] ?? {}) as Record<string, string>
  const latest = distTags.latest ?? null
  const v = latest ? doc.versions?.[latest] : undefined
  const repo = v?.repository
  const repoUrl = typeof repo === 'string' ? repo : repo?.url ?? null
  const lic = v?.license
  return {
    pk: {
      name,
      latest,
      latestPublishedAt: latest ? doc.time?.[latest] ?? null : null,
      createdAt: doc.time?.created ?? null,
      modifiedAt: doc.time?.modified ?? null,
      repository: repoUrl,
      repositoryDir: typeof repo === 'object' && repo ? repo.directory ?? null : null,
      license: typeof lic === 'string' ? lic : lic?.type ?? null,
      tarballUrl: v?.dist?.tarball ?? null,
      deprecated: Boolean(v?.deprecated),
      deprecatedMessage: v?.deprecated ?? null,
      keywords: v?.keywords ?? [],
      main: v?.main ?? null,
      exports: v?.exports ?? null,
      maintainers: (doc.maintainers ?? []).map(m => typeof m === 'string' ? m : m.name ?? '').filter(Boolean),
      distTags,
      readme: typeof doc.readme === 'string' ? doc.readme.slice(0, 200_000) : null,
      integrityOf: Object.fromEntries(
        Object.entries(doc.versions ?? {})
          .map(([v, x]) => [v, x?.dist?.integrity] as const)
          .filter((x): x is readonly [string, string] => typeof x[1] === 'string')),
      tarballOf: Object.fromEntries(
        Object.entries(doc.versions ?? {})
          .map(([v, x]) => [v, x?.dist?.tarball] as const)
          .filter((x): x is readonly [string, string] => typeof x[1] === 'string')),
    },
    status: 'ok',
  }
}

const TARBALL_MAX = 64 * 1024 * 1024
export async function fetchTarball(
  url: string,
  opts: { fetchFn?: typeof fetch; maxBytes?: number } = {},
): Promise<Buffer> {
  // callers that only need a content slice (AI review material) can pass a
  // much smaller cap than the scan-path default — 8 concurrent 64MB fetches
  // would be a memory spike for files the reviewer never reads anyway
  const MAX = opts.maxBytes ?? TARBALL_MAX
  // tarballUrl comes from packument/registry — restrict to https so a hostile
  // registry/mirror can't steer the fetch at file:// or an internal address
  let scheme: string
  try {
    scheme = new URL(url).protocol
  } catch {
    throw new Error(`tarball url malformed: ${url.slice(0, 80)}`)
  }
  if (scheme !== 'https:') throw new Error(`tarball url must be https: ${url.slice(0, 80)}`)
  const f = withTimeout(opts.fetchFn ?? fetch, 30_000)
  const res = await f(url)
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX) throw new Error(`tarball too large: ${len} bytes (cap ${MAX})`)
  // content-length can lie or be absent — stream with a byte cap so a
  // hostile/buggy server can't OOM the worker (the 30s timeout alone
  // allowed an unbounded arrayBuffer to ingest GBs before rejecting)
  const chunks: Buffer[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX) throw new Error(`tarball too large: ${buf.length} bytes (cap ${MAX})`)
    return buf
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX) {
      await reader.cancel()
      throw new Error(`tarball too large: >${MAX} bytes`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** npm download counts, last-30-days window (field name stays honest: this is not installs). */
export async function fetchDownloads30d(
  name: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<number | null> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  try {
    const res = await f(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`)
    if (!res.ok) return null
    const body = (await res.json()) as { downloads?: number }
    return body.downloads ?? null
  } catch {
    return null
  }
}
