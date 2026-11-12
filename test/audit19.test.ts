/** audit #7 (放行流 §7) — regressions:
 *  1. A later AI pass must NOT shadow a standing human pass on a flagged /
 *     never-scanned slot back into "ignored forever" — the human verdict is
 *     the only sanctioned release authority for those slots (human
 *     stickiness, applied to passes). The release rides the LIVE line's
 *     akey maturity: a superseded human akey is pruned from `announced`,
 *     so swapping the verdict source could never mature.
 *  2. catalog.yml's catalog fetches carry the forced '+refspec' so a
 *     non-FF catalog move can't leave origin/catalog stale inside the
 *     publish/notify retry loops (same hardening as §2/§4/§5/§6). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyMatureVerdicts, digestStateOf, explainEntry, humanPassCovers,
  latestHumanVerdicts, tombEpochs, akey } from '../pipeline/verdicts.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
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
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[], removed: CatalogIndex['removed'] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
const mkPu = (version: string, over: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) => ({
  version,
  capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  heldAt: 'h',
  ...over,
})
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string): AiVerdict => ({
    name, version, verdict, at, source, ...(reason ? { reason } : {}),
  })
const DIGEST = '2026-02-01T21:00:00Z'
const T1 = '2026-02-01T10:00:00Z'
const T2 = '2026-02-01T12:00:00Z'
const pendingFlagged = (name: string, caps: Partial<PluginEntry['capabilities']> = {}) =>
  mkEntry(name, {
    approval: 'pending', approvalReason: 'awaiting-review',
    capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:x'], ...caps },
  })

describe('§7: human pass covers a later ai pass on flagged/unscanned slots', () => {
  it('pending flagged slot: human pass T1 + ai pass T2(mature) → releases under human authority', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    // both lines announced — T2 is the live line whose akey carries maturity
    const dg = digestStateOf(DIGEST, [hp, ap])
    const r = applyMatureVerdicts(mkIndex([e]), [hp, ap], dg)
    expect(r.releases).toContain('p@1.0.0')
    expect(r.index.plugins[0]!.approval).toBe('approved')
  })
  it('unscanned slot (scannedAt null): same shadow → same release', () => {
    const e = pendingFlagged('p', { redFlags: [], scannedAt: null })
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const r = applyMatureVerdicts(mkIndex([e]), [hp, ap], digestStateOf(DIGEST, [hp, ap]))
    expect(r.releases).toContain('p@1.0.0')
  })
  it('held (pendingUpdate) flagged slot: human pass T1 + ai pass T2 → pu releases', () => {
    const e = mkEntry('p', {
      pendingUpdate: mkPu('2.0.0', {
        capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: ['sec:y'] },
      }),
    })
    const hp = v('p', '2.0.0', 'pass', T1, 'human')
    const ap = v('p', '2.0.0', 'pass', T2, 'ai')
    const r = applyMatureVerdicts(mkIndex([e]), [hp, ap], digestStateOf(DIGEST, [hp, ap]))
    expect(r.releases).toContain('p@2.0.0')
    expect(r.index.plugins[0]!.latestVersion).toBe('2.0.0')
    expect(r.index.plugins[0]!.pendingUpdate).toBeUndefined()
  })
  it('no human pass → ai pass on flagged slot still ignored (gate intact)', () => {
    const e = pendingFlagged('p')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const r = applyMatureVerdicts(mkIndex([e]), [ap], digestStateOf(DIGEST, [ap]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('cover requires a STANDING pass: human concern T3 lifts the cover', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const hc = v('p', '1.0.0', 'concern', '2026-02-01T14:00:00Z', 'human', 'changed my mind')
    const ap = v('p', '1.0.0', 'pass', '2026-02-01T16:00:00Z', 'ai')
    const r = applyMatureVerdicts(mkIndex([e]), [hp, hc, ap], digestStateOf(DIGEST, [ap]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('cover is epoch-gated: a pre-tombstone human pass does not cover a recycled name', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', '2025-01-01T00:00:00Z', 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const idx = mkIndex([e], [{ name: 'p', disappearedAt: '2025-06-01T00:00:00Z', reason: 'gone' } as never])
    const r = applyMatureVerdicts(idx, [hp, ap], digestStateOf(DIGEST, [ap]))
    expect(r.releases).toEqual([])
  })
  it('maturity rides the LIVE ai line: unannounced ai pass → still waits', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    // only the human line announced — the live ai line has no objection window yet
    const r = applyMatureVerdicts(mkIndex([e]), [hp, ap], digestStateOf(DIGEST, [hp]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('ai concern after human pass still brakes (conservative direction unchanged)', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ac = v('p', '1.0.0', 'concern', T2, 'ai', 'found something')
    const r = applyMatureVerdicts(mkIndex([e]), [hp, ac], digestStateOf(DIGEST, [ac]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approvalReason).toBe('found something')
  })
  it('humanPassCovers: epoch + verdict-shape semantics', () => {
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const human = latestHumanVerdicts([hp])
    expect(humanPassCovers(human, 'p', '1.0.0', new Map())).toBe(true)
    expect(humanPassCovers(human, 'p', '2.0.0', new Map())).toBe(false)
    expect(humanPassCovers(human, 'p', '1.0.0',
      tombEpochs([{ name: 'p', disappearedAt: '2026-02-02T00:00:00Z', reason: 'x' } as never]))).toBe(false)
    const hc = latestHumanVerdicts([v('p', '1.0.0', 'concern', T1, 'human')])
    expect(humanPassCovers(hc, 'p', '1.0.0', new Map())).toBe(false)
  })
})

describe('§7: mirrors stay honest about the cover', () => {
  it('explainEntry: covered ai pass reports release (with the cover note), not 被拦截', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const dg = digestStateOf(DIGEST, [hp, ap])
    const [s] = explainEntry(e, [hp, ap], dg, [])
    expect(s!.aiBlockedByFlags).toBe(false)
    expect(s!.outcome).toBe('release')
    expect(s!.why).toContain('人工 pass 覆盖')
  })
  it('explainEntry: uncovered ai pass still reports the block', () => {
    const e = pendingFlagged('p')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const [s] = explainEntry(e, [ap], digestStateOf(DIGEST, [ap]), [])
    expect(s!.aiBlockedByFlags).toBe(true)
    expect(s!.outcome).toBe('wait')
  })
  it('digest phaseOf mirror: covered flagged slot renders a pass phase, not 需人工', () => {
    const e = pendingFlagged('p')
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const md = renderDigest({
      index: mkIndex([e]), verdicts: [hp, ap],
      prev: digestStateOf('2026-01-31T21:00:00Z', [hp]),
      now: new Date('2026-02-01T21:15:00Z'),
    })
    expect(md).not.toContain('AI pass 被旗标/未扫描拦截·需人工')
    expect(md).toContain('待')  // still shows an honest waiting phase (immature/待放行闸)
  })
  it('digest phaseOf mirror: uncovered flagged slot still renders 需人工', () => {
    const e = pendingFlagged('p')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const md = renderDigest({
      index: mkIndex([e]), verdicts: [ap],
      prev: digestStateOf('2026-01-31T21:00:00Z', []),
      now: new Date('2026-02-01T21:15:00Z'),
    })
    expect(md).toContain('AI pass 被旗标/未扫描拦截·需人工')
  })
})

describe('§7: catalog.yml fetch refspec consistency', () => {
  const WF = readFileSync(new URL('../.github/workflows/catalog.yml', import.meta.url), 'utf8')
  it('every catalog-branch fetch uses the forced refspec (non-FF move cannot wedge the loops)', () => {
    const fetches = WF.match(/git fetch [^\n]*catalog[^\n]*/g) ?? []
    expect(fetches.length).toBeGreaterThanOrEqual(4)
    for (const f of fetches) {
      expect(f).toContain('--depth=1')
      expect(f).toContain('+refs/heads/catalog:refs/remotes/origin/catalog')
    }
  })
  it('akey maturity model sanity: superseded akeys are prunable without breaking the cover path', () => {
    // the fix deliberately rides the LIVE line's akey — assert the announced
    // set the digest would keep contains the live (ai) line, so mature(v)
    // evaluates the line that actually carries the objection window
    const hp = v('p', '1.0.0', 'pass', T1, 'human')
    const ap = v('p', '1.0.0', 'pass', T2, 'ai')
    const dg = digestStateOf(DIGEST, [hp, ap])
    expect(dg.announced).toContain(akey(ap))
    expect(dg.announced).toContain(akey(hp))   // test fixture keeps both; the
    // real compactor prunes hp — the gate only ever reads akey(ap) here
  })
})
