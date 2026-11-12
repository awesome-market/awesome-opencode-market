/** audit #8 (审核单流 §8) — regressions:
 *  docketTargets read `e.pendingUpdate ?? e` for the evidence slot while the
 *  verdict key already used candidateVer — on the B3 inverted state
 *  (pending entry + leftover hold) the issue would key on latestVersion but
 *  render the STALE hold's verification/redFlags/integrity/publishedAt as
 *  the candidate's evidence. heldStamp had the same drift for the 48h
 *  clock. Both now go through candidateSlot. */
import { describe, it, expect } from 'vitest'
import { docketTargets } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  integrity: 'sha512-entry',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: '2026-01-10T00:00:00Z', findings: ['f:entry.js'], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-20T00:00:00Z', source: 'ai', ...over,
})
const pu = (over: Record<string, unknown> = {}) => ({
  version: '2.0.0', heldAt: '2026-01-05T00:00:00Z',
  capabilities: { scannedAt: '2026-01-05T00:00:00Z', findings: [], redFlags: ['sec:exec:evil.js'] },
  verification: { status: 'failed' as const },
  integrity: 'sha512-hold',
  publishedAt: '2026-01-05',
  ...over,
})

describe('§8: pending+hold evidence slot follows candidateSlot', () => {
  it('issue keys on latestVersion AND renders the ENTRY\'s evidence, not the stale hold\'s', () => {
    const entry = e({ pendingUpdate: pu() as never })
    const [t] = docketTargets(idx([entry]), [v()], null, { now: '2026-01-21T00:00:00Z' })
    expect(t).toBeDefined()
    expect(t!.version).toBe('1.0.0')               // candidateVer — was already right
    expect(t!.verification).toBe('verified')        // entry side, not hold's 'failed'
    expect(t!.redFlags).toBe(0)                     // entry side, not hold's sec:exec
    expect(t!.findings).toBe(1)
    expect(t!.integrity).toBe('sha512-entry')
    expect(t!.publishedAt).toBe('2026-01-01')
    expect(t!.scanPreview).toEqual(['f:entry.js'])
    // held clock = entry's scannedAt (2026-01-10), not the hold's heldAt (01-05)
    expect(t!.heldAt).toBe('2026-01-10T00:00:00Z')
  })

  it('approved+hold still renders the HOLD\'s evidence for its own version', () => {
    const entry = e({
      approval: 'approved',
      pendingUpdate: pu() as never,
    })
    const [t] = docketTargets(idx([entry]), [v({ version: '2.0.0', verdict: 'concern' })],
      null, { now: '2026-01-21T00:00:00Z' })
    expect(t).toBeDefined()
    expect(t!.version).toBe('2.0.0')
    expect(t!.verification).toBe('failed')          // hold side — correct for approved
    expect(t!.redFlags).toBe(1)
    expect(t!.integrity).toBe('sha512-hold')
    expect(t!.heldAt).toBe('2026-01-05T00:00:00Z')   // hold's heldAt
  })
})
