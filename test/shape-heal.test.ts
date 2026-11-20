/** shape-heal + github shape-veto tombstones (approved follow-up to the
 *  plugin-shape gate):
 *
 *  1. goneCheck transient (repo meta rate-limited) → healGhShape judges the
 *     PINNED bytes via codeload (different quota than api.github.com) →
 *     shapeless + skill-less pending entry → 'filtered' tombstone. Before
 *     this, a rate-limit storm froze every kept 'plugin' claim indefinitely.
 *  2. SKILL.md payload → contains rewritten to ['skill'], entry kept —
 *     skills stay an open category.
 *  3. approved/legacy displays are never touched by heal.
 *  4. persisted capabilities.pluginModule/skillPayload → re-judged for free
 *     (no codeload fetch at all).
 *  5. rescanStaleGh (api healthy) applies the same veto → null → 'filtered',
 *     npm parity (previously it rewrote contains to [] and the entry sat
 *     pending forever).
 *  6. ghWorker transient (tree rate-limited while the repo is still in
 *     discovery) → same heal → tombstone, and healedOut stops goneCheck
 *     from resurrecting it in the same run.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const NOW = '2026-06-01T00:00:00Z'
const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

const ghE = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['github-topic'],
  source: { kind: 'github', id: name, repo: name, version: 'pin1' },
  description: { en: 'a repo' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: 'push1', maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: null, publishedAt: null, integrity: null,
  metrics: { stars: 3, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: NOW },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  contains: ['plugin'],
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idxOf = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: NOW, categories: {}, plugins, removed: [],
})

function mkTgz(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'sheal-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  for (const [p, body] of Object.entries(files)) {
    const fp = join(dir, 'pkg', p)
    mkdirSync(join(fp, '..'), { recursive: true })
    writeFileSync(fp, body)
  }
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

// a root package.json declaring main + plain CLI code = the magpie shape:
// installable-looking, opencode-tagged, but no plugin-shaped module
const SHAPELESS = {
  'package.json': '{"name":"x","main":"cli.js"}',
  'cli.js': 'console.log("i am a cli, not a plugin")',
}
const SHAPELESS_SKILL = { ...SHAPELESS, 'SKILL.md': '# a skill\n\ndo things\n' }
const PLUGINISH = {
  'package.json': '{"name":"x","main":"index.js"}',
  'index.js': 'export default { id: "x", setup() {} }',
}

interface FetchOpts {
  ghItems?: unknown[]
  metaStatus?: number
  metaBody?: unknown
  treeStatus?: number
  treeBody?: unknown
  codeloadFiles?: Record<string, string>
  codeloadCalls?: string[]
}

/** minimal catalog fetch: one filler npm package keeps the corruption gate
 *  fed; github endpoints are parameterized per scenario */
const mkFetch = (o: FetchOpts = {}) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/-/v1/search'))
    return mkRes({ objects: [{ package: { name: 'filler', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
  if (url.includes('api.github.com/search')) return mkRes({ items: o.ghItems ?? [] })
  if (url.includes('registry.npmjs.org/filler'))
    return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/f.tgz' } } }, time: {} })
  if (url === 'https://x/f.tgz') return new Response(new Uint8Array(mkTgz(PLUGINISH)))
  if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
  if (url.includes('/repos/o/') && !url.includes('/git/'))
    return o.metaStatus ? mkRes(o.metaBody ?? {}, o.metaStatus)
      : mkRes({ id: 7, stargazers_count: 3, archived: false, fork: false, pushed_at: 'push1', license: { spdx_id: 'MIT' }, full_name: 'o/shapeless', topics: ['opencode-plugin'] })
  if (url.includes('/git/trees/'))
    return o.treeStatus ? mkRes(o.treeBody ?? {}, o.treeStatus)
      : mkRes({ sha: 'newsha', truncated: false, tree: [{ path: 'package.json' }, { path: 'cli.js' }] })
  if (url.includes('codeload.github.com')) {
    o.codeloadCalls?.push(url)
    return new Response(new Uint8Array(mkTgz(o.codeloadFiles ?? SHAPELESS)))
  }
  if (url.includes('raw.githubusercontent.com')) return mkRes({}, 404)
  return mkRes({}, 404)
}) as typeof fetch

const META_OK = { id: 7, stargazers_count: 3, archived: false, fork: false, pushed_at: 'push1', license: { spdx_id: 'MIT' }, full_name: 'o/shapeless', topics: ['opencode-plugin'] }

describe('shape-heal: transient api failure still re-judges pinned bytes', () => {
  it('meta rate-limited + shapeless pinned bytes → filtered tombstone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-tomb-'))
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idxOf([ghE('o/shapeless')])))
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaStatus: 429, codeloadFiles: SHAPELESS }), now: NOW,
    })
    expect(idx.plugins.find(p => p.name === 'o/shapeless')).toBeUndefined()
    expect(idx.removed?.find(r => r.name === 'o/shapeless')?.reason).toBe('filtered')
  })

  it('meta rate-limited + SKILL.md payload → contains rewritten to [skill], kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-skill-'))
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idxOf([ghE('o/shapeless')])))
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaStatus: 429, codeloadFiles: SHAPELESS_SKILL }), now: NOW,
    })
    const e = idx.plugins.find(p => p.name === 'o/shapeless')
    expect(e?.contains).toEqual(['skill'])
    expect(e?.capabilities.skillPayload).toBe(true)
    expect(e?.capabilities.pluginModule).toBe(false)
    expect(idx.removed?.find(r => r.name === 'o/shapeless')).toBeUndefined()
  })

  it('meta rate-limited + approved entry → untouched (displays are never re-judged)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-appr-'))
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idxOf([ghE('o/shapeless', { approval: 'approved' })])))
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaStatus: 429, codeloadFiles: SHAPELESS }), now: NOW,
    })
    const e = idx.plugins.find(p => p.name === 'o/shapeless')
    expect(e?.contains).toEqual(['plugin'])
    expect(e?.capabilities.pluginModule).toBeUndefined()
    expect(idx.removed?.find(r => r.name === 'o/shapeless')).toBeUndefined()
  })

  it('persisted shape fields → tombstone with ZERO codeload fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-free-'))
    const oldPath = join(dir, 'old.json')
    const caps = {
      scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [],
      pluginModule: false, skillPayload: false,
    }
    writeFileSync(oldPath, JSON.stringify(idxOf([ghE('o/shapeless', { capabilities: caps })])))
    const calls: string[] = []
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaStatus: 429, codeloadCalls: calls }), now: NOW,
    })
    expect(calls.filter(u => u.includes('codeload'))).toHaveLength(0)
    expect(idx.plugins.find(p => p.name === 'o/shapeless')).toBeUndefined()
    expect(idx.removed?.find(r => r.name === 'o/shapeless')?.reason).toBe('filtered')
  })
})

describe('rescanStaleGh: pending shape-veto now tombstones (npm parity)', () => {
  it('api healthy + stale ruleset + shapeless scan → filtered tombstone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-rescan-'))
    const oldPath = join(dir, 'old.json')
    // rulesetVersion 'r0' forces the rescan; pushedAt matches modifiedAt so
    // only the staleness arm fires
    const stale = ghE('o/shapeless', {
      capabilities: { scannedAt: 't', rulesetVersion: 'r0-old', findings: [], redFlags: [] },
    })
    writeFileSync(oldPath, JSON.stringify(idxOf([stale])))
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaBody: META_OK, codeloadFiles: SHAPELESS }), now: NOW,
    })
    expect(idx.plugins.find(p => p.name === 'o/shapeless')).toBeUndefined()
    expect(idx.removed?.find(r => r.name === 'o/shapeless')?.reason).toBe('filtered')
  })

  it('api healthy + shapeless but SKILL.md → contains [skill], entry kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-resks-'))
    const oldPath = join(dir, 'old.json')
    const stale = ghE('o/shapeless', {
      capabilities: { scannedAt: 't', rulesetVersion: 'r0-old', findings: [], redFlags: [] },
    })
    writeFileSync(oldPath, JSON.stringify(idxOf([stale])))
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ metaBody: META_OK, codeloadFiles: SHAPELESS_SKILL }), now: NOW,
    })
    const e = idx.plugins.find(p => p.name === 'o/shapeless')
    expect(e?.contains).toEqual(['skill'])
    expect(idx.removed?.find(r => r.name === 'o/shapeless')).toBeUndefined()
  })
})

describe('ghWorker transient: in-discovery kept entry heals the same way', () => {
  it('tree rate-limited + pending ghPrev + shapeless pinned → filtered, no resurrection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheal-worker-'))
    const oldPath = join(dir, 'old.json')
    // modifiedAt 'pushA' ≠ candidate pushedAt → reuse fast-path skipped →
    // full path → tree probe → 429 → heal
    writeFileSync(oldPath, JSON.stringify(idxOf([ghE('o/shapeless', { modifiedAt: 'pushA' })])))
    const item = {
      full_name: 'o/shapeless', pushed_at: '2026-05-30T00:00:00Z', id: 42,
      stargazers_count: 5, archived: false, fork: false,
      license: { spdx_id: 'MIT' }, description: 'x', topics: ['opencode-plugin'],
      created_at: '2026-01-01T00:00:00Z', default_branch: 'main',
    }
    const idx = await run({
      outPath: join(dir, 'i.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({ ghItems: [item], treeStatus: 429, codeloadFiles: SHAPELESS }), now: NOW,
    })
    expect(idx.plugins.find(p => p.name === 'o/shapeless')).toBeUndefined()
    expect(idx.removed?.find(r => r.name === 'o/shapeless')?.reason).toBe('filtered')
  })
})
