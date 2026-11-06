/** Stage-2 verify tests: version pinning, per-version merge routing, plan
 *  targets, L2 pane judge, L3a gui harness. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage, coerceTarget, type ExecFn, type SpawnFn } from '../pipeline/verify/verify.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { planTargets, verifyTargetOf, verifyPartsOf, verifyQueued, hostStaleVerify, shard } from '../pipeline/verify/plan.ts'
import { VerifyResultFile } from '../pipeline/verify/merge.ts'
import { judgeTuiPane } from '../pipeline/verify/tui.ts'
import { checkGuiBundle, findGuiBundle } from '../pipeline/verify/gui.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { OPENCODE_VERSION } from '../pipeline/publish/merge.ts'
import { vkey } from '../pipeline/verdicts.ts'

/** serve reports dead on arrival — a test must never boot a real `opencode`
 *  binary (dev boxes may have one installed). Boot silence now THROWS
 *  (harness, not a package verdict); api-flow tests use liveSpawn. */
const deadSpawn = (() => ({
  stdout: { on: () => {} }, stderr: { on: () => {} },
  on: (_ev: string, cb: (a?: unknown) => void) => { cb() },
  kill: () => {},
})) as unknown as SpawnFn

/** Fake serve that announces its listener — exercises the post-boot api path. */
const liveSpawn = (() => ({
  stdout: { on: (_e: 'data', cb: (d: unknown) => void) => {
    cb('server listening on http://127.0.0.1:4567\nserver password pw\n')
  } },
  stderr: { on: () => {} },
  on: () => {},
  kill: () => {},
})) as unknown as SpawnFn

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'p' }, description: { en: '' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const caps = (redFlags: string[] = []) => ({ scannedAt: 't', findings: [], redFlags })
const verf = (status: 'unverified' | 'verified' | 'skipped' | 'failed', extra: Record<string, unknown> = {}) =>
  ({ status, ...extra }) as PluginEntry['verification']

describe('verifyPackage pinning', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vh2-'))
  it('installs the pinned name@version spec', async () => {
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@2.3.4' }, state: { status: 'active' } }]))
    const r = await verifyPackage('pkg', { version: '2.3.4', home, execFn: fake, spawnFn: liveSpawn })
    expect(calls.some(a => a[0] === 'plugin' && a[2] === 'pkg@2.3.4')).toBe(true)
    expect(r.version).toBe('2.3.4')
    expect(r.status).toBe('verified')
  })
  it('no version → bare name (legacy path), no version field in result', async () => {
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: 'opencode v2.2.5', stderr: '' }
    }) as unknown as ExecFn
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg' }, state: { status: 'active' } }]))
    const r = await verifyPackage('pkg', { home, execFn: fake, spawnFn: liveSpawn })
    expect(calls.some(a => a[0] === 'plugin' && a[2] === 'pkg')).toBe(true)
    expect(r.version).toBeUndefined()
  })
})

describe('coerceTarget', () => {
  it('legacy string shard entries coerce', () => {
    expect(coerceTarget('a')).toEqual({ name: 'a' })
    expect(coerceTarget({ name: 'b', version: '1', features: ['gui'] })).toEqual({ name: 'b', version: '1', features: ['gui'] })
  })
})

describe('verify/merge version routing', () => {
  const held = entry({
    latestVersion: '1.0.0',
    verification: verf('verified'),
    pendingUpdate: { version: '1.1.0', capabilities: caps(), verification: verf('unverified'), heldAt: 't' },
  })
  it('result for held version writes pendingUpdate.verification, display untouched', () => {
    const m = mergeResults(idx([held]), [
      { name: 'p', version: '1.1.0', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    const p = m.plugins[0]!
    expect(p.pendingUpdate!.verification.status).toBe('verified')
    expect(p.verification.status).toBe('verified') // was already verified for 1.0.0
    expect(p.latestVersion).toBe('1.0.0')
  })
  it('result for display version writes entry.verification', () => {
    const e = entry({ verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')
  })
  it('stale result (version matches neither slot) is dropped', () => {
    const m = mergeResults(idx([held]), [
      { name: 'p', version: '9.9.9', status: 'failed', level: 'install', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    const p = m.plugins[0]!
    expect(p.pendingUpdate!.verification.status).toBe('unverified')
    expect(p.verification.status).toBe('verified')
  })
  it('legacy version-less result writes the display slot', () => {
    const e = entry({ verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')
  })
  it('version-less result is DROPPED when a hold exists — it cannot say which version it measured', () => {
    const e = entry({
      latestVersion: '1.0.0', verification: verf('unverified'),
      pendingUpdate: { version: '1.1.0', capabilities: caps(), verification: verf('unverified'), heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', status: 'failed', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    const p = m.plugins[0]!
    expect(p.verification.status).toBe('unverified')
    expect(p.pendingUpdate!.verification.status).toBe('unverified')
  })
  it('harness:true results are dropped entirely — infrastructure is not a package verdict', () => {
    const e = entry({ verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'failed', level: 'install', opencodeVersion: '2.2.5',
        verifiedAt: 'v', logExcerpt: 'harness error: sudo: a password is required', harness: true },
    ])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('unverified')   // slot untouched — stays queued
    expect(v.retries).toBeUndefined()     // no retry budget burned
  })
  it('legacy failed without retries counts the first observed failure as attempt 1', () => {
    const e = entry({
      verification: { status: 'failed', level: 'install', verifiedAt: '2026-01-01T00:00:00Z' } as PluginEntry['verification'],
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'failed', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    expect(m.plugins[0]!.verification.retries).toBe(1)   // was 2 before the ?? 0 fix
  })
  it('pending new entry: result for latestVersion lands in verification (release gate reads it)', () => {
    const e = entry({ approval: 'pending', latestVersion: '3.0.0', verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '3.0.0', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')
  })
})

describe('verify/plan', () => {
  it('targets pendingUpdate version for held bumps, with its features', () => {
    const e = entry({
      latestVersion: '1.0.0', verification: verf('verified'), features: ['server'],
      pendingUpdate: { version: '1.1.0', capabilities: caps(), verification: verf('unverified'), features: ['server', 'gui'], heldAt: 't' },
    })
    const t = planTargets(idx([e]))
    expect(t).toEqual([{ name: 'p', version: '1.1.0', features: ['server', 'gui'], parts: ['plugin'] }])
  })
  it('targets latestVersion for pending new entries', () => {
    const e = entry({ approval: 'pending', latestVersion: '2.0.0', verification: verf('unverified') })
    expect(planTargets(idx([e]))).toEqual([{ name: 'p', version: '2.0.0', parts: ['plugin'] }])
  })
  it('skill-only npm entries queue with parts [skill]; plugin-less skill-less entries stay out', () => {
    const skill = entry({ name: 'sk', type: 'skill', contains: ['skill'], verification: verf('unverified') })
    const dual = entry({ name: 'du', contains: ['plugin', 'skill'], verification: verf('unverified') })
    const orphan = entry({ name: 'or', contains: ['command'], verification: verf('unverified') })
    const legacySkill = entry({ name: 'ls', type: 'skill', verification: verf('unverified') })
    const got = planTargets(idx([dual, legacySkill, orphan, skill]))   // index.plugins is name-asc
    expect(got.map(t => [t.name, t.parts])).toEqual([
      ['du', ['plugin', 'skill']], ['ls', ['skill']], ['sk', ['skill']],
    ])
    // D-R: the shared predicate must reject no-plugin/no-skill entries too —
    // digest §④ counts verifyQueued, and they must never drift apart
    expect(verifyQueued(orphan)).toBe(false)
    expect(verifyQueued(skill)).toBe(true)
    expect(verifyQueued(dual)).toBe(true)
  })
  it('skips verified, flagged, and version-less entries', () => {
    const verified = entry({ name: 'a', verification: verf('verified', { opencodeVersion: OPENCODE_VERSION }) })
    const flagged = entry({ name: 'b', verification: verf('unverified'), capabilities: caps(['x:y']) })
    const noVer = entry({ name: 'c', latestVersion: null, verification: verf('unverified') })
    expect(planTargets(idx([verified, flagged, noVer]))).toEqual([])
  })
  it('host-version drift: verified@different opencodeVersion re-queues (P1-6)', () => {
    const stale = entry({ name: 'stale', verification: verf('verified', { opencodeVersion: '9.9.9' }) })
    const legacy = entry({ name: 'legacy', verification: verf('verified') })   // no recorded host → also stale
    const current = entry({ name: 'current', verification: verf('verified', { opencodeVersion: OPENCODE_VERSION }) })
    const fresh = entry({ name: 'fresh', verification: verf('unverified') })
    const got = planTargets(idx([stale, legacy, current, fresh]))
    // stale-host tier outranks the normal queue; the current-host verify stays out
    expect(got.map(t => t.name)).toEqual(['stale', 'legacy', 'fresh'])
  })
  it('retest mode re-runs failed/verified but NEVER flagged targets', () => {
    const failed = entry({ name: 'a', verification: verf('failed') })
    const verified = entry({ name: 'b', verification: verf('verified', { opencodeVersion: OPENCODE_VERSION }) })
    const flagged = entry({ name: 'c', verification: verf('failed'), capabilities: caps(['r:f']) })
    const skipped = entry({ name: 'd', verification: verf('skipped'), capabilities: caps(['r:f']) })
    // 'a' has unused retry budget (retries absent → 0) — it auto-requeues;
    // verified-current and flagged stay out either way
    expect(planTargets(idx([failed, verified, flagged, skipped])).map(t => t.name)).toEqual(['a'])
    const got = planTargets(idx([failed, verified, flagged, skipped]), 48, true)
    expect(got.map(t => t.name)).toEqual(['a', 'b'])   // flagged targets stay out — pinned version included
    expect(got[0]!.version).toBe('1.0.0')
  })
  it('failed slots re-enter the queue while attempts remain (V-3 bounded retry)', () => {
    const now = new Date('2026-01-08T00:00:00Z')
    const fresh = entry({ name: 'fresh', verification: { status: 'failed', verifiedAt: '2026-01-07T00:00:00Z', retries: 1 } })
    const legacy = entry({ name: 'legacy', verification: { status: 'failed', verifiedAt: '2026-01-07T00:00:00Z' } })
    // queue starvation must not burn budget: an old failure that was never
    // retried still owns its attempts — the window is gone, the counter is
    // the bound
    const stale = entry({ name: 'stale', verification: { status: 'failed', verifiedAt: '2025-12-01T00:00:00Z' } })
    const exhausted = entry({ name: 'exhausted', verification: { status: 'failed', verifiedAt: '2026-01-07T00:00:00Z', retries: 3 } })
    const noDate = entry({ name: 'nodate', verification: { status: 'failed' } })
    const got = planTargets(idx([fresh, legacy, stale, exhausted, noDate]), 48, false, now)
    // everything under 3 attempts re-enters; only the exhausted slot is terminal
    expect(got.map(t => t.name)).toEqual(['fresh', 'legacy', 'stale', 'nodate'])
  })
  it('pendingUpdate failed slot retries on the held version', () => {
    const now = new Date('2026-01-08T00:00:00Z')
    const e = entry({
      verification: verf('verified'),
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: { status: 'failed', verifiedAt: '2026-01-07T00:00:00Z', retries: 2 }, heldAt: 't' },
    })
    // display slot verified, held slot failed-once-more-eligible → targets the held version
    expect(planTargets(idx([e]), 48, false, now)).toEqual([{ name: 'p', version: '2.0.0', parts: ['plugin'] }])
  })
  it('held flagged version is skipped (flag lives on pendingUpdate.capabilities)', () => {
    const e = entry({
      verification: verf('verified'),
      pendingUpdate: { version: '1.1.0', capabilities: caps(['sec-delta:x']), verification: verf('unverified'), heldAt: 't' },
    })
    expect(planTargets(idx([e]))).toEqual([])
  })
  it('cap slices deterministically', () => {
    const es = Array.from({ length: 50 }, (_, i) =>
      entry({ name: `p${String(i).padStart(3, '0')}`, verification: verf('unverified') }))
    expect(planTargets(idx(es), 48)).toHaveLength(48)
  })
  it('FIFO: oldest-held drains first regardless of name order', () => {
    // name-asc would put 'aaa' first; heldAt must win — a deep backlog
    // otherwise starves alphabetically-late packages forever
    const old = entry({ name: 'zzz', firstSeenAt: '2026-01-01T00:00:00Z', verification: verf('unverified') })
    const mid = entry({ name: 'mmm', firstSeenAt: '2026-01-03T00:00:00Z', verification: verf('unverified') })
    const new_ = entry({ name: 'aaa', firstSeenAt: '2026-01-05T00:00:00Z', verification: verf('unverified') })
    const got = planTargets(idx([new_, mid, old]))
    expect(got.map(t => t.name)).toEqual(['zzz', 'mmm', 'aaa'])
  })
  it('submission tier still jumps ahead of older organic entries', () => {
    const sub = entry({ name: 'sub', discoveredVia: ['submission'], firstSeenAt: '2026-01-05T00:00:00Z', verification: verf('unverified') })
    const org = entry({ name: 'org', discoveredVia: ['npm-keyword'], firstSeenAt: '2026-01-01T00:00:00Z', verification: verf('unverified') })
    expect(planTargets(idx([org, sub])).map(t => t.name)).toEqual(['sub', 'org'])
  })
  it('verifyPartsOf prefers pendingUpdate.contains — the held version its own parts', () => {
    const e = entry({
      contains: ['plugin'],   // displayed version's parts (pinned at hold time)
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: verf('unverified'),
        contains: ['plugin', 'skill'], heldAt: 't' },
    })
    expect(verifyPartsOf(e)).toEqual(['plugin', 'skill'])
    // legacy hold without pu.contains → entry.contains still describes the candidate
    const legacy = entry({
      contains: ['plugin', 'skill'],
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: verf('unverified'), heldAt: 't' },
    })
    expect(verifyPartsOf(legacy)).toEqual(['plugin', 'skill'])
  })
  it('submission-originated targets sort ahead of the alphabetical queue', () => {
    // index.plugins order is name-asc: acrawl, asub, zsub
    const crawled = entry({ name: 'acrawl', discoveredVia: ['npm-keyword'], verification: verf('unverified') })
    const subA = entry({ name: 'asub', discoveredVia: ['submission'], verification: verf('unverified') })
    const subZ = entry({ name: 'zsub', discoveredVia: ['submission', 'npm-keyword'], verification: verf('unverified') })
    const got = planTargets(idx([crawled, subA, subZ]))
    expect(got.map(t => t.name)).toEqual(['asub', 'zsub', 'acrawl'])
  })
  it('submission tier also obeys the cap — overflow waits for the next run', () => {
    const es = Array.from({ length: 50 }, (_, i) =>
      entry({ name: `s${String(i).padStart(3, '0')}`, discoveredVia: ['submission'], verification: verf('unverified') }))
    const got = planTargets(idx(es), 48)
    expect(got).toHaveLength(48)
    expect(got[0]!.name).toBe('s000')
    expect(got.at(-1)!.name).toBe('s047')
  })
  it('verifyTargetOf prefers the held slot', () => {
    const e = entry({
      verification: verf('verified'), features: ['server'],
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: verf('unverified'), features: ['tui'], heldAt: 't' },
    })
    expect(verifyTargetOf(e)).toEqual({ version: '2.0.0', unverified: true, flagged: false, features: ['tui'],
      hostStale: false, verification: verf('unverified') })
  })
  it('verifyTargetOf emits a pinned git spec for github-kind entries', () => {
    const e = entry({
      latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'abc123' },
      verification: verf('unverified'),
    })
    const t = verifyTargetOf(e)
    expect(t.git).toEqual({ repo: 'O/R', sha: 'abc123' })
    expect(t.version).toBeNull()
    // a github-kind entry with installable parts now QUEUES — the skipped
    // state was only ever "no install path existed", and one now does
    expect(verifyQueued(e)).toBe(true)
  })
  it('cleared-flag skipped slots re-queue instead of staying stale', () => {
    // skipIfFlagged leaves 'skipped' behind when red flags clear — the label
    // "没跑" would otherwise persist forever on a slot that can now be tested
    const e = entry({ name: 'cleared', verification: verf('skipped', { level: 'install' }) })
    expect(verifyQueued(e)).toBe(true)
    expect(planTargets(idx([e])).map(t => t.name)).toEqual(['cleared'])
    // a concern verdict on the slot still keeps it OUT — judged ≠ queued.
    // (latest covers every source — a human verdict lands in both maps, so
    // the concern must be present in `latest` the way the real stream builds it)
    const hc = { name: 'cleared', version: '1.0.0', verdict: 'concern', source: 'human', at: 't', reason: 'r' } as never
    const latest = new Map([[vkey('cleared', '1.0.0'), hc]])
    const human = new Map([[vkey('cleared', '1.0.0'), hc]])
    expect(verifyQueued(e, new Date(), latest, human)).toBe(false)
  })
  it('a slot-level or package-brake concern is never queued automatically', () => {
    const e = entry({ name: 'badpkg', verification: verf('unverified') })
    expect(verifyQueued(e)).toBe(true)   // no verdicts → queued
    const concern = { name: 'badpkg', version: '1.0.0', verdict: 'concern', source: 'ai', at: 't', reason: 'r' } as never
    const latest = new Map([[vkey('badpkg', '1.0.0'), concern]])
    expect(verifyQueued(e, new Date(), latest, new Map())).toBe(false)
    // package-level human brake (version=null) covers every slot too
    const brake = new Map([[vkey('badpkg', null), { name: 'badpkg', version: null, verdict: 'concern', source: 'human', at: 't', reason: 'r' } as never]])
    expect(verifyQueued(e, new Date(), new Map(), brake)).toBe(false)
    // a latest map present WITHOUT a human map → the concern check still runs
    // (latestHuman ?? new Map()); an unrelated slot's verdict doesn't gate.
    const other = new Map([[vkey('elsewhere', '1.0.0'), { name: 'elsewhere', version: '1.0.0', verdict: 'concern', source: 'ai', at: 't', reason: 'r' } as never]])
    expect(verifyQueued(e, new Date(), other)).toBe(true)
    // retest/manual dispatch still bypasses — the human asked for it
    expect(planTargets(idx([e]), 48, true).map(t => t.name)).toEqual(['badpkg'])
  })
  it('shard spreads items across buckets (greedy balance, deterministic)', () => {
    expect(shard([1, 2, 3, 4, 5], 2)).toEqual([[1, 4], [2, 5], [3]])
    expect(shard([], 8)).toEqual([])
  })
  it('weighted shard balances heavy targets instead of headcount', () => {
    // two gui-heavy (w=3 each) + four light (w=1) targets, size 4 → 2 shards.
    // Headcount slicing would put both heavies (list head) in one shard.
    const ts = ['a', 'b', 'c', 'd', 'e', 'f']
    const w = (t: string) => (t === 'a' || t === 'b' ? 3 : 1)
    const got = shard(ts, 4, w)
    expect(got).toHaveLength(2)
    // heavies land on different shards; both buckets carry ~equal total weight
    expect(got.some(s => s.includes('a') && s.includes('b'))).toBe(false)
    const ws = got.map(s => s.reduce((n, t) => n + w(t), 0))
    expect(Math.abs(ws[0]! - ws[1]!)).toBeLessThanOrEqual(1)
  })
})

describe('tui judge', () => {
  it('dead session → fail', () => {
    expect(judgeTuiPane('opencode ui content here', false).ok).toBe(false)
  })
  it('empty pane → fail', () => {
    expect(judgeTuiPane('   \n  ', true).ok).toBe(false)
  })
  it('crash pattern → fail', () => {
    expect(judgeTuiPane('some output\npanic: runtime error\nmore', true).ok).toBe(false)
    expect(judgeTuiPane('plugin x crashed while loading', true).ok).toBe(false)
  })
  it('alive session + real ui content → pass', () => {
    const pane = '┌─ opencode ────────────┐\n│ Ask anything...       │\n│ build agent · 2.2.5   │\n└───────────────────────┘'
    const r = judgeTuiPane(pane, true)
    expect(r.ok).toBe(true)
    expect(r.log).toContain('opencode')
  })
})

describe('gui harness', () => {
  const okBundle = `
    const { Plugin, Panel, SettingsPage } = require('@opencode/plugin/gui')
    module.exports.default = Plugin.define({
      setup(ctx) {
        ctx.add(Panel, () => ({ render: () => {
          const d = document.createElement('div'); d.textContent = 'hello'; return d } }))
        ctx.add(SettingsPage, () => ({ render: () => {
          const s = document.createElement('span'); s.textContent = 'settings'; return s } }))
      },
    })`
  it('load + register + render → ok', async () => {
    const r = await checkGuiBundle(okBundle)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['Panel', 'SettingsPage'])
    expect(r.rendered).toBe(2)
  })
  it('bundle exporting define() directly (no .default) → ok', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'x'; return d } }))
      } })`)
    expect(r.ok).toBe(true)
  })
  it('awaiting a host ipc stub does not hang (deepStub is non-thenable)', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ async setup(ctx) {
        const client = ctx.main({})
        await client.anything()
        ctx.add(Panel, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'x'; return d } }))
      } })`)
    expect(r.ok).toBe(true)
  })
  it('non-whitelisted require → whitelist failure naming the module', async () => {
    const r = await checkGuiBundle(`require('fs'); module.exports = {}`)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('whitelist')
    expect(r.error).toContain('fs')
  })
  it('eval throw → evaluate failure', async () => {
    const r = await checkGuiBundle(`throw new Error('boom on import')`)
    expect(r).toMatchObject({ ok: false, stage: 'evaluate' })
  })
  it('no setup → setup failure', async () => {
    const r = await checkGuiBundle(`module.exports.default = {}`)
    expect(r).toMatchObject({ ok: false, stage: 'setup' })
  })
  it('render() throwing → render failure', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => { throw new Error('render boom') } }))
      } })`)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('render')
    expect(r.error).toContain('render boom')
  })
  it('render() returning non-element → render failure', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => 'not an element' }))
      } })`)
    expect(r).toMatchObject({ ok: false, stage: 'render' })
  })
  it('empty element → render failure', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => document.createElement('div') }))
      } })`)
    expect(r).toMatchObject({ ok: false, stage: 'render' })
  })
  it('setup registering nothing → setup failure', async () => {
    const r = await checkGuiBundle(`
      const { Plugin } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup() {} })`)
    expect(r).toMatchObject({ ok: false, stage: 'setup' })
  })
  it('globals are restored after the check', async () => {
    const before = (globalThis as Record<string, unknown>)['document']
    await checkGuiBundle(okBundle)
    expect((globalThis as Record<string, unknown>)['document']).toBe(before)
  })
  it('process is not reachable inside the sandbox realm', async () => {
    const r = await checkGuiBundle(`process.exit(1); module.exports = {}`)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('evaluate')
    expect(r.error).toMatch(/process is not defined/)
  })
  it('dynamic import() in setup → deterministic failure, not a stray rejection', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ async setup(ctx) {
        await import('node:fs')
        ctx.add(Panel, () => ({ render: () => document.createElement('div') }))
      } })`)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('setup')
    // whitelist msg when vm-modules is enabled; the stock-node message otherwise
    expect(r.error).toMatch(/whitelist|dynamic import/i)
  })
  it('sync infinite loop in eval dies by the vm timeout', async () => {
    const r = await checkGuiBundle(`while(1){}; module.exports = {}`)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('evaluate')
    expect(r.error).toMatch(/timed out/i)
  }, 15000)

  it('findGuiBundle locates the gui export in the plugin cache layout', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'))
    const dir = join(home, 'cache', 'opencode', 'npm', 'pkg@1.2.3', '999', 'node_modules', 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { '.': './s.js', './gui-experimental': './g.js' } }))
    writeFileSync(join(dir, 'g.js'), 'module.exports={}')
    const found = findGuiBundle(home, 'pkg')
    expect('src' in found && found.src).toBe('module.exports={}')
  })
  it('findGuiBundle reports missing package dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh2-'))
    expect(findGuiBundle(home, 'nope')).toMatchObject({ error: expect.stringContaining('cache') })
  })
})

describe('skill structure check (skill-only + dual-nature parts)', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vh3-'))
  const SKILL = '---\nname: test-skill\ndescription: does things\n---\nbody text'
  const fakeSkillOs = (opts: { body?: string; list?: string; packErr?: boolean; calls?: string[][] } = {}) =>
    (async (cmd: string, args: string[]) => {
      opts.calls?.push([cmd, ...args])
      if (args.includes('--version')) return { stdout: 'opencode v2.2.5', stderr: '' }
      if (cmd === 'npm' && args[0] === 'pack') {
        if (opts.packErr) throw Object.assign(new Error('boom'), { stderr: 'npm ERR! 404' })
        return { stdout: 'pkg-1.0.0.tgz\n', stderr: '' }
      }
      if (cmd === 'tar' && args[0] === 'tzf')
        return { stdout: opts.list ?? 'package/package.json\npackage/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf')
        return { stdout: opts.body ?? SKILL, stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn

  it('verifyPartsOf normalizes contains → parts', () => {
    expect(verifyPartsOf(entry({ contains: ['skill'] }))).toEqual(['skill'])
    expect(verifyPartsOf(entry({ type: 'skill' }))).toEqual(['skill'])     // declared skill, no parts
    expect(verifyPartsOf(entry({}))).toEqual(['plugin'])                    // legacy
    expect(verifyPartsOf(entry({ contains: ['plugin', 'skill'] }))).toEqual(['plugin', 'skill'])
  })

  it('skill-only parts → structure check only; plugin add/serve never run', async () => {
    const calls: string[][] = []
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: vHome(), execFn: fakeSkillOs({ calls }), spawnFn: deadSpawn })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('structure')
    expect(calls.some(a => a[0] === 'npm' && a[1] === 'pack' && a[2] === 'sk@1.0.0')).toBe(true)
    expect(calls.some(a => a.includes('plugin') || a.includes('serve'))).toBe(false)
  })

  it('no SKILL.md in tarball → failed/structure with reason', async () => {
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: vHome(), execFn: fakeSkillOs({ list: 'package/package.json\npackage/index.js\n' }), spawnFn: deadSpawn })
    expect(r).toMatchObject({ status: 'failed', level: 'structure' })
    expect(r.logExcerpt).toContain('no SKILL.md')
  })

  it('SKILL.md without frontmatter name → failed/structure', async () => {
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: vHome(), execFn: fakeSkillOs({ body: '# just markdown\nno frontmatter here' }), spawnFn: deadSpawn })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain('frontmatter')
  })

  it('npm pack failure → failed/structure (version gone = not installable)', async () => {
    const r = await verifyPackage('sk', { version: '9.9.9', parts: ['skill'],
      home: vHome(), execFn: fakeSkillOs({ packErr: true }), spawnFn: deadSpawn })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('structure')
    expect(r.logExcerpt).toContain('404')
  })

  it('nested skills/<x>/SKILL.md layout also passes', async () => {
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: vHome(), execFn: fakeSkillOs({ list: 'package/package.json\npackage/skills/foo/SKILL.md\n' }), spawnFn: deadSpawn })
    expect(r.status).toBe('verified')
  })

  it('dual-nature: plugin passes load AND skill payload checked → verified', async () => {
    const calls: string[][] = []
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'du@1.0.0' }, state: { status: 'active' } }]))
    const r = await verifyPackage('du', { version: '1.0.0', parts: ['plugin', 'skill'],
      home, execFn: fakeSkillOs({ calls }), spawnFn: liveSpawn })
    expect(r.status).toBe('verified')
    expect(calls.some(a => a.includes('add') && a.join(' ').includes('du@1.0.0'))).toBe(true)
    expect(calls.some(a => a[0] === 'npm' && a[1] === 'pack')).toBe(true)
  })

  it('dual-nature: plugin ok but skill payload broken → failed at passed level', async () => {
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'du@1.0.0' }, state: { status: 'active' } }]))
    const r = await verifyPackage('du', { version: '1.0.0', parts: ['plugin', 'skill'],
      home, execFn: fakeSkillOs({ list: 'package/index.js\n' }), spawnFn: liveSpawn })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
    expect(r.logExcerpt).toContain('skill payload failed')
  })

  it('structure-level result rows pass the merge artifact boundary', () => {
    expect(VerifyResultFile.safeParse({
      name: 's', version: '1', status: 'verified', level: 'structure',
      opencodeVersion: '2.2.5', verifiedAt: '2026-01-02T00:00:00Z',
    }).success).toBe(true)
  })
})

describe('verifyShard', () => {
  it('a harness-failing target records failed + flushes results incrementally', async () => {
    const { verifyShard } = await import('../pipeline/verify/verify.ts')
    const { readFileSync } = await import('node:fs')
    const home = mkdtempSync(join(tmpdir(), 'vs-'))
    const out = join(home, 'results.json')
    // home as a FILE → writeDummyProvider's mkdirSync throws ENOTDIR out of
    // verifyPackage entirely → the per-target catch records 'harness error'
    const notDir = join(home, 'afile')
    writeFileSync(notDir, 'x')
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    const results = await verifyShard(['a', 'b'], out, { home: notDir, execFn: fake, spawnFn: deadSpawn })
    expect(results).toHaveLength(2)
    expect(results.every(r => r.status === 'failed')).toBe(true)
    expect(results[0]!.logExcerpt).toContain('harness error')
    expect(results.every(r => r.harness === true)).toBe(true)   // flagged for merge to drop
    // incremental flush — the file exists even though every target failed
    const onDisk = JSON.parse(readFileSync(out, 'utf8')) as { name: string }[]
    expect(onDisk.map(r => r.name)).toEqual(['a', 'b'])
  })

  it('harness-throw streak aborts the shard — bounded overshoot under parallel lanes', async () => {
    const { verifyShard } = await import('../pipeline/verify/verify.ts')
    const home = mkdtempSync(join(tmpdir(), 'vs-'))
    const out = join(home, 'results.json')
    const notDir = join(home, 'afile')
    writeFileSync(notDir, 'x')
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    const results = await verifyShard(['a', 'b', 'c', 'd', 'e', 'f'], out, { home: notDir, execFn: fake, spawnFn: deadSpawn })
    // 2 lanes: once the streak hits 3 no NEW target is pulled, but a sibling
    // lane may already hold one in-flight target — overshoot is bounded, not
    // zero (an outage is still not 6 bad packages)
    expect(results.length).toBeGreaterThanOrEqual(3)
    expect(results.length).toBeLessThanOrEqual(4)
    expect(results.every(r => r.harness === true)).toBe(true)
  })
})

describe('verify/merge drift, freshness, reuse', () => {
  const base = { level: 'load' as const, opencodeVersion: OPENCODE_VERSION, verifiedAt: '2026-01-02T00:00:00Z' }
  it('measured integrity ≠ pinned anchor → failed/install, not standing verified (re-tag)', () => {
    const e = entry({ integrity: 'sha512-PINNED', verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', integrity: 'sha512-OTHER', ...base },
    ])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('failed')
    expect(v.level).toBe('install')
    expect(v.logExcerpt).toContain('re-tagged')
    // the drift failure counts as an attempt — the retest path stays bounded
    expect(v.retries).toBe(1)
  })
  it('measured integrity == pinned anchor → verified stands', () => {
    const e = entry({ integrity: 'sha512-SAME', verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', integrity: 'sha512-SAME', ...base },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')
    expect(m.plugins[0]!.verification.integrity).toBe('sha512-SAME')
  })
  it('result without integrity skips the anchor compare (probe degraded)', () => {
    const e = entry({ integrity: 'sha512-PINNED', verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', ...base },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')
  })
  it('github-kind: source.version anchors the display slot', () => {
    const e = entry({
      latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'abc123' },
      verification: verf('unverified'),
    })
    const drifted = mergeResults(idx([e]), [
      { name: 'p', status: 'verified', integrity: 'def456', ...base },
    ])
    expect(drifted.plugins[0]!.verification.status).toBe('failed')
    const ok = mergeResults(idx([e]), [
      { name: 'p', status: 'verified', integrity: 'abc123', ...base },
    ])
    expect(ok.plugins[0]!.verification.status).toBe('verified')
  })
  it('pendingUpdate slot drift-checks against pu.integrity', () => {
    const e = entry({
      latestVersion: '1.0.0', verification: verf('verified'),
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: verf('unverified'),
        integrity: 'sha512-PU', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '2.0.0', status: 'verified', integrity: 'sha512-MOVED', ...base },
    ])
    expect(m.plugins[0]!.pendingUpdate!.verification.status).toBe('failed')
    expect(m.plugins[0]!.verification.status).toBe('verified')   // display untouched
  })
  it('fresher slot evidence beats a replayed (older) result row', () => {
    const e = entry({
      verification: verf('failed', { verifiedAt: '2026-01-05T00:00:00Z', retries: 1 }),
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', ...base },   // verifiedAt 01-02 < slot 01-05
    ])
    expect(m.plugins[0]!.verification.status).toBe('failed')
    expect(m.plugins[0]!.verification.verifiedAt).toBe('2026-01-05T00:00:00Z')
  })
  it('skipIfFlagged downgrade preserves the measured evidence trail', () => {
    const e = entry({
      verification: verf('unverified'),
      capabilities: caps(['sec:flag']),
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'verified', integrity: 'sha512-X', ...base },
    ], 'https://run/url')
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('skipped')
    expect(v.verifiedAt).toBe('2026-01-02T00:00:00Z')
    expect(v.integrity).toBe('sha512-X')
    expect(v.runUrl).toBe('https://run/url')
  })
  it('content-addressed reuse: a same-anchor verified donor covers the sibling slot', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-TWIN',
      verification: verf('unverified'),
      pendingUpdate: { version: '1.0.0', capabilities: caps(),
        verification: verf('verified', { integrity: 'sha512-TWIN', opencodeVersion: OPENCODE_VERSION }),
        integrity: 'sha512-TWIN', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    expect(m.plugins[0]!.verification.status).toBe('verified')
    expect(m.plugins[0]!.verification.integrity).toBe('sha512-TWIN')
  })
  it('reuse refuses stale-host donors and anchor mismatches', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-OTHER',
      verification: verf('unverified'),
      pendingUpdate: { version: '1.1.0', capabilities: caps(),
        // donor carries a DIFFERENT anchor and a stale host stamp — neither
        // may vouch for the displayed slot's bytes
        verification: verf('verified', { integrity: 'sha512-TWIN', opencodeVersion: 'oc-old' }),
        integrity: 'sha512-TWIN', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    expect(m.plugins[0]!.verification.status).toBe('unverified')
  })
})

describe('skill tarball edge cases', () => {
  const SKILL = '---\nname: s\ndescription: d\n---\nbody'
  it('any parseable SKILL.md wins — member ORDER must not decide (G3)', async () => {
    // docs/SKILL.md sorts first in the tar listing but has no frontmatter;
    // the real manifest under skills/ must still verify the package
    const fake = (async (cmd: string, args: string[]) => {
      if (args.includes('--version')) return { stdout: 'opencode v2.2.5', stderr: '' }
      if (cmd === 'npm' && args[0] === 'pack') return { stdout: 'pkg-1.0.0.tgz\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'tzf')
        return { stdout: 'package/docs/SKILL.md\npackage/package.json\npackage/skills/x/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf')
        return { stdout: args.at(-1)!.includes('skills') ? SKILL : '# docs only\n', stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', parts: ['skill'], home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('structure')
  })
  it('ALL manifests unparseable → failed/structure naming every checked file', async () => {
    const fake = (async (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'pack') return { stdout: 'pkg-1.0.0.tgz\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'tzf')
        return { stdout: 'package/SKILL.md\npackage/skills/x/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf') return { stdout: 'no frontmatter\n', stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', parts: ['skill'], home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain('no parseable SKILL.md')
    expect(r.logExcerpt).toContain('checked 2')
  })
  it('BOM + padded --- fences still parse as frontmatter', async () => {
    const fake = (async (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'pack') return { stdout: 'pkg-1.0.0.tgz\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'tzf') return { stdout: 'package/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf')
        return { stdout: '﻿---  \nname: s\ndescription: d\n--- \r\nbody', stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', parts: ['skill'], home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('verified')
  })
})

describe('github-kind verify routes', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vh4-'))
  it('git skill-only → codeload tarball structure check, no plugin add', async () => {
    const calls: string[][] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      if (cmd === 'curl') return { stdout: '', stderr: '' }
      if (cmd === 'tar' && args[0] === 'tzf')
        return { stdout: 'repo-abc123/SKILL.md\nrepo-abc123/README.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf')
        return { stdout: '---\nname: s\ndescription: d\n---\nbody', stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'abc123' }, parts: ['skill'],
      home: vHome(), execFn: fake })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('structure')
    // pinned commit fetch — never a floating HEAD
    expect(calls.some(a => a[0] === 'curl' && a.join(' ').includes('O/R/tar.gz/abc123'))).toBe(true)
    expect(calls.some(a => a.includes('plugin'))).toBe(false)
    // commit sha IS the measured identity
    expect(r.integrity).toBe('abc123')
  })
  it('codeload failure → failed/structure with the error', async () => {
    const fake = (async (cmd: string) => {
      if (cmd === 'curl') throw Object.assign(new Error('curl: 404'), { stderr: 'HTTP 404' })
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'abc123' }, parts: ['skill'],
      home: vHome(), execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain('404')
  })
  it('git plugin install pins owner/repo#sha and matches basename api entries', async () => {
    const calls: string[][] = []
    const home = vHome()
    // api reports the install dir shape — the repo basename candidate must match
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'r#abc123' }, state: { status: 'active' } }]))
    const fake = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'abc123' },
      home, execFn: fake, spawnFn: liveSpawn })
    expect(r.status).toBe('verified')
    expect(calls.some(a => a.join(' ').includes('plugin add O/R#abc123'))).toBe(true)
  })
  it('npm integrity probe: registry SRI lands on the result; failure degrades silently', async () => {
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@1.0.0' }, state: { status: 'active' } }]))
    const okFake = (async (cmd: string, args: string[]) =>
      cmd === 'npm' && args.includes('dist.integrity')
        ? { stdout: 'sha512-AAA\n', stderr: '' }
        : { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }) as unknown as ExecFn
    const ok = await verifyPackage('pkg', { version: '1.0.0', home, execFn: okFake, spawnFn: liveSpawn })
    expect(ok.integrity).toBe('sha512-AAA')
    const home2 = vHome()
    writeFileSync(join(home2, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@1.0.0' }, state: { status: 'active' } }]))
    const badFake = (async (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args.includes('dist.integrity')) throw new Error('registry down')
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const degraded = await verifyPackage('pkg', { version: '1.0.0', home: home2, execFn: badFake, spawnFn: liveSpawn })
    expect(degraded.status).toBe('verified')
    expect(degraded.integrity).toBeUndefined()
  })
})

describe('remaining verify/plan/merge edge branches', () => {
  it('spawnFn throwing outright → dead serve → harness throw, not a verdict', async () => {
    const boom = (() => { throw new Error('spawn refused') }) as unknown as SpawnFn
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    await expect(verifyPackage('p', { home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake, spawnFn: boom, bootWaitMs: 20 }))
      .rejects.toThrow('serve did not announce a listener')
  })
  it('git dual-nature: plugin passes AND codeload skill manifest checked', async () => {
    const calls: string[][] = []
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'O/R#abc123' }, state: { status: 'active' } }]))
    const fake = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      if (cmd === 'tar' && args[0] === 'tzf') return { stdout: 'repo-abc/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf') return { stdout: '---\nname: s\n---\nb', stderr: '' }
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'abc123' }, parts: ['plugin', 'skill'],
      home, execFn: fake, spawnFn: liveSpawn })
    expect(r.status).toBe('verified')
    expect(calls.some(a => a[0] === 'curl' && a.join(' ').includes('codeload'))).toBe(true)
    const broken = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'abc123' }, parts: ['plugin', 'skill'],
      home: (() => { const h = mkdtempSync(join(tmpdir(), 'vx-'))
        writeFileSync(join(h, 'plugins.json'), JSON.stringify(
          [{ source: { type: 'package', target: 'O/R#abc123' }, state: { status: 'active' } }]))
        return h })(),
      execFn: (async (cmd: string, args: string[]) => {
        if (cmd === 'tar' && args[0] === 'tzf') return { stdout: 'repo-abc/index.js\n', stderr: '' }
        return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
      }) as unknown as ExecFn, spawnFn: liveSpawn })
    expect(broken.status).toBe('failed')
    expect(broken.logExcerpt).toContain('skill payload failed')
  })
  it('git target without a pinned sha → refused, no HEAD install', async () => {
    const calls: string[][] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    // a sha-less git spec has no REVIEWED bytes to measure — the harness must
    // refuse (throw → harness:true, dropped by merge) rather than install
    // bare HEAD and let 'verified' endorse unscanned code
    await expect(verifyPackage('o/r', { git: { repo: 'O/R' }, parts: ['skill'],
      home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake }))
      .rejects.toThrow(/no pinned commit sha/)
    expect(calls.some(a => a[0] === 'curl' || a[0] === 'opencode')).toBe(false)
  })
  it('plan drops a sha-less github slot entirely (incl. --retest)', () => {
    const e = entry({
      latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'O/R' } as PluginEntry['source'],
      verification: verf('unverified'),
    })
    expect(verifyQueued(e)).toBe(false)
    expect(planTargets(idx([e]))).toEqual([])
    expect(planTargets(idx([e]), 48, true)).toEqual([])   // retest too
  })
  it('verifyTargetOf github fallback: missing source.repo → id; missing version → no sha', () => {
    const e = entry({
      latestVersion: null,
      source: { kind: 'github', id: 'o/r' } as PluginEntry['source'],
      verification: verf('unverified'),
    })
    const t = verifyTargetOf(e)
    expect(t.git).toEqual({ repo: 'o/r' })
    expect(t.version).toBeNull()
  })
  it('hostStaleVerify: github-kind slot invalidated by a host bump re-queues', () => {
    const e = entry({
      latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'abc' },
      verification: verf('verified', { opencodeVersion: 'oc-old' }),
    })
    expect(hostStaleVerify(e)).toBe(true)
    expect(verifyQueued(e)).toBe(true)
    const names = planTargets(idx([e])).map(t => t.name)
    expect(names).toEqual(['p'])
  })
  it('merge reuse: display verified donor covers the held slot on the same anchor', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-SAME',
      verification: verf('verified', { integrity: 'sha512-SAME', opencodeVersion: OPENCODE_VERSION }),
      pendingUpdate: { version: '1.0.0', capabilities: caps(), verification: verf('unverified'),
        integrity: 'sha512-SAME', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    expect(m.plugins[0]!.pendingUpdate!.verification.status).toBe('verified')
  })
  it('merge reuse: no anchor on the recipient slot → nothing adopted', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: null,
      verification: verf('unverified'),
      pendingUpdate: { version: '1.1.0', capabilities: caps(),
        verification: verf('verified', { integrity: 'sha512-X', opencodeVersion: OPENCODE_VERSION }),
        integrity: 'sha512-X', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    expect(m.plugins[0]!.verification.status).toBe('unverified')
  })
})

describe('coverage: branch stragglers', () => {
  it('pu slot fresher guard: stale replay does not overwrite newer pu evidence', () => {
    const e = entry({
      latestVersion: '1.0.0', verification: verf('verified'),
      pendingUpdate: { version: '2.0.0', capabilities: caps(),
        verification: verf('verified', { verifiedAt: '2026-01-06T00:00:00Z' }), heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '2.0.0', status: 'failed', level: 'load', opencodeVersion: 'x',
        verifiedAt: '2026-01-02T00:00:00Z' },
    ])
    expect(m.plugins[0]!.pendingUpdate!.verification.status).toBe('verified')
  })
  it('hostStaleVerify false when a host-stale github slot has no checkable parts', () => {
    const e = entry({
      latestVersion: null, contains: ['command'],
      source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'abc' },
      verification: verf('verified', { opencodeVersion: 'oc-old' }),
    })
    expect(hostStaleVerify(e)).toBe(false)
    expect(verifyQueued(e)).toBe(false)
  })
  it('malformed pre-existing opencode.json in uh is rebuilt, not a crash (G9)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    // non-sandbox: uh IS home — the corrupt file sits where writeDummyProvider reads
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), '{{{ not json')
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@1.0.0' }, state: { status: 'active' } }]))
    const fake = (async (_c: string, args: string[]) =>
      ({ stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' })) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', home, execFn: fake, spawnFn: liveSpawn })
    expect(r.status).toBe('verified')
  })
  it('serve without a password line still verifies (pw empty string branch)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@1.0.0' }, state: { status: 'active' } }]))
    const noPw = (() => ({
      stdout: { on: (_e: 'data', cb: (d: unknown) => void) => { cb('server listening on http://127.0.0.1:4567\n') } },
      stderr: { on: () => {} }, on: () => {}, kill: () => {},
    })) as unknown as SpawnFn
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', home, execFn: fake, spawnFn: noPw })
    expect(r.status).toBe('verified')
  })
  it('npm pack error without stderr falls back to Error.message', async () => {
    const fake = (async (cmd: string) => {
      if (cmd === 'npm') throw new Error('spawn npm ENOENT')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain('ENOENT')
  })
  it('verifyShard forwards git targets (git spec + parts reach verifyPackage)', async () => {
    const { verifyShard } = await import('../pipeline/verify/verify.ts')
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    const calls: string[][] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      if (cmd === 'tar' && args[0] === 'tzf') return { stdout: 'repo-x/SKILL.md\n', stderr: '' }
      if (cmd === 'tar' && args[0] === 'xzf') return { stdout: '---\nname: s\n---\nb', stderr: '' }
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const rs = await verifyShard([{ name: 'o/r', git: { repo: 'O/R', sha: 'abc' }, parts: ['skill'] }],
      join(home, 'res.json'), { execFn: fake })
    expect(rs).toHaveLength(1)
    expect(rs[0]!.status).toBe('verified')
    expect(calls.some(a => a[0] === 'curl' && a.join(' ').includes('O/R/tar.gz/abc'))).toBe(true)
  })
})

describe('coverage: last branch stragglers', () => {
  it('donor exists but recipient anchor mismatches → slot keeps its own verdict', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-OTHER',
      verification: verf('unverified'),
      pendingUpdate: { version: '1.1.0', capabilities: caps(),
        verification: verf('verified', { integrity: 'sha512-A', opencodeVersion: OPENCODE_VERSION }),
        integrity: 'sha512-A', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    // different bytes were never measured on this slot — no adoption
    expect(m.plugins[0]!.verification.status).toBe('unverified')
  })
  it('verifyShard honors an injected opencodeVersion without probing', async () => {
    const { verifyShard } = await import('../pipeline/verify/verify.ts')
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const rs = await verifyShard(['a'], join(home, 'res.json'),
      { execFn: fake, spawnFn: deadSpawn, opencodeVersion: '9.9.9' })
    expect(calls.filter(a => a[0] === '--version')).toHaveLength(0)
    expect(rs[0]!.opencodeVersion).toBe('unknown')   // harness rows stamp unknown
  })
  it('serve announces listening but no port → boot timeout throw (port empty branch)', async () => {
    const weird = (() => ({
      stdout: { on: (_e: 'data', cb: (d: unknown) => void) => { cb('server listening on unix:///tmp/s.sock\n') } },
      stderr: { on: () => {} }, on: () => {}, kill: () => {},
    })) as unknown as SpawnFn
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    await expect(verifyPackage('p', { home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake, spawnFn: weird, bootWaitMs: 30 }))
      .rejects.toThrow('serve did not announce a listener')
  })
  it('codeload error without stderr falls back to Error.message', async () => {
    const fake = (async (cmd: string) => {
      if (cmd === 'curl') throw new Error('ECONNREFUSED')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('o/r', { git: { repo: 'O/R', sha: 'x' }, parts: ['skill'],
      home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain('ECONNREFUSED')
  })
  it('npm pack with empty stdout → structure check fails on the empty tgz name', async () => {
    const fake = (async (cmd: string) => {
      if (cmd === 'npm') return { stdout: '', stderr: '' }
      if (cmd === 'tar') throw Object.assign(new Error('tar failed'), { stderr: 'tar: not a gzip' })
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('sk', { version: '1.0.0', parts: ['skill'],
      home: mkdtempSync(join(tmpdir(), 'vx-')), execFn: fake })
    expect(r.status).toBe('failed')
  })
})

describe('verify audit batch — replay bounds, git-gui, tar cap, api states', () => {
  const base = { level: 'load' as const, opencodeVersion: OPENCODE_VERSION }

  it('equal-timestamp replay is idempotent — retries do NOT double-count', () => {
    // the cancelled-merge sweep replays an artifact carrying the very
    // verifiedAt it already wrote — a second application must not burn
    // another retry of the budget
    const e = entry({
      verification: verf('failed', { verifiedAt: '2026-01-02T00:00:00Z', retries: 1 }),
    })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'failed', verifiedAt: '2026-01-02T00:00:00Z', ...base },
    ])
    expect(m.plugins[0]!.verification.status).toBe('failed')
    expect(m.plugins[0]!.verification.retries).toBe(1)   // was 2 under `>`
  })
  it('duplicate result rows in one batch apply once (swept + current both present)', () => {
    const e = entry({ verification: verf('unverified') })
    const row = { name: 'p', version: '1.0.0', status: 'failed' as const,
      verifiedAt: '2026-01-02T00:00:00Z', ...base }
    const m = mergeResults(idx([e]), [row, { ...row }])
    expect(m.plugins[0]!.verification.retries).toBe(1)
  })
  it('artifact boundary: over-long logExcerpt and unparseable verifiedAt drop the row', () => {
    const ok = { name: 'p', status: 'failed', level: 'install', opencodeVersion: 'x',
      verifiedAt: '2026-01-02T00:00:00Z' }
    expect(VerifyResultFile.safeParse({ ...ok, logExcerpt: 'x'.repeat(3000) }).success).toBe(false)
    expect(VerifyResultFile.safeParse({ ...ok, verifiedAt: 'not a date' }).success).toBe(false)
    expect(VerifyResultFile.safeParse({ ...ok, logExcerpt: 'x'.repeat(2048) }).success).toBe(true)
  })
  it('logExcerpt is sanitized at the index boundary — ANSI/control chars stripped', () => {
    const e = entry({ verification: verf('unverified') })
    const m = mergeResults(idx([e]), [
      { name: 'p', version: '1.0.0', status: 'failed',
        verifiedAt: '2026-01-02T00:00:00Z', ...base,
        logExcerpt: 'ok\x1b[31mred\x1b[0m\x07' },
    ])
    expect(m.plugins[0]!.verification.logExcerpt).toBe('okred')
  })
  it('level structure is NOT host-stale — the check never ran the host', () => {
    const structStale = entry({
      type: 'skill', contains: ['skill'],
      verification: verf('verified', { level: 'structure', opencodeVersion: 'oc-old' }),
    })
    const runStale = entry({ name: 'r',
      verification: verf('verified', { level: 'load', opencodeVersion: 'oc-old' }),
    })
    expect(verifyTargetOf(structStale).hostStale).toBe(false)
    expect(verifyTargetOf(runStale).hostStale).toBe(true)
    // the structure slot stays out of the staleHost priority tier entirely
    expect(planTargets(idx([structStale, runStale])).map(t => t.name)).toEqual(['r'])
  })
  it('targetWeight charges staged routes, not free features', async () => {
    const { targetWeight } = await import('../pipeline/verify/plan.ts')
    expect(targetWeight({ name: 'a' })).toBe(1)
    expect(targetWeight({ name: 'a', features: ['server', 'rpc'] })).toBe(1)
    expect(targetWeight({ name: 'a', features: ['tui'] })).toBe(2)
    expect(targetWeight({ name: 'a', features: ['gui'] })).toBe(2)
    expect(targetWeight({ name: 'a', features: ['tui', 'gui'], parts: ['plugin', 'skill'] })).toBe(4)
  })
  it('findGuiBundle locates a git-install cache dir (git-<slug>-<hash>) by spec', async () => {
    const { createHash } = await import('node:crypto')
    const spec = 'O/R#abc123'
    const dir = `git-R-${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`
    const home = mkdtempSync(join(tmpdir(), 'gh3-'))
    // a git install's package name needn't equal the repo name — the gui
    // export identifies it
    const pkg = join(home, 'cache', 'opencode', 'npm', dir, '999', 'node_modules', 'real-name')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ exports: { '.': './s.js', './gui': './g.js' } }))
    writeFileSync(join(pkg, 'g.js'), 'module.exports={}')
    const found = findGuiBundle(home, 'o/r', spec)
    expect('src' in found && found.src).toBe('module.exports={}')
    // without the spec the dir can't be located — honest 'not found', not a
    // false render verdict on a bundle that was never there
    expect('error' in findGuiBundle(home, 'o/r')).toBe(true)
  })
  it('skill tgz member probes are bounded — a stuffed tarball fails fast', async () => {
    const { checkSkillTgz } = await import('../pipeline/verify/verify.ts')
    let probes = 0
    const fake = (async (_cmd: string, args: string[]) => {
      if (args[0] === 'tzf')
        return { stdout: Array.from({ length: 100 }, (_, i) => `package/skills/s${i}/SKILL.md`).join('\n'), stderr: '' }
      probes++
      return { stdout: 'no frontmatter\n', stderr: '' }
    }) as unknown as ExecFn
    const r = await checkSkillTgz('f.tgz', fake, /^package\//, 'x')
    expect(r.ok).toBe(false)
    expect(probes).toBe(64)
    expect(r.log).toContain('truncated')
  })
  it('api entry stuck in a non-terminal state fails honestly, not as absent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vx-'))
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'p@1.0.0' }, state: { status: 'loading' } }]))
    const fake = (async (cmd: string) => ({
      stdout: cmd === 'curl' ? '200' : 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    const r = await verifyPackage('p', { version: '1.0.0', home, execFn: fake, spawnFn: liveSpawn, apiWaitMs: 40 })
    expect(r.status).toBe('failed')
    expect(r.logExcerpt).toContain("non-terminal state 'loading'")
  })
  it('serve API refusing auth with no scraped password → harness throw, not a package verdict', async () => {
    const fake = (async (cmd: string) => ({
      stdout: cmd === 'curl' ? '401' : 'opencode v2.2.5', stderr: '' })) as unknown as ExecFn
    await expect(verifyPackage('p', { home: mkdtempSync(join(tmpdir(), 'vx-')),
      execFn: fake, spawnFn: liveSpawn, apiWaitMs: 40 }))
      .rejects.toThrow('upstream output/auth drift')
  })
})
