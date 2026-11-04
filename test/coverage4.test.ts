import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchRepoMeta, fetchMarketMeta, repoFileExists } from '../pipeline/fetch/github.ts'
import { fetchPackument } from '../pipeline/fetch/npm.ts'
import { run, replacementOf } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const mkRes = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

const mkEntry = (name: string, v = '1.0.0', over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: v, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[], over: Partial<CatalogIndex> = {}): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [], ...over,
})

describe('fetchRepoMeta statuses', () => {
  it('ok → full meta incl. repoId/createdAt/topics', async () => {
    const { meta, status } = await fetchRepoMeta('o/r', {
      fetchFn: (async () => mkRes({
        id: 42, stargazers_count: 9, license: { spdx_id: 'MIT' }, archived: true,
        fork: false, topics: ['t1'], pushed_at: 'p', created_at: '2020-01-01', description: 'd',
      })) as typeof fetch,
    })
    expect(status).toBe('ok')
    expect(meta).toMatchObject({ id: 42, stars: 9, license: 'MIT', archived: true, topics: ['t1'], createdAt: '2020-01-01' })
  })
  it('404 → not-found; 500 → error; throw → error', async () => {
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).status).toBe('not-found')
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })).status).toBe('error')
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => { throw new Error('net') }) as typeof fetch })).status).toBe('error')
  })
})

describe('fetchMarketMeta (.opencode-market.json)', () => {
  it('valid file → parsed category/description', async () => {
    const meta = await fetchMarketMeta('o/r', {
      fetchFn: (async (input: RequestInfo | URL) =>
        String(input).includes('raw.githubusercontent.com')
          ? mkRes({ category: ['x'], description: { en: 'hi' } })
          : mkRes({}, 404)) as typeof fetch,
    })
    expect(meta).toMatchObject({ category: ['x'], description: { en: 'hi' } })
  })
  it('404/invalid/non-object → null', async () => {
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes('not-json{')) as typeof fetch })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes([1, 2])) as typeof fetch })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => { throw new Error('net') }) as typeof fetch })).toBeNull()
  })
})

describe('repoFileExists + fetchPackument statuses', () => {
  it('repoFileExists: ok→true, 404/500/throw→false', async () => {
    const yes = await repoFileExists('o/r', 'SKILL.md', { fetchFn: (async () => mkRes({})) as typeof fetch })
    const no = await repoFileExists('o/r', 'SKILL.md', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })
    const err = await repoFileExists('o/r', 'SKILL.md', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })
    const thr = await repoFileExists('o/r', 'SKILL.md', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })
    expect([yes, no, err, thr]).toEqual([true, false, false, false])
  })
  it('packument: 500 → error; exception → error; ok parses identity fields', async () => {
    expect((await fetchPackument('x', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })).status).toBe('error')
    expect((await fetchPackument('x', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).status).toBe('error')
    const { pk, status } = await fetchPackument('x', { fetchFn: (async () => mkRes({
      'dist-tags': { latest: '2.0.0', next: '3.0.0-beta' },
      versions: { '2.0.0': { deprecated: 'use y instead', dist: { tarball: 't' } } },
      time: { created: 'c', modified: 'm', '2.0.0': 'v2t' },
      maintainers: ['alice', { name: 'bob' }],
    })) as typeof fetch })
    expect(status).toBe('ok')
    expect(pk).toMatchObject({ latest: '2.0.0', createdAt: 'c', modifiedAt: 'm', deprecated: true,
      deprecatedMessage: 'use y instead', maintainers: ['alice', 'bob'], distTags: { latest: '2.0.0', next: '3.0.0-beta' } })
  })
})

describe('replacementOf + blocklist + capped (run branches)', () => {
  it('replacementOf parses common deprecate phrasings', () => {
    expect(replacementOf('use @scope/pkg instead')).toBe('@scope/pkg')
    expect(replacementOf('moved to other-pkg')).toBe('other-pkg')
    expect(replacementOf('renamed to `new-name`')).toBe('new-name')
    expect(replacementOf('gone')).toBeNull()
    expect(replacementOf(null)).toBeNull()
  })

  const alive = Array.from({ length: 5 }, (_, i) => mkEntry(`alive-${i}`))
  const mkOld = (extra: PluginEntry[]) => {
    const f = join(mkdtempSync(join(tmpdir(), 'old-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([...alive, ...extra])))
    return f
  }
  const baseFetch = (over: (url: string) => Response | null = () => null) => (async (input: RequestInfo | URL) => {
    const url = String(input)
    const o = over(url); if (o) return o
    if (url.includes('/-/v1/search'))
      return mkRes({ objects: alive.map(e => ({ package: { name: e.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } })) })
    if (url.includes('api.github.com/search')) return mkRes({ items: [] })
    if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 1 })
    return mkRes('{}', 404)
  }) as typeof fetch

  it('blocklisted old entry → tombstone manual', async () => {
    const bl = join(mkdtempSync(join(tmpdir(), 'bl-')), 'blocklist.json')
    writeFileSync(bl, JSON.stringify({ names: ['evil-pkg'], slugs: [] }))
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const idx = await run({ fetchFn: baseFetch(), oldIndexPath: mkOld([mkEntry('evil-pkg')]), blocklistPath: bl, outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx.removed.find(r => r.name === 'evil-pkg')?.reason).toBe('manual')
  })
  it('blocklist candidate skipped before entry creation', async () => {
    const bl = join(mkdtempSync(join(tmpdir(), 'bl-')), 'blocklist.json')
    writeFileSync(bl, JSON.stringify({ names: ['blocked-cand'], slugs: [] }))
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const fetch = baseFetch(url => url.includes('/-/v1/search')
      ? mkRes({ objects: [...alive.map(e => ({ package: { name: e.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } })),
        { package: { name: 'blocked-cand', version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } }] })
      : null)
    const idx = await run({ fetchFn: fetch, oldIndexPath: mkOld([]), blocklistPath: bl, outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx.plugins.map(e => e.name)).not.toContain('blocked-cand')
  })
  it('cap → missing old entry gets capped tombstone', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    // zzz-last must be a discovered candidate so it lands in cappedOut (sorted last)
    const fetch = baseFetch(url => url.includes('/-/v1/search')
      ? mkRes({ objects: [...alive.map(e => ({ package: { name: e.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } })),
        { package: { name: 'zzz-last', version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } }] })
      : null)
    const idx = await run({ fetchFn: fetch, oldIndexPath: mkOld([mkEntry('zzz-last')]), outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 5 })
    expect(idx.plugins).toHaveLength(5)
    expect(idx.removed.find(r => r.name === 'zzz-last')?.reason).toBe('capped')
  })
  it('github-topic-only candidate becomes github-kind entry', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const fetch = baseFetch(url => url.includes('api.github.com/search')
      ? mkRes({ items: [{ full_name: 'solo/gh-plug', description: 'gh', stargazers_count: 5, archived: false, fork: false, pushed_at: 't' }] })
      : null)
    const idx = await run({ fetchFn: fetch, oldIndexPath: mkOld([]), outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    const gh = idx.plugins.find(e => e.name === 'solo/gh-plug')
    expect(gh?.source.kind).toBe('github')
    expect(gh?.verification.status).toBe('skipped')
  })
})
