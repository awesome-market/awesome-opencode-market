/** audit #1 fresh round (catalog-ingestion, round 3):
 *  1. repository.directory traversal guard only split on '/' — WHATWG URL
 *     parsing treats '\' as '/', resolves %2e dot-segments, and strips
 *     tab/LF/CR, so 'a\..\b' / '..%2f' / '..\t/' all slipped past both the
 *     fetch guard and the sec:repo-dir-traversal finding. unsafeRepoDir is
 *     now a charset allowlist + dot-segment check shared by fetch and run.
 *  2. Ruleset-rescan rebuilds (rescanStaleNpm/rescanStaleGh/held-version
 *     re-scan) replaced capabilities with raw scan output, silently dropping
 *     sec:* / sec-delta:* findings nothing re-derives for gone-check-kept
 *     entries — and rescanStaleGh never re-derived sec:tree-truncated.
 *  3. mergeEntries' per-version restore keyed on name@version+host, which
 *     cannot see a moved github commit (latestVersion is always null) — a
 *     repo that advanced inherited the OLD commit's 'verified' badge and
 *     scan caps forever (verify plan never re-queues 'verified'). The
 *     restore now requires byte-anchor agreement; rescanStaleGh additionally
 *     resets verification when the pinned commit moved. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { unsafeRepoDir, fetchRepoPackageName, fetchRepoPackage } from '../pipeline/fetch/github.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
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
  versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-old' }, ...extra } },
  time: { '1.0.0': 't' },
})

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
    if (url.includes('/git/trees/')) return mkRes({ tree: [
      { path: '.opencode/plugin/x.ts' }, { path: 'package.json' },
    ] })
    if (url.includes('registry.npmjs.org/good-pkg')) return new Response(packument('good-pkg'))
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
    return mkRes({}, 404)
  }) as typeof fetch

describe('unsafeRepoDir: charset allowlist closes URL-parser smuggles', () => {
  it('literal dot-segments still rejected', () => {
    expect(unsafeRepoDir('../x')).toBe(true)
    expect(unsafeRepoDir('a/./b')).toBe(true)
    expect(unsafeRepoDir('a/../b')).toBe(true)
  })
  it('backslash separator smuggle rejected', () => {
    expect(unsafeRepoDir('..\\..\\victim\\repo')).toBe(true)
    expect(unsafeRepoDir('packages\\sub')).toBe(true)
  })
  it('percent-encoded and control-char smuggles rejected', () => {
    expect(unsafeRepoDir('..%2f..%2fx')).toBe(true)
    expect(unsafeRepoDir('a%2e%2e/b')).toBe(true)
    expect(unsafeRepoDir('..\t/x')).toBe(true)
    expect(unsafeRepoDir('a\nb')).toBe(true)
  })
  it('legit monorepo dirs pass', () => {
    expect(unsafeRepoDir('packages/sub')).toBe(false)
    expect(unsafeRepoDir('.github/hooks')).toBe(false)
    expect(unsafeRepoDir('pkg-name_1.0/~tilde')).toBe(false)
    expect(unsafeRepoDir('')).toBe(false)
    expect(unsafeRepoDir(null)).toBe(false)
    expect(unsafeRepoDir(undefined)).toBe(false)
  })
  it('fetchRepoPackageName/fetchRepoPackage refuse smuggled dirs without fetching', async () => {
    let called = false
    const f = (async () => { called = true; return mkRes({ name: 'x' }) }) as typeof fetch
    for (const dir of ['..\\..\\victim', '..%2f..%2fx', '..\t/x']) {
      expect((await fetchRepoPackageName('o/r', { dir, fetchFn: f })).status).toBe('error')
      expect((await fetchRepoPackage('o/r', { dir, fetchFn: f })).status).toBe('error')
    }
    expect(called).toBe(false)
  })
})

describe('run(): backslash-smuggled repository.directory still flags + skips probe', () => {
  it('sec:repo-dir-traversal fires for \\ and %2e dirs', async () => {
    const tgz = mkTgz()
    const d = tmp('air3-')
    for (const [pkg, dir] of [
      ['bs-pkg', '..\\..\\victim\\repo'],
      ['pct-pkg', '..%2f..%2fvictim'],
    ] as const) {
      const f = baseFetch(tgz, url => {
        if (url.includes(`registry.npmjs.org/${pkg}`)) {
          return new Response(packument(pkg, {
            repository: { url: 'https://github.com/o/e', directory: dir },
          }))
        }
        if (url.includes('/-/v1/search')) {
          return mkRes({ objects: [
            { package: { name: pkg, version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/e' }, date: 't' } },
          ] })
        }
        if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, default_branch: 'main' })
        return null
      })
      const out = await run({ outPath: join(d, `${pkg}.json`), fetchFn: f, now: 't' })
      const p = out.plugins.find(x => x.name === pkg)!
      expect(p.capabilities.findings).toContain('sec:repo-dir-traversal')
      // the package.json probe was skipped — no repo-mismatch verdict either way
      expect(p.capabilities.findings.some(x => x.startsWith('sec:repo-mismatch'))).toBe(false)
    }
  })
})

describe('gone-check rescan preserves non-scan findings', () => {
  it('npm: stale-ruleset rescan keeps sec:repo-* findings, drops nothing else', async () => {
    const tgz = mkTgz()
    const d = tmp('air3-')
    const oldEntry = e({
      name: 'gone-pkg', slug: 'gone-pkg', latestVersion: '1.0.0',
      capabilities: { scannedAt: 'old', rulesetVersion: 'r0',
        findings: ['sec:repo-mismatch:other-pkg', 'network-call:src/x.js'], redFlags: [] },
      verification: { status: 'verified', integrity: 'sha512-old' },
      integrity: 'sha512-old',
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([oldEntry])))
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/gone-pkg')) return new Response(packument('gone-pkg'))
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'gone-pkg')!
    // rescan ran (ruleset refreshed) AND the observation finding survived
    expect(p.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(p.capabilities.findings).toContain('sec:repo-mismatch:other-pkg')
    // scan-derived findings are rebuilt, not carried
    expect(p.capabilities.findings).not.toContain('network-call:src/x.js')
  })

  it('github: rescan keeps evidence-regressed, re-derives tree-truncated, resets moved verification', async () => {
    const tgz = mkTgz()
    const d = tmp('air3-')
    const oldEntry = e({
      name: 'o/gh', slug: 'o/gh', latestVersion: null,
      source: { kind: 'github', id: 'o/gh', repo: 'o/gh', version: 'oldsha000' },
      integrity: null,
      capabilities: { scannedAt: 'old', rulesetVersion: 'r0',
        findings: ['sec:evidence-regressed@abc123', 'sec:tree-truncated'], redFlags: [] },
      verification: { status: 'verified', integrity: 'oldsha000', opencodeVersion: '2.2.5' },
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([oldEntry])))
    const f = baseFetch(tgz, url => {
      if (url.includes('api.github.com/repos/o/gh') && !url.includes('/git/trees/'))
        return mkRes({ stargazers_count: 1, full_name: 'o/gh', default_branch: 'main' })
      if (url.includes('/git/trees/'))
        return mkRes({ tree: [{ path: '.opencode/plugin/x.ts' }], sha: 'newsha999', truncated: false })
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'o/gh')!
    expect(p.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    // non-scan observation finding preserved
    expect(p.capabilities.findings).toContain('sec:evidence-regressed@abc123')
    // tree-truncated re-derived from THIS probe (not truncated → dropped)
    expect(p.capabilities.findings).not.toContain('sec:tree-truncated')
    // pinned commit moved → verification can no longer claim the old bytes
    expect(p.source.version).toBe('newsha999')
    expect(p.verification.status).toBe('unverified')
  })
})

describe('mergeEntries: per-version restore requires byte-anchor agreement', () => {
  const ghOld = () => ({
    version: '1' as const, generatedAt: 'x', categories: {}, removed: [],
    plugins: [e({
      name: 'o/r', slug: 'o/r', latestVersion: null, integrity: null,
      source: { kind: 'github' as const, id: 'o/r', repo: 'o/r', version: 'shaA' },
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['old-scan-finding'], redFlags: [] },
      verification: { status: 'verified' as const, integrity: 'shaA', level: 'load' as const },
    })],
  })
  const ghFresh = (sha: string) => e({
    name: 'o/r', slug: 'o/r', latestVersion: null, integrity: null,
    source: { kind: 'github' as const, id: 'o/r', repo: 'o/r', version: sha },
    capabilities: { scannedAt: 't2', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
    verification: { status: 'unverified' as const },
  })

  it('moved commit → fresh caps + unverified survive (no stale verified inherit)', () => {
    const merged = mergeEntries([ghFresh('shaB')], ghOld(), '2.2.5', RULESET_VERSION)
    expect(merged[0]!.verification.status).toBe('unverified')
    expect(merged[0]!.capabilities.findings).not.toContain('old-scan-finding')
    expect(merged[0]!.capabilities.scannedAt).toBe('t2')
  })

  it('same commit → legacy restore still applies', () => {
    const merged = mergeEntries([ghFresh('shaA')], ghOld(), '2.2.5', RULESET_VERSION)
    expect(merged[0]!.verification.status).toBe('verified')
    expect(merged[0]!.capabilities.findings).toContain('old-scan-finding')
  })

  it('npm displayed slot with matching SRI still restores', () => {
    const old = { version: '1' as const, generatedAt: 'x', categories: {}, removed: [],
      plugins: [e({ name: 'np', slug: 'np', latestVersion: '1.0.0', integrity: 'sha512-x',
        capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: ['f'], redFlags: [] },
        verification: { status: 'verified' as const, integrity: 'sha512-x' } })] }
    const fresh = e({ name: 'np', slug: 'np', latestVersion: '1.0.0', integrity: 'sha512-x',
      capabilities: { scannedAt: 't2', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      verification: { status: 'unverified' as const } })
    const merged = mergeEntries([fresh], old, '2.2.5', RULESET_VERSION)
    expect(merged[0]!.verification.status).toBe('verified')
  })
})
