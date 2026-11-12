import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchPackument, fetchDownloadsMonth, fetchDownloadsRange } from '../pipeline/fetch/npm.ts'
import { run, loadMetricsHistory, delta30 } from '../pipeline/run.ts'
import { CatalogIndex } from '../src/schema.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const asFetch = (f: (input: RequestInfo | URL) => Promise<Response>) => f as typeof fetch

describe('packument homepage/bugs parsing', () => {
  const doc = (v: Record<string, unknown>, top: Record<string, unknown> = {}) => ({
    'dist-tags': { latest: '1' }, versions: { '1': { ...v, dist: {} } }, time: {}, ...top,
  })
  it('version-level homepage/bugs preferred over package-level', async () => {
    const { pk } = await fetchPackument('x', { fetchFn: asFetch(async () => mkRes(doc(
      { homepage: 'https://github.com/o/v#readme', bugs: { url: 'https://github.com/o/v/issues' } },
      { homepage: 'https://github.com/o/top', bugs: 'https://github.com/o/top/issues' }))) })
    expect(pk!.homepage).toBe('https://github.com/o/v#readme')
    expect(pk!.bugs).toBe('https://github.com/o/v/issues')
  })
  it('package-level homepage/bugs fallback; bugs accepts bare string', async () => {
    const { pk } = await fetchPackument('x', { fetchFn: asFetch(async () => mkRes(doc({},
      { homepage: 'https://github.com/o/top', bugs: 'https://github.com/o/top/issues' }))) })
    expect(pk!.homepage).toBe('https://github.com/o/top')
    expect(pk!.bugs).toBe('https://github.com/o/top/issues')
  })
  it('absent homepage/bugs → null', async () => {
    const { pk } = await fetchPackument('x', { fetchFn: asFetch(async () => mkRes(doc({}))) })
    expect(pk!.homepage).toBeNull()
    expect(pk!.bugs).toBeNull()
  })
})

describe('fetchDownloadsRange / fetchDownloadsMonth', () => {
  it('month query is a UTC calendar range YYYY-MM-01:YYYY-MM-DD', async () => {
    let seen = ''
    const f = asFetch(async (i) => { seen = String(i); return mkRes({ downloads: 7 }) })
    expect(await fetchDownloadsMonth('pkg', { fetchFn: f, now: new Date(Date.UTC(2026, 10, 12)) })).toBe(7)
    expect(seen).toBe('https://api.npmjs.org/downloads/point/2026-11-01:2026-11-12/pkg')
  })
  it('non-2xx → null; malformed body → null; network throw → null', async () => {
    expect(await fetchDownloadsRange('x', 'last-month', { fetchFn: asFetch(async () => mkRes({}, 500)) })).toBeNull()
    expect(await fetchDownloadsRange('x', 'last-month', { fetchFn: asFetch(async () => mkRes({ downloads: 'lots' })) })).toBeNull()
    expect(await fetchDownloadsRange('x', 'last-month', { fetchFn: asFetch(async () => { throw new Error('net') }) })).toBeNull()
  })
})

describe('metrics schema back-compat', () => {
  it('old index without new metrics fields parses with null defaults', () => {
    const idx = CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins: [{
      name: 'a', slug: 'a', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
      source: { kind: 'npm', id: 'a' }, description: { en: '' }, category: [], license: null,
      deprecated: false, replacement: null, firstSeenAt: 't', latestVersion: '1', publishedAt: null,
      metrics: { stars: 5, npmDownloads30d: 10, checkedAt: 't' },
      capabilities: { scannedAt: null, findings: [], redFlags: [] },
      verification: { status: 'verified' }, compat: {} }] })
    expect(idx.plugins[0]!.metrics.downloadsMonth).toBeNull()
    expect(idx.plugins[0]!.metrics.starsDelta30d).toBeNull()
  })
})

describe('loadMetricsHistory / delta30', () => {
  it('missing file / malformed JSON → empty history, no throw', () => {
    const d = mkdtempSync(join(tmpdir(), 'mh-'))
    expect(loadMetricsHistory(join(d, 'none.json'))).toEqual({ v: 1, e: {} })
    const bad = join(d, 'bad.json'); writeFileSync(bad, '{oops')
    expect(loadMetricsHistory(bad)).toEqual({ v: 1, e: {} })
  })
  it('delta30: needs a snapshot point that is itself ≥30d old', () => {
    const now = Date.parse('2026-11-12T00:00:00Z')
    expect(delta30(undefined, 100, now)).toBeNull()                    // no history
    expect(delta30([[now - 86400000, 90]], 100, now)).toBeNull()       // only yesterday → not enough
    expect(delta30([[now - 40 * 86400000, 50], [now - 86400000, 90]], 100, now)).toBe(50) // newest ≥30d point wins
    expect(delta30([[now - 40 * 86400000, 50]], null, now)).toBeNull() // no current reading → honest null
  })
})

const entry = (o: Record<string, unknown>) => ({
  name: 'x', slug: 'x', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'x' }, description: { en: '' }, category: [], license: null,
  deprecated: false, replacement: null, firstSeenAt: '2020-01-01', latestVersion: '1', publishedAt: null,
  integrity: 'sha512-x', metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 's', findings: [], redFlags: [], rulesetVersion: RULESET_VERSION },
  verification: { status: 'verified' }, compat: {}, ...o,
})

describe('repo back-match + metrics-history write', () => {
  it('npm entry adopts repo whose own package.json names it; unmatched stays null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-mh-'))
    const old = {
      version: '1', generatedAt: 'x', categories: {},
      plugins: [
        // the github entry that proves owner/real's package.json name IS 'orphan'
        entry({ name: 'o/real', slug: 'o/real', pkgName: 'orphan', discoveredVia: ['github-topic'],
          source: { kind: 'github', id: 'o/real', repo: 'o/real', repoId: 7 },
          latestVersion: null, integrity: null, verification: { status: 'skipped' } }),
        entry({ name: 'orphan', slug: 'orphan' }),
        entry({ name: 'lone', slug: 'lone' }),
      ],
    }
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const histPath = join(dir, 'hist.json')
    const f = asFetch(async (i) => {
      const url = String(i)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'orphan', version: '1', description: '', keywords: ['opencode'], links: {}, date: 't' } },
        { package: { name: 'lone', version: '1', description: '', keywords: ['opencode'], links: {}, date: 't' } },
      ] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      return mkRes({}, 404)
    })
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, metricsHistPath: histPath,
      fetchFn: f, now: '2026-11-12T00:00:00Z', forceGate: true })
    const orphan = idx.plugins.find(p => p.name === 'orphan')!
    const lone = idx.plugins.find(p => p.name === 'lone')!
    expect(orphan.source.repo).toBe('o/real')
    expect(lone.source.repo).toBeUndefined()     // no pkgName match → no fabricated repo
    // history file written; first snapshot → delta honestly null
    const hist = loadMetricsHistory(histPath)
    expect(hist.e['orphan']).toBeDefined()
    expect(orphan.metrics.starsDelta30d).toBeNull()
  })
})
