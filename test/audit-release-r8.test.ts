/** audit #7 (放行流 §7) fresh pass — regressions:
 *  1. applyMatureVerdicts evaluated the hold slot BEFORE the displayed slot —
 *     a mature pass on pu@2.0.0 promoted latestVersion first, so the
 *     displayed-slot verdictFor then queried the NEW version's key and a
 *     same-batch concern on the OLD displayed version was never adjudicated
 *     (the brake landed nowhere — spec "concern 立即生效" violated). The
 *     displayed slot now judges first: braking drops the hold via R-9 while
 *     the hold's verdict stays keyed for re-entry.
 *  2. R-9 only checked OUTPUT approval — a pending+pu (B3 inverted) entry
 *     released to approved kept its stale shadow as a legitimate hold
 *     forever. wasPending snapshot + union drop: input-pending shadows die
 *     regardless of what the release did to approval.
 *  3. explainEntry's `braking` excluded 'legacy' — applyMatureVerdicts pulls
 *     legacy→pending on a displayed concern, which IS a brake; the explainer
 *     reported "保持 hold" for a real demotion.
 *  4. release.ts --name value was filtered by string equality — a positional
 *     path equal to the package name got eaten (and nameAt=-1 offset 0
 *     would have eaten argv[0]); now positional filtering by index. */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMatureVerdicts, explainEntry, digestStateOf } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

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
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'human', reason?: string): AiVerdict => ({
  name, version, verdict, at, source, ...(reason ? { reason } : {}),
})

describe('§7: displayed slot judges before the hold (conservative direction)', () => {
  it('concern on displayed + mature pass on hold, same batch → brake lands, hold dropped, no release', () => {
    const e = mkEntry('p', {
      approval: 'approved', approvalReason: undefined,
      latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0'),
    })
    const concern = v('p', '1.0.0', 'concern', '2026-02-01T10:00:00Z', 'human', 'bad actor')
    const pass = v('p', '2.0.0', 'pass', '2026-02-01T09:00:00Z', 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [pass, concern], digestStateOf('2026-02-01T20:00:00Z', [pass]))
    const out = r.index.plugins[0]!
    // the v1 concern MUST take effect — pending + reason, pu dropped.
    // Before the reorder, the v2 pass released first and the concern on the
    // replaced version was never evaluated.
    expect(out.approval).toBe('pending')
    expect(out.approvalReason).toBe('bad actor')
    expect(out.latestVersion).toBe('1.0.0')
    expect(out.pendingUpdate).toBeUndefined()
    expect(r.releases).toEqual([])
    expect(r.held).toContain('p@1.0.0')
  })

  it('mature pass on the hold still releases normally when the displayed slot has no verdict', () => {
    const e = mkEntry('p', {
      approval: 'approved', approvalReason: undefined,
      latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0'),
    })
    const pass = v('p', '2.0.0', 'pass', '2026-02-01T09:00:00Z', 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [pass], digestStateOf('2026-02-01T20:00:00Z', [pass]))
    const out = r.index.plugins[0]!
    expect(r.releases).toEqual(['p@2.0.0'])
    expect(out.latestVersion).toBe('2.0.0')
    expect(out.approval).toBe('approved')
    expect(out.pendingUpdate).toBeUndefined()
  })
})

describe('§7: R-9 union — input-pending shadows die even across a release', () => {
  it('pending+pu (B3) released by a mature pass → approved WITHOUT the stale hold', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('0.9.0') })
    const pass = v('p', '1.0.0', 'pass', '2026-02-01T09:00:00Z', 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [pass], digestStateOf('2026-02-01T20:00:00Z', [pass]))
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('approved')
    // wasPending snapshot: output approval reads 'approved', but the shadow
    // still must not launder into a legitimate hold on the new release
    expect(out.pendingUpdate).toBeUndefined()
  })

  it('pending+pu (B3) with a displayed-version concern → stays pending AND drops the shadow', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('0.9.0') })
    const concern = v('p', '1.0.0', 'concern', '2026-02-01T10:00:00Z', 'human', 'still bad')
    const r = applyMatureVerdicts(mkIndex([e]), [concern], null)
    const out = r.index.plugins[0]!
    expect(out.approval).toBe('pending')
    expect(out.approvalReason).toBe('still bad')
    expect(out.pendingUpdate).toBeUndefined()
  })

  it('pending+pu (B3) with a mature pass on the STALE HOLD itself → shadow never adjudicates', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('0.9.0') })
    const pass = v('p', '0.9.0', 'pass', '2026-02-01T09:00:00Z', 'human')
    const r = applyMatureVerdicts(mkIndex([e]), [pass], digestStateOf('2026-02-01T20:00:00Z', [pass]))
    const out = r.index.plugins[0]!
    // the stale 0.9.0 hold describes bytes nobody is reviewing — it must not
    // release (candidate is 1.0.0) and must not survive as a live hold
    expect(out.latestVersion).toBe('1.0.0')
    expect(out.pendingUpdate).toBeUndefined()
    expect(r.releases).toEqual([])
  })
})

describe('§7: explainEntry mirrors apply — legacy concern IS a brake', () => {
  it('legacy entry + displayed-slot concern → outcome brake (was concern/"保持 hold")', () => {
    const e = mkEntry('p', { approval: 'legacy' })
    const concern = v('p', '1.0.0', 'concern', '2026-02-01T10:00:00Z', 'human', 'found malicious')
    const [s] = explainEntry(e, [concern], null, [])
    expect(s!.outcome).toBe('brake')
    expect(s!.why).toContain('回 pending')
  })
})

describe('release.ts CLI — --name value filtering is positional', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'))
  const index = mkIndex([mkEntry('p')])
  const idxPath = join(dir, 'pkg')
  const vPath = join(dir, 'v.jsonl')
  const dPath = join(dir, 'd.json')
  writeFileSync(idxPath, JSON.stringify(index))
  writeFileSync(vPath, '')
  writeFileSync(dPath, JSON.stringify({ lastDigestAt: 't', announced: [], day: 'x', dayAnnounced: [] }))
  const run = (extra: string[]) => execFileSync('npx',
    ['tsx', 'pipeline/release.ts', idxPath, vPath, dPath, ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  it('--name value equal to a positional basename does not eat the index arg', () => {
    // idxPath basename 'pkg' — '--name pkg' must filter ONLY the value slot
    const out = run(['--explain', '--name', 'pkg'])
    expect(JSON.parse(out).plugins[0].name).toBe('p')
  })
  it('no --name at all → index arg intact (nameAt=-1 offset must not eat argv[0])', () => {
    const out = run(['--explain'])
    expect(JSON.parse(out).plugins[0].name).toBe('p')
  })
})
