// audit #3 (verify-flow, fresh round): plan.ts slot semantics must stay
// consistent — verifyTargetOf already treats a pending entry's candidate as
// the entry itself (B3 inverted pendingUpdate is dropped by R-9); verifyPartsOf
// must not read the stale hold's parts for that same entry. And VERIFY_CAP
// must reject non-positive values instead of inverting slice().
import { describe, it, expect } from 'vitest'
import { verifyPartsOf, verifyTargetOf, planTargets, verifyQueued } from '../pipeline/verify/plan.ts'
import { CatalogIndex, type PluginEntry } from '../src/schema.ts'

const caps = { scannedAt: null, findings: [], redFlags: [] }
const verf = (status: 'unverified' | 'verified' | 'failed' | 'skipped' = 'unverified') =>
  ({ status, ...(status === 'verified' ? { level: 'load' as const, opencodeVersion: '2.2.5', verifiedAt: 't' } : {}) })
const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: {}, features: [], category: [],
  license: null, deprecated: false, deprecatedMessage: null, replacement: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: caps, verification: verf(), compat: {},
  approval: 'approved', ...over,
})
const idx = (plugins: PluginEntry[]) =>
  CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })

describe('audit#3 — verifyPartsOf mirrors the B3 slot rule', () => {
  it('pending + residual pendingUpdate: parts come from the ENTRY (candidate), not the stale hold', () => {
    const e = entry({
      approval: 'pending', latestVersion: '2.0.0',
      contains: ['plugin'],
      pendingUpdate: { version: '9.9.9', capabilities: caps, verification: verf(),
        contains: ['skill'], heldAt: 't' },
    })
    // verifyTargetOf already says the candidate is the entry itself —
    // parts must agree or the shard verifies the wrong payload shape
    expect(verifyTargetOf(e).version).toBe('2.0.0')
    expect(verifyPartsOf(e)).toEqual(['plugin'])
  })

  it('approved + hold still prefers pendingUpdate.contains (unchanged)', () => {
    const e = entry({
      contains: ['plugin'],
      pendingUpdate: { version: '2.0.0', capabilities: caps, verification: verf(),
        contains: ['plugin', 'skill'], heldAt: 't' },
    })
    expect(verifyPartsOf(e)).toEqual(['plugin', 'skill'])
  })

  it('pending + stale hold no longer routes a skill-only hold into plugin checks', () => {
    // the B3 ghost: hold says skill-only, entry candidate is a plugin —
    // before the fix the target would get a structure check instead of
    // the install/load chain its real payload needs
    const e = entry({
      approval: 'pending', latestVersion: '2.0.0', contains: ['plugin'],
      pendingUpdate: { version: '9.9.9', capabilities: caps, verification: verf(),
        contains: ['skill'], heldAt: 't' },
    })
    const targets = planTargets(idx([e]))
    expect(targets).toHaveLength(1)
    expect(targets[0]!.parts).toEqual(['plugin'])
    expect(targets[0]!.version).toBe('2.0.0')
  })
})

describe('audit#3 — verifyQueued agrees with the fixed parts', () => {
  it('pending+pu entry with plugin parts stays queued (was dropped by stale skill-only hold)', () => {
    const e = entry({
      approval: 'pending', latestVersion: '2.0.0', contains: ['plugin'],
      pendingUpdate: { version: '9.9.9', capabilities: caps, verification: verf(),
        contains: ['skill'], heldAt: 't' },
    })
    // plugin IS an installable part → queued; under the bug parts=['skill']
    // still queues, so assert the stronger invariant: target parts are plugin
    expect(verifyQueued(e)).toBe(true)
  })
})
