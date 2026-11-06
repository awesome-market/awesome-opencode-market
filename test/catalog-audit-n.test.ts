/** catalog-ingestion audit N-batch: github-kind verdict byte anchoring
 *  (shaAnchor + repo-moved flags), case-insensitive identity across the whole
 *  verdict/issue surface, refreshMeta repo-drift refresh, coveredRepos
 *  exemption, bounded finding interpolation, code-search channel. */
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run, clip } from '../pipeline/run.ts'
import { applyMatureVerdicts, digestStateOf, akey, vkey, slotVerdict, latestVerdicts, latestHumanVerdicts } from '../pipeline/verdicts.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { submissionStatuses } from '../pipeline/submission-status.ts'
import { seedLine, parseSubmission } from '../pipeline/submission.ts'
import { searchCode, discoverGithub } from '../pipeline/discover/github.ts'
import { fetchPackument, readJsonCapped } from '../pipeline/fetch/npm.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

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
const ghEntry = (name: string, sha: string, over: Partial<PluginEntry> = {}): PluginEntry =>
  mkEntry(name, {
    latestVersion: null, publishedAt: null, integrity: null,
    source: { kind: 'github', id: name, repo: name, version: sha },
    capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
    ...over,
  })
const idxOf = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
function mkTgz(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'ntgz-'))
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

describe('N-2/N-3: verdict keying is case-insensitive end to end', () => {
  it('vkey lowercases the name side — mixed-case verdicts bind lowercase entries', () => {
    expect(vkey('Owner/Repo', null)).toBe(vkey('owner/repo', null))
    expect(vkey('My-Pkg', '1.0.0')).toBe(vkey('my-pkg', '1.0.0'))
  })
  it('slotVerdict binds a typed-case human verdict to the canonical entry name', () => {
    const v: AiVerdict = { name: 'My-Pkg', version: '1.0.0', verdict: 'concern', at: '2026-03-01T00:00:00Z', source: 'human' }
    const latest = latestVerdicts([v]); const human = latestHumanVerdicts([v])
    expect(slotVerdict(latest, human, 'my-pkg', '1.0.0')?.verdict).toBe('concern')
  })
  it('human verdict on typed-case repo name brakes the lowercase gh entry (package brake via name@null)', () => {
    const v: AiVerdict = { name: 'Owner/Repo', version: null, verdict: 'concern', at: '2026-03-01T00:00:00Z', source: 'human' }
    const e = ghEntry('Owner/Repo', 'abc123', { approval: 'approved' })
    const { index } = applyMatureVerdicts(idxOf([e]), [v], null)
    expect(index.plugins[0]!.approval).toBe('pending')
  })
  it('markNotified matches a typed-case legacy seed row to the lowercase entry', () => {
    const idx = idxOf([mkEntry('my-pkg', { approval: 'approved' })])
    const line = JSON.stringify({ name: 'My-Pkg', issue: 9, notified: false, at: '2026-03-01T00:00:00Z' })
    const r = markNotified(idx, [line], { now: Date.parse('2026-03-02T00:00:00Z') })
    expect(r.issues).toEqual([9])
    expect(JSON.parse(r.lines[0]!).notified).toBe(true)
  })
  it('submissionStatuses resolves phases case-insensitively (entry + verdict keys)', () => {
    const idx = idxOf([mkEntry('my-pkg', { approval: 'pending' })])
    const line = JSON.stringify({ name: 'My-Pkg', issue: 10, notified: false })
    const rows = submissionStatuses(idx, [line], [])
    expect(rows[0]!.phase).toBe('review')   // would be 'queued' if the name lookup missed
    const concern: AiVerdict = { name: 'MY-PKG', version: null, verdict: 'concern', at: 't', source: 'human' }
    const rows2 = submissionStatuses(idx, [line], [concern])
    expect(rows2[0]!.phase).toBe('blocked')
  })
  it('seedLine writes the seed name lowercase', () => {
    const s = parseSubmission('### npm 包名或 owner/repo\nMy-Pkg\n')
    expect(s.name).toBe('My-Pkg')           // parse keeps the typed display case
    expect(JSON.parse(seedLine(s, 1)).name).toBe('my-pkg')
  })
})

describe('N-2: github-kind byte anchoring — verdict.sha pins source.version', () => {
  const dg = (v: AiVerdict) => digestStateOf('2026-03-01', [v])
  it('human pass stamped at the pinned commit releases the repo entry', () => {
    const e = ghEntry('o/r', 'commitA', { approval: 'pending', verification: { status: 'verified' } })
    const v: AiVerdict = { name: 'o/r', version: null, verdict: 'pass', sha: 'commitA', at: '2026-03-02T00:00:00Z', source: 'human' }
    const { index, releases } = applyMatureVerdicts(idxOf([e]), [v], dg(v))
    expect(index.plugins[0]!.approval).toBe('approved')
    expect(releases).toContain('o/r@null')
  })
  it('human pass stamped at a DIFFERENT commit does not release — moved bytes need a new decision', () => {
    const e = ghEntry('o/r', 'commitB', { approval: 'pending', verification: { status: 'verified' } })
    const v: AiVerdict = { name: 'o/r', version: null, verdict: 'pass', sha: 'commitA', at: '2026-03-02T00:00:00Z', source: 'human' }
    const { index, releases } = applyMatureVerdicts(idxOf([e]), [v], dg(v))
    expect(index.plugins[0]!.approval).toBe('pending')
    expect(releases).toHaveLength(0)
  })
  it('released repo entry whose HEAD moved past the verdict sha → sec:repo-moved-since-release redFlag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n-rel-'))
    const old = idxOf([ghEntry('o/rel', 'commitA', { approval: 'approved', modifiedAt: 'older' })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const verdicts = join(dir, 'v.jsonl')
    writeFileSync(verdicts, JSON.stringify({ name: 'o/rel', version: null, verdict: 'pass', sha: 'commitA', at: '2026-03-01T00:00:00Z', source: 'human' }) + '\n')
    const tgz = mkTgz({ 'package.json': '{"name":"x"}', '.opencode/plugin/i.js': 'x' })
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [{ full_name: 'o/rel', description: '', archived: false, fork: false, pushed_at: 'newer', stargazers_count: 5, default_branch: 'main', topics: ['opencode-plugin'], id: 7, created_at: '2020-01-01' }] })
      if (url.includes('/git/trees/')) return mkRes({ tree: [{ path: '.opencode/plugin/i.js' }, { path: 'package.json' }], sha: 'commitBHEAD' })
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      if (url.includes('raw.githubusercontent.com')) return mkRes({}, 404)
      if (url.includes('api.github.com/repos/')) return mkRes({ id: 7, full_name: 'o/rel', pushed_at: 'newer', created_at: '2020-01-01', archived: false })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, verdictsPath: verdicts, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'o/rel')!
    expect(e.capabilities.redFlags.some(x => x.startsWith('sec:repo-moved-since-release:'))).toBe(true)
    expect(e.verification.status).toBe('skipped')   // skipIfFlagged honest downgrade
  })
})

describe('N-5/N-7: refreshMeta repo refresh + coveredRepos exemption', () => {
  it('stale reused npm entry refreshes marketMeta desc/category and re-derives repo identity findings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n-refresh-'))
    const prev = mkEntry('reuse-pkg', {
      description: { en: 'old desc' }, category: [],
      source: { kind: 'npm', id: 'reuse-pkg', repo: 'o/reuse' },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },   // >7d stale
    })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'reuse-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/reuse-pkg'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', repository: 'https://github.com/o/reuse', dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-x' } } }, time: {} })
      if (url.includes('raw.githubusercontent.com/o/reuse/HEAD/.opencode-market.json'))
        return mkRes({ description: { en: 'fresh market desc' }, category: ['memory'] })
      if (url.includes('raw.githubusercontent.com/o/reuse/HEAD/package.json'))
        return mkRes({ name: 'totally-different-name' })
      if (url.includes('api.github.com/repos/o/reuse')) return mkRes({ id: 9, stargazers_count: 7 })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 5 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'reuse-pkg')!
    expect(e.description.en).toBe('fresh market desc')   // marketMeta wins over prior
    expect(e.category).toContain('memory')
    expect(e.capabilities.findings.some(x => x.startsWith('sec:repo-mismatch:totally-different-name'))).toBe(true)
  })
  it('existing gh entry covered by an npm twin still flows through ghWorker (metrics refresh)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n-cov-'))
    const prev = ghEntry('o/covered', 'commitA', { approval: 'approved', modifiedAt: 'samepush',
      metrics: { stars: 1, npmDownloads30d: null, checkedAt: '2026-01-01T00:00:00Z' } })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const tgz = mkTgz({ 'package.json': '{"name":"x"}', '.opencode/plugin/i.js': 'x' })
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'npm-twin', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [{ full_name: 'o/covered', description: '', archived: false, fork: false, pushed_at: 'samepush', stargazers_count: 99, default_branch: 'main', topics: ['opencode-plugin'], id: 3, created_at: '2020-01-01' }] })
      if (url.includes('registry.npmjs.org/npm-twin'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', repository: 'https://github.com/o/covered', dist: { tarball: 'https://x/t.tgz' } } }, time: {} })
      if (url.includes('/git/trees/')) return mkRes({ tree: [{ path: '.opencode/plugin/i.js' }], sha: 'commitA' })
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      if (url.includes('raw.githubusercontent.com')) return mkRes({}, 404)
      if (url.includes('api.github.com/repos/')) return mkRes({ id: 3, full_name: 'o/covered', pushed_at: 'samepush' })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const gh = idx.plugins.find(p => p.name === 'o/covered')!
    expect(gh).toBeDefined()
    expect(gh.metrics.stars).toBe(99)           // ghWorker reuse path refreshed metrics, not frozen
    expect(gh.metrics.checkedAt).toBe('2026-03-05T00:00:00Z')
  })
})

describe('N-4: bounded interpolation of attacker-controlled finding values', () => {
  it('clip() bounds strings at the cap', () => {
    expect(clip('x'.repeat(500))).toHaveLength(120)
    expect(clip('short')).toBe('short')
    expect(clip('y'.repeat(200), 50)).toHaveLength(50)
  })
  it('a hostile repo package.json name is clipped inside the finding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'n-clip-'))
    const huge = 'A'.repeat(10000)
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'clip-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/clip-pkg'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', repository: 'https://github.com/o/clip', dist: { tarball: 'https://x/t.tgz' } } }, time: {} })
      if (url.includes('raw.githubusercontent.com/o/clip/HEAD/package.json')) return mkRes({ name: huge })
      if (url.includes('api.github.com/repos/')) return mkRes({ id: 1 })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'clip-pkg')!
    const fnd = e.capabilities.findings.find(x => x.startsWith('sec:repo-mismatch:'))
    expect(fnd).toBeDefined()
    expect(fnd!.length).toBeLessThan(200)
  })
})

describe('O-3: code-search discovery channel', () => {
  it('searchCode maps repository objects into GhRepo candidates', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/search/code')
      return mkRes({ items: [
        { repository: { full_name: 'a/one', description: 'd', archived: false, fork: false, pushed_at: 't', stargazers_count: 2, default_branch: 'main', id: 11, created_at: 'c', license: { spdx_id: 'MIT' }, topics: ['x'] } },
        { repository: { full_name: 'b/two', pushed_at: null } },   // partial object → backfill path
        { repository: null },
      ] })
    }) as typeof fetch
    const repos = await searchCode('filename:opencode.json', { token: 't', fetchFn: f })
    expect(repos).toHaveLength(2)
    expect(repos[0]).toMatchObject({ fullName: 'a/one', id: 11, stars: 2, license: 'MIT' })
    expect(repos[1]).toMatchObject({ fullName: 'b/two', pushedAt: null, id: null })
  })
  it('discoverGithub merges code-search hits with topic hits (union discoveredVia); skips without token', async () => {
    const calls: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url)
      if (url.includes('/search/code')) return mkRes({ items: [
        { repository: { full_name: 'Shared/Repo', pushed_at: 't', id: 1, fork: false, archived: false } },
        { repository: { full_name: 'code/only', pushed_at: 't', id: 2, fork: false, archived: false } },
      ] })
      return mkRes({ items: [{ full_name: 'Shared/Repo', description: '', archived: false, fork: false, pushed_at: 't', stargazers_count: 1, default_branch: 'm', topics: [] }] })
    }) as typeof fetch
    const map = await discoverGithub(['opencode-plugin'], { token: 't', fetchFn: f, maxPages: 1 })
    const shared = map.get('shared/repo')!
    expect(shared.discoveredVia).toEqual(expect.arrayContaining(['github-topic', 'code-search']))
    expect(map.get('code/only')!.discoveredVia).toEqual(['code-search'])
    expect(calls.filter(u => u.includes('/search/code')).length).toBeGreaterThan(0)
    // no token → the code-search leg never fires (401-degraded by design)
    const calls2: string[] = []
    const f2 = (async (input: RequestInfo | URL) => { calls2.push(String(input)); return mkRes({ items: [] }) }) as typeof fetch
    await discoverGithub(['opencode-plugin'], { fetchFn: f2, maxPages: 1 })
    expect(calls2.filter(u => u.includes('/search/code'))).toHaveLength(0)
  })
})

describe('O-4: notified seed rows are terminal at ingestion', () => {
  it('notified npm + repo seeds fire no probes; live rows still inject', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notif-'))
    const seed = join(dir, 'seed.txt')
    writeFileSync(seed, [
      JSON.stringify({ name: 'notified-pkg', issue: 1, notified: true }),
      JSON.stringify({ repo: 'o/notified-repo', issue: 2, notified: true }),
      JSON.stringify({ name: 'live-pkg', issue: 3 }),
    ].join('\n'))
    const urls: string[] = []
    const tgz = mkTgz({ 'package.json': '{"name":"live-pkg","main":"i.js"}', 'i.js': 'x' })
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/live-pkg'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } }, time: {} })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    // terminal rows never reached the network — a notified repo seed used to
    // pay meta+tree+codeload+scan every single run until the 90d prune
    expect(urls.some(u => u.includes('notified-pkg'))).toBe(false)
    expect(urls.some(u => u.includes('notified-repo'))).toBe(false)
    expect(urls.some(u => u.includes('live-pkg'))).toBe(true)
    expect(idx.plugins.map(p => p.name)).toEqual(['live-pkg'])
  })
})

describe('O-5: refreshMeta — a fully-failed refresh is not a refresh', () => {
  it('all probes failed → entry returned unchanged, checkedAt NOT advanced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf-fail-'))
    const prev = mkEntry('reuse-pkg', {
      source: { kind: 'npm', id: 'reuse-pkg', repo: 'o/reuse' },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },   // >7d stale → refresh path
    })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'reuse-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      return mkRes({}, 500)   // every probe (packument/repoMeta/downloads/marketMeta/repoPkg) fails
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'reuse-pkg')!
    // a failed refresh used to stamp checkedAt:now — dead metrics frozen
    // another week and the catalog lying about when the entry was last seen
    expect(e.metrics.checkedAt).toBe('2026-01-01T00:00:00Z')
    expect(e.metrics.stars).toBe(1)
  })
  it('partial success still refreshes — one live probe is enough', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf-part-'))
    const prev = mkEntry('reuse-pkg', {
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },
    })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [{ package: { name: 'reuse-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 42 })   // the only live probe
      return mkRes({}, 500)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-03-05T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'reuse-pkg')!
    expect(e.metrics.npmDownloads30d).toBe(42)
    expect(e.metrics.checkedAt).toBe('2026-03-05T00:00:00Z')
  })
})

describe('O-6: bounded JSON reads — readJsonCapped', () => {
  it('streams the body and rejects past the cap (content-length can lie)', async () => {
    const big = '{"x":"' + 'A'.repeat(100_000) + '"}'
    await expect(readJsonCapped(new Response(big), 1024)).rejects.toThrow(/too large/)
  })
  it('content-length pre-check rejects before reading', async () => {
    const res = new Response('{}', { headers: { 'content-length': String(10 * 1024 * 1024) } })
    await expect(readJsonCapped(res, 1024)).rejects.toThrow(/too large/)
  })
  it('under-cap bodies parse normally', async () => {
    await expect(readJsonCapped<{ a: number }>(new Response('{"a":1}'), 1024)).resolves.toEqual({ a: 1 })
  })
  it('an oversize packument degrades to status error — one giant package cannot OOM the run', async () => {
    const f = (async () => new Response('{}', { headers: { 'content-length': String(70 * 1024 * 1024) } })) as typeof fetch
    const r = await fetchPackument('huge-pkg', { fetchFn: f })
    expect(r.status).toBe('error')
    expect(r.pk).toBeNull()
  })
})

describe('O-7: empty repo tree counts treeEmpty, not evidenceRejected', () => {
  it('a 200 tree with zero entries is rejection-by-absence, honest accounting', async () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
    try {
      const f = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
        if (url.includes('api.github.com/search'))
          return mkRes({ items: [{ full_name: 'o/empty', description: '', archived: false, fork: false, pushed_at: 't', stargazers_count: 1, default_branch: 'main', topics: ['opencode-plugin'], id: 1, created_at: 'c' }] })
        if (url.includes('/git/trees/')) return mkRes({ tree: [] })   // exists, holds zero files
        return mkRes({}, 404)
      }) as typeof fetch
      const idx = await run({ outPath: join(mkdtempSync(join(tmpdir(), 'te-')), 'i.json'), fetchFn: f, now: 't', forceGate: true })
      expect(idx.plugins.find(p => p.name === 'o/empty')).toBeUndefined()
      const line = logs.find(l => l.startsWith('github-kind:'))
      expect(line).toContain('1 empty')
      expect(line).toContain('0 evidence-rejected')
    } finally { spy.mockRestore() }
  })
})
