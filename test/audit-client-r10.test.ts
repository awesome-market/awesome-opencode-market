import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchIndexCached, fetchPkgVersionMeta, assertFetchFinalUrl, isSkillsUrl, isIndexUrl } from '../plugins/market/src/catalog.js'

/** a Response whose .url reports where the redirect chain landed — undici and
 *  webview fetch set it to the final URL; `new Response()` leaves it '' */
const resAt = (body: string, url: string, status = 200): Response => {
  const r = new Response(body, { status })
  Object.defineProperty(r, 'url', { value: url })
  return r
}

const mkLs = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() }
}

const IDX = JSON.stringify({ generatedAt: '2025-01-01T00:00:00Z', plugins: [{ name: 'p', slug: 'p', latestVersion: '1.0.0' }] })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('assertFetchFinalUrl — redirect downgrade gate', () => {
  it('accepts https finals and empty res.url; accepts loopback http (dev index)', () => {
    expect(() => assertFetchFinalUrl(resAt('x', 'https://cdn.example.com/i.json'), 'index')).not.toThrow()
    expect(() => assertFetchFinalUrl(new Response('x'), 'index')).not.toThrow()
    expect(() => assertFetchFinalUrl(resAt('x', 'http://localhost:8000/index.json'), 'index')).not.toThrow()
    expect(() => assertFetchFinalUrl(resAt('x', 'http://127.0.0.1:9999/x.tgz'), 'tgz')).not.toThrow()
  })
  it('rejects non-loopback http and odder schemes a redirect could land on', () => {
    expect(() => assertFetchFinalUrl(resAt('x', 'http://evil.example/i.json'), 'index')).toThrow(/non-https/)
    expect(() => assertFetchFinalUrl(resAt('x', 'file:///etc/passwd'), 'index')).toThrow(/non-https/)
    expect(() => assertFetchFinalUrl(resAt('x', 'ftp://e/x'), 'index')).toThrow(/non-https/)
  })
})

describe('client fetches refuse redirect downgrades', () => {
  it('index.json landing on http → fetchIndexCached rejects instead of caching', async () => {
    vi.stubGlobal('localStorage', mkLs())
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith('health.json')
        ? resAt('nf', 'https://i.example/health.json', 404)
        : resAt(IDX, 'http://evil.example/index.json')))
    await expect(fetchIndexCached('https://i.example/index.json', true)).rejects.toThrow(/non-https/)
  })
  it('health.json landing on http → treated as manifest-less, never trusted', async () => {
    vi.stubGlobal('localStorage', mkLs())
    const f = vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith('health.json')
        ? resAt('{}', 'http://evil.example/health.json')
        : resAt(IDX, 'https://i.example/index.json'))
    vi.stubGlobal('fetch', f)
    // downgraded health is skipped → index pulls unpinned but still https-final
    const idx = await fetchIndexCached('https://i.example/index.json', true)
    expect(idx.plugins.length).toBe(1)
  })
  it('packument landing on http → fetchPkgVersionMeta rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resAt('{}', 'http://evil.example/p')))
    await expect(fetchPkgVersionMeta('pkg', '1.0.0')).rejects.toThrow(/non-https/)
  })
  it('loopback-http dev index still fetches (the carve-out is narrow, not removed)', async () => {
    vi.stubGlobal('localStorage', mkLs())
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL) =>
      String(u).endsWith('health.json')
        ? resAt('nf', 'http://localhost:8000/health.json', 404)
        : resAt(IDX, 'http://localhost:8000/index.json')))
    const idx = await fetchIndexCached('http://localhost:8000/index.json', true)
    expect(idx.plugins.length).toBe(1)
  })
})

describe('isSkillsUrl — skills[] toggle accepts the dev loop too', () => {
  it('https with trailing slash, loopback http, rejects everything else', () => {
    expect(isSkillsUrl('https://x.github.io/repo/skills/')).toBe(true)
    expect(isSkillsUrl('http://localhost:8000/skills/')).toBe(true)
    expect(isSkillsUrl('http://127.0.0.1/skills/')).toBe(true)
    expect(isSkillsUrl('http://evil.example/skills/')).toBe(false)
    expect(isSkillsUrl('https://x.example/noSlash')).toBe(false)   // namespace, not file
    expect(isSkillsUrl('ftp://x/skills/')).toBe(false)
    expect(isSkillsUrl(42)).toBe(false)
  })
  it('loopback index derives a skills url its own toggle accepts', () => {
    const ix = 'http://localhost:8000/index.json'
    expect(isIndexUrl(ix)).toBe(true)
    expect(isSkillsUrl(new URL('skills/', ix).href)).toBe(true)
  })
})
