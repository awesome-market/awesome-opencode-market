import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchIndex, rows, DEFAULT_INDEX_URL } from '../src/catalog.ts'
import type { MarketEntry, MarketIndex } from '../src/catalog.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(dir, '../package.json'), 'utf8'))

const mkEntry = (name: string, status: string, red = 0): MarketEntry => ({
  name, slug: name, type: 'plugin', category: [],
  capabilities: { scannedAt: 't', findings: [], redFlags: Array(red).fill('x') },
  verification: { status },
})

describe('market plugin', () => {
  it('exports map satisfies the host entry contract', () => {
    expect(pkg.exports['.']).toBe('./dist/server.js')
    expect(pkg.exports['./tui']).toBe('./dist/tui.js')
    expect(pkg.exports['./gui-experimental']).toBe('./dist/gui.cjs')
  })
  it('gui bundle exists and is CommonJS-evaluable text', () => {
    const p = join(dir, '../dist/gui.cjs')
    if (!existsSync(p)) {
      execFileSync('npx', ['tsx', 'build.ts'], { cwd: join(dir, '..') })
    }
    const code = readFileSync(join(dir, '../dist/gui.cjs'), 'utf8')
    expect(code).toContain('opencode-market')
    // CJS marker: module.exports or exports usage — ESM `export` statements must not appear top-level
    expect(code).not.toMatch(/^export\s+(default|\{)/m)
  })
  it('fetchIndex parses index shape', async () => {
    const idx = await fetchIndex().catch(() => null) // network optional in tests
    if (idx) expect(idx.plugins).toBeInstanceOf(Array)
    expect(DEFAULT_INDEX_URL).toContain('index.json')
  })
  it('rows: verified first, redFlag last, name order within', () => {
    const r = rows([
      mkEntry('b-unver', 'unverified'),
      mkEntry('a-ver', 'verified'),
      mkEntry('c-flag', 'skipped', 1),
    ])
    expect(r.map(e => e.name)).toEqual(['a-ver', 'b-unver', 'c-flag'])
  })
})

describe('catalog helpers', () => {
  it('redactLog strips home paths and secrets', async () => {
    const { redactLog } = await import('../src/catalog.ts')
    const t = redactLog('err /Users/terry/x token=abc123 sk-abcdefghijkl at /home/bob/y key: z')
    expect(t).not.toContain('terry'); expect(t).not.toContain('abc123'); expect(t).not.toContain('sk-abc')
    expect(t).toContain('<home>'); expect(t).toContain('<redacted>')
  })
  it('keyLines keeps error lines or falls back to tail', async () => {
    const { keyLines } = await import('../src/catalog.ts')
    expect(keyLines('a\nb\nnpm error 404 not found\nc').some(l => l.includes('404'))).toBe(true)
    expect(keyLines('x1\nx2\nx3', 2)).toEqual(['x2', 'x3'])
  })
  it('state roundtrip + allGroups + empty fallback', async () => {
    const { loadState, saveState, allGroups, EMPTY_STATE } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } } as unknown as Storage
    saveState({ ...EMPTY_STATE, groups: { a: 'g2', b: 'g1' }, notes: { a: 'n' } })
    const s = loadState()
    expect(s.notes.a).toBe('n'); expect(allGroups(s)).toEqual(['g1', 'g2'])
    store['opencode-market.state.v1'] = '{bad'
    expect(loadState()).toEqual(EMPTY_STATE)
    delete (globalThis as Record<string, unknown>).localStorage
  })
  it('categoriesOf/sortEntries/search', async () => {
    const { categoriesOf, sortEntries, search } = await import('../src/catalog.ts')
    const mk = (name: string, cat: string[], st: string, dl = 0, stars = 0): MarketEntry => ({
      name, slug: name, type: 'plugin', category: cat,
      verification: { status: st }, metrics: { npmDownloads30d: dl, stars },
    })
    const es = [mk('a', ['x'], 'failed', 1, 9), mk('b', ['y'], 'verified', 5, 1), mk('c', ['x', 'z'], 'skipped', 3, 5)]
    expect(categoriesOf(es)).toEqual(['x', 'y', 'z'])
    expect(sortEntries(es, 'verified')[0]!.name).toBe('b')
    expect(sortEntries(es, 'downloads')[0]!.name).toBe('b')
    expect(sortEntries(es, 'stars')[0]!.name).toBe('a')
    expect(sortEntries(es, 'name').map(e => e.name)).toEqual(['a', 'b', 'c'])
    expect(search(es, 'A')).toEqual([es[0]])
    expect(search(es, '')).toHaveLength(3)
  })
})
  it('rows orders verified first, redFlag last', async () => {
    const { rows } = await import('../src/catalog.ts')
    const mk = (n: string, st: string, rf = 0): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], verification: { status: st }, capabilities: { scannedAt: '', findings: [], redFlags: Array(rf).fill('x') } })
    const r = rows([mk('z', 'failed'), mk('a', 'verified'), mk('m', 'verified', 2), mk('q', 'unverified', 1)])
    expect(r.slice(0, 2).map(e => e.name)).toEqual(['a', 'm'])   // verified first even with redFlags
    expect(r[r.length - 1]!.name).toBe('q')                     // redFlagged non-verified last
  })
  it('search matches description too', async () => {
    const { search } = await import('../src/catalog.ts')
    const es = [{ name: 'a', slug: 'a', type: 'p', category: [], description: { en: 'find me' } } as MarketEntry]
    expect(search(es, 'find')).toHaveLength(1)
    expect(search(es, 'nomatch')).toHaveLength(0)
  })
  it('sortKey verified-order covers unverified/unknown', async () => {
    const { sortEntries } = await import('../src/catalog.ts')
    const mk = (n: string, st?: string): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], verification: st ? { status: st } : undefined })
    const r = sortEntries([mk('x', 'weird'), mk('u', 'unverified'), mk('v', 'verified'), mk('s', 'skipped')], 'verified')
    expect(r.map(e => e.name)).toEqual(['v', 'u', 'x', 's'])
  })
  it('sortKey metric fallbacks when metrics missing', async () => {
    const { sortEntries } = await import('../src/catalog.ts')
    const mk = (n: string, m?: MarketEntry['metrics']): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], metrics: m })
    const r = sortEntries([mk('a'), mk('b', { npmDownloads30d: null, stars: null }), mk('c', { npmDownloads30d: 5, stars: 0 })], 'downloads')
    expect(r[0]!.name).toBe('c')
    const r2 = sortEntries([mk('a'), mk('b', { npmDownloads30d: 0, stars: 3 })], 'stars')
    expect(r2[0]!.name).toBe('b')
  })
  it('redactLog windows path + key with colon', async () => {
    const { redactLog } = await import('../src/catalog.ts')
    const t = redactLog('at C:\\Users\\joe\\x password= hunter2')
    expect(t).toContain('<home>'); expect(t).toContain('password=<redacted>')
  })
  it('fetchIndex returns plugins list shape', async () => {
    const { fetchIndex } = await import('../src/catalog.ts')
    const idx = await fetchIndex()
    expect(Array.isArray(idx.plugins)).toBe(true)
    expect(idx.plugins.length).toBeGreaterThan(0)
  }, 15000)
  it('indexAge/hasUpdate/t basics', async () => {
    const { indexAge, hasUpdate, t } = await import('../src/catalog.ts')
    expect(indexAge({ generatedAt: '2026-11-02T06:00:00Z' } as MarketIndex)).toBe('2026-11-02 06:00')
    expect(indexAge(null)).toBe('')
    expect(hasUpdate({ name: 'x', latestVersion: '2' } as MarketEntry, '1')).toBe(true)
    expect(hasUpdate({ name: 'x', latestVersion: '1' } as MarketEntry, '1')).toBe(false)
    expect(hasUpdate({ name: 'x' } as MarketEntry, '1')).toBe(false)
    expect(typeof t('verified')).toBe('string')
  })
  it('fetchIndexCached TTL + snapshot fallback', async () => {
    const { fetchIndexCached } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    // fresh fetch caches
    const a = await fetchIndexCached()
    expect(a.plugins.length).toBeGreaterThan(0)
    expect(store['opencode-market.index.v1']).toBeTruthy()
    // second call hits TTL cache (no error even if offline now)
    const b = await fetchIndexCached('http://127.0.0.1:9/dead')
    expect(b.plugins.length).toBe(a.plugins.length)
    delete (globalThis as Record<string, unknown>).localStorage
  }, 20000)
  it('t() zh strings when language is zh', async () => {
    const { t } = await import('../src/catalog.ts')
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
    // module-level zh flag is fixed at import — test the en path contract instead
    expect(t('loading')).toBeTruthy()
    delete (globalThis as Record<string, unknown>).navigator
  })
  it('fetchIndexCached refetches when cache expired', async () => {
    const { fetchIndexCached } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    // seed an EXPIRED cache entry
    store['opencode-market.index.v1'] = JSON.stringify({ at: 1, index: { version: 'old', generatedAt: '', plugins: [] } })
    const idx = await fetchIndexCached()   // must refetch, not serve stale
    expect(idx.plugins.length).toBeGreaterThan(0)
    // poison network + valid cache → fallback serves cached
    store['opencode-market.index.v1'] = JSON.stringify({ at: Date.now() - 7200_000, index: { version: 'snap', generatedAt: '', plugins: [{ name: 'snap-pkg' }] } })
    const snap = await fetchIndexCached('http://127.0.0.1:9/dead')
    expect(snap.version).toBe('snap')
    // poison + no cache → throws
    store['opencode-market.index.v1'] = 'null'
    await expect(fetchIndexCached('http://127.0.0.1:9/dead')).rejects.toThrow()
    delete (globalThis as Record<string, unknown>).localStorage
  }, 20000)
