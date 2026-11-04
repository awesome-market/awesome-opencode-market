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
  opts: { registry?: string; fetchFn?: typeof fetch } = {},
): Promise<PackumentResult> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const base = opts.registry ?? 'https://registry.npmjs.org'
  let res: Response
  try {
    res = await f(`${base}/${encodeURIComponent(name)}`)
  } catch {
    return { pk: null, status: 'error' }
  }
  if (res.status === 404) return { pk: null, status: 'not-found' }
  if (!res.ok) return { pk: null, status: 'error' }
  const doc = (await res.json()) as {
    'dist-tags'?: { latest?: string } & Record<string, string>
    maintainers?: Array<{ name?: string } | string>
    versions?: Record<string, {
      repository?: string | { url?: string; directory?: string }
      license?: string | { type?: string }
      dist?: { tarball?: string }
      keywords?: string[]
      main?: string
      exports?: unknown
      deprecated?: string
    }>
    time?: Record<string, string>
    readme?: string
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
    },
    status: 'ok',
  }
}

const TARBALL_MAX = 64 * 1024 * 1024
export async function fetchTarball(
  url: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<Buffer> {
  const f = withTimeout(opts.fetchFn ?? fetch, 30_000)
  const res = await f(url)
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > TARBALL_MAX) throw new Error(`tarball too large: ${len} bytes`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > TARBALL_MAX) throw new Error(`tarball too large: ${buf.length} bytes`)
  return buf
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
