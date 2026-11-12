/** audit #1 fresh round (catalog-ingestion, round 7):
 *  Blocklist bypass via repository repoint — three keep/drop paths evaluated
 *  the ban against the entry's STORED identity (name/slug) while the fresh
 *  packument's repository field had already repointed to a banned repo:
 *
 *  1. full path: `isBlocked(cand.name, slug)` correctly drops the candidate,
 *     but gone-check only probed `isBlockedAnyCase(e.name, e.slug)` — neither
 *     stored field lists the NEW repo — then the packument probe answered
 *     'ok' and rescanStaleNpm pushed the banned entry back. A repoint to a
 *     blocklisted repo could never take effect; the entry stayed forever.
 *  2. same hole in the evidence-regressed keep: an approved slot was
 *     protected on stored-identity grounds even with a fresh banned repo.
 *  3. reuse path: refreshMeta re-resolves packument.repository and writes it
 *     into source.repo — but nothing re-checked the blocklist against that
 *     fresh repo, so a repoint (or a blocklist row added after admission)
 *     was invisible on the cached path.
 *
 *  The fix carries fresh-identity drops in `blockedFresh`: the worker stamps
 *  it wherever a fresh packument slug/repo is found banned, and gone-check
 *  tombstones 'manual' instead of keeping. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const mkRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'good-pkg', slug: 'good-pkg', aliases: [], type: 'plugin',
  discoveredVia: ['npm-keyword'], source: { kind: 'npm', id: 'good-pkg' },
  description: { en: 'a pkg' }, category: [], license: null, deprecated: false,
  replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null,
  maintainers: [], distTags: { latest: '1.0.0' }, firstSeenAt: '2020-01-01T00:00:00Z',
  latestVersion: '1.0.0', publishedAt: null, integrity: 'sha512-old',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2020-01-01T00:00:00Z' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {}, approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2020-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

const repointedPackument = (latest: string) => ({
  name: 'good-pkg',
  'dist-tags': { latest },
  time: { created: '2020-01-01T00:00:00Z', modified: 't' },
  versions: {
    '1.0.0': { dist: { integrity: 'sha512-old', tarball: 'https://x/1.tgz' } },
    [latest]: {
      keywords: ['opencode-plugin'], main: 'index.js',
      repository: { url: 'https://github.com/evil/repo.git' },
      dist: { integrity: 'sha512-new', tarball: 'https://x/2.tgz' },
    },
  },
})

const f = (packument: unknown) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/-/v1/search')) {
    return mkRes({ objects: [{ package: { name: 'good-pkg', version: '2.0.0' } }] })
  }
  if (url.includes('registry.npmjs.org/good-pkg')) return mkRes(packument)
  if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 7 })
  if (url.includes('api.github.com/search')) return mkRes({ items: [] })
  return mkRes({}, 404)
}) as typeof fetch

describe('blocklist: repointed repository cannot keep a banned entry alive', () => {
  it('full path: repoint to banned repo → manual tombstone, not gone-check keep', async () => {
    const d = tmp('air7-')
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([e({ metrics: { stars: 1, npmDownloads30d: 1, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-06-01T00:00:00Z' } })])))
    writeFileSync(join(d, 'blocklist.json'), JSON.stringify({ slugs: ['evil/repo'] }))
    // search reports a version bump → the worker takes the full path where
    // isBlocked(fresh slug) drops it; without blockedFresh, gone-check's
    // stored-field probe resurrects the entry via rescanStaleNpm
    await run({
      outPath: join(d, 'i.json'), oldIndexPath: oldPath,
      blocklistPath: join(d, 'blocklist.json'),
      fetchFn: f(repointedPackument('2.0.0')), now: '2026-06-02T00:00:00Z', forceGate: true,
    })
    const out = JSON.parse(readFileSync(join(d, 'i.json'), 'utf8')) as CatalogIndex
    expect(out.plugins.find(p => p.name === 'good-pkg')).toBeUndefined()
    expect(out.removed.find(r => r.name === 'good-pkg')?.reason).toBe('manual')
  })

  it('evidence-regressed keep: banned repoint beats the approved-slot protect', async () => {
    const d = tmp('air7-')
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([e({ metrics: { stars: 1, npmDownloads30d: 1, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-06-01T00:00:00Z' } })])))
    writeFileSync(join(d, 'blocklist.json'), JSON.stringify({ slugs: ['evil/repo'] }))
    // same scenario but the packument lost its opencode evidence too — the
    // approved-slot keep must not shield a fresh banned repo identity
    const pk = repointedPackument('2.0.0')
    ;(pk.versions['2.0.0'] as Record<string, unknown>).keywords = ['unrelated']
    ;(pk.versions['2.0.0'] as Record<string, unknown>).main = undefined
    ;(pk as Record<string, unknown>).readme = 'nothing here'
    await run({
      outPath: join(d, 'i.json'), oldIndexPath: oldPath,
      blocklistPath: join(d, 'blocklist.json'),
      fetchFn: f(pk), now: '2026-06-02T00:00:00Z', forceGate: true,
    })
    const out = JSON.parse(readFileSync(join(d, 'i.json'), 'utf8')) as CatalogIndex
    expect(out.plugins.find(p => p.name === 'good-pkg')).toBeUndefined()
    expect(out.removed.find(r => r.name === 'good-pkg')?.reason).toBe('manual')
  })

  it('reuse path: stale-metrics refresh that lands on a banned repo → manual tombstone', async () => {
    const d = tmp('air7-')
    const oldPath = join(d, 'old.json')
    // same-version candidate + current ruleset → reuse path; stale checkedAt
    // drives refreshMeta, which re-resolves the repository field
    writeFileSync(oldPath, JSON.stringify(idx([e()])))
    writeFileSync(join(d, 'blocklist.json'), JSON.stringify({ slugs: ['evil/repo'] }))
    const searchOne = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [{ package: { name: 'good-pkg', version: '1.0.0' } }] })
      }
      if (url.includes('registry.npmjs.org/good-pkg')) return mkRes(repointedPackument('1.0.0'))
      if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 7 })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      return mkRes({}, 404)
    }) as typeof fetch
    await run({
      outPath: join(d, 'i.json'), oldIndexPath: oldPath,
      blocklistPath: join(d, 'blocklist.json'),
      fetchFn: searchOne, now: '2026-06-02T00:00:00Z', forceGate: true,
    })
    const out = JSON.parse(readFileSync(join(d, 'i.json'), 'utf8')) as CatalogIndex
    expect(out.plugins.find(p => p.name === 'good-pkg')).toBeUndefined()
    expect(out.removed.find(r => r.name === 'good-pkg')?.reason).toBe('manual')
  })
})
