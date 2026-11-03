/** Stage-2 verify tests: version pinning, per-version merge routing, plan
 *  targets, L2 pane judge, L3a gui harness. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage, coerceTarget, type ExecFn } from '../pipeline/verify/verify.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { planTargets, verifyTargetOf, shard } from '../pipeline/verify/plan.ts'
import { judgeTuiPane } from '../pipeline/verify/tui.ts'
import { checkGuiBundle, findGuiBundle } from '../pipeline/verify/gui.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

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
const verf = (status: 'unverified' | 'verified' | 'skipped' | 'failed') => ({ status }) as PluginEntry['verification']

describe('verifyPackage pinning', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vh2-'))
  it('installs the pinned name@version spec', async () => {
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const home = vHome()
    mkdirSync(join(home, 'data', 'opencode', 'log'), { recursive: true })
    writeFileSync(join(home, 'data', 'opencode', 'log', 'opencode.log'), 'msg="loading plugin" id=pkg entrypoint=x')
    const r = await verifyPackage('pkg', { version: '2.3.4', home, execFn: fake })
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
    mkdirSync(join(home, 'data', 'opencode', 'log'), { recursive: true })
    writeFileSync(join(home, 'data', 'opencode', 'log', 'opencode.log'), 'msg="loading plugin" id=pkg entrypoint=x')
    const r = await verifyPackage('pkg', { home, execFn: fake })
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
    expect(t).toEqual([{ name: 'p', version: '1.1.0', features: ['server', 'gui'] }])
  })
  it('targets latestVersion for pending new entries', () => {
    const e = entry({ approval: 'pending', latestVersion: '2.0.0', verification: verf('unverified') })
    expect(planTargets(idx([e]))).toEqual([{ name: 'p', version: '2.0.0' }])
  })
  it('skips verified, flagged, and version-less entries', () => {
    const verified = entry({ name: 'a', verification: verf('verified') })
    const flagged = entry({ name: 'b', verification: verf('unverified'), capabilities: caps(['x:y']) })
    const noVer = entry({ name: 'c', latestVersion: null, verification: verf('unverified') })
    expect(planTargets(idx([verified, flagged, noVer]))).toEqual([])
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
  it('verifyTargetOf prefers the held slot', () => {
    const e = entry({
      verification: verf('verified'), features: ['server'],
      pendingUpdate: { version: '2.0.0', capabilities: caps(), verification: verf('unverified'), features: ['tui'], heldAt: 't' },
    })
    expect(verifyTargetOf(e)).toEqual({ version: '2.0.0', unverified: true, flagged: false, features: ['tui'] })
  })
  it('shard chunks by size', () => {
    expect(shard([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
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
