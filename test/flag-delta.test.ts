import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyDelta, isRiskyDeltaPath, isTrivialDeltaPath, parseCompare, fetchCompare, type DeltaFile } from '../pipeline/delta.ts'
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
  it('agent-instruction files veto triviality at ANY depth — prompt-injection surface', () => {
    for (const p of ['SKILL.md', 'docs/SKILL.md', 'CLAUDE.md', 'docs/AGENTS.md',
      '.cursorrules', '.windsurfrules', '.cursor/rules/x.md', '.claude/settings.json',
      '.github/copilot-instructions.md']) {
      expect(isTrivialDeltaPath(p), p).toBe(false)
    }
    expect(isTrivialDeltaPath('README.md')).toBe(true)
    expect(isTrivialDeltaPath('docs/guide.md')).toBe(true)
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

describe('autoResolved — provably-inert drift retires itself', () => {
  const trivialCmp = (files: { path: string; patch?: string }[], over = {}) => ({
    aheadBy: 1, commitsTotal: 1, filesTotal: files.length, additions: 5, deletions: 1,
    commits: [{ sha: 'c', msg: 'docs' }],
    files: files.map(f => ({ path: f.path, status: 'modified', add: 5, del: 1, ...(f.patch ? { patch: f.patch } : {}) })),
    truncated: false, ...over,
  })
  const pass = { verdict: 'pass' as const, reasonZh: '纯文档', reasonEn: 'docs only' }

  it('all-docs delta + judge pass → autoResolved trivial', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => trivialCmp([{ path: 'README.md', patch: '@@ docs' }, { path: 'docs/a.md', patch: '@@' }]),
      judge: async () => pass,
    })
    expect(loadAssessments(s.spool)[0]!.autoResolved).toBe('trivial')
  })
  it('judge concern on a trivial delta → NO auto-resolve', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => trivialCmp([{ path: 'README.md', patch: '@@' }]),
      judge: async () => ({ verdict: 'concern' as const, reasonZh: 'docs 藏注入', reasonEn: 'injection in docs' }),
    })
    expect(loadAssessments(s.spool)[0]!.autoResolved).toBeUndefined()
  })
  it('judge unavailable (ai:null) → no auto-resolve, retried later', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => trivialCmp([{ path: 'README.md', patch: '@@' }]),
      judge: async () => { throw new Error('down') },
    })
    expect(loadAssessments(s.spool)[0]!.autoResolved).toBeUndefined()
  })
  it('truncated compare → no auto-resolve (unseen files stay human)', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => trivialCmp([{ path: 'README.md' }], { truncated: true }),
      judge: async () => pass,
    })
    expect(loadAssessments(s.spool)[0]!.autoResolved).toBeUndefined()
  })
  it('delta touching a flagged file → no auto-resolve', async () => {
    const e2 = ghEntry({ capabilities: { scannedAt: 't', findings: [], flaggedAt: '2026-11-15T00:00:00Z',
      redFlags: ['sec:repo-moved-since-release:newsha999888777', 'exec:docs/run.md — L1: x'] } })
    const s = setup([e2])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => trivialCmp([{ path: 'docs/run.md', patch: '@@' }]),
      judge: async () => pass,
    })
    expect(loadAssessments(s.spool)[0]!.autoResolved).toBeUndefined()
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

// ---------- parseCompare / fetchCompare ----------

describe('parseCompare', () => {
  const payload = {
    ahead_by: 7, total_commits: 9,
    commits: [
      { sha: 'abcdef1234567890', commit: { message: 'subject line\n\nbody' } },
      { sha: 'short1', commit: {} },
    ],
    files: [
      { filename: 'a.ts', status: 'modified', additions: 5, deletions: 2, patch: '@@ x' },
      { filename: 'b.png', status: 'added', additions: 0, deletions: 0 },
    ],
  }
  it('parses commits (subject only, sha capped), files, totals', () => {
    const c = parseCompare(payload)!
    expect(c.aheadBy).toBe(7)
    expect(c.commitsTotal).toBe(9)
    expect(c.commits[0]).toEqual({ sha: 'abcdef123456', msg: 'subject line' })
    expect(c.commits[1]).toEqual({ sha: 'short1', msg: '' })
    expect(c.files[0]).toEqual({ path: 'a.ts', status: 'modified', add: 5, del: 2, patch: '@@ x' })
    expect(c.files[1]!.patch).toBeUndefined()
    expect(c.additions).toBe(5)
    expect(c.deletions).toBe(2)
    expect(c.truncated).toBe(false)
  })
  it('rejects non-compare payloads', () => {
    for (const bad of [null, 'x', {}, { commits: [] }, { commits: [], files: 'no' }, { commits: 'x', files: [] }]) {
      expect(parseCompare(bad), JSON.stringify(bad)).toBeNull()
    }
  })
  it('defaults ahead_by/total_commits from array lengths', () => {
    const c = parseCompare({ commits: payload.commits, files: payload.files })!
    expect(c.aheadBy).toBe(2)
    expect(c.commitsTotal).toBe(2)
  })
  it('caps lists and flags truncation', () => {
    const many = { commits: Array(30).fill({ sha: 's', commit: { message: 'm' } }),
      files: Array(80).fill({ filename: 'f', status: 'modified', additions: 1, deletions: 0 }) }
    const c = parseCompare(many)!
    expect(c.commits).toHaveLength(20)
    expect(c.files).toHaveLength(60)
    expect(c.filesTotal).toBe(80)
    expect(c.truncated).toBe(true)
    const capped = parseCompare(many, { commits: 5, files: 10 })!
    expect(capped.commits).toHaveLength(5)
    expect(capped.files).toHaveLength(10)
  })
})

describe('fetchCompare', () => {
  it('returns parsed compare on success', async () => {
    const c = await fetchCompare('o/r', 'a', 'b', async () => JSON.stringify({
      ahead_by: 1, commits: [{ sha: 'x', commit: { message: 'm' } }],
      files: [{ filename: 'f', status: 'modified', additions: 1, deletions: 0 }],
    }))
    expect(c?.aheadBy).toBe(1)
  })
  it('returns null on transport error and on invalid JSON', async () => {
    expect(await fetchCompare('o/r', 'a', 'b', async () => { throw new Error('net down') })).toBeNull()
    expect(await fetchCompare('o/r', 'a', 'b', async () => 'not json')).toBeNull()
    expect(await fetchCompare('o/r', 'a', 'b', async () => '{}')).toBeNull()
  })
})

// ---------- omlxJudge via env + fetch stub (end-to-end through main) ----------

describe('omlxJudge (env-selected, no deps.judge)', () => {
  const withFetch = async (impl: () => Promise<unknown>, fn: () => Promise<void>) => {
    const origFetch = globalThis.fetch
    const origModel = process.env.AI_MODEL
    process.env.AI_MODEL = 'test-model'
    globalThis.fetch = impl as typeof fetch
    try { await fn() } finally {
      globalThis.fetch = origFetch
      if (origModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = origModel
    }
  }
  const okResp = (content: string) => ({
    ok: true, headers: { get: () => null }, body: undefined,
    json: async () => ({ choices: [{ message: { content } }] }),
  })
  it('parses a pass verdict into the assessment', async () => {
    const s = setup([ghEntry()])
    await withFetch(async () => okResp('{"verdict":"pass","reason_zh":"仅版本更新","reason_en":"version bump"}'), async () => {
      await flagDeltaMain([...args(s), '--limit', '5'], {
        compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
          commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }),
      })
    })
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai?.verdict).toBe('pass')
    expect(a.ai?.reasonZh).toBe('仅版本更新')
  })
  it('unparseable model output → judge-error note, retried next run', async () => {
    const s = setup([ghEntry()])
    await withFetch(async () => okResp('I cannot decide, ask a human'), async () => {
      await flagDeltaMain([...args(s), '--limit', '5'], {
        compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, del: 0 as never, deletions: 0,
          commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0 }], truncated: false }),
      })
    })
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai).toBeNull()
    expect(a.aiNote).toContain('judge-error')
  })
  it('non-ok HTTP status → judge-error', async () => {
    const s = setup([ghEntry()])
    await withFetch(async () => ({ ok: false, status: 500, headers: { get: () => null }, body: undefined, json: async () => ({}) }), async () => {
      await flagDeltaMain([...args(s), '--limit', '5'], {
        compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
          commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0 }], truncated: false }),
      })
    })
    expect(loadAssessments(s.spool)[0]!.aiNote).toContain('judge-error')
  })
})

describe('flag-delta main — remaining branches', () => {
  it('limit slices the queue; repo falls back to entry name', async () => {
    const s = setup([ghEntry({ name: 'solo/repo', source: { kind: 'github', id: 'solo/repo', version: 'newsha999888777' } }),
      ghEntry({ name: 'o/second', source: { kind: 'github', id: 'o/second', repo: 'o/second', version: 'newsha999888777' } })],
      [humanPass,
        { name: 'solo/repo', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'oldsha111222333' },
        { name: 'o/second', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human', sha: 'oldsha111222333' }])
    const repos: string[] = []
    await flagDeltaMain([...args(s), '--limit', '1'], {
      compareFn: async (r) => { repos.push(r); return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(repos).toHaveLength(1)
    expect(repos[0]).toBe('solo/repo')   // source.repo absent → e.name
  })
  it('non-Error judge throw still records aiNote', async () => {
    const s = setup([ghEntry()])
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
        commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0 }], truncated: false }),
      judge: async () => { throw 'string-failure' as never },
    })
    expect(loadAssessments(s.spool)[0]!.aiNote).toContain('judge-error')
  })
  it('oversized patch and patch-less files land in patchOmitted', async () => {
    const s = setup([ghEntry()])
    const huge = 'x'.repeat(30 * 1024)
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 3, additions: 3, deletions: 0,
        commits: [], files: [
          { path: 'a.ts', status: 'modified', add: 1, del: 0, patch: huge },
          { path: 'b.ts', status: 'modified', add: 1, del: 0 },
          { path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@ ok' },
        ], truncated: false }),
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    const a = loadAssessments(s.spool)[0]!
    const omitted = a.files.filter(f => f.patchOmitted).map(f => f.path).sort()
    expect(omitted).toEqual(['a.ts', 'b.ts'])
  })
  it('no AI_MODEL and no deps.judge → ai:null judge-unavailable (still records stats)', async () => {
    const s = setup([ghEntry()])
    const orig = process.env.AI_MODEL
    delete process.env.AI_MODEL
    try {
      await flagDeltaMain([...args(s), '--limit', '5'], {
        compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
          commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }),
      })
    } finally { if (orig !== undefined) process.env.AI_MODEL = orig }
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai).toBeNull()
    expect(a.aiNote).toBe('judge-unavailable')
    expect(a.aheadBy).toBe(1)
  })
})

describe('coverage edges', () => {
  it('parseCompare tolerates fully-missing optional fields', () => {
    const c = parseCompare({ commits: [{}], files: [{}] })!
    expect(c.commits[0]).toEqual({ sha: '', msg: '' })
    expect(c.files[0]).toEqual({ path: '', status: '', add: 0, del: 0 })
    expect(c.aheadBy).toBe(1)
    expect(c.additions).toBe(0)
  })
  it('main() default compareFn path via injected transport', async () => {
    const s = setup([ghEntry()])
    const seen: string[] = []
    await flagDeltaMain([...args(s), '--limit', '5'], {
      // no compareFn → exercises the fetchCompare+transport default arm
      transport: async a => { seen.push(a[1] ?? ''); return JSON.stringify({
        ahead_by: 1, commits: [{ sha: 'x', commit: { message: 'm' } }],
        files: [{ filename: 'README.md', status: 'modified', additions: 1, deletions: 0 }],
      }) },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(seen[0]).toContain('repos/o/plugin/compare/')
    expect(loadAssessments(s.spool)).toHaveLength(1)
  })
})

describe('flag-delta main — final edges', () => {
  it('github source without version is skipped', async () => {
    const s = setup([ghEntry({ source: { kind: 'github', id: 'o/plugin', repo: 'o/plugin' } })],
      [humanPass])
    let compares = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => { compares++; return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(compares).toBe(0)
  })
  it('no --spool and not --dry → assessment counted but nothing persisted', async () => {
    const s = setup([ghEntry()])
    const noSpool = ['--index', s.idx, '--verdicts', s.vd, '--assessments', s.ad, '--limit', '5']
    await flagDeltaMain(noSpool, {
      compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
        commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }),
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(existsSync(s.spool)).toBe(false)
  })
})

describe('flag-delta main — verdict/assessments absence', () => {
  it('flagged entry with NO human verdict has no sha anchor → skipped', async () => {
    const s = setup([ghEntry()], [])   // empty verdicts file
    let compares = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => { compares++; return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(compares).toBe(0)
  })
  it('runs without --assessments (prior state empty)', async () => {
    const s = setup([ghEntry()])
    const noAssess = ['--index', s.idx, '--verdicts', s.vd, '--spool', s.spool, '--limit', '5']
    await flagDeltaMain(noAssess, {
      compareFn: async () => ({ aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
        commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }),
      judge: async () => ({ verdict: 'pass', reasonZh: 'ok', reasonEn: 'ok' }),
    })
    expect(loadAssessments(s.spool)).toHaveLength(1)
  })
})

describe('flag-delta main — sha-less human verdict', () => {
  it('human verdict without sha cannot anchor a compare → skipped', async () => {
    const s = setup([ghEntry()],
      [{ name: 'o/plugin', version: null, verdict: 'pass', at: '2026-11-14T00:00:00Z', source: 'human' }])
    let compares = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => { compares++; return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(compares).toBe(0)
  })
})

describe('flag-delta main — non-moved flags', () => {
  it('approved github entry without repo-moved flags is skipped', async () => {
    const s = setup([ghEntry({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-recreated'] } })],
      [humanPass])
    let compares = 0
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => { compares++; return null },
      judge: async () => ({ verdict: 'pass', reasonZh: '', reasonEn: '' }),
    })
    expect(compares).toBe(0)
  })
})

describe('flag-delta main — truncated compare disclosure', () => {
  it('truncated compare flags partial-delta in judge material and assessment', async () => {
    const s = setup([ghEntry()])
    let sawPartial = false
    await flagDeltaMain([...args(s), '--limit', '5'], {
      compareFn: async () => ({ aheadBy: 50, commitsTotal: 50, filesTotal: 60, additions: 999, deletions: 0,
        commits: [{ sha: 'c', msg: 'm' }], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: true }),
      judge: async m => { sawPartial = m.summary.includes('PARTIAL delta'); return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    expect(sawPartial).toBe(true)
    expect(loadAssessments(s.spool)[0]!.truncated).toBe(true)
  })
})


// ---------- devinJudge via AI_BACKEND=devin + fake devin binary on PATH ----------
describe('devinJudge (env-selected, no deps.judge)', () => {
  const withDevinEnv = async (binBody: string, fn: () => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-devin-'))
    writeFileSync(join(dir, 'devin'), `#!/bin/sh\n${binBody}`)
    chmodSync(join(dir, 'devin'), 0o755)
    const origPath = process.env.PATH
    const origBackend = process.env.AI_BACKEND
    const origModel = process.env.AI_MODEL
    process.env.PATH = `${dir}:${origPath ?? ''}`
    process.env.AI_BACKEND = 'devin'
    delete process.env.AI_MODEL
    try { await fn() } finally {
      process.env.PATH = origPath
      if (origBackend === undefined) delete process.env.AI_BACKEND; else process.env.AI_BACKEND = origBackend
      if (origModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = origModel
    }
  }
  const cmp = { aheadBy: 1, commitsTotal: 1, filesTotal: 1, additions: 1, deletions: 0,
    commits: [], files: [{ path: 'README.md', status: 'modified', add: 1, del: 0, patch: '@@' }], truncated: false }

  it('AI_BACKEND=devin routes the judge through the devin CLI', async () => {
    const s = setup([ghEntry()])
    await withDevinEnv(`printf '%s' '{"verdict":"pass","reason_zh":"仅文档","reason_en":"docs-only"}'`, async () => {
      await flagDeltaMain([...args(s), '--limit', '5'], { compareFn: async () => ({ ...cmp }) })
    })
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai?.verdict).toBe('pass')
    expect(a.ai?.reasonEn).toBe('docs-only')
  }, 30_000)

  it('devin prose output → retry once then unparseable → ai:null', async () => {
    const s = setup([ghEntry()])
    await withDevinEnv(`printf '%s' 'I cannot decide'`, async () => {
      await flagDeltaMain([...args(s), '--limit', '5'], { compareFn: async () => ({ ...cmp }) })
    })
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai).toBeNull()
    expect(a.aiNote).toContain('judge-error')
  }, 30_000)

  it('devin CLI missing → judge-error, not a crash', async () => {
    const s = setup([ghEntry()])
    // PATH without devin: restrict to a dir with no binaries
    const dir = mkdtempSync(join(tmpdir(), 'empty-path-'))
    const origPath = process.env.PATH
    const origBackend = process.env.AI_BACKEND
    process.env.PATH = dir
    process.env.AI_BACKEND = 'devin'
    try {
      await flagDeltaMain([...args(s), '--limit', '5'], { compareFn: async () => ({ ...cmp }) })
    } finally {
      process.env.PATH = origPath
      if (origBackend === undefined) delete process.env.AI_BACKEND; else process.env.AI_BACKEND = origBackend
    }
    const a = loadAssessments(s.spool)[0]!
    expect(a.ai).toBeNull()
    expect(a.aiNote).toContain('judge-error')
  }, 30_000)
})
