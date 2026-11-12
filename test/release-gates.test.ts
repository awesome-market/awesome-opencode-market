/** Release-gate hardening regression coverage (2026-11 audit batch 2):
 *  B2 publishedAt/features no longer inherit displayed-version data on release;
 *  B3 applyMatureVerdicts normalizes pending+pendingUpdate at the source;
 *  G2 verdict.sha is checked against the slot's integrity before release;
 *  G3 first-digest bootstrap windows the backlog announce;
 *  G4 verdicts-compact drops only superseded old AI lines;
 *  G5 legacy entries upgrade on a mature pass;
 *  G6 stale approvalReason resets when a newer pass supersedes;
 *  G8 pkg@* package-level human brake;
 *  G9 verify-merge flagged-slot results land as 'skipped';
 *  L-2 held-slot pu.reason normalizes when its concern verdict is superseded;
 *  L-3 tombstone epoch — a pass predating disappearance cannot release a
 *      recreated/recycled-name entry (concerns still brake, conservatively). */
import { describe, it, expect } from 'vitest'
import { applyMatureVerdicts, digestStateOf, explainEntry, akey } from '../pipeline/verdicts.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import type { VerifyResult } from '../pipeline/verify/verify.ts'
import { nextDigestState, renderDigest } from '../pipeline/ai/digest.ts'
import { compactLines } from '../pipeline/verdicts-compact.ts'
import { resolveVerdictEvent } from '../pipeline/human-verdict.ts'
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
const mkVerdict = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string, sha?: string): AiVerdict => ({
    name, version, verdict, at, source,
    ...(reason ? { reason } : {}), ...(sha ? { sha } : {}),
  })
const DIGEST = '2026-02-01T21:00:00Z'
const BEFORE = '2026-02-01T10:00:00Z'
const AFTER = '2026-02-02T08:00:00Z'

// ————— B2: release must not resurrect displayed-version metadata —————
describe('B2: held release promotes the CANDIDATE\'s own metadata', () => {
  it('absent pu.publishedAt → null, never the old version\'s publish date', () => {
    const e = mkEntry('p', {
      publishedAt: '2020-01-01',
      pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-N' }),
    })
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE)
    const [out] = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v])).index.plugins
    expect(out!.latestVersion).toBe('1.1.0')
    expect(out!.publishedAt).toBeNull()        // NOT '2020-01-01'
  })
  it('absent pu.features → empty, never the old version\'s feature set', () => {
    const e = mkEntry('p', {
      features: ['tui'],
      pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-N' }),   // no features — legacy hold shape
    })
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE)
    const [out] = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v])).index.plugins
    expect(out!.features).toEqual([])          // NOT ['tui'] — verify routing stays honest
  })
  it('present pu fields still promote normally', () => {
    const e = mkEntry('p', {
      pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-N', publishedAt: '2026-01-15', features: ['server'], contains: ['plugin', 'skill'] }),
    })
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE)
    const [out] = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v])).index.plugins
    expect(out!.publishedAt).toBe('2026-01-15')
    expect(out!.features).toEqual(['server'])
    expect(out!.contains).toEqual(['plugin', 'skill'])
    expect(out!.integrity).toBe('sha512-N')
  })
})

// ————— B3: brake normalizes pending+pendingUpdate at the source —————
describe('B3: pending entries never carry pendingUpdate out of applyMatureVerdicts', () => {
  it('displayed-version concern drops the stale hold (matches mergeEntries R-9)', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const hc = mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'supply chain')
    const r = applyMatureVerdicts(mkIndex([e]), [hc], null)
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.approvalReason).toBe('supply chain')
    expect(out.pendingUpdate).toBeUndefined()  // was: left as an inverted shadow
    expect(r.held).toContain('p@1.0.0')
  })
  it('immature held pass + displayed brake → pending, hold dropped (its verdict survives in jsonl)', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const vp = mkVerdict('p', '2.0.0', 'pass', BEFORE, 'ai')          // not announced → immature
    const brake = mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'bad maintainer')
    const r = applyMatureVerdicts(mkIndex([e]), [vp, brake], digestStateOf(DIGEST, []))
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.pendingUpdate).toBeUndefined()
  })
  it('displayed concern brakes before the hold can release past it — "concern 立即生效"', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const vp = mkVerdict('p', '2.0.0', 'pass', BEFORE, 'ai')
    const stale = mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'old-version issue')
    const r = applyMatureVerdicts(mkIndex([e]), [vp, stale], digestStateOf(DIGEST, [vp]))
    const out = r.index.plugins[0]!
    // the displayed slot judges FIRST: a concern on the version people are
    // seeing right now must take effect — releasing the hold first would
    // promote latestVersion past the concern's key and the brake would
    // land nowhere (its target replaced in the same iteration). The held
    // 2.0.0 is dropped by R-9; its mature pass stays keyed and it releases
    // when 2.0.0 re-enters as a fresh candidate.
    expect(out.approval).toBe('pending')
    expect(out.approvalReason).toBe('old-version issue')
    expect(out.latestVersion).toBe('1.0.0')
    expect(out.pendingUpdate).toBeUndefined()
    expect(r.releases).toEqual([])
    expect(r.held).toContain('p@1.0.0')
  })
  it('pre-existing pending+pu input is healed even without touching verdicts', () => {
    const e = mkEntry('p', { approval: 'pending', pendingUpdate: mkPu('2.0.0') })
    const r = applyMatureVerdicts(mkIndex([e]), [mkVerdict('other', '9.9', 'pass', BEFORE)], null)
    expect(r.index.plugins[0]!.pendingUpdate).toBeUndefined()
  })
})

// ————— G2: verdict.sha must match the bytes the slot will ship —————
describe('G2: sha-pinned verdicts refuse to release retagged bytes', () => {
  it('pu release blocked when verdict.sha ≠ pu.integrity', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-PINNED' }) })
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE, 'ai', undefined, 'sha512-OTHER')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toHaveLength(0)
    expect(r.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
  })
  it('pu releases when verdict.sha === pu.integrity', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-X' }) })
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE, 'ai', undefined, 'sha512-X')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual(['p@1.1.0'])
    expect(r.index.plugins[0]!.integrity).toBe('sha512-X')
  })
  it('legacy hold (no pu.integrity) is NOT false-blocked by a sha-bearing verdict', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('1.1.0') })   // no integrity field
    const v = mkVerdict('p', '1.1.0', 'pass', BEFORE, 'ai', undefined, 'sha512-X')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual(['p@1.1.0'])   // e.integrity (old version) is NOT used as the candidate anchor
  })
  it('displayed-slot approve blocked when verdict.sha ≠ e.integrity', () => {
    const e = mkEntry('p', { approval: 'pending', integrity: 'sha512-OLD' })
    const v = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai', undefined, 'sha512-NEW')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('displayed-slot approve proceeds when sha matches or is absent', () => {
    const e = mkEntry('p', { approval: 'pending', integrity: 'sha512-X' })
    const v1 = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai', undefined, 'sha512-X')
    expect(applyMatureVerdicts(mkIndex([e]), [v1], digestStateOf(DIGEST, [v1])).index.plugins[0]!.approval).toBe('approved')
    const v2 = mkVerdict('p', '1.0.0', 'pass', BEFORE)            // sha-less verdict → nothing to compare
    expect(applyMatureVerdicts(mkIndex([e]), [v2], digestStateOf(DIGEST, [v2])).index.plugins[0]!.approval).toBe('approved')
  })
})

// ————— G5: legacy entries complete the approval upgrade —————
describe('G5: legacy + mature pass → approved', () => {
  const legacy = () => mkEntry('p', { approval: 'legacy' })
  it('announced pass + verified upgrades the badge', () => {
    const v = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')
    const r = applyMatureVerdicts(mkIndex([legacy()]), [v], digestStateOf(DIGEST, [v]))
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('unannounced pass keeps legacy (maturity gate still applies)', () => {
    const v = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')
    const r = applyMatureVerdicts(mkIndex([legacy()]), [v], null)
    expect(r.index.plugins[0]!.approval).toBe('legacy')
  })
  it('legacy + concern still brakes into pending (pre-existing behavior kept)', () => {
    const v = mkVerdict('p', '1.0.0', 'concern', BEFORE, 'human', 'bad')
    const r = applyMatureVerdicts(mkIndex([legacy()]), [v], null)
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.approvalReason).toBe('bad')
  })
  // D3 regression: the G5 cases above hand-build `announced` via digestStateOf,
  // which bypassed the announce layer entirely — heldSlotKeys only listed
  // 'pending' display slots, so a pass on a LEGACY entry's shown version could
  // never enter `announced` and the release branch above was unreachable in
  // production. End-to-end: the real nextDigestState must announce it.
  it('a pass on a legacy display slot is announce-able end-to-end', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'legacy' })])
    const v = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')
    const day1 = nextDigestState([v], null, new Date(DIGEST), idx)
    expect(day1.announced).toContain(akey(v))
    // still inside its own render — not yet mature (objection window holds)
    expect(day1.dayAnnounced).toContain(akey(v))
    const day2 = nextDigestState([v], day1, new Date('2026-02-02T21:00:00Z'), idx)
    expect(day2.dayAnnounced).not.toContain(akey(v))
    const r = applyMatureVerdicts(idx, [v], day2)
    expect(r.index.plugins[0]!.approval).toBe('approved')
  })
})

// ————— G6: stale approvalReason resets on a superseding pass —————
describe('G6: a newer pass clears the stale concern reason', () => {
  it('mature pass → approved, reason gone entirely', () => {
    const e = mkEntry('p', { approval: 'pending', approvalReason: 'malware reported' })
    const v = mkVerdict('p', '1.0.0', 'pass', AFTER, 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.index.plugins[0]!.approvalReason).toBeUndefined()
  })
  it('immature pass → reason resets to awaiting-review, not the stale concern', () => {
    const e = mkEntry('p', { approval: 'pending', approvalReason: 'malware reported' })
    const v = mkVerdict('p', '1.0.0', 'pass', AFTER, 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [v], null)   // not announced → not mature
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.approvalReason).toBe('awaiting-review')
  })
  it('latest concern still wins — no reset', () => {
    const e = mkEntry('p', { approval: 'pending', approvalReason: 'awaiting-review' })
    const v = mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'malware')
    const r = applyMatureVerdicts(mkIndex([e]), [v], null)
    expect(r.index.plugins[0]!.approvalReason).toBe('malware')
  })
})

// ————— G8: pkg@* package-level brake —————
describe('G8: version:null human concern brakes the whole package', () => {
  const brake = (at = BEFORE, reason = 'malicious package') => mkVerdict('p', null, 'concern', at, 'human', reason)
  it('brakes the displayed slot of an approved entry', () => {
    const r = applyMatureVerdicts(mkIndex([mkEntry('p')]), [brake()], null)
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.approvalReason).toBe('malicious package')
  })
  it('brakes BOTH slots — the display is pulled and the hold discarded with it', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const r = applyMatureVerdicts(mkIndex([e]), [brake()], null)
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.pendingUpdate).toBeUndefined()   // held slot's annotation collapses with the hold (B3)
    // the displayed slot is adjudicated first under a package brake — the
    // pull to pending makes the hold dead on arrival (R-9), so annotating
    // it would be bookkeeping on a shadow that no longer exists
    expect(r.held).toContain('p@1.0.0')
  })
  it('a mature ai pass cannot release under a package brake', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const vp = mkVerdict('p', '2.0.0', 'pass', AFTER, 'ai')
    const r = applyMatureVerdicts(mkIndex([e]), [brake(BEFORE), vp], digestStateOf(DIGEST, [vp]))
    expect(r.releases).toHaveLength(0)
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('a NEWER human pass on a slot un-brakes only that version — the brake lands first, the lift releases on re-entry', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0', { integrity: 'sha512-N' }) })
    const vp = mkVerdict('p', '2.0.0', 'pass', AFTER, 'human')           // after the brake
    const verdicts = [brake(BEFORE), vp]
    const digest = digestStateOf(DIGEST, [vp])
    // displayed slot judges first: the standing package brake pulls the
    // shown version to pending — the hold's lift is real but its slot dies
    // with the hold (R-9). The keyed pass survives…
    const r = applyMatureVerdicts(mkIndex([e]), verdicts, digest)
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.pendingUpdate).toBeUndefined()
    // …and lifts the SAME package brake when 2.0.0 re-enters as the pending
    // candidate (npm still latest=2.0.0 → fresh hold → verified → release)
    const reentered = mkEntry('p', {
      approval: 'pending', approvalReason: 'malicious package',
      latestVersion: '2.0.0', verification: { status: 'verified', level: 'load' },
    })
    const r2 = applyMatureVerdicts(mkIndex([reentered]), verdicts, digest)
    expect(r2.index.plugins[0]!.approval).toBe('approved')
    expect(r2.index.plugins[0]!.latestVersion).toBe('2.0.0')
  })
  it('an OLDER human pass on a slot does not lift the brake', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('2.0.0') })
    const vp = mkVerdict('p', '2.0.0', 'pass', BEFORE, 'human')          // before the brake at AFTER
    const r = applyMatureVerdicts(mkIndex([e]), [brake(AFTER), vp], digestStateOf(DIGEST, [vp]))
    expect(r.releases).toHaveLength(0)
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('a newer package-level pass dissolves the brake entirely', () => {
    const unbrake = mkVerdict('p', null, 'pass', AFTER, 'human', 'all clear')
    const r = applyMatureVerdicts(mkIndex([mkEntry('p', { approval: 'pending', approvalReason: 'malicious package' })]),
      [brake(BEFORE), unbrake], null)
    // brake dissolved → slot verdicts evaluate normally; no pass on 1.0.0 → stays pending but reason resets
    expect(r.index.plugins[0]!.approvalReason).toBe('awaiting-review')
  })
  it('github-kind entries keep working — the null key IS their slot', () => {
    const e = mkEntry('o/r', { latestVersion: null, approval: 'approved', source: { kind: 'github', id: 'o/r' } })
    const hc = mkVerdict('o/r', null, 'concern', BEFORE, 'human', 'bad repo')
    const r = applyMatureVerdicts(mkIndex([e]), [hc], null)
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.approvalReason).toBe('bad repo')
  })
})

// ————— G3: bootstrap windows the backlog announce —————
describe('G3: first digest announces only the recent window', () => {
  const now = new Date('2026-02-20T21:00:00Z')
  const old = mkVerdict('p', '1.0.0', 'pass', '2025-01-01T00:00:00Z')
  const young = mkVerdict('q', '2.0.0', 'pass', '2026-02-19T00:00:00Z')
  it('nextDigestState(prev=null) withholds verdicts older than the window', () => {
    const s = nextDigestState([old, young], null, now)
    expect(s.announced).toEqual([akey(young)])
  })
  it('the withheld backlog announces normally from the next digest', () => {
    const s1 = nextDigestState([old, young], null, now)
    const s2 = nextDigestState([old, young], s1, new Date('2026-02-21T21:00:00Z'))
    expect(s2.announced.sort()).toEqual([akey(old), akey(young)].sort())
  })
  it('a normal (non-bootstrap) render announces everything', () => {
    const prev = nextDigestState([], null, now)
    const s = nextDigestState([old, young], prev, new Date('2026-02-21T21:00:00Z'))
    expect(s.announced.sort()).toEqual([akey(old), akey(young)].sort())
  })
  it('renderDigest surfaces the withheld count in the header', () => {
    const md = renderDigest({ index: mkIndex([]), verdicts: [old, young], prev: null, now })
    expect(md).toContain('首次公告')
    expect(md).toContain('14 天')
    // and the young verdict still renders as today's announce
    expect(md).toContain('q')
    expect(md).not.toContain('| p | 1.0.0')
  })
})

// ————— G4: verdicts-compact —————
describe('G4: compaction drops only superseded old AI lines', () => {
  const NOW = Date.parse('2026-02-20T00:00:00Z')
  const line = (o: Partial<AiVerdict>) => JSON.stringify({ name: 'p', version: '1.0.0', verdict: 'pass', source: 'ai', at: '2025-01-01T00:00:00Z', ...o })
  it('drops old superseded AI lines, keeps latest-per-key + human + fresh + malformed', () => {
    const supersededOld = line({ at: '2025-01-01T00:00:00Z' })
    const supersededMid = line({ at: '2025-01-05T00:00:00Z', verdict: 'concern' })
    const human = line({ at: '2025-01-20T00:00:00Z', source: 'human', verdict: 'pass' })   // superseded too — but human ⇒ keep
    const latestOld = line({ at: '2025-02-01T00:00:00Z' })                                 // top for the key
    const freshSuperseded = line({ name: 'fresh', at: '2026-02-19T00:00:00Z' })
    const freshLatest = line({ name: 'fresh', at: '2026-02-19T01:00:00Z' })
    const malformed = '{"name":"p","version":"1.0.0","verdict":'
    const { lines, dropped } = compactLines(
      [supersededOld, supersededMid, human, latestOld, freshSuperseded, freshLatest, malformed],
      { days: 180, now: NOW })
    expect(dropped).toBe(2)                        // the two old superseded AI lines
    expect(lines).toContain(latestOld)             // latest for key — even though old
    expect(lines).toContain(human)                 // human audit trail untouched even when superseded
    expect(lines).toContain(freshSuperseded)       // inside the window — kept regardless of domination
    expect(lines).toContain(freshLatest)
    expect(lines).toContain(malformed)             // never delete what we can't parse
  })
  it('latestVerdicts/latestHumanVerdicts reconstruct identically after compaction', async () => {
    const { latestVerdicts, latestHumanVerdicts, loadVerdicts } = await import('../pipeline/verdicts.ts')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const raw = [
      line({ at: '2025-01-01T00:00:00Z' }), line({ at: '2025-02-01T00:00:00Z' }),
      line({ at: '2025-02-10T00:00:00Z', source: 'human', verdict: 'concern' }),
      line({ name: 'q', at: '2026-02-19T00:00:00Z' }),
    ]
    const dir = mkdtempSync(join(tmpdir(), 'vc-'))
    const f = join(dir, 'v.jsonl')
    writeFileSync(f, raw.join('\n') + '\n')
    const { lines } = compactLines(raw, { days: 180, now: NOW })
    writeFileSync(f, lines.join('\n') + '\n')
    const after = loadVerdicts(f)
    const before = raw.map(l => JSON.parse(l) as AiVerdict)
    // same keys, same winners (at is the verdict identity)
    expect([...latestVerdicts(after).values()].map(v => akey(v)).sort())
      .toEqual([...latestVerdicts(before).values()].map(v => akey(v)).sort())
    expect([...latestHumanVerdicts(after).values()].map(v => akey(v)).sort())
      .toEqual([...latestHumanVerdicts(before).values()].map(v => akey(v)).sort())
  })
})

// ————— G9: verify-merge flagged slots land 'skipped', not 'verified' —————
describe('G9: mergeResults honors the honest-label invariant', () => {
  const res = (name: string, version: string, status: 'verified' | 'failed' = 'verified'): VerifyResult => ({
    name, version, status, level: 'load', opencodeVersion: '2.2.5', verifiedAt: 't',
  })
  const flagged = () => mkEntry('p', {
    verification: { status: 'unverified' },
    capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:integrity-drift'] },
  })
  it('displayed slot flagged → verified result becomes skipped', () => {
    const r = mergeResults(mkIndex([flagged()]), [res('p', '1.0.0')])
    expect(r.plugins[0]!.verification.status).toBe('skipped')
  })
  it('held slot flagged → pu result becomes skipped', () => {
    const e = { ...flagged(), pendingUpdate: mkPu('2.0.0', {
      verification: { status: 'unverified' },
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:repo-recreated'] },
    }) }
    const r = mergeResults(mkIndex([e]), [res('p', '2.0.0')])
    expect(r.plugins[0]!.pendingUpdate!.verification.status).toBe('skipped')
    // the displayed slot's own unverified state is untouched by the held write
    expect(r.plugins[0]!.verification.status).toBe('unverified')
  })
  it('failed keeps its real outcome even on a flagged slot', () => {
    const r = mergeResults(mkIndex([flagged()]), [res('p', '1.0.0', 'failed')])
    expect(r.plugins[0]!.verification.status).toBe('failed')
  })
  it('unflagged slot still lands verified', () => {
    const r = mergeResults(mkIndex([mkEntry('p', { verification: { status: 'unverified' } })]), [res('p', '1.0.0')])
    expect(r.plugins[0]!.verification.status).toBe('verified')
  })
})

// ————— explainEntry mirrors the new gates —————
describe('explainEntry: package brake and sha-mismatch are explained, not hidden', () => {
  it('package brake shows up as the slot verdict with the prefix', () => {
    const e = mkEntry('p')
    const brake = mkVerdict('p', null, 'concern', BEFORE, 'human', 'bad pkg')
    const [s] = explainEntry(e, [brake], null)
    expect(s).toMatchObject({ outcome: 'brake', verdict: 'concern' })
    expect(s!.why).toContain('包级刹车')
  })
  it('sha mismatch reports the pin disagreement', () => {
    const e = mkEntry('p', { approval: 'pending', integrity: 'sha512-OLD' })
    const v = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai', undefined, 'sha512-NEW')
    const [s] = explainEntry(e, [v], digestStateOf(DIGEST, [v]))
    expect(s!.outcome).toBe('wait')
    expect(s!.why).toContain('integrity')
  })
})

// ————— pkg@* resolution —————
describe('pkg@* resolves to the package-scope sentinel', () => {
  const ev = (over: object = {}) => ({
    event: 'issue_comment', action: 'created', issueTitle: 'some issue', issueBody: '',
    commentBody: '/concern pkg@* malware', label: '', issueNumber: 1, actor: 'a', ...over,
  })
  it('comment arg preserves *', () => {
    expect(resolveVerdictEvent(ev())).toMatchObject({ name: 'pkg', ver: '*', verdict: 'concern' })
  })
  it('comment arg preserves * on a pass too', () => {
    expect(resolveVerdictEvent(ev({ commentBody: '/approve pkg@* all clear' }))).toMatchObject({ name: 'pkg', ver: '*', verdict: 'pass' })
  })
  it('version field * in the concern form survives', () => {
    const r = resolveVerdictEvent({
      event: 'issues', action: 'opened', issueTitle: '[concern] x', actor: 'a', issueNumber: 1, label: '',
      commentBody: '',
      issueBody: '### npm 包名或 owner/repo\n\npkg\n\n### 版本（可留空）\n\n*\n\n### 操作 / Action\n\n拦截 (concern)\n\n### 理由 / Reason\n\nbad',
    })
    expect(r).toMatchObject({ name: 'pkg', ver: '*' })
  })
  it('blank version still resolves empty (unchanged old behavior)', () => {
    expect(resolveVerdictEvent(ev({ commentBody: '/concern pkg bad' })).ver).toBe('')
  })
})

// ————— L-2: held-slot reason mirror of the displayed slot's G6 reset —————
describe('L-2: pu.reason normalizes when its governing concern is superseded', () => {
  it('a newer (still-immature) pass resets a stale concern reason on the held slot', () => {
    const v = [
      mkVerdict('p', '2.0.0', 'concern', '2026-01-30T10:00:00Z', 'human', 'flagged'),
      mkVerdict('p', '2.0.0', 'pass', '2026-02-01T10:00:00Z', 'human'),
    ]
    // announced TODAY → still inside the objection window → not mature, the
    // hold stays — but its reason must not keep claiming the dead concern
    const r = applyMatureVerdicts(
      mkIndex([mkEntry('p', { pendingUpdate: mkPu('2.0.0', { reason: 'flagged' }) })]),
      v, digestStateOf(DIGEST, v, v.map(akey)))
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.reason).toBe('awaiting-review')
  })
  it('a still-governing concern keeps annotating (no reset)', () => {
    const v = [mkVerdict('p', '2.0.0', 'concern', '2026-02-01T10:00:00Z', 'human', 'still bad')]
    const r = applyMatureVerdicts(
      mkIndex([mkEntry('p', { pendingUpdate: mkPu('2.0.0') })]), v, digestStateOf(DIGEST, v))
    expect(r.index.plugins[0]!.pendingUpdate?.reason).toBe('still bad')
    expect(r.held).toEqual(['p@2.0.0'])
  })
  it('idempotent: a second apply leaves the normalized reason alone', () => {
    const v = [mkVerdict('p', '2.0.0', 'pass', '2026-02-01T10:00:00Z', 'human')]
    const once = applyMatureVerdicts(
      mkIndex([mkEntry('p', { pendingUpdate: mkPu('2.0.0', { reason: 'flagged' }) })]),
      v, digestStateOf(DIGEST, v, v.map(akey)))
    const twice = applyMatureVerdicts(once.index, v, digestStateOf(DIGEST, v, v.map(akey)))
    expect(twice.index.plugins[0]).toEqual(once.index.plugins[0])
  })
})

// ————— L-3: tombstone epoch — a pass predating disappearance judged a different object —————
describe('L-3: pass predating disappearance does not govern a re-entered entry', () => {
  const tomb = (disappearedAt: string, name = 'p') =>
    ({ slug: name.toLowerCase(), name, disappearedAt, reason: 'npm-404' as const })
  const pendingEntry = () => mkEntry('p', { approval: 'pending', approvalReason: 'awaiting-review' })
  const OLD_PASS = mkVerdict('p', '1.0.0', 'pass', '2026-01-20T10:00:00Z', 'human')

  it('stale pass (pre-tombstone) does not release a pending re-entry', () => {
    const idx = { ...mkIndex([pendingEntry()]), removed: [tomb('2026-02-01T00:00:00Z')] }
    const r = applyMatureVerdicts(idx, [OLD_PASS], digestStateOf(DIGEST, [OLD_PASS]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('a fresh pass (post-tombstone) still releases — the epoch is not a freeze', () => {
    const v = mkVerdict('p', '1.0.0', 'pass', '2026-02-02T10:00:00Z', 'human')
    const idx = { ...mkIndex([pendingEntry()]), removed: [tomb('2026-02-01T00:00:00Z')] }
    const r = applyMatureVerdicts(idx, [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('a stale CONCERN still brakes — a recycled name inherits distrust', () => {
    const c = mkVerdict('p', '1.0.0', 'concern', '2026-01-20T10:00:00Z', 'human', 'was bad')
    const idx = { ...mkIndex([pendingEntry()]), removed: [tomb('2026-02-01T00:00:00Z')] }
    const r = applyMatureVerdicts(idx, [c], digestStateOf(DIGEST, [c]))
    expect(r.index.plugins[0]!.approvalReason).toBe('was bad')
    expect(r.held).toEqual(['p@1.0.0'])
  })
  it('no tombstone → the same pass still works (no regression on live entries)', () => {
    const idx = mkIndex([pendingEntry()])
    const r = applyMatureVerdicts(idx, [OLD_PASS], digestStateOf(DIGEST, [OLD_PASS]))
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('stale pass on a HELD slot does not release it either', () => {
    const v = mkVerdict('p', '2.0.0', 'pass', '2026-01-20T10:00:00Z', 'human')
    const idx = {
      ...mkIndex([mkEntry('p', { pendingUpdate: mkPu('2.0.0') })]),
      removed: [tomb('2026-02-01T00:00:00Z')],
    }
    const r = applyMatureVerdicts(idx, [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.pendingUpdate?.version).toBe('2.0.0')
  })
  it('tombstone name match is case-insensitive (recycled repo names)', () => {
    const v = mkVerdict('Owner/Repo', null, 'pass', '2026-01-20T10:00:00Z', 'human')
    const idx = {
      ...mkIndex([mkEntry('Owner/Repo', {
        source: { kind: 'github', id: 'x', version: 'abc' }, latestVersion: null, approval: 'pending',
      })]),
      removed: [tomb('2026-02-01T00:00:00Z', 'owner/repo')],
    }
    const r = applyMatureVerdicts(idx, [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual([])
  })
  it('explainEntry reports the epoch, not a misleading gate', () => {
    const s = explainEntry(
      mkEntry('p', { approval: 'pending' }), [OLD_PASS], digestStateOf(DIGEST, [OLD_PASS]),
      [tomb('2026-02-01T00:00:00Z')])
    expect(s[0]!.outcome).toBe('wait')
    expect(s[0]!.why).toContain('上一个同名对象')
  })
})
