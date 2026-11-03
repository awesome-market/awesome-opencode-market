/** Stage-5 tests: digest rendering + maturity window + diagnose candidate pick. */
import { describe, it, expect } from 'vitest'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { verdictRecord, reviewMaterial } from '../pipeline/ai/diagnose.ts'
import { applyMatureVerdicts } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

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
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.1.0', verdict: 'pass', at: '2026-01-02T00:00:00Z', source: 'ai', ...over,
})

describe('renderDigest', () => {
  it('lists pass verdicts in window, held queue, concerns', () => {
    const md = renderDigest({
      index: idx([entry(), entry({ name: 'held', pendingUpdate: { version: '9.9', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })]),
      verdicts: [v(), v({ name: 'old', at: '2025-12-01T00:00:00Z' }), v({ name: 'flagged', verdict: 'concern', reason: 'inject|ed' })],
      lastDigestAt: '2026-01-01T00:00:00Z',
      now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('| pkg | 1.1.0 | ai |')
    expect(md).not.toContain('| old |')           // outside window
    expect(md).toContain('`held` v9.9')            // queue backlog
    expect(md).toContain('inject\\|ed')            // pipe escaped for table
    expect(md).toContain('# marketplace digest 2026-01-03')
  })
  it('missing digest-state = -∞ window catches everything', () => {
    const md = renderDigest({ index: idx([]), verdicts: [v({ at: '2001-01-01T00:00:00Z' })], lastDigestAt: null, now: new Date('2026-01-03') })
    expect(md).toContain('| pkg |')
  })
})

describe('verdictRecord + digest maturity interplay', () => {
  it('pass verdict before digest → held; after digest-state → released', () => {
    const pu = { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' as const }, heldAt: 't' }
    const e = entry({ pendingUpdate: pu })
    const ver = v({ name: 'pkg', version: '1.1.0' })
    // before digest: not mature (verdict.at > lastDigestAt)
    const held = applyMatureVerdicts(idx([e]), [ver], '2026-01-01T00:00:00Z')
    expect(held.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
    // after digest published at 2026-01-02T21:00 → mature → released
    const rel = applyMatureVerdicts(idx([e]), [ver], '2026-01-02T21:00:00Z')
    expect(rel.index.plugins[0]!.latestVersion).toBe('1.1.0')
    expect(rel.index.plugins[0]!.pendingUpdate).toBeUndefined()
  })
  it('human pass also needs digest appearance (no shortcut)', () => {
    const pu = { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' as const }, heldAt: 't' }
    const e = entry({ pendingUpdate: pu })
    const hv = v({ source: 'human' })
    const held = applyMatureVerdicts(idx([e]), [hv], '2026-01-01T00:00:00Z')
    expect(held.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
  })
})

describe('reviewMaterial', () => {
  it('covers pending capabilities not the whole archive', () => {
    const m = reviewMaterial(entry({
      pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: ['uses http'], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    }))
    expect(m.some(x => x.id === 'manifest')).toBe(true)
    expect(m.some(x => x.id === 'finding:uses http')).toBe(true)
    expect(m.some(x => x.id === 'pending')).toBe(true)
  })
  it('verdictRecord pins pendingUpdate.version', () => {
    const rec = verdictRecord(entry({ pendingUpdate: { version: '3.0.1', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } }), 'pass', 'looks fine')
    expect(rec.version).toBe('3.0.1')
    expect(rec.source).toBe('ai')
  })
})
