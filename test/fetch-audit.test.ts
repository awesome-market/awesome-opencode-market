/** F-series fetch/discovery audit fixes: gone-check re-probe, dir traversal,
 *  declared-repo wiring, gh cap, submission tagging, spam FP, tarball scheme. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { normalizeRepoUrl } from '../pipeline/discover/github.ts'
import { looksLikeTemplateSpam } from '../pipeline/discover/filter.ts'
import { fetchRepoPackageName, fetchRepoTree, fetchMarketMeta } from '../pipeline/fetch/github.ts'
import { repoToNpm } from '../pipeline/discover/seed.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const mkRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

function mkTgz(): Buffer {
  const dir = tmp('fatgz-')
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

const packument = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  'dist-tags': { latest: '1.0.0' },
  versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' }, ...extra } },
  time: { '1.0.0': 't' },
})

/** Baseline router: one good npm candidate, empty gh search, working tarball. */
const baseFetch = (tgz: Buffer, route?: (url: string) => Response | null) =>
  (async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = route?.(url)
    if (hit) return hit
    if (url.includes('/-/v1/search')) {
      return mkRes({ objects: [
        { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
      ] })
    }
    if (url.includes('api.github.com/search')) return mkRes({ items: [] })
    if (url.includes('registry.npmjs.org/good-pkg')) return new Response(packument('good-pkg'))
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
    return mkRes({}, 404)
  }) as typeof fetch

describe('F-3 looksLikeTemplateSpam: shared opencode- prefix is not spam', () => {
  it('six opencode-* names with distinct suffixes → not spam', () => {
    expect(looksLikeTemplateSpam([
      'opencode-weather', 'opencode-git', 'opencode-docker',
      'opencode-k8s', 'opencode-npm', 'opencode-lint',
    ])).toBe(false)
  })
  it('six names identical after digit/dash strip → spam', () => {
    expect(looksLikeTemplateSpam(['mp-x1', 'mp-x2', 'mp-x3', 'mp-x4', 'mp-x5', 'mp-x6'])).toBe(true)
  })
})

describe('F-10/F-5 normalizeRepoUrl: bare owner/repo + trailing .git/', () => {
  it('bare owner/repo form', () => {
    expect(normalizeRepoUrl('owner/repo')).toBe('owner/repo')
    expect(normalizeRepoUrl('owner/repo.git')).toBe('owner/repo')
  })
  it('trailing .git/ stripped', () => {
    expect(normalizeRepoUrl('https://github.com/a/b.git/')).toBe('a/b')
  })
  it('three-segment non-github path is not a repo', () => {
    expect(normalizeRepoUrl('gitlab.com/o/r')).toBeNull()
  })
})

describe('F-2 fetchRepoPackageName: directory traversal refused', () => {
  it('dir with .. → error, no fetch issued', async () => {
    let called = false
    const f = (async () => { called = true; return mkRes({ name: 'x' }) }) as typeof fetch
    const r = await fetchRepoPackageName('o/r', { dir: '../../../victim/repo/HEAD', fetchFn: f })
    expect(r.status).toBe('error')
    expect(called).toBe(false)
  })
  it('clean nested dir still works', async () => {
    const r = await fetchRepoPackageName('o/r', { dir: 'packages/sub', fetchFn: (async () => mkRes({ name: 'n' })) as typeof fetch })
    expect(r.pkgName).toBe('n')
  })
})

describe('F-8 fetchRepoTree: truncated flag surfaced', () => {
  it('truncated response carries truncated=true', async () => {
    const r = await fetchRepoTree('o/r', 'main', { fetchFn: (async () => mkRes({ tree: [{ path: 'a' }], truncated: true })) as typeof fetch })
    expect(r.truncated).toBe(true)
    expect(r.paths!.has('a')).toBe(true)
  })
})

describe('F-9 fetchMarketMeta: size caps', () => {
  it('long category list/strings and huge descriptions are capped', async () => {
    const f = (async () => mkRes({
      category: Array.from({ length: 20 }, (_, i) => `cat-${i}`),
      description: { en: 'x'.repeat(10_000), zh: '中'.repeat(10_000) },
    })) as typeof fetch
    const meta = await fetchMarketMeta('o/r', { fetchFn: f })
    expect(meta!.category!.length).toBeLessThanOrEqual(8)
    expect(meta!.description!.en!.length).toBeLessThanOrEqual(4_000)
    expect(meta!.description!.zh!.length).toBeLessThanOrEqual(4_000)
  })
})

describe('F-11 repoToNpm: explicit default branch probed first', () => {
  it('opts.branch hit wins before main/master', async () => {
    const urls: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const u = String(input); urls.push(u)
      return u.includes('/develop/') ? mkRes({ name: 'dev-pkg' }) : mkRes({}, 404)
    }) as typeof fetch
    expect(await repoToNpm('o/r', { branch: 'develop', fetchFn: f })).toBe('dev-pkg')
    expect(urls[0]).toContain('/develop/')
  })
})

describe('F-1 gone-check: github entries get a live re-probe like npm', () => {
  const ghEntry = () => e({
    name: 'o/gh', slug: 'o/gh', source: { kind: 'github', id: 'o/gh', repo: 'o/gh' },
    latestVersion: null, verification: { status: 'unverified' },
  })

  it('repo meta ok → filtered; 404 → repo-404; 500 → preserved', async () => {
    const tgz = mkTgz()
    const run1 = async (repoRes: Response) => {
      const d = tmp('fa-')
      const oldPath = join(d, 'old.json')
      writeFileSync(oldPath, JSON.stringify(idx([ghEntry()])))
      const f = baseFetch(tgz, url => url.includes('api.github.com/repos/o/gh') ? repoRes.clone() : null)
      return run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    }
    // repo still exists → filtered
    let out = await run1(mkRes({ stargazers_count: 1 }))
    expect(out.removed.find(r => r.name === 'o/gh')!.reason).toBe('filtered')
    // repo deleted → repo-404
    out = await run1(mkRes({}, 404))
    expect(out.removed.find(r => r.name === 'o/gh')!.reason).toBe('repo-404')
    // transient error → stale entry preserved, no tombstone
    out = await run1(mkRes({}, 500))
    expect(out.plugins.map(p => p.name)).toContain('o/gh')
    expect(out.removed.find(r => r.name === 'o/gh')).toBeUndefined()
  })

  it('rate-limited re-probe → preserved', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([ghEntry()])))
    const f = baseFetch(tgz, url => url.includes('api.github.com/repos/o/gh')
      ? mkRes({}, 403, { 'x-ratelimit-remaining': '0' }) : null)
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    expect(out.plugins.map(p => p.name)).toContain('o/gh')
  })
})

describe('F-4 github candidates share the entry cap', () => {
  it('gh topic burst is sliced deterministically; seed repos bypass', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, 'github:zz-seed/repo\n')
    const f = baseFetch(tgz, url => {
      if (url.includes('api.github.com/search')) {
        return mkRes({ items: [
          ...Array.from({ length: 6 }, (_, i) => ({
            full_name: `o${i}/gh-${i}`, description: '', archived: false, fork: false,
            pushed_at: 't', stargazers_count: 1, default_branch: 'main', id: i,
          })),
        ] })
      }
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, default_branch: 'main' })
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', maxEntries: 4, seedPath: seed })
    const ghNames = out.plugins.filter(p => p.source.kind === 'github').map(p => p.name)
    // npm candidate takes 1 slot; gh capped at 4 sorted + seed bypass
    expect(ghNames).toContain('zz-seed/repo')
    expect(ghNames.filter(n => n.startsWith('o')).length).toBe(4)
  })
})

describe('F-5/F-6 submission wiring', () => {
  it('declared repo used when packument lacks repository; mismatch → finding', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, JSON.stringify({ name: 'seeded-pkg', repo: 'claimed/repo' }) + '\n')
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/seeded-pkg'))
        return new Response(packument('seeded-pkg', { repository: 'https://github.com/real/other' }))
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 5, default_branch: 'main' })
      if (url.includes('raw.githubusercontent.com/')) return mkRes({}, 404)
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', seedPath: seed })
    const p = out.plugins.find(x => x.name === 'seeded-pkg')!
    expect(p.source.repo).toBe('real/other')
    expect(p.capabilities.findings).toContain('sec:repo-declared-mismatch:claimed/repo')
    expect(p.discoveredVia).toContain('submission')
  })

  it('declared repo is fallback when packument has no repository field', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, JSON.stringify({ name: 'norepo-pkg', repo: 'claimed/repo' }) + '\n')
    let metaHit = false
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/norepo-pkg')) {
        return new Response(packument('norepo-pkg')) // no repository
      }
      if (url.includes('api.github.com/repos/claimed/repo')) { metaHit = true; return mkRes({ stargazers_count: 7, default_branch: 'main', id: 42 }) }
      if (url.includes('raw.githubusercontent.com/')) return mkRes({ name: 'norepo-pkg' })
      if (url.includes('api.github.com/repos/')) return mkRes({}, 404)
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', seedPath: seed })
    const p = out.plugins.find(x => x.name === 'norepo-pkg')!
    expect(p.source.repo).toBe('claimed/repo')
    expect(metaHit).toBe(true)               // repo meta probed via declared repo
    expect(p.capabilities.findings.some(x => x.startsWith('sec:repo-declared'))).toBe(false)
  })

  it('dir traversal in repository.directory → sec:repo-dir-traversal finding', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/evil-pkg')) {
        return new Response(packument('evil-pkg', {
          repository: { url: 'https://github.com/o/e', directory: '../../../victim/repo/HEAD' },
        }))
      }
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [
          { package: { name: 'evil-pkg', version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/e' }, date: 't' } },
        ] })
      }
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, default_branch: 'main' })
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'evil-pkg')!
    expect(p.capabilities.findings).toContain('sec:repo-dir-traversal')
  })

  it('transient packument error keeps stale entry without double-fetch; seed warned', async () => {
    const tgz = mkTgz()
    const d = tmp('fa-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, 'new-seed-pkg\n')
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([e({ name: 'stale-pkg', latestVersion: '0.9.0' })])))
    let staleCalls = 0
    const f = baseFetch(tgz, url => {
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [
          { package: { name: 'stale-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
        ] })
      }
      if (url.includes('registry.npmjs.org/stale-pkg')) { staleCalls++; return mkRes({}, 500) }
      if (url.includes('registry.npmjs.org/new-seed-pkg')) return mkRes({}, 500)
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't', seedPath: seed })
    expect(out.plugins.map(p => p.name)).toContain('stale-pkg')
    // worker preserves on error → gone-check skips → single packument call
    expect(staleCalls).toBe(1)
    // new seed on transient error → not in index (self-heals next run)
    expect(out.plugins.map(p => p.name)).not.toContain('new-seed-pkg')
  })
})
