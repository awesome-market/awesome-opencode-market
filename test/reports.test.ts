import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeDaily, dailyBody, monthlyBody, yearlyBody, loadState, shiftDate, emptyState, verifyFailRows, deadPassRows, verifyFailBody, verifyFailIssueBody, type ReportState, type DailySnap } from '../pipeline/reports.ts'
import { main } from '../pipeline/reports.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import type { DocketTarget } from '../pipeline/docket.ts'

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

describe('fetchNpmDownloads', () => {
  const withFetch = async (impl: (...a: unknown[]) => Promise<unknown>, fn: () => Promise<void>) => {
    const orig = globalThis.fetch
    globalThis.fetch = impl as typeof fetch
    try { await fn() } finally { globalThis.fetch = orig }
  }
  const resp = (body: unknown, ok = true) => ({
    ok, status: ok ? 200 : 500, headers: { get: () => null }, body: undefined, json: async () => body,
  })
  it('sums downloads across names; skips failures; null when all fail', async () => {
    const { fetchNpmDownloads } = await import('../pipeline/reports.ts')
    await withFetch(async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('/bad')) return resp({}, false)
      if (u.endsWith('/junk')) return resp({ downloads: 'x' })
      return resp({ downloads: u.endsWith('/a') ? 10 : 20 })
    }, async () => {
      expect(await fetchNpmDownloads(['a', 'b'])).toBe(30)
      expect(await fetchNpmDownloads(['bad', 'junk'])).toBeNull()   // zero ok → null
      expect(await fetchNpmDownloads(['a', 'bad'])).toBe(10)        // partial still sums
      expect(await fetchNpmDownloads([])).toBe(0)
    })
  })
})

describe('computeDaily — review inputs', () => {
  it('awaitingRelease counts docket pass targets when verdicts provided', async () => {
    const verdicts = [{ name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'ai' }]
    const r = await computeDaily(idx([e({ approval: 'pending' })]), '2026-11-15', emptyState(), async () => 0,
      { verdicts: verdicts as never, digest: null })
    expect(r.snap.awaitingRelease).toBe(1)
    expect(r.snap.pendingReview).toBe(1)
    const noReview = await computeDaily(idx([e()]), '2026-11-15', emptyState(), async () => 0)
    expect(noReview.snap.awaitingRelease).toBeNull()
  })
})

describe('main — verdicts/digest inputs', () => {
  it('loads verdicts+digest and renders linked queue stats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-v-'))
    const idxPath = join(dir, 'i.json'), stPath = join(dir, 'state.json'), out = join(dir, 'out')
    const vPath = join(dir, 'v.jsonl'), dPath = join(dir, 'd.json')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'pending' })])))
    writeFileSync(vPath, JSON.stringify({ name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'ai' }) + '\n')
    writeFileSync(dPath, JSON.stringify({ lastDigestAt: '2026-11-14T00:00:00Z', announced: [], dayAnnounced: [] }))
    await main(['x', '--index', idxPath, '--state', stPath, '--out', out, '--date', '2026-11-15',
      '--verdicts', vPath, '--digest-state', dPath, '--repo', 'o/r'],
      { downloadsFn: async () => 5 })
    const daily = readFileSync(join(out, 'daily', '2026-11-15.md'), 'utf8')
    expect(daily).toContain('label%3Aai%3Apass')
    expect(daily).toContain('label%3Areview%3Apending')
    const state = JSON.parse(readFileSync(stPath, 'utf8')) as ReportState
    expect(state.dailies[0]!.awaitingRelease).toBe(1)
  })
})

describe('edge coverage — schema/null tolerance', () => {
  it('verOf falls back through null latestVersion and missing pins', async () => {
    const plugins = [
      e({ name: 'npmbad', latestVersion: null }),                                          // npm, no version → ''
      e({ name: 'ghnov', latestVersion: null, source: { kind: 'github', id: 'o/g', repo: 'o/g' } as never }), // github, no pin → ''
      e({ name: 'nulldate', firstSeenAt: null as never }),                                          // null firstSeenAt
      e({ name: 'dep', deprecated: true }),
      e({ name: 'nofeat', features: undefined }),
      e({ name: 'weirdfeat', features: ['cli'] as never }),
    ]
    const r = await computeDaily(idx(plugins), '2026-11-15', emptyState())   // no downloadsFn → null
    expect(r.snap.npmDownloads).toBeNull()
    expect(r.snap.deprecated).toBe(1)
    expect(r.snap.byType).toEqual({ server: 0, tui: 0, gui: 0, rpc: 0 })
    expect(r.state.versions.npmbad).toBe('')
    expect(r.state.versions.ghnov).toBe('')
  })
  it('loadState tolerates partial/mistyped fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-p-'))
    const p = join(dir, 's.json')
    writeFileSync(p, JSON.stringify({ seeded: true, dailies: 'nope', versions: null }))
    const s = loadState(p)
    expect(s.dailies).toEqual([])
    expect(s.versions).toEqual({})
    expect(s.seeded).toBe(true)
  })
  it('empty periods render 暂无数据 and —, never crash', () => {
    const state: ReportState = { versions: {}, seeded: true, dailies: [] }
    const daily = dailyBody(snap(), state)                       // no repo → plain stats
    expect(daily).toContain('_暂无数据_')
    expect(daily).toContain('自 2026-11-15 起 0 天')
    expect(monthlyBody('2020-01', state)).toContain('_暂无数据_')
    expect(monthlyBody('2020-01', state)).toContain('期末总数：**—**')
    expect(monthlyBody('2020-01', state)).not.toContain('获取失败')
    expect(yearlyBody('2020', state)).toContain('_暂无数据_')
    expect(yearlyBody('2020', state)).toContain('期末总数：**—**')
    expect(yearlyBody('2020', state)).not.toContain('获取失败')
    // yearly with a null-download day → 下限 disclosure + ?? 0 arm
    const ystate: ReportState = { versions: {}, seeded: true, dailies: [
      snap({ date: '2026-06-01', npmDownloads: null }),
      snap({ date: '2026-11-15', npmDownloads: 10 }),
    ] }
    const y = yearlyBody('2026', ystate)
    expect(y).toContain('下限')
    expect(y).toContain('）：**10**')
  })
})

describe('fetchNpmDownloads — failure modes', () => {
  it('fetch throw and non-finite downloads count as failures', async () => {
    const { fetchNpmDownloads } = await import('../pipeline/reports.ts')
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.endsWith('/boom')) throw new Error('net down')
      if (u.endsWith('/inf')) return { ok: true, status: 200, headers: { get: () => null }, body: undefined, json: async () => ({ downloads: 1e999 }) }
      return { ok: true, status: 200, headers: { get: () => null }, body: undefined, json: async () => ({ downloads: 5 }) }
    }) as unknown as typeof fetch
    try {
      expect(await fetchNpmDownloads(['boom', 'inf'])).toBeNull()   // throw + non-finite → all fail
      expect(await fetchNpmDownloads(['ok', 'boom'])).toBe(5)
    } finally { globalThis.fetch = orig }
  })
})

describe('main — arg defaults and env repo', () => {
  it('defaults --date to today; --repo falls back to GH_REPO env; github-only index needs no downloadsFn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-e-'))
    const idxPath = join(dir, 'i.json'), stPath = join(dir, 'state.json'), out = join(dir, 'out')
    writeFileSync(idxPath, JSON.stringify(idx([
      e({ name: 'gh', source: { kind: 'github', id: 'o/g', repo: 'o/g', version: 'v1' }, latestVersion: null }),
    ])))
    const origRepo = process.env.GH_REPO
    process.env.GH_REPO = 'envowner/envrepo'
    try {
      await main(['x', '--index', idxPath, '--state', stPath, '--out', out], {})   // no --date, no downloadsFn
    } finally { if (origRepo === undefined) delete process.env.GH_REPO; else process.env.GH_REPO = origRepo }
    const today = new Date().toISOString().slice(0, 10)
    const daily = readFileSync(join(out, 'daily', `${today}.md`), 'utf8')
    expect(daily).toContain('envowner.github.io/envrepo')      // env repo → site links
    const state = JSON.parse(readFileSync(stPath, 'utf8')) as ReportState
    expect(state.dailies[0]!.npmDownloads).toBe(0)             // no npm names → 0, no fetch
  })
  it('verdicts file with some bad lines still runs (bad>0 but non-empty ok)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-b-'))
    const idxPath = join(dir, 'i.json'), stPath = join(dir, 'state.json'), out = join(dir, 'out')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, '{bad json\n' + JSON.stringify({ name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'ai' }) + '\n')
    await main(['x', '--index', idxPath, '--state', stPath, '--out', out, '--date', '2026-11-15',
      '--verdicts', vPath], { downloadsFn: async () => 1 })
    expect(existsSync(join(out, 'daily', '2026-11-15.md'))).toBe(true)
  })
})

describe('verify-fail 日报', () => {
  const t = (name: string, version: string | null, verdict: 'pass'|'concern'|'none'|'flag', reason?: string): DocketTarget =>
    ({ name, version, verdict, ...(reason !== undefined ? { reason } : {}) })

  it('verifyFailRows：只收机械装测失败，解析阶段', () => {
    const rows = verifyFailRows([
      t('a', '1.0', 'concern', '装测失败（verify load 级）：插件模块无法被宿主加载 — LoadError'),
      t('b', '2.0', 'concern', '装测失败（verify install 级）：npm 404'),
      t('c', '1.0', 'concern', 'LLM 判 concern：postinstall 可疑'),   // non-mechanical → out
      t('d', '1.0', 'pass'),
      t('e', null, 'concern'),                                         // no reason → not 装测失败
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.stage)).toEqual(['install', 'load'])        // sorted by stage then name
    expect(rows[0]!.name).toBe('b')
    expect(rows[1]!.summary).toContain('插件模块无法被宿主加载')
  })

  it('deadPassRows：只收 ai:pass+failed，与装测失败 concern 互不混淆', () => {
    const rows = deadPassRows([
      { ...t('a', '1.0', 'pass'), verification: 'failed' },
      { ...t('b', '2.0', 'pass'), verification: 'verified' },           // 真通过 → out
      { ...t('c', '1.0', 'concern', '装测失败（verify load 级）：x'), verification: 'failed' }, // 机械 concern → out
      t('d', '1.0', 'pass'),                                            // 未测 → out
    ])
    expect(rows).toEqual([{ name: 'a', version: '1.0' }])
  })

  it('verifyFailBody 第二区列死单，issue body 计数同步', () => {
    const body = verifyFailBody([{ name: 'a', version: '1.0', stage: 'load', summary: 'x' }],
      '2026-11-16', 'o/r', [{ name: 'dp1', version: '3.0' }, { name: 'dp2', version: null }])
    expect(body).toContain('AI 判过但装不上：**2**')
    expect(body).toContain('| dp1 | 3.0 |')
    const issue = verifyFailIssueBody([], '2026-11-16', 'o/r', [{ name: 'dp1', version: '3.0' }])
    expect(issue).toContain('**1 个 AI 判过但装不上**')
  })

  it('verifyFailBody：阶段计数 + 明细表 + 非安全判定声明', () => {
    const body = verifyFailBody([
      { name: 'a', version: '1.0', stage: 'load', summary: 'x' },
      { name: 'b', version: null, stage: 'load', summary: 'y' },
      { name: 'c', version: '2', stage: 'install', summary: 'z | pipe' },
    ], '2026-11-16', 'o/r')
    expect(body).toContain('**3**')
    expect(body).toContain('**load** 2')
    expect(body).toContain('**install** 1')
    expect(body).toContain('| a | 1.0 | load |')
    expect(body).toContain('z \\| pipe')            // pipes escaped for the table
    expect(body).toContain('不是安全判定')
    expect(body).toContain('concern%3Averify')
  })

  it('verifyFailIssueBody：汇总 + 前20截断 + 日报链接', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, version: '1', stage: 'load', summary: 's' }))
    const body = verifyFailIssueBody(rows, '2026-11-16', 'o/r')
    expect(body).toContain('**当前 25 个装测失败条目**')
    expect(body).toContain('样本（前 20')
    expect(body).toContain('docs/reports/verify-fail.md')
    expect((body.match(/`p\d+`/g) ?? []).length).toBe(20)
  })

  it('main() 生成 verify-fail.md + verify-fail-issue.md（verdicts 驱动）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-vf-'))
    const idxPath = join(dir, 'i.json'), stPath = join(dir, 'state.json'), out = join(dir, 'out')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'pending' })])))
    writeFileSync(vPath, JSON.stringify({
      name: 'pkg', version: '1.0.0', verdict: 'concern', at: '2026-11-15T00:00:00Z', source: 'ai',
      reason: '装测失败（verify load 级）：x',
    }) + '\n')
    await main(['x', '--index', idxPath, '--state', stPath, '--out', out, '--date', '2026-11-15',
      '--verdicts', vPath], { downloadsFn: async () => 1 })
    const vf = readFileSync(join(out, 'verify-fail.md'), 'utf8')
    expect(vf).toContain('装测失败日报 — 2026-11-15')
    expect(vf).toContain('| pkg | 1.0.0 | load |')
    const iss = readFileSync(join(out, 'verify-fail-issue.md'), 'utf8')
    expect(iss).toContain('**当前 1 个装测失败条目**')
  })
})
