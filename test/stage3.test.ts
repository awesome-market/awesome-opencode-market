/** Stage-3 tests: pending entries invisible on site/client, installs pinned to
 *  the approved version, updates rewrite the spec (never implicit latest). */
import { describe, it, expect, vi } from 'vitest'
import { listPage, detailPage, buildSite, approvalBadge, isVisible as siteVisible } from '../pipeline/site/build.ts'
import { isVisible, pinSpec, approvedTarballUrl } from '../plugins/market/src/catalog.ts'
import { dedupeToSpec, cleanSpec } from '../plugins/market/src/spec.ts'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

describe('isVisible (client + site share the rule)', () => {
  it('pending hidden; approved/legacy/absent visible', () => {
    expect(siteVisible(entry({ approval: 'pending' }))).toBe(false)
    expect(isVisible({ name: 'x', approval: 'pending' } as never)).toBe(false)
    expect(siteVisible(entry({ approval: 'approved' }))).toBe(true)
    expect(siteVisible(entry({ approval: 'legacy' }))).toBe(true)
    expect(isVisible({ name: 'x' } as never)).toBe(true) // old index, no field
  })
})

describe('pinSpec', () => {
  it('pins name@latestVersion when a version exists', () => {
    expect(pinSpec({ name: 'pkg', latestVersion: '1.2.3' })).toBe('pkg@1.2.3')
  })
  it('bare name for version-less (github-kind) entries', () => {
    expect(pinSpec({ name: 'o/r', latestVersion: null })).toBe('o/r')
    expect(pinSpec({ name: 'pkg' })).toBe('pkg')
  })
  it('pinned spec survives cleanSpec round-trip', () => {
    expect(cleanSpec(pinSpec({ name: 'pkg', latestVersion: '2.0.0' }))).toBe('pkg')
    expect(cleanSpec(pinSpec({ name: '@s/p', latestVersion: '2.0.0' }))).toBe('@s/p')
  })
})

describe('approvedTarballUrl (skill installs must not leak pendingUpdate)', () => {
  const pk = { versions: { '1.0.0': { dist: { tarball: 'https://r/approved.tgz' } }, '9.9.9': { dist: { tarball: 'https://r/latest.tgz' } } } }
  it('resolves the catalog-approved version, never dist-tags.latest', () => {
    // approved 1.0.0 while npm latest is 9.9.9 (a held pendingUpdate)
    expect(approvedTarballUrl(pk, { latestVersion: '1.0.0' })).toBe('https://r/approved.tgz')
  })
  it('no approved version → null (caller must not fall back to latest)', () => {
    expect(approvedTarballUrl(pk, { latestVersion: null })).toBeNull()
    expect(approvedTarballUrl(pk, {})).toBeNull()
  })
  it('approved version missing from packument → null, not latest', () => {
    expect(approvedTarballUrl(pk, { latestVersion: '7.7.7' })).toBeNull()
  })
})

describe('dedupeToSpec', () => {
  it('collapses old+bare+other-version specs down to the pinned one', () => {
    const out = dedupeToSpec(['pkg@0.9', 'pkg', 'other@1.0', 'pkg@0.8'], 'pkg@1.0.0')
    expect(out).toEqual(['other@1.0', 'pkg@1.0.0'])
  })
  it('scoped names: only the trailing @version splits', () => {
    expect(dedupeToSpec(['@s/p@0.1', '@s/q@9'], '@s/p@1.0')).toEqual(['@s/q@9', '@s/p@1.0'])
  })
})

describe('site rendering', () => {
  it('listPage hides pending cards entirely', () => {
    const html = listPage(idx([
      entry({ name: 'shown', slug: 's' }),
      entry({ name: 'held-secret', slug: 'h', approval: 'pending' }),
    ]))
    expect(html).toContain('shown')
    expect(html).not.toContain('held-secret')
    expect(html).toContain('1 entries')
  })
  it('approvalBadge marks only legacy', () => {
    expect(approvalBadge(entry({ approval: 'legacy' }))).toContain('legacy')
    expect(approvalBadge(entry({ approval: 'approved' }))).toBe('')
    expect(approvalBadge(entry({ approval: 'pending' }))).toBe('')
  })
  it('detailPage shows held next-version as under review', () => {
    const e = entry({ pendingUpdate: { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const html = detailPage(e)
    expect(html).toContain('v1.1.0')
    expect(html).toContain('under review')
    expect(html).toContain('pkg@1.0.0') // install line pins the APPROVED version
  })
  it('detailPage install hint pins latestVersion', () => {
    const html = detailPage(entry({ latestVersion: '2.5.1' }))
    expect(html).toContain('opencode plugin add pkg@2.5.1')
  })
  it('buildSite writes no detail page for pending, index.json keeps full data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'site3-'))
    await buildSite(idx([
      entry({ name: 'shown', slug: 'shown' }),
      entry({ name: 'pending-pkg', slug: 'pending-pkg', approval: 'pending' }),
    ]), dir)
    expect(existsSync(join(dir, 'p', 'shown.html'))).toBe(true)
    expect(existsSync(join(dir, 'p', 'pending-pkg.html'))).toBe(false)
    // index.json is the auditable data plane — pending entries stay in it
    const json = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as CatalogIndex
    expect(json.plugins.map(p => p.name).sort()).toEqual(['pending-pkg', 'shown'])
    expect(JSON.parse(readFileSync(join(dir, 'health.json'), 'utf8')).entries).toBe(1)
    expect(readdirSync(join(dir, 'p'))).toEqual(['shown.html'])
  })
})

describe('fetchIndex pending filter (data plane)', () => {
  it('strips pending entries from the fetched index', async () => {
    const body = {
      version: '1', generatedAt: 'x', plugins: [
        { name: 'ok', slug: 'ok', type: 'plugin', category: [], approval: 'approved' },
        { name: 'hidden', slug: 'hidden', type: 'plugin', category: [], approval: 'pending' },
      ],
    }
    // fresh Response per call — fetchIndex now hits health.json first (sha
    // manifest check) and a shared, already-consumed body throws on re-read
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }))
    try {
      const { fetchIndex } = await import('../plugins/market/src/catalog.ts')
      const out = await fetchIndex('https://example.test/index.json')
      expect(out.plugins.map(p => p.name)).toEqual(['ok'])
    } finally { spy.mockRestore() }
  })
})
