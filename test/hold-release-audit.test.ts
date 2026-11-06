/** Release-flow audit batch (2026-11): the shared slot-governing predicate
 *  (slotVerdict/packageBrake), the legacy-integrity release fix, the versioned
 *  unreviewed backlog aggregate + declared-pause surface, and the digest's
 *  package-brake phase mirror.
 *  R-A: released legacy hold keeps integrity:null (never the displayed SRI);
 *  R-B: slotVerdict = ONE governing-verdict semantic for release/pin/digest/
 *       docket (human-stickiness + package brake + brake-lift);
 *  R-C: versioned 'none' targets aggregate when the queue is big OR diagnose
 *       is declared paused — no per-entry issue flood during an AI stoppage;
 *  R-D: digest §② mirrors the package brake phase; §⑤ marks a declared pause. */
import { describe, it, expect } from 'vitest'
import { applyMatureVerdicts, digestStateOf, slotVerdict, packageBrake,
  latestVerdicts, latestHumanVerdicts } from '../pipeline/verdicts.ts'
import { docketTargets, issueBody, issueTitle,
  NONE_BACKLOG, NONE_ISSUE_CAP } from '../pipeline/docket.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: '2026-01-01T00:00:00Z', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const mkPu = (version: string, over: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) => ({
  version,
  capabilities: { scannedAt: '2026-01-10T00:00:00Z', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  heldAt: '2026-01-10T00:00:00Z',
  ...over,
})
const mkVerdict = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai'): AiVerdict => ({ name, version, verdict, at, source })
const T1 = '2026-01-02T00:00:00Z'
const T2 = '2026-01-03T00:00:00Z'
const T3 = '2026-01-04T00:00:00Z'

// ————— R-A: legacy hold release never inherits the displayed SRI —————
describe('R-A: released legacy hold keeps integrity null', () => {
  it('pendingUpdate without integrity → released integrity is null, NOT the old version\'s SRI', () => {
    // the whole 2026-11 production hold population: pendingUpdate predates the
    // integrity field. Releasing it must not stamp v_new with v_old's hash —
    // that SRI would (a) fail closed at install for every client, (b) freeze
    // a WRONG anchor and raise a bogus sec:integrity-drift flag forever
    const e = mkEntry('p', {
      integrity: 'sha512-OLDVERSION',
      pendingUpdate: mkPu('1.1.0'),   // no integrity — the legacy shape
    })
    const v = mkVerdict('p', '1.1.0', 'pass', T1)
    const [out] = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf('2026-02-01T00:00:00Z', [v])).index.plugins
    expect(out!.latestVersion).toBe('1.1.0')
    expect(out!.approval).toBe('approved')
    expect(out!.integrity).toBeNull()
    // null (honest "unknown") lets the next refreshMeta anchor the REAL
    // tarball SRI via anchorIntegrity — self-healing instead of a frozen lie
  })
  it('pendingUpdate WITH integrity still promotes it', () => {
    const e = mkEntry('p', { integrity: 'sha512-OLD', pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-NEW' }) })
    const v = mkVerdict('p', '1.1.0', 'pass', T1)
    const [out] = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf('2026-02-01T00:00:00Z', [v])).index.plugins
    expect(out!.integrity).toBe('sha512-NEW')
  })
})

// ————— R-B: one governing-verdict semantic for every held-slot surface —————
describe('R-B: slotVerdict governs uniformly (release / pin / digest / docket)', () => {
  const maps = (vs: AiVerdict[]) => ({ latest: latestVerdicts(vs), human: latestHumanVerdicts(vs) })
  it('human concern stays sticky over a LATER ai pass on the same slot (R-4)', () => {
    // the pin-terminal regression: run.ts' held-pin check must see 'concern'
    // here, not the raw-latest 'pass' — else a braked version pins forever
    const { latest, human } = maps([
      mkVerdict('p', '1.1.0', 'concern', T1, 'human'),
      mkVerdict('p', '1.1.0', 'pass', T2, 'ai'),
    ])
    expect(slotVerdict(latest, human, 'p', '1.1.0')!.verdict).toBe('concern')
  })
  it('a later HUMAN pass does lift the earlier human concern', () => {
    const { latest, human } = maps([
      mkVerdict('p', '1.1.0', 'concern', T1, 'human'),
      mkVerdict('p', '1.1.0', 'pass', T3, 'human'),
    ])
    expect(slotVerdict(latest, human, 'p', '1.1.0')!.verdict).toBe('pass')
  })
  it('package brake (name@null concern) governs every versioned slot', () => {
    const { latest, human } = maps([
      mkVerdict('p', null, 'concern', T1, 'human'),
      mkVerdict('p', '1.1.0', 'pass', T2, 'ai'),
      mkVerdict('p', '1.2.0', 'pass', T2, 'ai'),
    ])
    expect(slotVerdict(latest, human, 'p', '1.1.0')!.verdict).toBe('concern')
    expect(slotVerdict(latest, human, 'p', '1.2.0')!.verdict).toBe('concern')
  })
  it('a NEWER human pass on the exact slot lifts the package brake', () => {
    const { latest, human } = maps([
      mkVerdict('p', null, 'concern', T1, 'human'),
      mkVerdict('p', '1.1.0', 'pass', T3, 'human'),
    ])
    expect(slotVerdict(latest, human, 'p', '1.1.0')!.verdict).toBe('pass')
    expect(slotVerdict(latest, human, 'p', '1.2.0')!.verdict).toBe('concern') // other slots stay braked
  })
  it('version=null is the github-kind slot\'s OWN verdict — never a package brake', () => {
    const { latest, human } = maps([mkVerdict('p', null, 'concern', T1, 'human')])
    const r = slotVerdict(latest, human, 'p', null)
    expect(r!.verdict).toBe('concern')
    expect(r!.version).toBeNull()
    // and a null-key human PASS is just a slot verdict — packageBrake ignores it
    const { human: h2 } = maps([mkVerdict('p', null, 'pass', T1, 'human')])
    expect(packageBrake(h2, 'p')).toBeUndefined()
  })
  it('ai pass followed by ai concern (re-flag) governs as concern', () => {
    const { latest, human } = maps([
      mkVerdict('p', '1.1.0', 'pass', T1),
      mkVerdict('p', '1.1.0', 'concern', T2),
    ])
    expect(slotVerdict(latest, human, 'p', '1.1.0')!.verdict).toBe('concern')
  })
  it('no verdict at all → undefined (caller treats as unreviewed)', () => {
    const { latest, human } = maps([])
    expect(slotVerdict(latest, human, 'p', '1.1.0')).toBeUndefined()
  })
})

// ————— R-C: versioned unreviewed targets aggregate —————
describe('R-C: versioned none-targets aggregate instead of flooding issues', () => {
  const OLD = '2020-06-01T00:00:00Z'
  const NOW = '2026-01-05T00:00:00Z'
  const aged = (n: string) => mkEntry(n, {
    approval: 'pending',
    capabilities: { scannedAt: OLD, rulesetVersion: 'r', findings: [], redFlags: [] },
  })
  it('at-or-below cap → individual none targets unchanged', () => {
    const es = Array.from({ length: NONE_ISSUE_CAP }, (_, i) => aged(`p${i}`))
    const t = docketTargets(mkIndex(es), [], null, { now: NOW })
    expect(t).toHaveLength(NONE_ISSUE_CAP)
    expect(t.every(x => x.verdict === 'none' && !x.backlog)).toBe(true)
  })
  it('over cap → ONE aggregate standing issue, no individual none issues', () => {
    const es = Array.from({ length: NONE_ISSUE_CAP + 5 }, (_, i) => aged(`p${i}`))
    const t = docketTargets(mkIndex(es), [], null, { now: NOW })
    expect(t).toEqual([{
      name: NONE_BACKLOG, version: null, verdict: 'none',
      backlog: es.map(e => ({ name: e.name, version: e.latestVersion, heldAt: OLD, verification: 'verified' })),
    }])
  })
  it('declared pause aggregates even a small queue — intentional, so say so in one place', () => {
    const t = docketTargets(mkIndex([aged('p1'), aged('p2')]), [], null, { now: NOW, paused: true })
    expect(t).toHaveLength(1)
    expect(t[0]!.name).toBe(NONE_BACKLOG)
    expect(t[0]!.backlog).toHaveLength(2)
  })
  it('young (not-yet-aged) candidates stay AI-owned — only aged ones fold in', () => {
    const young = mkEntry('young', {
      approval: 'pending',
      capabilities: { scannedAt: '2026-01-04T20:00:00Z', rulesetVersion: 'r', findings: [], redFlags: [] },
    })
    const es = [...Array.from({ length: NONE_ISSUE_CAP + 1 }, (_, i) => aged(`p${i}`)), young]
    const t = docketTargets(mkIndex(es), [], null, { now: NOW })
    expect(t).toHaveLength(1)
    expect(t[0]!.backlog!.map(b => b.name)).not.toContain('young')
  })
  it('verdicted targets still get their own issues alongside the aggregate', () => {
    const es = [...Array.from({ length: NONE_ISSUE_CAP + 1 }, (_, i) => aged(`p${i}`)), mkEntry('judged', { approval: 'pending' })]
    const t = docketTargets(mkIndex(es), [mkVerdict('judged', '1.0.0', 'concern', T1)], null, { now: NOW })
    expect(t).toHaveLength(2)
    expect(t.find(x => x.name === NONE_BACKLOG)).toBeTruthy()
    expect(t.find(x => x.name === 'judged')!.verdict).toBe('concern')
  })
  it('issueBody renders the aggregate\'s bounded member list + per-target command hint', () => {
    const es = Array.from({ length: NONE_ISSUE_CAP + 3 }, (_, i) => aged(`p${i}`))
    const [t] = docketTargets(mkIndex(es), [], null, { now: NOW })
    const body = issueBody(t!, { repo: 'o/r' })
    expect(issueTitle(t!)).toBe('[review] (unreviewed backlog)')
    expect(body).toContain('未评审积压总单')
    expect(body).toContain('`p0@1.0.0`')
    expect(body).toContain('/approve 包名@版本')
    expect(body).toContain('自动关闭')
  })
  it('paused body names the marker file and says the queue is intentionally paused', () => {
    const [t] = docketTargets(mkIndex([aged('p1')]), [], null, { now: NOW, paused: true })
    const body = issueBody(t!, { repo: 'o/r', paused: true })
    expect(body).toContain('diagnose.paused')
    expect(body).toContain('声明暂停')
    expect(body).toContain('resume')
  })
})

// ————— R-D: digest mirrors the brake phase + the declared pause —————
describe('R-D: digest surfaces the package brake and declared pause', () => {
  const NOW = new Date('2026-02-01T21:00:00Z')
  it('§② held entry under a package brake reads 包级刹车, not a misleading verify phase', () => {
    const e = mkEntry('p', {
      approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }),
    })
    const md = renderDigest({
      index: mkIndex([e]),
      verdicts: [mkVerdict('p', null, 'concern', T1, 'human')],
      prev: null, now: NOW,
    })
    expect(md).toContain('包级刹车·需人工解除')
  })
  it('a NEWER human pass on the held slot lifts the brake phase back to the slot\'s own', () => {
    const e = mkEntry('p', {
      approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }),
    })
    const md = renderDigest({
      index: mkIndex([e]),
      verdicts: [
        mkVerdict('p', null, 'concern', T1, 'human'),
        mkVerdict('p', '1.1.0', 'pass', T3, 'human'),
      ],
      prev: null, now: NOW,
    })
    expect(md).not.toContain('包级刹车')
  })
  it('§⑤ marks a declared pause instead of reading like an undiagnosed stall', () => {
    const md = renderDigest({
      index: mkIndex([mkEntry('p', { approval: 'pending' })]),
      verdicts: [], prev: null, now: NOW, paused: true,
    })
    expect(md).toContain('diagnose.paused')
    expect(md).toContain('暂停')
    const md2 = renderDigest({
      index: mkIndex([mkEntry('p', { approval: 'pending' })]),
      verdicts: [], prev: null, now: NOW,
    })
    expect(md2).not.toContain('diagnose.paused')
  })
})
