/** audit #1 fresh-batch (catalog ingestion): ghWorker meta-backfill must not
 *  proceed on FABRICATED identity when the identity probe fails — a seed/partial
 *  candidate carries archived:false, fork:false, id:null, createdAt:null, so a
 *  failed fetchRepoMeta would silently bypass the archived/fork guard, repojack
 *  repoId check and name-reuse createdAt tombstone. 'error'/'rate-limited' is
 *  transient (keep ghPrev / defer the seed); 'not-found' still flows to the tree
 *  probe which records repo-not-found. Plus: sec:version-rollback must compare
 *  upstream dist-tags markers — under a pinned hold latestVersion IS the hold,
 *  so the old hold-vs-hold comparison blinded the check exactly where the pin
 *  hides upstream from every other surface. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../pipeline/run.ts'
import { trustFlags } from '../pipeline/publish/merge.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import { REJECT_REASONS } from '../pipeline/submission-status.ts'
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
  const dir = mkdtempSync(join(tmpdir(), 'a13tgz-'))
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
// a fully-admittable repo: opencode evidence + installable artifact + healthy
// codeload — if meta-failure let the fabricated identity through, THIS fixture
// is exactly what an archived/fork/repojacked repo would look like downstream.
// A filler npm package keeps the corruption gate fed (empty index → refuse).
const ADMIT = (seedRepo: string) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/-/v1/search'))
    return mkRes({ objects: [{ package: { name: 'filler', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
  if (url.includes('api.github.com/search')) return mkRes({ items: [] })
  if (url.includes('registry.npmjs.org/filler'))
    return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/f.tgz' } } }, time: {} })
  if (url === 'https://x/f.tgz') return new Response(new Uint8Array(mkTgz({ 'package.json': '{"name":"filler"}' })))
  if (url.includes(`/repos/${seedRepo}`) && !url.includes('/git/trees/'))
    return mkRes({}, 500)                                                     // identity probe fails
  if (url.includes('/git/trees/'))
    return mkRes({ tree: [{ path: '.opencode/plugin/i.js' }, { path: 'package.json' }, { path: 'SKILL.md' }], sha: 'commitX' })
  if (url.includes('codeload.github.com')) return new Response(new Uint8Array(mkTgz({ 'package.json': '{"name":"x"}', '.opencode/plugin/i.js': 'x' })))
  if (url.includes('raw.githubusercontent.com')) return mkRes({}, 404)
  if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
  return mkRes({}, 404)
}) as typeof fetch

describe('ghWorker meta-backfill failure — no admission on fabricated identity', () => {
  it('repo seed + meta error → NOT admitted (was: archived/fork/repojack gates all bypassed)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a13-seed-'))
    const seeds = join(dir, 'submissions.txt')
    writeFileSync(seeds, JSON.stringify({ repo: 'o/seed', issue: 1, at: '2026-03-01T00:00:00Z' }) + '\n')
    const outcomes = join(dir, 'outcomes.json')
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seeds, seedOutcomesPath: outcomes,
      fetchFn: ADMIT('o/seed'), now: '2026-03-05T00:00:00Z',
    })
    expect(idx.plugins.find(p => p.name.toLowerCase() === 'o/seed')).toBeUndefined()
    expect(JSON.parse(readFileSync(outcomes, 'utf8'))['o/seed']).toBe('repo-fetch-error')
    expect(REJECT_REASONS['repo-fetch-error']).toBeTruthy()   // status-comment copy exists
  })
  it('repo seed + meta error + existing ghPrev → old entry kept (transient ≠ disappearance)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a13-prev-'))
    const seeds = join(dir, 'submissions.txt')
    writeFileSync(seeds, JSON.stringify({ repo: 'o/keep', issue: 2, at: '2026-03-01T00:00:00Z' }) + '\n')
    const prev = ghEntry('o/keep', 'commitA', { approval: 'approved', modifiedAt: 'push1' })
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seeds, oldIndexPath: oldPath,
      fetchFn: ADMIT('o/keep'), now: '2026-03-05T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'o/keep')
    expect(e?.source.version).toBe('commitA')   // ghPrev carried — not dropped, not rebuilt on fake identity
  })
  it('repo seed + meta 404 → still reaches tree probe → repo-not-found outcome', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a13-nf-'))
    const seeds = join(dir, 'submissions.txt')
    writeFileSync(seeds, JSON.stringify({ repo: 'o/gone', issue: 3, at: '2026-03-01T00:00:00Z' }) + '\n')
    const outcomes = join(dir, 'outcomes.json')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'filler', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/filler'))
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/f.tgz' } } }, time: {} })
      if (url === 'https://x/f.tgz') return new Response(new Uint8Array(mkTgz({ 'package.json': '{"name":"filler"}' })))
      if (url.includes('api.npmjs.org/downloads')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)                                        // meta AND tree both 404
    }) as typeof fetch
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seeds, seedOutcomesPath: outcomes,
      fetchFn: f, now: '2026-03-05T00:00:00Z',
    })
    expect(idx.plugins.find(p => p.name.toLowerCase() === 'o/gone')).toBeUndefined()
    expect(JSON.parse(readFileSync(outcomes, 'utf8'))['o/gone']).toBe('repo-not-found')
  })
})

describe('sec:version-rollback sees upstream through the pinned hold', () => {
  const held = (): PluginEntry => mkEntry('p', {
    approval: 'approved', latestVersion: '1.2.0',
    distTags: { latest: '1.5.0' },                    // upstream latest when the hold pinned
    pendingUpdate: {
      version: '1.5.0', heldAt: 't',
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      verification: { status: 'unverified' },
    },
  })
  it('upstream rollback while a hold is pinned → flag fires (was blind: hold-vs-hold)', () => {
    // cand shadow for a held bump: latestVersion IS the hold — registry latest
    // only observable via distTags (npm unpublished 1.5.0 → latest 1.4.0)
    const cand = mkEntry('p', { latestVersion: '1.5.0', distTags: { latest: '1.4.0' } })
    expect(trustFlags(held(), cand).redFlags).toContain('sec:version-rollback')
  })
  it('upstream moved forward under a hold → no flag', () => {
    const cand = mkEntry('p', { latestVersion: '1.5.0', distTags: { latest: '1.6.0' } })
    expect(trustFlags(held(), cand).redFlags).not.toContain('sec:version-rollback')
  })
  it('non-held rollback still detected via distTags', () => {
    const prev = mkEntry('p', { latestVersion: '2.0.0', distTags: { latest: '2.0.0' } })
    const cand = mkEntry('p', { latestVersion: '1.9.0', distTags: { latest: '1.9.0' } })
    expect(trustFlags(prev, cand).redFlags).toContain('sec:version-rollback')
  })
  it('legacy entries without distTags keep the held/displayed-marker fallback', () => {
    const prev = mkEntry('p', { latestVersion: '2.0.0', distTags: {} })
    const cand = mkEntry('p', { latestVersion: '1.0.0', distTags: {} })
    expect(trustFlags(prev, cand).redFlags).toContain('sec:version-rollback')
  })
})
