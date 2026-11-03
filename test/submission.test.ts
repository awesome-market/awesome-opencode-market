import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSubmission, seedLine } from '../pipeline/submission.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { run } from '../pipeline/run.ts'
import { CatalogIndex } from '../src/schema.ts'

const FORM_BODY = `### npm 包名

opencode-foo

### GitHub 仓库地址

https://github.com/o/foo

### 英文描述

Does the thing.

### 其他语言描述（可选）

zh: 做那件事
ja: それをやる

### 类型

skill（技能包）

### 分类

模型与接入
`

describe('submission parser', () => {
  it('parses issue-form body into structured fields', () => {
    const s = parseSubmission(FORM_BODY)
    expect(s.name).toBe('opencode-foo')
    expect(s.repo).toBe('o/foo')
    expect(s.descEn).toBe('Does the thing.')
    expect(s.descOther).toEqual({ zh: '做那件事', ja: 'それをやる' })
    expect(s.type).toBe('skill')
    expect(s.category).toBe('模型与接入')
  })

  it('auto category → null; _No response_ fields → null', () => {
    const s = parseSubmission(`### npm 包名\n\npkg-x\n\n### 分类\n\n自动（由管线判断）\n\n### 其他语言描述（可选）\n\n_No response_`)
    expect(s.category).toBeNull()
    expect(s.descOther).toEqual({})
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
    expect(e.category).toEqual(['记忆'])
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
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'o/repo-skill')!
    expect(e.source.kind).toBe('github')
    expect(e.discoveredVia).toContain('submission')
  })
})
