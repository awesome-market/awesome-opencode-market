/** audit #7 fresh-batch (release flow, round 2):
 *  1. brakeFor/slotVerdict lift check was not epoch-gated: a slot-keyed human
 *     pass predating the name's latest tombstone judged a DEAD incarnation —
 *     letting it dissolve a live package brake dropped the brake exactly on
 *     recycled names, where "concern inherits distrust" is the spec. The
 *     shared predicates now take an optional tomb map; every callsite that
 *     knows removed entries passes it (release gate, run.ts pin check,
 *     digest phases, docket, diagnose queue/sweep, verify queue).
 *  2. pkgPass normalization read the raw human map — a stale name@null pass
 *     reset a live entry's approvalReason; now epoch-gated too.
 *  3. explainEntry rendered a pendingUpdate chain for approval:'pending'
 *     entries — the B3 inverted state the gate refuses to adjudicate (and
 *     drops via the R-9 cleanup). Reporting it would mislead ops. */
import { describe, it, expect } from 'vitest'
import { applyMatureVerdicts, brakeFor, slotVerdict, explainEntry, latestVerdicts, latestHumanVerdicts, tombEpochs } from '../pipeline/verdicts.ts'
import { verifyQueued } from '../pipeline/verify/plan.ts'
import type { CatalogIndex, PluginEntry, AiVerdict, RemovedEntry } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-10', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[], removed: RemovedEntry[] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
const tomb = (at: string, name = 'p'): RemovedEntry => ({ slug: name, name, disappearedAt: at, reason: 'npm-404' })
const mkVerdict = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string): AiVerdict => ({
    name, version, verdict, at, source, ...(reason ? { reason } : {}),
  })

// timeline: brake T1 → slot pass T2 (lifts under old code) → tombstone T3 →
// name re-created and re-enters the index
const T_BRAKE = '2026-01-01T00:00:00Z'
const T_SLOT_PASS = '2026-01-02T00:00:00Z'
const T_TOMB = '2026-01-03T00:00:00Z'
const VERDICTS = [
  mkVerdict('p', null, 'concern', T_BRAKE, 'human', 'package brake'),
  mkVerdict('p', '1.0.0', 'pass', T_SLOT_PASS, 'human'),
]

describe('package brake vs stale lifting pass (epoch-gated)', () => {
  const human = latestHumanVerdicts(VERDICTS)
  const latest = latestVerdicts(VERDICTS)
  const tombs = tombEpochs([tomb(T_TOMB)])

  it('a pre-tombstone slot pass does NOT dissolve the brake', () => {
    expect(brakeFor(human, 'p', '1.0.0', tombs)?.verdict).toBe('concern')
    expect(slotVerdict(latest, human, 'p', '1.0.0', tombs)?.verdict).toBe('concern')
  })

  it('omitting tomb keeps the old lifted behavior (compat)', () => {
    expect(brakeFor(human, 'p', '1.0.0')).toBeUndefined()
  })

  it('a POST-tombstone slot pass still lifts the brake (regression)', () => {
    const v2 = [...VERDICTS, mkVerdict('p', '1.0.0', 'pass', '2026-01-04T00:00:00Z', 'human')]
    const h2 = latestHumanVerdicts(v2)
    expect(brakeFor(h2, 'p', '1.0.0', tombs)).toBeUndefined()
  })
})

describe('applyMatureVerdicts — recycled name keeps the brake', () => {
  it('stale slot pass cannot un-brake a re-entered package', () => {
    const idx = mkIndex([mkEntry('p')], [tomb(T_TOMB)])
    const r = applyMatureVerdicts(idx, VERDICTS, null)
    const e = r.index.plugins[0]!
    // brake governs → displayed entry pulled back to pending
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('package brake')
    expect(r.held).toContain('p@1.0.0')
    expect(r.releases).toHaveLength(0)
  })

  it('pkgPass normalization is epoch-gated: a stale name@null pass must not reset a live reason', () => {
    const idx = mkIndex([
      mkEntry('p', { approval: 'pending', approvalReason: 'still reviewing' }),
    ], [tomb(T_TOMB)])
    const vs = [mkVerdict('p', null, 'pass', T_SLOT_PASS, 'human')] // pre-tombstone → dead
    const r = applyMatureVerdicts(idx, vs, null)
    expect(r.index.plugins[0]!.approvalReason).toBe('still reviewing')
  })
})

describe('explainEntry — B3 inverted state', () => {
  it('approval:pending + pendingUpdate explains only the displayed slot', () => {
    const e = mkEntry('p', {
      approval: 'pending',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
        verification: { status: 'unverified', level: 'install' }, heldAt: 'h' },
    })
    const chains = explainEntry(e, [], null)
    expect(chains.map(c => c.slot)).toEqual(['displayed'])
  })
})

describe('verifyQueued — tomb-aware brake check', () => {
  it('a braked slot stays out of the queue even with a stale slot pass', () => {
    const e = mkEntry('p', { verification: { status: 'unverified', level: 'install' } })
    const latest = latestVerdicts(VERDICTS)
    const human = latestHumanVerdicts(VERDICTS)
    expect(verifyQueued(e, new Date(), latest, human, tombEpochs([tomb(T_TOMB)]))).toBe(false)
    // without tomb the stale pass dissolves the brake and the slot queues
    // (pre-fix behavior — kept as the compat contract)
    expect(verifyQueued(e, new Date(), latest, human)).toBe(true)
  })
})
