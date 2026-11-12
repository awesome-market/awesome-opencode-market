/** audit #7 (放行流 §7) — regressions:
 *  1. applyMatureVerdicts' empty-verdicts early return skipped the whole
 *     per-entry pass — including the R-9 source invariant (pending entries
 *     never keep pendingUpdate). A pending+hold inverted index fed through
 *     with an empty verdicts file passed through untouched; the hold now
 *     drops even when there is nothing to adjudicate.
 *  2. run.ts discovery short-circuit read pendingUpdate unconditionally —
 *     on the inverted state it could match/reuse the STALE hold's version
 *     and caps while the real candidate (latestVersion) was never
 *     re-evaluated. All slot reads now go through candidateSlot.
 *  3. merge.ts trustFlags prevUpstream read pendingUpdate?.version before
 *     latestVersion — on the inverted state the rollback anchor compared
 *     upstream against the stale hold instead of the candidate. Now
 *     candidateVer. */
import { describe, it, expect } from 'vitest'
import { applyMatureVerdicts } from '../pipeline/verdicts.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const mkPu = (version: string, over: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) => ({
  version,
  capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  heldAt: 'h',
  ...over,
})

describe('§7: R-9 normalization survives the empty-verdicts path', () => {
  it('pending+hold with ZERO verdicts → pendingUpdate dropped (was: early return skipped the sweep)', () => {
    const e = mkEntry('p', { latestVersion: '1.0.0', pendingUpdate: mkPu('0.9.0') })
    const r = applyMatureVerdicts(mkIndex([e]), [], null)
    expect(r.releases).toEqual([])
    expect(r.held).toEqual([])
    expect(r.index.plugins[0]!.pendingUpdate).toBeUndefined()
    expect(r.index.plugins[0]!.latestVersion).toBe('1.0.0')
  })

  it('approved+hold with ZERO verdicts → legitimate hold preserved', () => {
    const e = mkEntry('p', {
      approval: 'approved', approvalReason: undefined,
      latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0'),
    })
    const r = applyMatureVerdicts(mkIndex([e]), [], null)
    expect(r.index.plugins[0]!.pendingUpdate?.version).toBe('2.0.0')
  })
})

describe('§7: merge rollback anchor uses the candidate version, not a stale hold', () => {
  it('pending+hold prev without distTags → prevUpstream = latestVersion (rollback still detected)', () => {
    // prev: pending entry, candidate 1.0.0, stale hold 0.5.0, no distTags
    // (legacy shape — the ?? fallback chain is what fires)
    const prev = mkEntry('p', {
      latestVersion: '1.0.0',
      pendingUpdate: mkPu('0.5.0'),
      distTags: {},
    })
    // fresh candidate reports upstream latest 0.9.0 — BELOW the candidate
    // 1.0.0 → sec:version-rollback must fire. Against the stale hold 0.5.0
    // it would read as an upgrade and miss the rollback entirely.
    const fresh = mkEntry('p', {
      latestVersion: '0.9.0',
      distTags: { latest: '0.9.0' },
      approval: 'pending',
    })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r', '2026-02-01T00:00:00Z')
    expect(out!.capabilities.redFlags).toContain('sec:version-rollback')
  })

  it('approved+hold prev → prevUpstream still prefers the held candidate version', () => {
    const prev = mkEntry('p', {
      approval: 'approved', approvalReason: undefined,
      latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0'),
      distTags: {},
    })
    // upstream 1.5.0 < held 2.0.0 → rollback fires against the HOLD (the
    // version actually under review), same as before the fix
    const fresh = mkEntry('p', {
      latestVersion: '1.0.0',
      distTags: { latest: '1.5.0' },
      approval: 'approved',
      pendingUpdate: mkPu('2.0.0'),
    })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r', '2026-02-01T00:00:00Z')
    expect(out!.capabilities.redFlags).toContain('sec:version-rollback')
  })
})
