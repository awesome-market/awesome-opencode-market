import { describe, it, expect } from 'vitest'
import { extractRepos, filterByStars, buildSeedList } from '../pipeline/discover/seed.ts'
import { reviewPackage } from '../pipeline/review.ts'
import { listPage } from '../pipeline/site/build.ts'
import { normalizeRepoUrl } from '../pipeline/discover/github.ts'
import type { PluginEntry } from '../src/schema.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

describe('branch coverage round 4', () => {
  it('seed: extractRepos edge cases', () => {
    expect(extractRepos('github.com//x and github.com/a')).toEqual([])
    expect(extractRepos('')).toEqual([])
  })
  it('seed: filterByStars missing count treated as 0', async () => {
    const f = (async () => mkRes({})) as typeof fetch
    expect(await filterByStars(['a/b'], 1, { fetchFn: f })).toEqual([])
  })
  it('seed: buildSeedList throws on bad readme fetch', async () => {
    const f = (async () => mkRes({}, 404)) as typeof fetch
    await expect(buildSeedList({ url: 'x', fetchFn: f })).rejects.toThrow('awesome fetch failed')
  })
  it('review: pkg without tarball/repo → empty findings, null repo', async () => {
    const f = (async (u: RequestInfo | URL) => {
      const s = String(u)
      if (s.includes('registry.npmjs.org')) return mkRes({
        'dist-tags': { latest: '1' }, versions: { '1': { keywords: ['opencode'], main: 'i.js' } }, time: {} })
      return mkRes({}, 404)
    }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn: f })
    expect(r.exists).toBe(true)
    expect(r.repo).toBeNull()
    expect(r.findings).toEqual([])
  })
  it('site: missing optional fields render without version/metrics', () => {
    const e: PluginEntry = {
      name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: 'p' }, description: {}, category: [],
      license: null, deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: '2026-01-01', latestVersion: null, publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'skipped' }, compat: {},
      approval: 'approved',
    }
    const html = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [e], removed: [] })
    expect(html).toContain('nothing to install')
    expect(html).not.toContain('undefined')
  })
  it('github normalizeRepoUrl variants', () => {
    expect(normalizeRepoUrl(null)).toBeNull()
    expect(normalizeRepoUrl('https://github.com/a/b')).toBe('a/b')
    expect(normalizeRepoUrl('git+https://github.com/a/b.git')).toBe('a/b')
    expect(normalizeRepoUrl('git@github.com:a/b.git')).toBe('a/b')
    expect(normalizeRepoUrl('https://gitlab.com/a/b')).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
  })
})
