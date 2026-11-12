import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filterByStars, repoToNpm, buildSeedList } from '../pipeline/discover/seed.ts'
import { fetchRepoMeta, fetchMarketMeta } from '../pipeline/fetch/github.ts'
import { fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { reviewPackage, verdict, renderReview } from '../pipeline/review.ts'
import { verifyPackage, type SpawnFn } from '../pipeline/verify/verify.ts'
import { versionCmp } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

/** serve reports dead on arrival — a test must never boot a real `opencode`
 *  binary (dev boxes may have one installed). */
const deadSpawn = (() => ({
  stdout: { on: () => {} }, stderr: { on: () => {} },
  on: (_ev: string, cb: (a?: unknown) => void) => { cb() },
  kill: () => {},
})) as unknown as SpawnFn

const mkRes = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('seed.ts branches', () => {
  it('filterByStars: skips non-ok, archived, below-threshold, missing count', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.endsWith('/a')) return mkRes({ stargazers_count: 100 })
      if (u.endsWith('/b')) return mkRes({}, 500)
      if (u.endsWith('/c')) return mkRes({ stargazers_count: 5 })
      if (u.endsWith('/d')) return mkRes({ stargazers_count: 999, archived: true })
      if (u.endsWith('/e')) return mkRes({})                      // missing count → 0
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await filterByStars(['a', 'b', 'c', 'd', 'e'], 50, { fetchFn: f })
    expect(out).toEqual([{ repo: 'a', stars: 100, branch: null }])
  })
  it('repoToNpm: main 404 → master hit; non-json tolerated; both miss → null', async () => {
    const masterHit = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/master/package.json') ? mkRes({ name: 'pkg-x' }) : mkRes({}, 404)) as typeof fetch
    expect(await repoToNpm('o/r', { fetchFn: masterHit })).toBe('pkg-x')
    const badJson = (async () => mkRes('not json{')) as typeof fetch
    expect(await repoToNpm('o/r', { fetchFn: badJson })).toBeNull()
    expect(await repoToNpm('o/r', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).toBeNull()
    const noName = (async () => mkRes({})) as typeof fetch
    expect(await repoToNpm('o/r', { fetchFn: noName })).toBeNull()
  })
  it('buildSeedList: awesome fetch failure throws', async () => {
    await expect(buildSeedList({ fetchFn: (async () => mkRes({}, 503)) as typeof fetch })).rejects.toThrow('awesome fetch failed')
  })
})

describe('fetch/github.ts defaults', () => {
  it('repoMeta: missing fields → nulls; NOASSERTION license → null', async () => {
    const { meta } = await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes({ license: { spdx_id: 'NOASSERTION' } })) as typeof fetch })
    expect(meta).toMatchObject({ id: null, stars: 0, license: null, topics: [], archived: false, createdAt: null })
  })
  it('marketMeta: zh-only desc; non-string category dropped; empty → null', async () => {
    const zh = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ description: { zh: '中' }, category: [1, 'ok'] })) as typeof fetch })
    // category is all-or-nothing: one non-string element invalidates the list
    expect(zh).toMatchObject({ description: { zh: '中' } })
    expect(zh!.category).toBeUndefined()
    const empty = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ unrelated: 1 })) as typeof fetch })
    expect(empty).toBeNull()
  })
})

describe('fetch/npm.ts + review.ts branches', () => {
  it('downloads: non-ok → null; missing field → null; exception → null', async () => {
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })).toBeNull()
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({})) as typeof fetch })).toBeNull()
    expect(await fetchDownloads30d('x', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).toBeNull()
  })
  it('reviewPackage: missing package → invalid verdict', async () => {
    const r = await reviewPackage('nope', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })
    expect(r.exists).toBe(false)
    expect(verdict(r)).toBe('invalid')
    expect(renderReview(r)).toContain('package not found')
  })
  it('renderReview: >30 flags truncated, clean verdict on empty', () => {
    const r = {
      name: 'p', exists: true, status: 'ok' as const, evidenceOk: true, scanned: true, scanError: null,
      evidence: ['keyword'], downloads30d: 5, repo: null, pkgName: null, createdAt: null,
      version: null, integrity: null,
      findings: Array.from({ length: 35 }, (_, i) => `f${i}`),
      redFlags: Array.from({ length: 35 }, (_, i) => `r${i}`),
    }
    const md = renderReview(r)
    expect(md).toContain('+5 more')
    expect(md).toContain('verdict: flagged')
  })
})

describe('verify.ts exec branches', () => {
  const execAllFail = (async () => { throw new Error('boom') }) as never
  it('plugin add fails → failed/install, ocVersion catch → unknown', async () => {
    const r = await verifyPackage('x', { execFn: execAllFail, spawnFn: deadSpawn })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('install')
    expect(r.opencodeVersion).toBe('unknown')
  })
})

describe('versionCmp + merge misc branches', () => {
  it('versionCmp dotted compare incl. edge cases', () => {
    expect(versionCmp('1.2.3', '1.2.10')).toBe(-1)
    expect(versionCmp('2.0.0', '1.9.9')).toBe(1)
    expect(versionCmp('1.2', '1.2.0')).toBe(0)
    expect(versionCmp('a.b', '1.0')).toBe(0)
    expect(versionCmp(null, '1.0')).toBe(0)
    expect(versionCmp('1.0', null)).toBe(0)
  })
})

describe('run.ts remaining branches', () => {
  const mkEntry = (name: string): PluginEntry => ({
    name, slug: name, aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
    source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
    license: 'MIT', deprecated: false, replacement: null,
    deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: {},
    firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: null,
    metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
    capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
    verification: { status: 'unverified' }, compat: {},
    approval: 'approved',
  })
  const alive = Array.from({ length: 5 }, (_, i) => mkEntry(`alive-${i}`))
  const mkOld = () => {
    const f = join(mkdtempSync(join(tmpdir(), 'old-')), 'index.json')
    writeFileSync(f, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: alive, removed: [] } satisfies CatalogIndex))
    return f
  }
  const baseFetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search'))
      return mkRes({ objects: alive.map(e => ({ package: { name: e.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } })) })
    if (url.includes('api.github.com/search')) return mkRes({ items: [] })
    if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 1 })
    return mkRes('{}', 404)
  }) as typeof fetch

  it('malformed blocklist file → hard-fail (corrupt must not silently unblock, C-4)', async () => {
    const bl = join(mkdtempSync(join(tmpdir(), 'bl-')), 'blocklist.json')
    writeFileSync(bl, '{not json')
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    await expect(run({ fetchFn: baseFetch, oldIndexPath: mkOld(), blocklistPath: bl, outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 }))
      .rejects.toThrow('blocklist unreadable')
  })
  it('blocklist with non-array fields → filters to empty lists', async () => {
    const bl = join(mkdtempSync(join(tmpdir(), 'bl-')), 'blocklist.json')
    writeFileSync(bl, JSON.stringify({ names: 'str-not-array', slugs: [1, 'ok-slug'] }))
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const idx = await run({ fetchFn: baseFetch, oldIndexPath: mkOld(), blocklistPath: bl, outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx.plugins).toHaveLength(5)
    // non-string elements inside arrays are dropped per-element
    const bl2 = join(mkdtempSync(join(tmpdir(), 'bl2-')), 'blocklist.json')
    writeFileSync(bl2, JSON.stringify({ names: [1, 'ok-name'], slugs: [] }))
    const idx2 = await run({ fetchFn: baseFetch, oldIndexPath: mkOld(), blocklistPath: bl2, outPath: join(mkdtempSync(join(tmpdir(), 'o2-')), 'i.json'), now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx2.plugins).toHaveLength(5)
  })
})

describe('backfill + refreshMeta remaining branches', () => {
  it('backfill: fetch error tolerated, entry untouched; repoId already set → skipped', async () => {
    const { backfill } = await import('../pipeline/backfill.ts')
    const e1 = mkEntryX('err-pkg')
    const e2 = mkEntryX('has-id', { source: { kind: 'npm', id: 'has-id', repo: 'o/r', repoId: 7 }, createdAt: 'c', maintainers: ['m'] })
    const fetchFn = (async () => { throw new Error('net') }) as typeof fetch
    const out = await backfill({ version: '1', generatedAt: 'x', categories: {}, plugins: [e1, e2], removed: [] }, { fetchFn })
    expect(out.plugins).toHaveLength(2)
    expect(out.plugins[1]!.source.repoId).toBe(7)
  })
  it('run: stale reused entry refreshes repoId + deprecated via refreshMeta', async () => {
    const e = mkEntryX('stale-pkg', {
      source: { kind: 'npm', id: 'stale-pkg', repo: 'o/r' },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2020-01-01' },   // very stale → refresh path
    })
    const old = join(mkdtempSync(join(tmpdir(), 'old-')), 'index.json')
    writeFileSync(old, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: alive2(), removed: [] }))
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes('/-/v1/search'))
        return mkRes({ objects: alive2().map(x => ({ package: { name: x.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } })) })
      if (u.includes('api.github.com/search')) return mkRes({ items: [] })
      if (u.includes('registry.npmjs.org')) return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { deprecated: 'use other-pkg instead' } }, time: {} })
      if (u.includes('api.github.com/repos')) return mkRes({ id: 88, stargazers_count: 2 })
      if (u.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 3 })
      return mkRes('{}', 404)
    }) as typeof fetch
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const idx = await run({ fetchFn: f, oldIndexPath: old, outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    const stale = idx.plugins.find(x => x.name === 'stale-pkg')
    expect(stale?.source.repoId).toBe(88)
    expect(stale?.deprecated).toBe(true)
    expect(stale?.replacement).toBe('other-pkg')
  })
})

function mkEntryX(name: string, over: Partial<PluginEntry> = {}): PluginEntry {
  return {
    name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
    source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
    license: 'MIT', deprecated: false, replacement: null,
    deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
    firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: null,
    metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
    capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
    verification: { status: 'unverified' }, compat: {},
    approval: 'approved',
    ...over,
  }
}
function alive2() {
  return [...Array.from({ length: 4 }, (_, i) => mkEntryX(`alive-${i}`)), mkEntryX('stale-pkg', {
    source: { kind: 'npm', id: 'stale-pkg', repo: 'o/r' },
    metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2020-01-01' },
  })]
}
