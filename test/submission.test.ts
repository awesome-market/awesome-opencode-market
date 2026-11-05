import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSubmission, seedLine } from '../pipeline/submission.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { submissionStatuses } from '../pipeline/submission-status.ts'
import { applySeedOutcomes } from '../pipeline/seed-outcome.ts'
import { run } from '../pipeline/run.ts'
import { CatalogIndex } from '../src/schema.ts'

const FORM_BODY = `### npm package name / npm 包名

opencode-foo

### GitHub repository / GitHub 仓库地址

https://github.com/o/foo

### Description (English) / 英文描述

Does the thing.

### Other languages (optional) / 其他语言描述

zh: 做那件事
ja: それをやる

### Type / 类型

skill

### Categories (multi-select) / 分类可多选

- [x] 模型与接入 (Models & providers)
- [ ] 主题与外观 (Themes & UI)
- [x] 记忆 (Memory)
`

describe('submission parser', () => {
  it('parses issue-form body into structured fields', () => {
    const s = parseSubmission(FORM_BODY)
    expect(s.name).toBe('opencode-foo')
    expect(s.repo).toBe('o/foo')
    expect(s.kind).toBe('npm')
    expect(s.descEn).toBe('Does the thing.')
    expect(s.descOther).toEqual({ zh: '做那件事', ja: 'それをやる' })
    expect(s.type).toBe('skill')
    expect(s.category).toEqual(['模型与接入', '记忆'])
  })

  it('checkbox-format category: only [x] items counted; all-unchecked → null', () => {
    const s = parseSubmission(`### npm 包名\n\npkg-x\n\n### 分类（可多选）\n\n- [ ] 主题与外观\n- [x] 记忆\n- [x] 安全与权限\n- [ ] 通知`)
    expect(s.category).toEqual(['记忆', '安全与权限'])
    const none = parseSubmission(`### npm 包名\n\npkg-x\n\n### 分类（可多选）\n\n- [ ] 主题与外观\n- [ ] 记忆`)
    expect(none.category).toBeNull()
  })

  it('auto category → null; _No response_ fields → null', () => {
    const s = parseSubmission(`### npm 包名\n\npkg-x\n\n### 分类（可多选）\n\n自动（由管线判断）\n\n### 其他语言描述（可选）\n\n_No response_`)
    expect(s.category).toBeNull()
    expect(s.descOther).toEqual({})
  })

  it('kind: repo when only a repo is given, none when neither', () => {
    expect(parseSubmission('### GitHub 仓库地址\n\nhttps://github.com/a/b\n').kind).toBe('repo')
    expect(parseSubmission('### 英文描述\n\nnothing else\n').kind).toBe('none')
  })

  it('freeform fallback: first package-like token + repo url', () => {
    const s = parseSubmission('check out https://github.com/a/b — the package is opencode-bar, thanks!')
    expect(s.repo).toBe('a/b')
    expect(s.name).toBe('opencode-bar')
  })

  it('rejects non-package names in the package field', () => {
    const s = parseSubmission('### npm 包名\n\nnot a package!!!\n')
    expect(s.name).not.toBe('not a package!!!')
  })

  it('seedLine emits JSONL with issue + notified flag', () => {
    const l = JSON.parse(seedLine(parseSubmission(FORM_BODY), 42))
    expect(l).toMatchObject({ name: 'opencode-foo', repo: 'o/foo', type: 'skill', issue: 42, notified: false })
    expect(l.desc).toMatchObject({ en: 'Does the thing.', zh: '做那件事' })
    expect(l.at).toBeTruthy()   // submission timestamp — stale-seed detection
  })

  it('seedLine extra: reviewed version + repo pkg name ride the line', () => {
    const l = JSON.parse(seedLine(parseSubmission(FORM_BODY), 42, { version: '2.3.0', pkg: 'oc-foo' }))
    expect(l.version).toBe('2.3.0')
    expect(l.pkg).toBe('oc-foo')
    const bare = JSON.parse(seedLine(parseSubmission(FORM_BODY), 42))
    expect('version' in bare).toBe(false)
  })

  it('seedLine author: issue author rides the seed for provenance/abuse gates', () => {
    const l = JSON.parse(seedLine(parseSubmission(FORM_BODY), 42, { author: 'alice' }))
    expect(l.author).toBe('alice')
    const bare = JSON.parse(seedLine(parseSubmission(FORM_BODY), 42))
    expect('author' in bare).toBe(false)
  })

  it('descEn keeps the full multi-line answer (collapsed), not just line 1', () => {
    const s = parseSubmission(`### 英文描述\n\nFirst line.\nSecond line with details.\nThird.`)
    expect(s.descEn).toBe('First line. Second line with details. Third.')
  })

  it('descOther en: line cannot override the dedicated English description', () => {
    const s = parseSubmission(`### 英文描述\n\nReal English desc.\n\n### 其他语言描述（可选）\n\nen: impostor\nzh: 中文`)
    const l = JSON.parse(seedLine(s, 1))
    expect(l.desc.en).toBe('Real English desc.')
    expect(l.desc.zh).toBe('中文')
  })

  it('descOther en: survives only when the dedicated field is empty', () => {
    const s = parseSubmission(`### 其他语言描述（可选）\n\nen: fallback en\nzh: 中文`)
    const l = JSON.parse(seedLine(s, 1))
    expect(l.desc.en).toBe('fallback en')
  })
})

describe('markNotified', () => {
  const idx = CatalogIndex.parse({
    version: '1', generatedAt: 't', categories: {},
    plugins: [{ name: 'opencode-foo', slug: 'x', aliases: [], type: 'plugin', discoveredVia: [], source: { kind: 'npm', id: 'x' }, description: { en: '' }, features: [], category: [], license: null, deprecated: false, deprecatedMessage: null, replacement: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {}, firstSeenAt: 't', latestVersion: null, publishedAt: null, metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' }, capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' }, compat: {} }],
    removed: [],
  })
  const lines = [
    '{"name":"opencode-foo","issue":7,"notified":false}',
    '{"name":"not-in-index","issue":8,"notified":false}',
    '{"name":"opencode-foo","issue":9,"notified":true}',   // already notified
    'plain-legacy-line',
  ]
  it('marks landed seeds and emits their issue numbers', () => {
    const { lines: out, issues } = markNotified(idx, lines)
    expect(issues).toEqual([7])
    expect(JSON.parse(out[0]!).notified).toBe(true)
    expect(JSON.parse(out[1]!).notified).toBe(false)
    expect(out[3]).toBe('plain-legacy-line')
  })
  it('repo-only seeds match the github-kind entry by repo, not name', () => {
    const ghIdx = CatalogIndex.parse({
      version: '1', generatedAt: 't', categories: {},
      plugins: [{ name: 'o/r', slug: 'o/r', aliases: [], type: 'plugin', discoveredVia: [], source: { kind: 'github', id: 'o/r', repo: 'o/r' }, description: { en: '' }, features: [], category: [], license: null, deprecated: false, deprecatedMessage: null, replacement: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {}, firstSeenAt: 't', latestVersion: null, publishedAt: null, metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' }, capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'skipped' }, compat: {}, approval: 'approved' }],
      removed: [],
    })
    const seed = ['{"repo":"o/r","issue":11,"notified":false}',
      '{"repo":"o/other","issue":12,"notified":false}']
    const { lines: out, issues } = markNotified(ghIdx, seed)
    expect(issues).toEqual([11])
    expect(JSON.parse(out[0]!).notified).toBe(true)
    expect(JSON.parse(out[1]!).notified).toBe(false)
  })
  it('repo seed stays quiet while the entry is still pending', () => {
    const ghIdx = CatalogIndex.parse({
      version: '1', generatedAt: 't', categories: {},
      plugins: [{ name: 'o/r', slug: 'o/r', aliases: [], type: 'plugin', discoveredVia: [], source: { kind: 'github', id: 'o/r', repo: 'o/r' }, description: { en: '' }, features: [], category: [], license: null, deprecated: false, deprecatedMessage: null, replacement: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {}, firstSeenAt: 't', latestVersion: null, publishedAt: null, metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' }, capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'skipped' }, compat: {}, approval: 'pending' }],
      removed: [],
    })
    const { issues } = markNotified(ghIdx, ['{"repo":"o/r","issue":11,"notified":false}'])
    expect(issues).toEqual([])
  })

  it('stale: approved seed aged past staleDays without landing warns once', () => {
    const NOW = Date.parse('2026-11-05T00:00:00Z')
    const old = '2026-10-16T00:00:00Z'   // 20d ago — past staleDays(14), under deadDays(30)
    const lines = [
      `{"name":"opencode-foo","issue":7,"notified":false,"at":"${old}"}`,          // landed → notify not stale
      `{"name":"not-in-index","issue":8,"notified":false,"at":"${old}"}`,          // aged, absent → stale
      `{"name":"also-missing","issue":9","notified":false,"at":"${old}","staleWarned":true}`, // already warned
      `{"name":"fresh-one","issue":10,"notified":false,"at":"2026-11-04T00:00:00Z"}`,        // too young
      '{"name":"legacy-no-at","issue":11,"notified":false}',                                 // no timestamp → skip
    ]
    const { issues, stale, dead, lines: out } = markNotified(idx, lines, { now: NOW })
    expect(issues).toEqual([7])
    expect(stale).toEqual([8])
    expect(dead).toEqual([])
    expect(JSON.parse(out[1]!).staleWarned).toBe(true)
    expect(JSON.parse(out[3]!).staleWarned).toBeUndefined()
  })

  it('stale: pending entry still counts as not-landed', () => {
    const NOW = Date.parse('2026-11-05T00:00:00Z')
    const pendIdx = CatalogIndex.parse({
      version: '1', generatedAt: 't', categories: {}, removed: [],
      plugins: [{ ...idx.plugins[0]!, approval: 'pending' }],
    })
    const { stale } = markNotified(pendIdx,
      ['{"name":"opencode-foo","issue":7,"notified":false,"at":"2026-10-16T00:00:00Z"}'], { now: NOW })
    expect(stale).toEqual([7])
  })

  it('dead: seed aged past deadDays without landing is terminal + deduped', () => {
    const NOW = Date.parse('2026-11-05T00:00:00Z')
    const ancient = '2026-09-01T00:00:00Z'   // 65d ago
    const lines = [
      `{"name":"not-in-index","issue":8,"notified":false,"at":"${ancient}"}`,       // → dead
      `{"name":"also-missing","issue":9,"notified":false,"at":"${ancient}","staleWarned":true}`, // warned then died → dead
      `{"name":"opencode-foo","issue":7,"notified":false,"at":"${ancient}"}`,       // landed → notify wins over dead
      `{"name":"gone","issue":12,"notified":false,"at":"${ancient}","dead":true}`,  // already dead → untouched
      `{"name":"dup-a","issue":5,"notified":false,"at":"${ancient}"}`,
      `{"name":"dup-b","issue":5,"notified":false,"at":"${ancient}"}`,               // same issue twice → one dead entry
    ]
    const { issues, stale, dead, lines: out } = markNotified(idx, lines, { now: NOW })
    expect(issues).toEqual([7])
    expect(stale).toEqual([])
    expect(dead.sort()).toEqual([5, 8, 9])
    expect(JSON.parse(out[0]!).dead).toBe(true)
    expect(JSON.parse(out[4]!).dead).toBe(true)
    expect(JSON.parse(out[5]!).dead).toBe(true)
    expect(JSON.parse(out[3]!).dead).toBe(true)   // pre-dead line passes through
  })
})

const mkRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
describe('run: JSONL seed declared metadata', () => {
  it('applies author-declared type/category/description to the entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const seed = join(dir, 'submissions.txt')
    writeFileSync(seed, JSON.stringify({
      name: 'seed-pkg', repo: 'o/s', type: 'skill', category: ['记忆'],
      desc: { en: 'declared en', zh: '声明的中文' }, issue: 5, notified: false,
    }) + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/seed-pkg')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' }, repository: 'https://github.com/o/s' } },
        time: {},
      })
      if (url.includes('x/t.tgz')) return mkRes({}, 404)
      if (url.includes('api.github.com')) return mkRes({}, 404)
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 3 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'seed-pkg')!
    expect(e.type).toBe('skill')
    expect(e.category).toEqual(['memory'])   // zh declared label normalized to id at merge
    expect(e.description.en).toBe('declared en')
    expect(e.description.zh).toBe('声明的中文')
    expect(e.discoveredVia).toContain('submission')
  })

  it('repo-only seed (no npm name) produces a github-kind entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const seed = join(dir, 'submissions.txt')
    writeFileSync(seed, JSON.stringify({ name: null, repo: 'o/repo-skill', type: 'skill', issue: 6, notified: false }) + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search') || url.includes('api.github.com/search')) return mkRes({ objects: [], items: [] })
      if (url.includes('/git/trees/')) return mkRes({ tree: [
        { path: '.opencode/skills/x/SKILL.md' }, { path: 'README.md' },
      ], sha: 'tree-head-1' })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'o/repo-skill')!
    expect(e.source.kind).toBe('github')
    expect(e.discoveredVia).toContain('submission')
    expect(e.type).toBe('skill')   // declared type honored for repo-only seeds
  })

  it('repo seed: tree moved since review → drift finding, not silent re-scan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const seed = join(dir, 'submissions.txt')
    // version = the commit sha the submission REVIEW scanned
    writeFileSync(seed, JSON.stringify({ name: null, repo: 'o/drift', type: 'skill', version: 'tree-at-review', issue: 7, notified: false }) + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search') || url.includes('api.github.com/search')) return mkRes({ objects: [], items: [] })
      if (url.includes('/git/trees/')) return mkRes({ tree: [
        { path: '.opencode/skills/x/SKILL.md' }, { path: 'README.md' },
      ], sha: 'tree-head-2' })   // HEAD moved since the review
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'o/drift')!
    expect(e.capabilities.findings).toContain('sec:repo-moved-since-review')
  })

  it('dead seeds are skipped — no candidate injection, no scan budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-'))
    const seed = join(dir, 'submissions.txt')
    writeFileSync(seed,
      JSON.stringify({ name: 'dead-pkg', repo: null, issue: 8, notified: false, dead: true }) + '\n' +
      JSON.stringify({ name: 'live-pkg', repo: null, issue: 9, notified: false }) + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search') || url.includes('api.github.com/search')) return mkRes({ objects: [], items: [] })
      if (url.includes('registry.npmjs.org/dead-pkg')) throw new Error('dead seed must never be fetched')
      if (url.includes('registry.npmjs.org/live-pkg')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } },
        time: {},
      })
      if (url.includes('x/t.tgz')) return mkRes({}, 404)
      if (url.includes('api.github.com')) return mkRes({}, 404)
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    expect(idx.plugins.find(p => p.name === 'dead-pkg')).toBeUndefined()
    expect(idx.plugins.find(p => p.name === 'live-pkg')).toBeDefined()
  })
})

describe('submissionStatuses', () => {
  const basePlugin = { name: 'p1', slug: 'p1', aliases: [], type: 'plugin' as const, discoveredVia: [], source: { kind: 'npm' as const, id: 'p1' }, description: { en: '' }, features: [], category: [], license: null, deprecated: false, deprecatedMessage: null, replacement: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {}, firstSeenAt: 't', latestVersion: null, publishedAt: null, metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' }, capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' as const }, compat: {} }
  const mkIdx = (plugins: unknown[]) => CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })

  it('phases: queued (no entry) / review (pending); landed is skipped (notified already covers it)', () => {
    const idx = mkIdx([
      { ...basePlugin, name: 'pend-pkg', approval: 'pending' },
      { ...basePlugin, name: 'live-pkg', approval: 'approved' },
    ])
    const rows = submissionStatuses(idx, [
      '{"name":"queued-pkg","issue":1,"notified":false}',
      '{"name":"pend-pkg","issue":2,"notified":false}',
      '{"name":"live-pkg","issue":3,"notified":false}',
      '{"name":"done-pkg","issue":4,"notified":true}',     // terminal — skipped
      '{"name":"dead-pkg","issue":5,"notified":false,"dead":true}', // terminal — skipped
      '{"name":"noissue","notified":false}',               // no issue — skipped
    ])
    expect(rows.map(r => [r.issue, r.phase])).toEqual([
      [1, 'queued'], [2, 'review'],
    ])
    expect(rows[0]!.phaseLabel).toBe('排队中')
  })

  it('rejected phase renders the stamped reason (S-7: the "届时会说明原因" promise)', () => {
    const idx = mkIdx([{ ...basePlugin, name: 'pend-pkg', approval: 'pending' }])
    const rows = submissionStatuses(idx, [
      '{"name":"blocked-pkg","issue":7,"notified":false,"rejected":"blocklisted"}',
      '{"name":"gone-pkg","issue":8,"notified":false,"rejected":"pkg-not-found"}',
      // entry exists → 'review' wins over a stale rejected stamp
      '{"name":"pend-pkg","issue":9,"notified":false,"rejected":"no-plugin-evidence"}',
    ])
    expect(rows.map(r => [r.issue, r.phase])).toEqual([
      [7, 'rejected'], [8, 'rejected'], [9, 'review'],
    ])
    expect(rows[0]!.phaseLabel).toBe('未通过收录规则')
    expect(rows[0]!.detail).toContain('黑名单')
    expect(rows[1]!.detail).toContain('找不到')
  })

  it('one row per issue — newest seed wins; repo seeds match by repo', () => {
    const idx = mkIdx([{ ...basePlugin, name: 'o/r', source: { kind: 'github', id: 'o/r', repo: 'o/r' }, approval: 'pending' }])
    const rows = submissionStatuses(idx, [
      '{"name":"old-name","issue":9,"notified":false}',
      '{"repo":"o/r","issue":9,"notified":false}',   // same issue, later line wins
      '{"repo":"o/other","issue":10,"notified":false}',
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.issue === 9)!.key).toBe('o/r')
    expect(rows.find(r => r.issue === 9)!.phase).toBe('review')
    expect(rows.find(r => r.issue === 10)!.phase).toBe('queued')
  })
})

describe('notify-published main', () => {
  it('rewrites the seed file in place and prints landed issue numbers', () => {
    const { main } = require('../pipeline/notify-published.ts') as typeof import('../pipeline/notify-published.ts')
    const dir = mkdtempSync(join(tmpdir(), 'np-'))
    const idxPath = join(dir, 'index.json')
    const seedPath = join(dir, 'subs.txt')
    writeFileSync(idxPath, JSON.stringify({
      version: '1', generatedAt: 't', categories: {}, removed: [],
      plugins: [{ name: 'p1', slug: 'p1', aliases: [], type: 'plugin', discoveredVia: [], source: { kind: 'npm', id: 'p1' }, description: { en: '' }, features: [], category: [], license: null, deprecated: false, deprecatedMessage: null, replacement: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {}, firstSeenAt: 't', latestVersion: '1', publishedAt: null, metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' }, capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' }, compat: {}, approval: 'approved' }],
    }))
    writeFileSync(seedPath, '{"name":"p1","issue":3,"notified":false}\n')
    const logs: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => { logs.push(String(a[0])) }
    try { main(['x', 'y', idxPath, seedPath]) } finally { console.log = orig }
    expect(logs).toEqual(['3\tp1'])
    expect(readFileSync(seedPath, 'utf8')).toContain('"notified":true')
  })
})

describe('applySeedOutcomes', () => {
  const idx = {
    plugins: [
      { name: 'landed-pkg', source: { repo: 'o/landed' } },
      { name: 'npm-twin', source: { kind: 'npm', id: 'npm-twin', repo: 'o/twin' } },
    ],
  }

  it('stamps the rejection code; a landed entry clears the stamp; repo seeds match source.repo', () => {
    const out = applySeedOutcomes([
      '{"name":"rejected-pkg","issue":1}',
      '{"name":"landed-pkg","issue":2,"rejected":"no-plugin-evidence"}',
      '{"repo":"o/twin","issue":3,"rejected":"repo-not-found"}',   // covered by the npm twin entry
      '{"repo":"o/stuck","issue":4,"rejected":"repo-not-found"}', // no entry, no outcome → stamp stays
      'plain-name-legacy-line',
    ], {
      'rejected-pkg': 'no-plugin-evidence',
    }, idx)
    expect(JSON.parse(out[0]!).rejected).toBe('no-plugin-evidence')
    expect(JSON.parse(out[1]!).rejected).toBeUndefined()
    expect(JSON.parse(out[2]!).rejected).toBeUndefined()
    expect(JSON.parse(out[3]!).rejected).toBe('repo-not-found')
    expect(out[4]).toBe('plain-name-legacy-line')
  })

  it('re-stamp with a new code replaces the old one; identical stamp is a no-op', () => {
    const line = '{"name":"p","issue":1,"rejected":"fetch-error"}'
    const [a] = applySeedOutcomes([line], { p: 'pkg-not-found' }, { plugins: [] })
    expect(JSON.parse(a!).rejected).toBe('pkg-not-found')
    const [b] = applySeedOutcomes([line], { p: 'fetch-error' }, { plugins: [] })
    expect(b).toBe(line)
  })
})
