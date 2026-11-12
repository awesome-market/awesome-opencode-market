/** audit #6 (日报流 §6) — regressions:
 *  digest.ts read `e.pendingUpdate` directly in six places, re-implementing
 *  the slot pick the WRONG way for the B3 inverted state (pending entry +
 *  residual hold): the stale hold's version/verification/capabilities/reason
 *  shadowed the real candidate (latestVersion). Every slot read now goes
 *  through candidateSlot — pending → the entry itself, approved → the hold.
 *  Sites covered: heldSlotKeys (announce-able key set), recentFailed
 *  (verOf), phaseOf (ver/vf/caps), heldLine (ver/reason). */
import { describe, it, expect } from 'vitest'
import { renderDigest, nextDigestState } from '../pipeline/ai/digest.ts'
import { akey, digestStateOf } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
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
  heldAt: '2026-01-10T00:00:00Z',
  ...over,
})
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string): AiVerdict => ({
  name, version, verdict, at, source, ...(reason ? { reason } : {}),
})
const NOW = new Date('2026-02-01T21:15:00Z')
const T = '2026-02-01T10:00:00Z'

/** pending entry carrying a residual hold — the B3 inverted state: the
 *  candidate under review is latestVersion=1.0.0; pendingUpdate@2.0.0 is
 *  stale bytes nobody is reviewing. */
const pendingWithStaleHold = (name: string, over: Partial<PluginEntry> = {},
  puOver: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) =>
  mkEntry(name, { pendingUpdate: mkPu('2.0.0', puOver), ...over })

describe('§6: pending+hold slot reads go through candidateSlot', () => {
  it('heldSlotKeys: a verdict on the stale hold key is NOT announce-able; the real candidate key is', () => {
    const e = pendingWithStaleHold('p')
    const staleHoldVerdict = v('p', '2.0.0', 'pass', T)
    const realVerdict = v('p', '1.0.0', 'pass', T)
    const st = nextDigestState([staleHoldVerdict, realVerdict], null, NOW, mkIndex([e]))
    expect(st.announced).toContain(akey(realVerdict))
    expect(st.announced).not.toContain(akey(staleHoldVerdict))
  })

  it('heldLine: pending+hold renders the CANDIDATE version (v1.0.0（未上架）), not the stale hold', () => {
    const e = pendingWithStaleHold('p')
    const md = renderDigest({ index: mkIndex([e]), verdicts: [], prev: null, now: NOW })
    expect(md).toContain('`p` v1.0.0（未上架）')
    expect(md).not.toContain('v2.0.0')
  })

  it('heldLine reason: pending+hold shows approvalReason, not the stale hold reason', () => {
    const e = pendingWithStaleHold('p',
      { approvalReason: 'human asked for rescan' },
      { reason: 'stale hold reason' })
    const md = renderDigest({ index: mkIndex([e]), verdicts: [], prev: null, now: NOW })
    expect(md).toContain('human asked for rescan')
    expect(md).not.toContain('stale hold reason')
  })

  it('phaseOf verification: entry verification (failed) outranks the stale hold verification (verified)', () => {
    const e = pendingWithStaleHold('p',
      { verification: { status: 'failed', level: 'install', logExcerpt: 'boom', retries: 1 } },
      { verification: { status: 'verified', level: 'load' } })
    const md = renderDigest({ index: mkIndex([e]), verdicts: [], prev: null, now: NOW })
    expect(md).toContain('验证失败')
    expect(md).not.toContain('已公告·待放行闸')
  })

  it('phaseOf caps: entry redFlags (not the stale hold\'s clean caps) gate an ai pass', () => {
    const e = pendingWithStaleHold('p',
      { capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:exec:a.js'] } },
      { capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] } })
    const ap = v('p', '1.0.0', 'pass', T)
    // announce it yesterday so the pass phase is reachable today
    const prev = digestStateOf('2026-01-31T21:00:00Z', [ap])
    const md = renderDigest({ index: mkIndex([e]), verdicts: [ap], prev, now: NOW })
    expect(md).toContain('AI pass 被旗标/未扫描拦截·需人工')
  })

  it('recentFailed (verOf): entry-level recent failure counts; the stale hold\'s clean verification does not mask it', () => {
    const e = pendingWithStaleHold('p',
      { verification: { status: 'failed', level: 'install', logExcerpt: 'boom', retries: 1, verifiedAt: T } },
      { verification: { status: 'verified', level: 'load' } })
    const md = renderDigest({ index: mkIndex([e]), verdicts: [], prev: null, now: NOW })
    expect(md).toContain('近 7 天验证失败 1')
  })

  it('approved+hold still reads the hold slot (candidateSlot preserves the real hold semantics)', () => {
    const e = mkEntry('p', {
      approval: 'approved',
      pendingUpdate: mkPu('2.0.0', { reason: 'hold reason' }),
    })
    const ap = v('p', '2.0.0', 'pass', T)
    const st = nextDigestState([ap], null, NOW, mkIndex([e]))
    expect(st.announced).toContain(akey(ap))
    const md = renderDigest({ index: mkIndex([e]), verdicts: [ap], prev: null, now: NOW })
    expect(md).toContain('`p` v2.0.0')
    expect(md).toContain('hold reason')
  })
})
