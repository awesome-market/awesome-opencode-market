/** §10 client audit — index-cache shape guard + registry-scoped packument cache. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchIndexCached, fetchPkgVersionMeta } from '../plugins/market/src/catalog.ts'

const LS_IDX = 'opencode-market.index.v1'
const mkLs = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}
const IDX_BODY = JSON.stringify({ version: '1', generatedAt: 't', categories: {}, plugins: [], removed: [] })

afterEach(() => { vi.unstubAllGlobals(); delete process.env.npm_config_registry })

describe('readIdxCache shape guard', () => {
  it('a truthy-but-shapeless blob must not serve `undefined` as the catalog', async () => {
    vi.stubGlobal('localStorage', mkLs())
    // corrupt value that ISN'T null — JSON parses fine, but has no .index.plugins.
    // The old truthiness check let it pass: TTL path then served cached.index
    // (undefined) — the catalog rendered empty while never touching the network.
    localStorage.setItem(LS_IDX, JSON.stringify({ at: Date.now() }))
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) => {
      calls.push(String(u))
      return String(u).endsWith('health.json') ? new Response('nf', { status: 404 }) : new Response(IDX_BODY)
    }))
    const idx = await fetchIndexCached('https://i1.example/index.json')
    expect(calls.some(u => u.endsWith('index.json'))).toBe(true)   // corrupt → treated as absent → real pull
    expect(Array.isArray(idx?.plugins)).toBe(true)
  })
  it('corrupt blob + fetch failure rejects with the real error, not a TypeError in the fallback', async () => {
    vi.stubGlobal('localStorage', mkLs())
    // stale-TTL corrupt blob → fetch path → catch derefs cached.index.categories
    // inside the stale-fallback → an unhandled TypeError replaced the real error
    localStorage.setItem(LS_IDX, JSON.stringify({ at: 1 }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(fetchIndexCached('https://i2.example/index.json'))
      .rejects.toThrow(/catalog fetch failed: 503/)
  })
  it('a primitive cache value behaves the same — absent, not truthy', async () => {
    vi.stubGlobal('localStorage', mkLs())
    localStorage.setItem(LS_IDX, '5')
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith('health.json') ? new Response('nf', { status: 404 }) : new Response(IDX_BODY)))
    const idx = await fetchIndexCached('https://i3.example/index.json')
    expect(Array.isArray(idx?.plugins)).toBe(true)
  })
})

describe('packument cache is registry-scoped', () => {
  it('switching npm_config_registry refetches — the old registry\'s metadata must not linger', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) => {
      calls.push(String(u))
      return new Response(JSON.stringify({ versions: { '1.0.0': { dist: { tarball: 'https://t/x.tgz' } } } }))
    }))
    process.env.npm_config_registry = 'https://reg-a.example'
    await fetchPkgVersionMeta('reg-switch-pkg', '1.0.0')
    process.env.npm_config_registry = 'https://reg-b.example'
    const meta = await fetchPkgVersionMeta('reg-switch-pkg', '1.0.0')
    expect(calls).toEqual(['https://reg-a.example/reg-switch-pkg', 'https://reg-b.example/reg-switch-pkg'])
    expect(meta.tarball).toBe('https://t/x.tgz')
  })
  it('same registry reuses the cached packument', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) => {
      calls.push(String(u))
      return new Response(JSON.stringify({ versions: { '1.0.0': { dist: {} } } }))
    }))
    process.env.npm_config_registry = 'https://reg-c.example'
    await fetchPkgVersionMeta('reg-same-pkg', '1.0.0')
    await fetchPkgVersionMeta('reg-same-pkg', '1.0.0')
    expect(calls).toHaveLength(1)
  })
})
