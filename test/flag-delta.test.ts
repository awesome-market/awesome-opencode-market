import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyDelta, isRiskyDeltaPath, type DeltaFile } from '../pipeline/delta.ts'
import { issueBody, type CompareInfo } from '../pipeline/docket.ts'
import { main as flagDeltaMain, loadAssessments, latestAssessments, type FlagAssessment } from '../pipeline/ai/flag-delta.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const df = (path: string, over: Partial<DeltaFile> = {}): DeltaFile =>
  ({ path, status: 'modified', add: 10, del: 5, ...over })

describe('classifyDelta / isRiskyDeltaPath', () => {
  it('flags lifecycle/dependency/CI/credential paths as risky', () => {
    for (const p of ['package.json', 'setup.sh', '.github/workflows/ci.yml', 'scripts/postinstall.js',
      '.npmrc', 'config/credentials.json', 'bin/tool', 'dist/bundle.node']) {
      expect(isRiskyDeltaPath(p), p).toBe(true)
    }
    expect(isRiskyDeltaPath('README.md')).toBe(false)
    expect(isRiskyDeltaPath('docs/guide.mdx')).toBe(false)
  })
  it('trivial = every file docs/assets-only AND none risky', () => {
    const cls = classifyDelta([df('README.md'), df('docs/a.md', { add: 3, del: 1 }), df('assets/logo.png')])
    expect(cls.trivial).toBe(true)
    expect(cls.riskyFiles).toEqual([])
  })
  it('any executable or risky file breaks trivial', () => {
    expect(classifyDelta([df('README.md'), df('src/index.ts')]).trivial).toBe(false)
    expect(classifyDelta([df('CHANGELOG.md'), df('.github/workflows/release.yml')]).trivial).toBe(false)
    expect(classifyDelta([df('README.md'), df('package.json')]).trivial).toBe(false)
  })
  it('riskyFiles lists risky paths, deduped by path', () => {
    const cls = classifyDelta([df('package.json'), df('.github/workflows/a.yml'), df('src/x.ts')])
    expect(cls.riskyFiles.sort()).toEqual(['.github/workflows/a.yml', 'package.json'])
  })
})

const cmpInfo = (over: Partial<CompareInfo> = {}): CompareInfo => ({
  url: 'https://github.com/o/r/compare/aaa...bbb',
  filesUrl: 'https://github.com/o/r/compare/aaa...bbb/files',
  aheadBy: 3, commitsTotal: 3,
  commits: [{ sha: 'abc1234', msg: 'bump version to 1.2.0' }, { sha: 'def5678', msg: 'fix: handle empty config <script>' }],
  filesTotal: 2, additions: 40, deletions: 10,
  files: [
    { path: 'package.json', status: 'modified', add: 5, del: 2, risky: true },
    { path: 'README.md', status: 'modified', add: 35, del: 8, risky: false },
  ],
  riskyCount: 1, truncated: false,
  ...over,
})

const flagTarget = (over: Record<string, unknown> = {}) => ({
  name: 'o/plugin', version: null, verdict: 'flag' as const,
  reason: 'sec:repo-moved-since-release:bbb2222cccc',
  verification: 'skipped',
  redFlagList: ['sec:repo-moved-since-release:bbb2222cccc'],
  sitePage: true, flaggedAt: '2026-11-15T00:00:00Z',
  flagDelta: { repo: 'o/plugin', oldSha: 'aaa1111', newSha: 'bbb2222cccc3333' },
  ...over,
})

const assess = (over: Partial<FlagAssessment> = {}): FlagAssessment => ({
  name: 'o/plugin', flag: 'sec:repo-moved-since-release:bbb2222cccc', repo: 'o/plugin',
  oldSha: 'aaa1111', newSha: 'bbb2222cccc3333', at: '2026-11-16T00:00:00Z',
  aheadBy: 3, filesChanged: 2, commitsTotal: 3, additions: 40, deletions: 10,
  commits: [{ sha: 'abc1234', msg: 'bump version' }],
  files: [
    { path: 'package.json', status: 'modified', add: 5, del: 2, risky: true },
    { path: 'README.md', status: 'modified', add: 35, del: 8, risky: false },
  ],
  riskyFiles: ['package.json'], trivial: false, truncated: false,
  ai: { verdict: 'pass', reasonZh: '仅版本号与文档更新，无可疑变更', reasonEn: 'version bump + docs only' },
  ...over,
})

describe('issueBody — compare evidence', () => {
  it('renders commits, risky files, stats and compare links', () => {
    const body = issueBody(flagTarget(), { compare: cmpInfo() })
    expect(body).toContain('### 🔍 这次变了什么')
    expect(body).toContain('**3 commits** · 2 files · +40/-10')
    expect(body).toContain('⚠️ 风险文件 1 个：`package.json`')
    expect(body).toContain('bump version to 1.2.0')
    expect(body).toContain('https://github.com/o/r/compare/aaa...bbb/files')
  })
  it('escapes markdown/HTML in commit messages and paths', () => {
    const body = issueBody(flagTarget(), { compare: cmpInfo({
      commits: [{ sha: 'x', msg: 'fix <img src=x onerror=alert(1)> **bold**' }],
    }) })
    expect(body).not.toContain('<img')
    expect(body).toContain('&lt;img')
  })
  it('falls back to a manual compare link when fetch failed but shas exist', () => {
    const body = issueBody(flagTarget(), { compare: null })
    expect(body).toContain('compare 取数失败')
    expect(body).toContain('https://github.com/o/plugin/compare/aaa1111...bbb2222cccc3333')
    expect(body).not.toContain('这次变了什么')
  })
  it('no compare and no sha pair → flag-name-only (legacy behavior)', () => {
    const body = issueBody({ name: 'o/p', version: null, verdict: 'flag', reason: 'sec:x', redFlagList: ['sec:x'] }, {})
    expect(body).not.toContain('这次变了什么')
    expect(body).not.toContain('compare 取数失败')
  })
  it('truncated compare payload is disclosed', () => {
    const body = issueBody(flagTarget(), { compare: cmpInfo({ truncated: true }) })
    expect(body).toContain('列表已截断')
  })
})

describe('issueBody — AI 初筛 assessment', () => {
  const map = new Map<string, FlagAssessment>([
    ['o/plugin\0sec:repo-moved-since-release:bbb2222cccc', assess()],
  ])
  it('renders ai verdict + reasons + next action', () => {
    const body = issueBody(flagTarget(), { assessments: map })
    expect(body).toContain('### 🤖 AI 初筛')
    expect(body).toContain('**pass**')
    expect(body).toContain('仅版本号与文档更新')
    expect(body).toContain('advisory 不构成放行依据')
    expect(body).toContain('verdict:pass` / `verdict:concern')
  })
  it('concern assessment states concrete reason and next step', () => {
    const m = new Map([['o/plugin\0sec:repo-moved-since-release:bbb2222cccc',
      assess({ ai: { verdict: 'concern', reasonZh: '新增 postinstall 下载远程脚本', reasonEn: 'new postinstall fetches remote script' } })]])
    const body = issueBody(flagTarget(), { assessments: m })
    expect(body).toContain('**concern**')
    expect(body).toContain('新增 postinstall')
    expect(body).toContain('verdict:concern` 下架回炉')
  })
  it('ai:null renders rules+stats with retry note and coverage warning', () => {
    const m = new Map([['o/plugin\0sec:repo-moved-since-release:bbb2222cccc',
      assess({ ai: null, aiNote: 'judge-unavailable', truncated: true,
        files: [{ path: 'big.bin', status: 'added', add: 999, del: 0, risky: true, patchOmitted: true }] })]])
    const body = issueBody(flagTarget(), { assessments: m })
    expect(body).toContain('AI 判词暂缺')
    expect(body).toContain('下轮自动重试')
    expect(body).toContain('这不等于安全')
    expect(body).toContain('compare 数据截断: 是')
  })
  it('assessment for a DIFFERENT flag does not render', () => {
    const m = new Map([['o/plugin\0sec:repo-moved-since-release:other999', assess()]])
    const body = issueBody(flagTarget(), { assessments: m })
    expect(body).not.toContain('AI 初筛')
  })
})

// ---------- flag-delta main ----------

const ghEntry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'o/plugin', slug: 'o/plugin', aliases: [], type: 'plugin', discoveredVia: ['github-topic'],
  source: { kind: 'github', id: 'o/plugin', repo: 'o/plugin', version: 'newsha999888777' },
  description: { en: 'a plugin' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: null, publishedAt: null,
  metrics: { stars: 42, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:newsha999888777'], flaggedAt: '2026-11-15T00:00:00Z' },
  verification: { status: 'skipped' }, compat: {},
  approval: 'approved',
  ...over,
})
const idxJson = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const humanPass = { name: 'o/plugin', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'oldsha111222333' }

const cmpFixture = {
  ahead_by: 2, total_commits: 2,
  commits: [
    { sha: 'c1', commit: { message: 'bump version\n\nbody' } },
    { sha: 'c2', commit: { message: 'docs: update readme' } },
  ],
  files: [
    { filename: 'package.json', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-"version":"1.0.0"\n+"version":"1.0.1"' },
    { filename: 'README.md', status: 'modified', additions: 10, deletions: 2, patch: '@@ docs' },
  ],
}

function setup(plugins: PluginEntry[], verdicts: object[] = [humanPass], assessLines: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'flagdelta-'))
  const idx = join(dir, 'index.json'), vd = join(dir, 'verdicts.jsonl')
  const ad = join(dir, 'assess.jsonl'), spool = join(dir, 'spool.jsonl')
  writeFileSync(idx, JSON.stringify(idxJson(plugins)))
  writeFileSync(vd, verdicts.map(v => JSON.stringify(v)).join('\n') + '\n')
  writeFileSync(ad, assessLines.join('\n') + (assessLines.length ? '\n' : ''))
  return { dir, idx, vd, ad, spool }
}
const args = (s: ReturnType<typeof setup>) =>
  ['--index', s.idx, '--verdicts', s.vd, '--assessments', s.ad, '--spool', s.spool]

describe('flag-delta main', () => {
  it('assesses a drifted live entry and appends to spool', async () => {
    const s = setup([ghEntry()])
    const judged: string[] = []
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => ({ aheadBy: 2, commitsTotal: 2, filesTotal: 2, additions: 13, deletions: 3,
        commits: [{ sha: 'c1', msg: 'bump version' }], files: [
          { path: 'package.json', status: 'modified', add: 3, del: 1, patch: '@@ v' },
          { path: 'README.md', status: 'modified', add: 10, del: 2, patch: '@@ d' },
        ], truncated: false }),
      judge: async m => { judged.push(m.patches); return { verdict: 'pass', reasonZh: '仅版本与文档', reasonEn: 'version+docs' } },
    })
    expect(judged).toHaveLength(1)
    expect(judged[0]).toContain('package.json')
    const lines = readFileSync(s.spool, 'utf8').trim().split('\n').map(l => JSON.parse(l) as FlagAssessment)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.ai?.verdict).toBe('pass')
    expect(lines[0]!.riskyFiles).toEqual(['package.json'])
    expect(lines[0]!.flag).toBe('sec:repo-moved-since-release:newsha999888777')
  })
  it('skips already-assessed flags (ai!=null) but retries ai:null lines', async () => {
    const done = assess({ flag: 'sec:repo-moved-since-release:newsha999888777', newSha: 'newsha999888777' })
    const pending = assess({ flag: 'sec:repo-moved-since-release:newsha999888777', newSha: 'newsha999888777',
      ai: null, aiNote: 'judge-unavailable', at: '2026-11-16T01:00:00Z' })
    const s = setup([ghEntry()], [humanPass], [JSON.stringify(done), JSON.stringify(pending)])
    let calls = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => null,   // would fail anyway — proves selection skipped 'done'
      judge: async () => { calls++; return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    // 'done' (ai!=null) suppressed; 'pending' (ai:null) re-queued → compareFn null → no spool write, no judge call
    expect(calls).toBe(0)
    expect(existsSync(s.spool) ? readFileSync(s.spool, 'utf8') : '').toBe('')
  })
  it('excludes pending entries, non-github sources, and sha-matched pins', async () => {
    const s = setup([
      ghEntry({ name: 'o/pending', approval: 'pending' }),
      ghEntry({ name: 'o/npmish', source: { kind: 'npm', id: 'npmish' } }),
      ghEntry({ name: 'o/same', source: { kind: 'github', id: 'o/same', repo: 'o/same', version: 'oldsha111222333' } }),
    ], [humanPass,
      { name: 'o/pending', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'oldsha111222333' },
      { name: 'o/npmish', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'x' },
      { name: 'o/same', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'oldsha111222333' },
    ])
    let compares = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => { compares++; return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(compares).toBe(0)
  })
  it('--dry prints without writing the spool', async () => {
    const s = setup([ghEntry()])
    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
    try {
      await flagDeltaMain([...args(s), '--limit', '5', '--dry'], {
        compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
          commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }),
        judge: async () => ({ verdict: 'pass', reasonZh: 'ok', reasonEn: 'ok' }),
      })
    } finally { console.log = orig }
    expect(logs.some(l => l.includes('"name":"o/plugin"'))).toBe(true)
    expect(existsSync(s.spool)).toBe(false)
  })
  it('judge failure records ai:null + note (retried next run)', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
        commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0 }], truncated: false }),
      judge: async () => { throw new Error('omlx 500') },
    })
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai).toBeNull()
    expect(a.aiNote).toContain('judge-error')
  })
})

describe('loadAssessments / latestAssessments', () => {
  it('tolerates malformed lines and missing file', () => {
    expect(loadAssessments(undefined)).toEqual([])
    expect(loadAssessments('/nonexistent/x.jsonl')).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'fa-'))
    const p = join(dir, 'a.jsonl')
    writeFileSync(p, '{"bad"\n' + JSON.stringify(assess()) + '\n')
    expect(loadAssessments(p)).toHaveLength(1)
  })
  it('latest by at wins per name+flag key', () => {
    const old = assess({ at: '2026-11-15T00:00:00Z', ai: { verdict: 'concern', reasonZh: 'old', reasonEn: 'old' } })
    const nw = assess({ at: '2026-11-16T00:00:00Z' })
    const m = latestAssessments([old, nw])
    expect(m.get('o/plugin\0sec:repo-moved-since-release:bbb2222cccc')!.ai!.verdict).toBe('pass')
  })
})
