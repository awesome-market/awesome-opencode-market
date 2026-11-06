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
  /** per-version engines/peerDependencies → `entry.compat` (schema-compat
   *  strings; the site/client render engines · peer on the details page) */
  compatOf: Record<string, VersionCompat>
}

export interface VersionCompat { engines?: string; peer?: string; [k: string]: unknown }

/** Packument fields are attacker-controlled — serialize engines/peer to the
 *  schema's two display strings with hard length caps. */
export function compatStrings(engines: unknown, peer: unknown): VersionCompat {
  const out: VersionCompat = {}
  if (typeof engines === 'string') {
    if (engines.trim()) out.engines = engines.slice(0, 300)
  } else if (engines && typeof engines === 'object' && !Array.isArray(engines)) {
    const s = Object.entries(engines as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([k, v]) => `${k} ${v}`).join('; ')
    if (s) out.engines = s.slice(0, 300)
  }
  if (peer && typeof peer === 'object' && !Array.isArray(peer)) {
    const s = Object.entries(peer as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([k, v]) => `${k}@${v}`).join(', ')
    if (s) out.peer = s.slice(0, 500)
  }
  return out
}

export type PackumentStatus = 'ok' | 'not-found' | 'error'
export interface PackumentResult { pk: Packument | null; status: PackumentStatus }

/** Default fetch wrapper: timeout guard — a hung registry/repo response must
 *  not stall a worker for the whole 60-minute job budget. Custom fetchFn
 *  (tests, proxies) is passed the signal too; implementations may ignore it. */
export const withTimeout = (f: typeof fetch, timeoutMs: number): typeof fetch =>
  (input, init) => f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) })

/** Bounded JSON body read — `res.json()` buffers the whole response with no
 *  size guard, and a pathological document (a packument with tens of
 *  thousands of versions, a hostile .opencode-market.json) can OOM the whole
 *  generate job before any catch clause sees an error. Same streamed-byte-cap
 *  posture as fetchTarball: content-length can lie or be absent, so count
 *  real bytes. Test doubles without a body stream fall back to text()/json(). */
export async function readJsonCapped<T>(res: Response, maxBytes: number): Promise<T> {
  const len = Number(res.headers?.get?.('content-length') ?? 0)
  if (len > maxBytes) throw new Error(`response too large: ${len} bytes (cap ${maxBytes})`)
  const reader = res.body?.getReader?.()
  if (reader) {
    const chunks: Buffer[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`response too large: >${maxBytes} bytes`)
      }
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }
  if (typeof res.text === 'function') {
    const text = await res.text()
    if (text.length > maxBytes) throw new Error(`response too large: ${text.length} bytes (cap ${maxBytes})`)
    return JSON.parse(text) as T
  }
  return res.json() as Promise<T>
}

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
      engines?: unknown
      peerDependencies?: unknown
    }>
    time?: Record<string, string>
    readme?: string
  }
  try {
    // packuments grow with version count — the biggest real ones run tens of
    // MB; unbounded res.json() lets a pathological package OOM the whole job
    doc = await readJsonCapped<typeof doc>(res, 64 * 1024 * 1024)
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
      compatOf: Object.fromEntries(
        Object.entries(doc.versions ?? {})
          .map(([v, x]) => [v, compatStrings(x?.engines, x?.peerDependencies)] as const)
          .filter((x): x is readonly [string, VersionCompat] => !!(x[1].engines || x[1].peer))),
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
  // follow redirects manually — the entry-URL https check is worthless if a
  // redirect downgrades to http:// or steers into an internal host, so every
  // hop is re-validated against the same rule
  let target = url
  for (let hop = 0; ; hop++) {
    const res = await f(target, { redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      if (hop >= 5) throw new Error(`tarball redirect chain too long (>5 hops)`)
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`tarball redirect without Location header`)
      let next: URL
      try {
        next = new URL(loc, target)
      } catch {
        throw new Error(`tarball redirect location malformed: ${loc.slice(0, 80)}`)
      }
      if (next.protocol !== 'https:') throw new Error(`tarball redirect to non-https: ${next.protocol}`)
      await res.body?.cancel()
      target = next.toString()
      continue
    }
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
    const body = await readJsonCapped<{ downloads?: number }>(res, 1024 * 1024)
    return body.downloads ?? null
  } catch {
    return null
  }
}
