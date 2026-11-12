import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeEntries, trustFlags, dedupeSlugs, buildIndex } from '../pipeline/publish/merge.ts'
import { sanitize, sanitizeIndex } from '../plugins/market/src/catalog.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const mkEntry = (name: string, v = '1.0.0', over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['alice'], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: v, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[], over: Partial<CatalogIndex> = {}): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [], ...over,
})

describe('trustFlags (SEC-2/3)', () => {
  it('name re-registered after firstSeenAt → redFlag', () => {
    const prev = mkEntry('a', '1.0.0', { firstSeenAt: '2026-01-01' })
    const fresh = mkEntry('a', '1.0.0', { createdAt: '2026-06-01' })
    expect(trustFlags(prev, fresh).redFlags).toContain('sec:name-reused')
  })
  it('package created before firstSeenAt → no flag', () => {
    const prev = mkEntry('a', '1.0.0', { firstSeenAt: '2026-01-01' })
    const fresh = mkEntry('a', '1.0.0', { createdAt: '2020-01-01' })
    expect(trustFlags(prev, fresh).redFlags).toEqual([])
  })
  it('maintainer drift → weak finding, not redFlag', () => {
    const prev = mkEntry('a', '1.0.0', { maintainers: ['alice'] })
    const fresh = mkEntry('a', '1.0.0', { maintainers: ['mallory'] })
    const tf = trustFlags(prev, fresh)
    expect(tf.findings).toContain('sec:maintainer-changed')
    expect(tf.redFlags).toEqual([])
  })
  it('empty prev maintainers (pre-backfill) → no flag', () => {
    const prev = mkEntry('a', '1.0.0', { maintainers: [], distTags: {} })
    const fresh = mkEntry('a', '1.0.0', { maintainers: ['bob'] })
    expect(trustFlags(prev, fresh).findings).toEqual([])
  })
  it('repo numeric id changed → repojacking redFlag', () => {
    const prev = mkEntry('a', '1.0.0', { source: { kind: 'npm', id: 'a', repo: 'o/r', repoId: 111 } })
    const fresh = mkEntry('a', '1.0.0', { source: { kind: 'npm', id: 'a', repo: 'o/r', repoId: 222 } })
    expect(trustFlags(prev, fresh).redFlags).toContain('sec:repo-recreated')
  })
  it('version rollback → redFlag', () => {
    const prev = mkEntry('a', '2.0.0')
    const fresh = mkEntry('a', '1.5.0')
    expect(trustFlags(prev, fresh).redFlags).toContain('sec:version-rollback')
  })
  it('new lifecycle script in same ruleset → strong redFlag', () => {
    const prev = mkEntry('a', '1.0.0')
    const fresh = mkEntry('a', '2.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['lifecycle-script:package.json'], redFlags: ['lifecycle-script:package.json'] },
    })
    expect(trustFlags(prev, fresh).redFlags).toContain('sec-delta:lifecycle-script')
  })
  it('new weak finding → findings only', () => {
    const prev = mkEntry('a', '1.0.0')
    const fresh = mkEntry('a', '2.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['network-call:src/x.ts'], redFlags: [] },
    })
    const tf = trustFlags(prev, fresh)
    expect(tf.findings).toContain('sec-delta:network-call')
    expect(tf.redFlags).toEqual([])
  })
  it('ruleset mismatch → no delta (upgrade is not a behavior change)', () => {
    const prev = mkEntry('a', '1.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: 'r1', findings: [], redFlags: [] },
    })
    const fresh = mkEntry('a', '1.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['lifecycle-script:package.json'], redFlags: [] },
    })
    expect(trustFlags(prev, fresh).redFlags).toEqual([])
  })
})

describe('mergeEntries two-layer keys (I-2)', () => {
  it('identity fields survive a version bump', () => {
    const prev = mkEntry('a', '1.0.0', {
      firstSeenAt: '2025-01-01', slug: 'o/a-repo', aliases: ['x'],
      discoveredVia: ['submission'], verification: { status: 'verified', level: 'load' },
    })
    const fresh = mkEntry('a', '2.0.0')
    const [m] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', RULESET_VERSION)
    expect(m!.firstSeenAt).toBe('2025-01-01')
    expect(m!.slug).toBe('o/a-repo')
    expect(m!.aliases).toContain('x')
    expect(m!.discoveredVia).toContain('submission')
    // per-version layer does NOT carry over on bump
    expect(m!.verification.status).toBe('unverified')
  })
  it('per-version cache reused only when name@version+host+ruleset all match', () => {
    const prev = mkEntry('a', '1.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['f1'], redFlags: [] },
      verification: { status: 'verified', level: 'load' },
    })
    const same = mkEntry('a', '1.0.0')
    const [m] = mergeEntries([same], mkIndex([prev]), '2.2.5', RULESET_VERSION)
    expect(m!.verification.status).toBe('verified')
    expect(m!.capabilities.findings).toEqual(['f1'])
  })
  it('ruleset bump → findings not reused (I-5), verification kept', () => {
    const prev = mkEntry('a', '1.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: 'r1', findings: ['old'], redFlags: [] },
      verification: { status: 'verified', level: 'load' },
    })
    const fresh = mkEntry('a', '1.0.0', {
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['new'], redFlags: [] },
    })
    const [m] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', RULESET_VERSION)
    expect(m!.capabilities.findings).toEqual(['new'])
    expect(m!.verification.status).toBe('verified')
  })
  it('verified downgraded to skipped when new redFlags appear (SEC-3.5)', () => {
    // same version so the verified verdict is reused — then the redFlag strips it
    const prev = mkEntry('a', '1.0.0', {
      verification: { status: 'verified', level: 'load' },
      source: { kind: 'npm', id: 'a', repo: 'o/r', repoId: 111 },
    })
    const fresh = mkEntry('a', '1.0.0', {
      source: { kind: 'npm', id: 'a', repo: 'o/r', repoId: 999 },   // repojacking fires
    })
    const [m] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', RULESET_VERSION)
    expect(m!.verification.status).toBe('skipped')
    expect(m!.capabilities.redFlags).toContain('sec:repo-recreated')
  })
})

describe('dedupeSlugs (I-1)', () => {
  it('collided entries re-slug to npm name; old slug lands in aliases', () => {
    const a = mkEntry('pkg-a', '1.0.0', { slug: 'o/monorepo' })
    const b = mkEntry('pkg-b', '1.0.0', { slug: 'o/monorepo' })
    const out = dedupeSlugs([a, b])
    const slugs = out.map(e => e.slug)
    expect(new Set(slugs).size).toBe(2)
    const renamed = out.find(e => e.slug === 'pkg-a' || e.slug === 'pkg-b')!
    expect(renamed.aliases).toContain('o/monorepo')
  })
  it('unique slugs untouched', () => {
    const out = dedupeSlugs([mkEntry('a'), mkEntry('b')])
    expect(out.map(e => e.slug)).toEqual(['a', 'b'])
  })
})

describe('buildIndex removed + categories (F-2/I-3)', () => {
  it('keeps recent tombstones, prunes >180d, drops resurrected', () => {
    const now = '2026-06-01T00:00:00.000Z'
    const old = mkIndex([], { removed: [
      { slug: 'a', name: 'a', disappearedAt: '2026-05-01', reason: 'npm-404' },
      { slug: 'b', name: 'b', disappearedAt: '2020-01-01', reason: 'npm-404' },
      { slug: 'c', name: 'c', disappearedAt: '2026-05-01', reason: 'npm-404' },
    ] })
    const { index } = buildIndex([mkEntry('c')], old, { opencodeVersion: '2.2.5', now })
    expect(index.removed.map(r => r.name)).toEqual(['a'])
  })
  it('caller tombstones appended; category registry unions whitelisted', () => {
    const e = mkEntry('x', '1.0.0', { category: ['other'] })
    const old = mkIndex([], { categories: { tools: { en: 'Old', zh: '旧' }, 'old-cat': { en: 'Gone' } } })
    const { index } = buildIndex([e], old, {
      opencodeVersion: '2.2.5', now: '2026-01-01',
      removed: [{ slug: 'y', name: 'y', disappearedAt: '2026-01-01', reason: 'npm-404' }],
    })
    expect(index.removed).toHaveLength(1)
    // canonical id survives (labels re-canonicalized); unknown ids are
    // dropped from both dict and entries — author strings can't mint globals
    expect(index.categories['tools']).toEqual({ en: 'tools & capabilities', zh: '工具与能力' })
    expect(index.categories['other']).toEqual({ en: 'other', zh: '其他' })
    expect(index.categories['old-cat']).toBeUndefined()
  })
})

describe('sanitize (B-2)', () => {
  it('strips CSI, OSC and C0/C1 controls from untrusted strings', () => {
    expect(sanitize('a\x1b[31mred\x1b[0mb')).toBe('aredb')
    expect(sanitize('x\x1b]8;;http://evil\x07link\x1b]8;;\x07y')).toBe('xlinky')
    expect(sanitize('ok\x00\x1f\x7fend')).toBe('okend')
    expect(sanitize('plain text')).toBe('plain text')
  })
  it('sanitizeIndex scrubs every untrusted string field', () => {
    const idx = sanitizeIndex({
      plugins: [{ name: 'a\x1b[1m', slug: 's\x07', description: { en: 'd\x1b]0;t\x07' }, category: ['c\x9b'], source: {} } as never],
    } as never)
    expect(idx.plugins[0]!.name).toBe('a')
    expect(idx.plugins[0]!.description!.en).toBe('d')
    expect(idx.plugins[0]!.category[0]).toBe('c')
  })
})

describe('run gone-check (F-2)', () => {
  // 5 entries stay in discovery (reuse path) so a single disappearance stays
  // under the corruption-gate drop alarm; 'gone-pkg' exists only in the old index.
  const alive = Array.from({ length: 5 }, (_, i) => mkEntry(`alive-${i}`, '1.0.0'))
  const gone = mkEntry('gone-pkg', '1.0.0')
  const mkOld = () => {
    const f = join(mkdtempSync(join(tmpdir(), 'old-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([...alive, gone])))
    return f
  }
  const mkFetchFor = (goneStatus: number) => (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search'))
      return new Response(JSON.stringify({ objects: alive.map(e => (
        { package: { name: e.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } }
      )) }))
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.includes('registry.npmjs.org'))
      return new Response('{}', { status: url.includes('gone-pkg') ? goneStatus : 404 })
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  it('npm 404 on gone-check → tombstone npm-404', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const idx = await run({ fetchFn: mkFetchFor(404), oldIndexPath: mkOld(), outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx.plugins.map(e => e.name)).toEqual(alive.map(e => e.name))
    expect(idx.removed[0]).toMatchObject({ name: 'gone-pkg', reason: 'npm-404' })
  })
  it('transient 500 on gone-check → stale entry preserved, no tombstone', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'out-')), 'index.json')
    const idx = await run({ fetchFn: mkFetchFor(500), oldIndexPath: mkOld(), outPath: out, now: '2026-06-01T00:00:00.000Z', maxEntries: 10 })
    expect(idx.plugins.map(e => e.name).sort()).toEqual([...alive.map(e => e.name), 'gone-pkg'].sort())
    expect(idx.removed).toHaveLength(0)
  })
})

import { remerge } from '../pipeline/remerge.ts'
import { backfill } from '../pipeline/backfill.ts'

describe('remerge (WF-2 publish retry)', () => {
  it('remote state preserved: verification + removed + categories survive', () => {
    const ours = mkIndex([mkEntry('a', '1.0.0'), mkEntry('new-pkg', '1.0.0')], {
      categories: { tools: { en: 'T' } },
      removed: [{ slug: 'x', name: 'x', disappearedAt: 't', reason: 'npm-404' }],
    })
    const remote = mkIndex([mkEntry('a', '1.0.0', { verification: { status: 'verified', level: 'load' } })], {
      categories: { other: { en: 'O' } },
      removed: [{ slug: 'y', name: 'y', disappearedAt: 't', reason: 'filtered' }],
    })
    const out = remerge(ours, remote)
    expect(out.plugins.find(e => e.name === 'a')!.verification.status).toBe('verified')
    expect(out.plugins.find(e => e.name === 'new-pkg')).toBeTruthy()
    expect(out.removed.map(r => r.name).sort()).toEqual(['x', 'y'])
    expect(out.categories).toMatchObject({ tools: { en: 'tools & capabilities' }, other: { en: 'other' } })
  })
  it('legacy zh categories normalize on the retry path (I-3 follow-through)', () => {
    // ours-side entry carries a legacy zh value (old run.json / submission-supplied);
    // remote dict carries a legacy zh key — both must land as english ids
    const ours = mkIndex([mkEntry('a', '1.0.0', { category: ['主题与外观'] })])
    const remote = mkIndex([mkEntry('a', '1.0.0')], {
      categories: { '主题与外观': { en: '主题与外观' } },
    })
    const out = remerge(ours, remote)
    expect(out.categories['主题与外观']).toBeUndefined()
    expect(out.categories['appearance']).toEqual({ en: 'appearance', zh: '主题与外观' })
    expect(out.plugins.find(e => e.name === 'a')!.category).toEqual(['appearance'])
  })
  it('null remote → ours returned wholesale', () => {
    const ours = mkIndex([mkEntry('a')])
    expect(remerge(ours, null)).toBe(ours)
  })
  it('entry category with unknown id → dropped (whitelist, no mint)', () => {
    // arbitrary author-declared strings must not mint global category ids —
    // they fall off the entry AND never enter the dict
    const ours = mkIndex([mkEntry('a', '1.0.0', { category: ['custom-x'] })])
    const out = remerge(ours, mkIndex([]))
    expect(out.categories['custom-x']).toBeUndefined()
    expect(out.plugins.find(e => e.name === 'a')!.category).toEqual([])
  })
})

describe('backfill (SEC-4)', () => {
  it('fills createdAt/maintainers/repoId for entries missing them', async () => {
    const e = mkEntry('old-pkg', '1.0.0', {
      createdAt: null, maintainers: [],
      source: { kind: 'npm', id: 'old-pkg', repo: 'o/r' },
    })
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org'))
        return new Response(JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: {},
          time: { created: '2019-01-01', modified: 'm' },
          maintainers: [{ name: 'bob' }],
        }))
      if (url.includes('api.github.com/repos'))
        return new Response(JSON.stringify({ id: 555, stargazers_count: 1 }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const out = await backfill(mkIndex([e]), { fetchFn })
    const got = out.plugins[0]!
    expect(got.createdAt).toBe('2019-01-01')
    expect(got.maintainers).toEqual(['bob'])
    expect(got.source.repoId).toBe(555)
  })
})
