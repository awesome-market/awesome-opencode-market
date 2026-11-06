/** audit #1 fresh-batch (catalog ingestion): refreshMeta must follow a
 *  repointed packument `repository` field (frozen source.repo blinded the
 *  reuse path to repo moves/repojacks), and merge/buildIndex name-key lookups
 *  must be case-insensitive like every other name index in the pipeline. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../pipeline/run.ts'
import { mergeEntries, buildIndex } from '../pipeline/publish/merge.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-02-02T00:00:00Z' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const idxOf = (plugins: PluginEntry[], removed: CatalogIndex['removed'] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
function mkTgz(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'a12-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  for (const [p, body] of Object.entries(files)) {
    const fp = join(dir, 'pkg', p)
    mkdirSync(join(fp, '..'), { recursive: true })
    writeFileSync(fp, body)
  }
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'])
  return readFileSync(out)
}

describe('audit#1: refreshMeta follows a repointed packument repository', () => {
  it('source.repo + repoId move to the fresh declaration → sec:repo-recreated fires', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a12-refresh-'))
    const prev = mkEntry('repoint-pkg', {
      source: { kind: 'npm', id: 'repoint-pkg', repo: 'o/old', repoId: 7 },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },   // stale → refresh
      approval: 'approved',
    })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const seen: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); seen.push(url)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'repoint-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/repoint-pkg'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', repository: 'https://github.com/o/new',
            dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-x' } } },
          time: {} })
      if (url.includes('api.github.com/repos/o/new')) return mkRes({ id: 99, stargazers_count: 5 })
      if (url.includes('raw.githubusercontent.com/o/new/HEAD/package.json')) return mkRes({ name: 'repoint-pkg' })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 5 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'repoint-pkg')!
    // probes ran against the NEW repo — the old one's meta was never consulted
    expect(seen.some(u => u.includes('repos/o/new'))).toBe(true)
    expect(seen.some(u => u.includes('repos/o/old'))).toBe(false)
    expect(e.source.repo).toBe('o/new')
    expect(e.source.repoId).toBe(99)
    expect(e.capabilities.redFlags).toContain('sec:repo-recreated')   // 7 → 99 repojack signal
  })

  it('absent/garbage repository field falls back to the stored source.repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a12-fallback-'))
    const prev = mkEntry('keep-pkg', {
      source: { kind: 'npm', id: 'keep-pkg', repo: 'o/keep', repoId: 7 },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },
      approval: 'approved',
    })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const seen: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); seen.push(url)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'keep-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/keep-pkg'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', repository: '../not-a-repo',
            dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-x' } } },
          time: {} })
      if (url.includes('api.github.com/repos/o/keep')) return mkRes({ id: 7, stargazers_count: 3 })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 2 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'keep-pkg')!
    expect(e.source.repo).toBe('o/keep')
    expect(e.source.repoId).toBe(7)
    expect(e.capabilities.redFlags).not.toContain('sec:repo-recreated')
    expect(seen.some(u => u.includes('repos/o/keep'))).toBe(true)
  })
})

describe('audit#1: merge/buildIndex name keys are case-insensitive', () => {
  it('a case-drifted fresh name still inherits identity + approval state', () => {
    const prev = mkEntry('My-Pkg', { approval: 'approved', firstSeenAt: '2020-01-01T00:00:00Z' })
    const fresh = mkEntry('my-pkg', { approval: 'approved' })
    const out = mergeEntries([fresh], idxOf([prev]), 'test', RULESET_VERSION, '2026-03-05T00:00:00Z')
    expect(out[0]!.firstSeenAt).toBe('2020-01-01T00:00:00Z')
    expect(out[0]!.approval).toBe('approved')
    expect(out[0]!.slug).toBe(prev.slug)
  })

  it('a case-drifted live name retires its tombstone — no zombie removed row', () => {
    const prev = mkEntry('owner/repo', { approval: 'approved' })
    const removed = [{ slug: 'owner-repo', name: 'Owner/Repo', disappearedAt: '2026-02-01T00:00:00Z', reason: 'repo-404' as const }]
    const { index } = buildIndex([prev], idxOf([], removed), { opencodeVersion: 'test', rulesetVersion: RULESET_VERSION, now: '2026-03-05T00:00:00Z' })
    expect(index.removed).toHaveLength(0)
  })
})
