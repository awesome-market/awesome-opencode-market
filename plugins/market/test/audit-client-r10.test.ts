/** audit #10 (客户端消费流 §10 plugins/market) — regression:
 *  Hold semantics end-to-end at the client layer. An approved entry carrying
 *  pendingUpdate must pin/install ONLY the displayed (approved) version —
 *  the held candidate is display-only. And assertApprovedPin must reject a
 *  spec whose pin no longer equals the catalog-approved version (the window
 *  where a concern'd version could otherwise install). */
import { describe, it, expect } from 'vitest'
import { pinSpec, assertApprovedPin, installPlan, verMarker, hasUpdate, isDowngrade, sanitizeIndex, isVisible, type MarketEntry, type MarketIndex } from '../src/catalog.ts'

const mk = (over: Partial<MarketEntry> = {}): MarketEntry => ({
  name: 'pkg', slug: 'o/pkg', type: 'plugin', category: [],
  source: { kind: 'npm', id: 'pkg' },
  latestVersion: '1.0.0',
  approval: 'approved',
  contains: ['plugin'],
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' },
  ...over,
})
const idx = (plugins: MarketEntry[]): MarketIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins })

describe('§10: client hold semantics', () => {
  it('pendingUpdate.version never becomes the install pin — displayed latestVersion wins', () => {
    const e = mk({
      latestVersion: '1.0.0',
      pendingUpdate: { version: '2.0.0', heldAt: 't', reason: 'r' },
    })
    expect(pinSpec(e)).toBe('pkg@1.0.0')
    expect(verMarker(e)).toBe('1.0.0')
    // update-detection compares against the DISPLAYED version only —
    // a held 2.0.0 must not surface as "update available"
    expect(hasUpdate(e, '1.0.0')).toBe(false)
    expect(isDowngrade(e, '2.0.0')).toBe(true)   // installed 2.0.0 > approved 1.0.0 = revert-to-approved
  })

  it('assertApprovedPin rejects the stale pin once the catalog moves latestVersion to the held version', async () => {
    const held = mk({
      latestVersion: '1.0.0',
      pendingUpdate: { version: '2.0.0' },
    })
    const moved = mk({ latestVersion: '2.0.0' })   // hold released: 2.0.0 now approved
    // renderer pinned 1.0.0 while catalog still showed it — after the move
    // the same pin is stale and must be refused, not silently installed
    await expect(assertApprovedPin(async () => idx([moved]), 'pkg', 'pkg@1.0.0'))
      .rejects.toThrow('catalog moved')
    // and the NEW approved pin is what passes
    expect(await assertApprovedPin(async () => idx([moved]), 'pkg', 'pkg@2.0.0')).toBe(moved)
    void held
  })

  it('pending+hold inverted entry is invisible end-to-end: sanitizeIndex keeps it in data, isVisible drops it', () => {
    const inv = mk({
      name: 'inv', slug: 'o/inv', approval: 'pending',
      latestVersion: '1.0.0',
      pendingUpdate: { version: '9.9.9' },
    })
    const raw = idx([inv])
    const san = sanitizeIndex(raw)
    expect(san.plugins).toHaveLength(1)            // audit plane keeps the row
    expect(isVisible(san.plugins[0]!)).toBe(false) // client surface drops it
    // and installPlan on a pending row would still route — the visibility
    // filter at fetchIndexCached is what keeps it out of every UI list
    expect(installPlan(san.plugins[0]!).plugin).toBe(true)
  })
})
