import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeDaily, dailyBody, monthlyBody, yearlyBody, loadState, shiftDate, emptyState, type ReportState, type DailySnap } from '../pipeline/reports.ts'
import { main } from '../pipeline/reports.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-11-15T08:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const snap = (over: Partial<DailySnap> = {}): DailySnap => ({
  date: '2026-11-15', newPlugins: 2, upgrades: 1, total: 100,
  pendingReview: 7, deprecated: 3, awaitingRelease: 12,
  byType: { server: 40, tui: 20, gui: 10, rpc: 5 }, npmDownloads: 12345, ...over,
})

describe('computeDaily', () => {
  it('counts new-by-firstSeenAt, upgrades-by-version-diff, type buckets, npm names', async () => {
    const state = emptyState()
    const plugins = [
      e({ name: 'new1', firstSeenAt: '2026-11-15T01:00:00Z', features: ['server', 'tui'] }),
      e({ name: 'new2', firstSeenAt: '2026-11-15T02:00:00Z', source: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'abc' }, latestVersion: null, features: ['gui'] }),
      e({ name: 'old1', firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '2.0.0' }),
      e({ name: 'gh1', firstSeenAt: '2026-01-01T00:00:00Z', source: { kind: 'github', id: 'o/g', repo: 'o/g', version: 'pin1' }, latestVersion: null }),
    ]
    // seed first (baseline: no upgrades counted)
    const seed = await computeDaily(idx(plugins), '2026-11-14', state, async () => 0)
    expect(seed.snap.upgrades).toBe(0)
    expect(seed.state.seeded).toBe(true)
    // next day: old1 bumped 1.0.0→2.0.0? seed recorded 2.0.0 already — simulate bump by re-seeding at 1.0.0
    const st2: ReportState = { ...seed.state, versions: { ...seed.state.versions, old1: '1.0.0' } }
    const r = await computeDaily(idx(plugins), '2026-11-15', st2, async names => {
      expect(names).toContain('pkg')         // npm entries only (pkg covers new1+old1)
      expect(names).not.toContain('o/r')     // github excluded
      return 777
    })
    expect(r.snap.newPlugins).toBe(2)         // new1+new2 firstSeen today
    expect(r.snap.upgrades).toBe(1)           // old1 1.0.0→2.0.0
    expect(r.snap.total).toBe(4)
    expect(r.snap.byType).toEqual({ server: 1, tui: 1, gui: 1, rpc: 0 })
    expect(r.snap.npmDownloads).toBe(777)
    expect(r.state.dailies.map(d => d.date)).toEqual(['2026-11-14', '2026-11-15'])
  })
  it('re-running same date replaces the snapshot (idempotent)', async () => {
    const s = emptyState()
    const p = [e()]
    const r1 = await computeDaily(idx(p), '2026-11-15', s, async () => 1)
    const r2 = await computeDaily(idx([...p, e({ name: 'x' })]), '2026-11-15', r1.state, async () => 2)
    expect(r2.state.dailies).toHaveLength(1)
    expect(r2.state.dailies[0]!.total).toBe(2)
    expect(r2.snap.npmDownloads).toBe(2)
  })
  it('download failure stays null — never rendered as zero', async () => {
    const r = await computeDaily(idx([e()]), '2026-11-15', emptyState(), async () => null)
    expect(r.snap.npmDownloads).toBeNull()
    expect(dailyBody(r.snap, r.state)).toContain('获取失败')
    expect(dailyBody(r.snap, r.state)).toContain('不等于 0')
  })
})

describe('report bodies', () => {
  it('daily shows today + trailing 7-day table + totals', () => {
    const state: ReportState = { versions: {}, seeded: true, dailies: [
      snap({ date: '2026-11-09', newPlugins: 1, upgrades: 0, total: 90, npmDownloads: 100 }),
      snap({ date: '2026-11-15' }),
    ] }
    const body = dailyBody(snap(), state, 'o/r')
    expect(body).toContain('# 插件市场日报 — 2026-11-15')
    expect(body).toContain('新增插件：[2](')            // today new — linked to site
    expect(body).toContain('2026-11-09')                  // inside 7d window
    expect(body).toContain('12,345')
    expect(body).toContain('label%3Areview%3Apending')   // queue stats link to issue lists
    expect(body).toContain('等待审核')
    expect(body).not.toContain('2026-11-08')              // outside window
  })
  it('monthly aggregates the month and says when data is partial', () => {
    const state: ReportState = { versions: {}, seeded: true, dailies: [
      snap({ date: '2026-11-01', newPlugins: 5, upgrades: 2, total: 80, npmDownloads: 1000 }),
      snap({ date: '2026-11-15', newPlugins: 3, upgrades: 1, total: 100, npmDownloads: null }),
      snap({ date: '2026-10-31', newPlugins: 9, total: 70 }),   // other month — excluded
    ] }
    const body = monthlyBody('2026-11', state)
    expect(body).toContain('覆盖天数：**2**'.replace('**2**', '2'))
    expect(body).toContain('本月新增合计：**8**')
    expect(body).toContain('本月升级合计：**3**')
    expect(body).toContain('下限')                          // null-download day disclosed
    expect(body).not.toContain('2026-10-31')
  })
  it('yearly covers the year', () => {
    const state: ReportState = { versions: {}, seeded: true, dailies: [
      snap({ date: '2026-01-05', newPlugins: 4, total: 50 }),
      snap({ date: '2026-11-15', newPlugins: 2, total: 100 }),
      snap({ date: '2025-12-31', newPlugins: 7, total: 40 }),
    ] }
    const body = yearlyBody('2026', state)
    expect(body).toContain('覆盖天数：2')
    expect(body).toContain('全年新增合计：**6**')
    expect(body).not.toContain('2025-12-31')
  })
  it('shiftDate handles month/year boundaries', () => {
    expect(shiftDate('2026-11-15', -6)).toBe('2026-11-09')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('loadState / main', () => {
  it('loadState tolerates missing and corrupt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'))
    expect(loadState(join(dir, 'none.json'))).toEqual(emptyState())
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{oops')
    expect(loadState(bad)).toEqual(emptyState())
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ versions: { a: '1' }, seeded: true, dailies: [snap()] }))
    expect(loadState(good).dailies).toHaveLength(1)
  })
  it('main writes daily+monthly+yearly+state (dry prints only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-m-'))
    const idxPath = join(dir, 'i.json'), stPath = join(dir, 'state.json'), out = join(dir, 'out')
    writeFileSync(idxPath, JSON.stringify(idx([e({ name: 'a', firstSeenAt: '2026-01-01T00:00:00Z' }), e({ name: 'b', firstSeenAt: '2026-11-15T00:00:00Z' })])))
    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => logs.push(a.join(' '))
    try {
      await main(['x', '--index', idxPath, '--state', stPath, '--out', out, '--date', '2026-11-15', '--dry'],
        { downloadsFn: async () => 42 })
    } finally { console.log = orig }
    expect(logs.join('\n')).toContain('daily/2026-11-15.md')
    expect(logs.join('\n')).toContain('monthly/2026-11.md')
    expect(logs.join('\n')).toContain('yearly/2026.md')
    expect(existsSync(join(out, 'daily', '2026-11-15.md'))).toBe(false)   // dry wrote nothing
    await main(['x', '--index', idxPath, '--state', stPath, '--out', out, '--date', '2026-11-15'],
      { downloadsFn: async () => 42 })
    const daily = readFileSync(join(out, 'daily', '2026-11-15.md'), 'utf8')
    expect(daily).toContain('新增插件：1')
    expect(daily).toContain('插件总数：2')
    const state = JSON.parse(readFileSync(stPath, 'utf8')) as ReportState
    expect(state.seeded).toBe(true)
    expect(state.dailies[0]!.npmDownloads).toBe(42)
    expect(existsSync(join(out, 'monthly', '2026-11.md'))).toBe(true)
    expect(existsSync(join(out, 'yearly', '2026.md'))).toBe(true)
  })
})
