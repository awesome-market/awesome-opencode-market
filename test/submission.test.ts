import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSubmission, seedLine } from '../pipeline/submission.ts'
import { markNotified } from '../pipeline/notify-published.ts'
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
    const old = '2026-10-01T00:00:00Z'   // 35d ago
    const lines = [
      `{"name":"opencode-foo","issue":7,"notified":false,"at":"${old}"}`,          // landed → notify not stale
      `{"name":"not-in-index","issue":8,"notified":false,"at":"${old}"}`,          // aged, absent → stale
      `{"name":"also-missing","issue":9,"notified":false,"at":"${old}","staleWarned":true}`, // already warned
      `{"name":"fresh-one","issue":10,"notified":false,"at":"2026-11-04T00:00:00Z"}`,        // too young
      '{"name":"legacy-no-at","issue":11,"notified":false}',                                 // no timestamp → skip
    ]
    const { issues, stale, lines: out } = markNotified(idx, lines, { now: NOW })
    expect(issues).toEqual([7])
    expect(stale).toEqual([8])
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
      ['{"name":"opencode-foo","issue":7,"notified":false,"at":"2026-10-01T00:00:00Z"}'], { now: NOW })
    expect(stale).toEqual([7])
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
      ] })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'o/repo-skill')!
    expect(e.source.kind).toBe('github')
    expect(e.discoveredVia).toContain('submission')
    expect(e.type).toBe('skill')   // declared type honored for repo-only seeds
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
    expect(logs).toEqual(['3'])
    expect(readFileSync(seedPath, 'utf8')).toContain('"notified":true')
  })
})
