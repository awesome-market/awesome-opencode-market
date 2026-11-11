/** audit #3 fresh round (verification-flow, round 7):
 *  host-bump amnesty for terminal failures — a 'failed' slot with its retry
 *  budget spent on an OLD host re-enters the queue once per OPENCODE_VERSION
 *  bump (the failure was measured on a runtime users no longer run). Same
 *  honesty rules as hostStale: 'unknown' host ≠ provably stale, 'structure'-
 *  level fails never ran the host, concern verdicts still veto. */
import { describe, it, expect } from 'vitest'
import { verifyQueued, planTargets } from '../pipeline/verify/plan.ts'
import { OPENCODE_VERSION } from '../pipeline/publish/merge.ts'
import { latestVerdicts, latestHumanVerdicts } from '../pipeline/verdicts.ts'
import type { AiVerdict, PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'p' }, description: { en: '' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '2.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  // budget burned (3 retries) on an OLD host — the amnesty case
  verification: { status: 'failed', level: 'load', opencodeVersion: 'oc-old',
    verifiedAt: '2026-01-01T00:00:00Z', retries: 3 },
  compat: {}, approval: 'approved', contains: ['plugin'],
  ...over,
})
const idx = (plugins: PluginEntry[]) =>
  ({ plugins, removed: [] }) as unknown as Parameters<typeof planTargets>[0]

describe('hostStaleFail: terminal failure on an old host re-queues once', () => {
  it('failed@3 on oc-old → queued', () => {
    expect(verifyQueued(entry())).toBe(true)
    expect(planTargets(idx([entry()])).map(t => t.name)).toEqual(['p'])
  })
  it('failed@3 on the CURRENT host → stays terminal (no amnesty needed)', () => {
    const e = entry({ verification: { status: 'failed', level: 'load', opencodeVersion: OPENCODE_VERSION, verifiedAt: 't', retries: 3 } })
    expect(verifyQueued(e)).toBe(false)
  })
  it('failed with unknown host → NOT stale (unknown ≠ provably off-host)', () => {
    const e = entry({ verification: { status: 'failed', level: 'load', opencodeVersion: 'unknown', verifiedAt: 't', retries: 3 } })
    expect(verifyQueued(e)).toBe(false)
  })
  it('structure-level fail on old host → stays out (never ran the host)', () => {
    const e = entry({ verification: { status: 'failed', level: 'structure', opencodeVersion: 'oc-old', verifiedAt: 't', retries: 3 } })
    expect(verifyQueued(e)).toBe(false)
  })
  it('budget NOT yet spent on old host → queued via retryable anyway', () => {
    const e = entry({ verification: { status: 'failed', level: 'load', opencodeVersion: 'oc-old', verifiedAt: 't', retries: 1 } })
    expect(verifyQueued(e)).toBe(true)
  })
  it('no recorded host (pre-field legacy verdict) → stale, same rule as hostStale', () => {
    const e = entry({ verification: { status: 'failed', level: 'load', verifiedAt: '2026-01-01T00:00:00Z', retries: 3 } })
    expect(verifyQueued(e)).toBe(true)
  })
  it('a standing concern verdict still vetoes the amnesty', () => {
    const vs: AiVerdict[] = [{ name: 'p', version: '2.0.0', verdict: 'concern', at: '2026-01-02T00:00:00Z', source: 'human' }]
    expect(verifyQueued(entry(), new Date(), latestVerdicts(vs), latestHumanVerdicts(vs), new Map())).toBe(false)
  })
})
