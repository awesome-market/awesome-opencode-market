/** Stage-5 tests: digest rendering + maturity window + diagnose candidate pick. */
import { describe, it, expect } from 'vitest'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { verdictRecord, reviewMaterial, unreviewedTargets } from '../pipeline/ai/diagnose.ts'
import { applyMatureVerdicts, latestVerdicts } from '../pipeline/verdicts.ts'
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
  it('verify backlog section reports queue/submissions/recent-failures/oldest', () => {
    const md = renderDigest({
      index: idx([
        entry({ name: 'wait-a', verification: { status: 'unverified' } }),
        entry({ name: 'wait-sub', discoveredVia: ['submission'], verification: { status: 'unverified' }, firstSeenAt: '2025-12-20T00:00:00Z' }),
        entry({ name: 'f7d', verification: { status: 'failed', verifiedAt: '2026-01-02T00:00:00Z' } }),
        entry({ name: 'flagged', verification: { status: 'unverified' }, capabilities: { scannedAt: 't', findings: [], redFlags: ['x:y'] } }),
      ]),
      verdicts: [], lastDigestAt: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('验证积压（queue — 2）')
    expect(md).toContain('投稿优先 1')
    expect(md).toContain('近 7 天验证失败 1')
    expect(md).toContain('最老等待 2025-12-20')
  })
  it('missing digest-state = -∞ window catches everything', () => {
    const md = renderDigest({ index: idx([]), verdicts: [v({ at: '2001-01-01T00:00:00Z' })], lastDigestAt: null, now: new Date('2026-01-03') })
    expect(md).toContain('| pkg |')
  })
})

describe('verdictRecord + digest maturity interplay', () => {
  it('bilingual reasons: reasonEn lands on the record and in the digest', () => {
    const rec = { ...verdictRecord(entry(), 'pass', '中文理由', { reasonEn: 'english reason' }), at: '2026-01-02T00:00:00Z' }
    expect(rec.reason).toBe('中文理由')
    expect(rec.reasonEn).toBe('english reason')
    const md = renderDigest({ index: idx([]), verdicts: [rec], lastDigestAt: null, now: new Date('2026-01-03') })
    expect(md).toContain('中文理由 / english reason')
  })
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

describe('unreviewedTargets (diagnose candidate pick)', () => {
  const seen = (vs: AiVerdict[]) => latestVerdicts(vs)
  it('picks never-verdicted pending entries and pendingUpdates', () => {
    const pend = entry({ name: 'a', approval: 'pending' })
    const bump = entry({ name: 'b', approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const done = entry({ name: 'c', approval: 'approved' })                    // approved, no hold → not a target
    const targets = unreviewedTargets(idx([pend, bump, done]), seen([]))
    expect(targets.map(e => e.name)).toEqual(['a', 'b'])
  })
  it('a HUMAN verdict excludes the target — AI must never overturn it', () => {
    const bump = entry({ approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const hv: AiVerdict = { name: 'pkg', version: '2.0', verdict: 'concern', at: 't2', source: 'human', reason: 'no' }
    expect(unreviewedTargets(idx([bump]), seen([hv]))).toEqual([])
  })
  it('an existing AI verdict also excludes (no re-review churn)', () => {
    const pend = entry({ approval: 'pending' })
    const av: AiVerdict = { name: 'pkg', version: '1.0.0', verdict: 'pass', at: 't1', source: 'ai' }
    expect(unreviewedTargets(idx([pend]), seen([av]))).toEqual([])
  })
  it('verdict on a DIFFERENT version does not exclude the held candidate', () => {
    const bump = entry({ approval: 'approved', latestVersion: '1.0.0', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const old = v({ name: 'pkg', version: '1.0.0' })
    expect(unreviewedTargets(idx([bump]), seen([old])).map(e => e.name)).toEqual(['pkg'])
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
