/** audit-docket-r13 — issue #6270 "前言不搭后语" regressions:
 *  1. 红旗清单 flat-mixed the trigger signal (sec:repo-moved) with standing
 *     scan flags — "3 doc commits" sat next to "6 red flags" and the reader
 *     couldn't tell which the delta introduced. Now: two provenance groups.
 *  2. "验证状态：还没验" on an APPROVED entry read as a contradiction — the
 *     status describes the drifted pin's bytes, not the released entry's.
 *     Now: scoped "当前钉版 <sha>" + integrity-vs-pin mismatch callout.
 *  3. Nothing answered "did the delta touch the flagged files" — the one
 *     question a repo-moved flag actually asks. Now: flag-file ∩
 *     compare-file line, with truncation honesty. */
import { describe, it, expect } from 'vitest'
import { issueBody, docketTargets, type DocketTarget, type CompareInfo } from '../pipeline/docket.ts'
import type { FlagAssessment } from '../pipeline/ai/flag-delta.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const flagT = (over: Partial<DocketTarget> = {}): DocketTarget => ({
  name: 'mnema-work/mnema', version: null, verdict: 'flag',
  reason: 'sec:repo-moved-since-release:b26623dca283',
  verification: 'unverified',
  flagDelta: { repo: 'mnema-work/mnema', oldSha: 'fd62115d7585', newSha: 'b26623dca283677529ccce6b2c9bfd45e6adf95e' },
  integrity: 'b26623dca283677529ccce6b2c9bfd45e6adf95e',
  flaggedAt: '2026-11-16T16:25:43Z',
  humanVerdict: { name: 'mnema-work/mnema', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', reason: '钉版字节逐旗深检均为良性' },
  redFlags: 6,
  redFlagList: [
    'binary-blob:packages/chain/conformance/vectors/jsontestsuite/test_parsing/i_string_utf16BE_no_BOM.json',
    'credential-read:packages/chain/src/chain/key-protection.ts — L35: * passphrase into the shell',
    'sec:repo-moved-since-release:b26623dca283',
  ],
  ...over,
})

const cmp = (files: CompareInfo['files'], over: Partial<CompareInfo> = {}): CompareInfo => ({
  url: 'https://github.com/mnema-work/mnema/compare/fd62115d...b26623dca283',
  filesUrl: 'https://github.com/mnema-work/mnema/compare/fd62115d...b26623dca283/files',
  aheadBy: 3, commitsTotal: 3, commits: [], filesTotal: files.length,
  additions: 1301, deletions: 117, files, riskyCount: 0, truncated: false,
  ...over,
})

describe('issueBody — flag target provenance split (#6270)', () => {
  it('splits identity trigger signals from standing scan flags', () => {
    const body = issueBody(flagT())
    expect(body).toContain('两类来源')
    expect(body).toContain('身份/触发信号（1 条')
    expect(body).toContain('存量扫描旗标（2 条')
    expect(body).toContain('非本次触发信号')
    // trigger group must render the moved flag; scan group the file hits
    expect(body).toContain('sec:repo-moved-since-release:b26623dca283')
    expect(body).toContain('binary-blob:packages/chain')
  })
  it('single-provenance lists keep the flat rendering', () => {
    const body = issueBody(flagT({ redFlagList: ['sec:repo-moved-since-release:b26623dca283'] }))
    expect(body).toContain('红旗清单（1 条）')
    expect(body).not.toContain('两类来源')
  })
})

describe('issueBody — flag target verification names the measured bytes', () => {
  it('scopes the status to the current pin and notes auto-refresh', () => {
    const body = issueBody(flagT())
    expect(body).toContain('验证状态（当前钉版 `b26623dca2…`）：还没验（unverified）')
    expect(body).toContain('verify 班按新 HEAD 跑')
  })
  it('calls out when verification covered a DIFFERENT (older) pin', () => {
    const body = issueBody(flagT({ verification: 'verified', integrity: 'aaaabbbbccccdddd' }))
    expect(body).toContain('装测覆盖的是 aaaabbbbcc…，非当前钉版')
  })
  it('non-flag targets keep the plain line', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', verification: 'verified' })
    expect(body).toContain('- 验证状态：已实测可装可用（verified）')
    expect(body).not.toContain('当前钉版')
  })
})

describe('issueBody — concern target with an LLM-pass reason', () => {
  it('mechanical block over an LLM pass does NOT also claim "AI concern 已拦截"', () => {
    const body = issueBody({
      name: 'opencode-posh', version: '1.2.2', verdict: 'concern',
      reason: 'L0.5 命中注入信号（score 0.783）；LLM 判 pass：透明集成POSH文档',
      verification: 'verified',
    })
    expect(body).toContain('AI 判词本体为 pass')
    expect(body).not.toContain('AI concern 已拦截放行')
  })
  it('a real AI concern keeps the held line', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'concern', reason: 'LLM 判 concern：凭据外泄' })
    expect(body).toContain('AI concern 已拦截放行')
  })
})

describe('issueBody — delta ∩ flagged files', () => {
  it('delta not touching flagged files renders the all-clear line', () => {
    const body = issueBody(flagT(), {
      compare: cmp([
        { path: 'docs/ADR-479.md', status: 'added', add: 10, del: 0, risky: false },
        { path: 'README.md', status: 'modified', add: 1, del: 1, risky: false },
      ]),
    })
    expect(body).toContain('本次 delta 未触及已 flag 文件（2 个')
    expect(body).toContain('被标记的代码未变')
  })
  it('delta touching a flagged file escalates it', () => {
    const body = issueBody(flagT(), {
      compare: cmp([
        { path: 'packages/chain/src/chain/key-protection.ts', status: 'modified', add: 5, del: 2, risky: false },
      ]),
    })
    expect(body).toContain('本次 delta 触及 1 个已 flag 文件')
    expect(body).toContain('key-protection.ts')
  })
  it('truncated compare scopes the all-clear honestly', () => {
    const body = issueBody(flagT(), { compare: cmp([], { truncated: true }) })
    expect(body).toContain('compare 截断，仅核对前 0 个文件')
  })
})

// ---------- auto-resolve: provably-inert drift retires the flag ----------

const ghFlagEntry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['github-topic'],
  source: { kind: 'github', id: 'pkg', repo: 'o/pkg', version: 'bbb2222' },
  description: { en: 'x' }, category: [], license: null, deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: null, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:bbb2222'], flaggedAt: '2026-01-02T00:00:00Z' },
  verification: { status: 'verified' }, compat: {}, approval: 'approved',
  ...over,
})
const ghIdx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const aMap = (a: Partial<FlagAssessment>): Map<string, FlagAssessment> =>
  new Map([['pkg\0sec:repo-moved-since-release:bbb2222', a as FlagAssessment]])

describe('docketTargets — autoResolved trivial drift', () => {
  it('retires the flag without a human slot', () => {
    const t = docketTargets(ghIdx([ghFlagEntry()]), [], null,
      { assessments: aMap({ autoResolved: 'trivial' }) })
    expect(t).toEqual([])
  })
  it('assessment lacking autoResolved does NOT retire — key carries the sha', () => {
    const t = docketTargets(ghIdx([ghFlagEntry()]), [], null,
      { assessments: aMap({ ai: { verdict: 'pass', reasonZh: '', reasonEn: '' } }) })
    expect(t.some(x => x.verdict === 'flag')).toBe(true)
  })
  it('no assessments map → flag surface unchanged', () => {
    expect(docketTargets(ghIdx([ghFlagEntry()]), []).some(x => x.verdict === 'flag')).toBe(true)
  })
})

// ---------- standing-flag presentation ----------

describe('issueBody — standing flags collapse + coverage', () => {
  const manyFlags = flagT({ redFlagList: [
    'sec:repo-moved-since-release:b26623dca283',
    'binary-blob:a/f1.json', 'binary-blob:a/f2.json',
    'credential-read:b/x.ts — L1: read()', 'credential-read:b/y.ts — L2: read()',
  ] })
  it('>3 standing flags collapse to rule counts — no path dump', () => {
    const body = issueBody(manyFlags)
    expect(body).toContain('按规则：binary-blob ×2、credential-read ×2')
    expect(body).toContain('逐条清单见')
    expect(body).not.toContain('a/f1.json')
  })
  it('untouched flagged files + human verdict → 判词覆盖仍有效', () => {
    const body = issueBody(manyFlags, {
      compare: cmp([{ path: 'README.md', status: 'modified', add: 1, del: 0, risky: false }]),
    })
    expect(body).toContain('判词覆盖仍有效')
    expect(body).toContain('按规则：')
  })
  it('≤3 standing flags still list inline', () => {
    const body = issueBody(flagT())
    expect(body).toContain('binary-blob:packages/chain')
    expect(body).not.toContain('按规则：')
  })
})
