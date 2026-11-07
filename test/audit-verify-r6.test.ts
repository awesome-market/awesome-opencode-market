/** audit #3 fresh round (verification-flow, round 6):
 *  hostStaleVerify advertised "same filters as the queue" but dropped the
 *  concern-verdict gate verifyQueued applies — digest §④'s staleHost backlog
 *  counted slots a verdict already condemned, over-reporting the re-verify
 *  tier next to a queue number that correctly excluded them. The predicate
 *  now takes the same latest/latestHuman/tomb maps the queue gets. */
import { describe, it, expect } from 'vitest'
import { hostStaleVerify } from '../pipeline/verify/plan.ts'
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
  // a verified result recorded under a different host — the stale-backlog case
  verification: { status: 'verified', level: 'load', opencodeVersion: 'oc-old',
    verifiedAt: '2026-01-01T00:00:00Z' },
  compat: {}, approval: 'approved', contains: ['plugin'],
  ...over,
})
const verdict = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'p', version: '2.0.0', verdict: 'concern', at: '2026-01-02T00:00:00Z',
  source: 'human', ...over,
})

describe('hostStaleVerify: condemned slots are not stale-backlog', () => {
  it('uncondemned stale slot still counts', () => {
    expect(hostStaleVerify(entry())).toBe(true)
    expect(hostStaleVerify(entry(), new Map(), new Map(), new Map())).toBe(true)
  })
  it('a standing concern on the slot drops it from the stale backlog', () => {
    const vs = [verdict()]
    const latest = latestVerdicts(vs)
    const human = latestHumanVerdicts(vs)
    // the queue predicate (verifyQueued) already excludes this slot — the
    // backlog stat must agree instead of over-reporting it
    expect(hostStaleVerify(entry(), latest, human, new Map())).toBe(false)
  })
  it('a package-level concern brake also drops the slot', () => {
    const vs = [verdict({ version: null })]
    expect(hostStaleVerify(entry(), latestVerdicts(vs), latestHumanVerdicts(vs), new Map())).toBe(false)
  })
  it('a pass verdict does not drop the slot', () => {
    const vs = [verdict({ verdict: 'pass' })]
    expect(hostStaleVerify(entry(), latestVerdicts(vs), latestHumanVerdicts(vs), new Map())).toBe(true)
  })
})
