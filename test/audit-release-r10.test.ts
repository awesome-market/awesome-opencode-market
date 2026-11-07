/** audit #7 (放行流 §7) round-10 fresh pass — two findings:
 *
 *  1. explainEntry reported the pendingUpdate slot's RAW decision chain even
 *     when the displayed slot's concern had already braked the entry:
 *     applyMatureVerdicts adjudicates the displayed slot FIRST — the brake
 *     pulls approval back to pending and the R-9 source invariant drops the
 *     hold before the held slot's verdicts are ever consulted, so the gate
 *     can never produce that slot's 'release' (or 'concern → 保持 hold').
 *     The explainer now evaluates the displayed slot first and marks a
 *     preempted hold 'wait' with the preemption reason; the slot's own chain
 *     stays appended for context. Covers both brake shapes: a slot-keyed
 *     concern and a package-level (name@null) human brake.
 *
 *  2. release.ts had no argv guard — a bare run died inside
 *     readFileSync(undefined) with a bare TypeError, and a flag-swallowed
 *     positional (dangling --name) silently degraded to "no verdicts",
 *     writing a normalized-but-wrong index. Now exits 2 with usage like
 *     every sibling CLI. */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { applyMatureVerdicts, explainEntry, digestStateOf } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'approved', approvalReason: undefined,
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const mkPu = (version: string, over: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) => ({
  version,
  capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  integrity: 'sha512-N', heldAt: 'h',
  ...over,
})
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'human', reason?: string): AiVerdict => ({
  name, version, verdict, at, source, ...(reason ? { reason } : {}),
})
const DIGEST = '2026-02-01T21:00:00Z'

describe('§7 explainEntry — a displayed-slot brake preempts the hold slot', () => {
  const held = () => mkEntry('p', { latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0') })
  const maturePuPass = () => v('p', '2.0.0', 'pass', '2026-02-01T10:00:00Z', 'ai')

  it('slot-keyed concern on the display + mature pass on the hold → pu reports wait, not release', () => {
    const e = held()
    const brake = v('p', '1.0.0', 'concern', '2026-02-02T00:00:00Z', 'human', 'bad actor')
    const pass = maturePuPass()
    const digest = digestStateOf(DIGEST, [pass])
    // the gate itself: brake lands, hold dropped, NOTHING releases
    const r = applyMatureVerdicts(mkIndex([e]), [brake, pass], digest)
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.pendingUpdate).toBeUndefined()
    // the explainer must tell the same story — before the fix it reported
    // `[pendingUpdate] 2.0.0 → release — pass 成熟 + 可放行 → 生效`
    const slots = explainEntry(e, [brake, pass], digest, [])
    const pu = slots.find(s => s.slot === 'pendingUpdate')!
    const disp = slots.find(s => s.slot === 'displayed')!
    expect(pu.outcome).toBe('wait')
    expect(pu.why).toContain('R-9')
    expect(pu.why).toContain('丢弃')
    // the slot's own chain stays appended — the pass WAS mature and green
    expect(pu.why).toContain('pass 成熟')
    expect(disp.outcome).toBe('brake')
  })

  it('package-level brake (name@null human concern) preempts the hold the same way', () => {
    const e = held()
    const pkgBrake = v('p', null, 'concern', '2026-02-02T00:00:00Z', 'human', 'malicious package')
    const pass = maturePuPass()
    const digest = digestStateOf(DIGEST, [pass])
    const r = applyMatureVerdicts(mkIndex([e]), [pkgBrake, pass], digest)
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.pendingUpdate).toBeUndefined()
    const pu = explainEntry(e, [pkgBrake, pass], digest, []).find(s => s.slot === 'pendingUpdate')!
    expect(pu.outcome).toBe('wait')
    expect(pu.why).toContain('R-9')
  })

  it('legacy entry + displayed concern → hold preempted identically (legacy→pending is a brake)', () => {
    const e = mkEntry('p', { approval: 'legacy', latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0') })
    const brake = v('p', '1.0.0', 'concern', '2026-02-02T00:00:00Z', 'human', 'found malicious')
    const pass = maturePuPass()
    const digest = digestStateOf(DIGEST, [pass])
    const pu = explainEntry(e, [brake, pass], digest, []).find(s => s.slot === 'pendingUpdate')!
    expect(pu.outcome).toBe('wait')
    expect(pu.why).toContain('R-9')
  })

  it('no displayed brake → the hold slot still reports its own release chain', () => {
    const e = held()
    const pass = maturePuPass()
    const digest = digestStateOf(DIGEST, [pass])
    const pu = explainEntry(e, [pass], digest, []).find(s => s.slot === 'pendingUpdate')!
    expect(pu.outcome).toBe('release')
    expect(pu.why).toContain('生效')
  })

  it('displayed wait (immature pass on legacy display) does NOT preempt — hold adjudicates normally', () => {
    // legacy keeps the displayed slot "under review" (a pass there must
    // still mature), so an unannounced pass reports 'wait' — and since the
    // entry does NOT brake, the hold's own chain stands untouched
    const e = mkEntry('p', { approval: 'legacy', latestVersion: '1.0.0', pendingUpdate: mkPu('2.0.0') })
    const dispPass = v('p', '1.0.0', 'pass', '2026-02-02T00:00:00Z', 'ai')   // unannounced → wait
    const holdPass = v('p', '2.0.0', 'pass', '2026-02-01T10:00:00Z', 'ai')
    const digest = digestStateOf(DIGEST, [holdPass])
    const slots = explainEntry(e, [dispPass, holdPass], digest, [])
    const pu = slots.find(s => s.slot === 'pendingUpdate')!
    const disp = slots.find(s => s.slot === 'displayed')!
    expect(disp.outcome).toBe('wait')
    expect(pu.outcome).toBe('release')   // not preempted — hold adjudicates
    // and the gate agrees: the hold promotes, the display pass stays immature
    const r = applyMatureVerdicts(mkIndex([e]), [dispPass, holdPass], digest)
    expect(r.releases).toEqual(['p@2.0.0'])
    expect(r.index.plugins[0]!.latestVersion).toBe('2.0.0')
  })
})

describe('release.ts CLI — argv guard like every sibling CLI', () => {
  const run = (args: string[]) => {
    try {
      execFileSync('npx', ['tsx', 'pipeline/release.ts', ...args],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, err: '' }
    } catch (e: any) {
      return { code: e.status ?? -1, err: String(e.stderr ?? '') }
    }
  }

  it('bare invocation → exit 2 + usage, no TypeError stack', () => {
    const r = run([])
    expect(r.code).toBe(2)
    expect(r.err).toContain('usage:')
    expect(r.err).not.toContain('TypeError')
  })

  it('index-only invocation → exit 2 (verdicts arg is required, not silently empty)', () => {
    const r = run(['/dev/null'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('usage:')
  })

  it('dangling --name must not swallow the verdicts positional into "no verdicts"', () => {
    // `release.ts index.json --name` leaves args=[index.json] — the guard
    // refuses instead of running applyMatureVerdicts with an empty verdict set
    const r = run(['/dev/null', '--name'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('usage:')
  })
})
