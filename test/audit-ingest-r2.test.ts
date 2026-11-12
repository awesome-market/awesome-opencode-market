// catalog-ingestion audit round 2 — fresh-audit regressions:
//  A. github-kind approved entries survive evidence regression (npm parity)
//  B. remerge evicts entries tombstoned on the remote after our snapshot
//  C. pendingUpdate.compat — held candidate's engines/peer promote on release
//  D. hasSkillPath .opencode/skills prefix needs a real directory boundary
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { run } from '../pipeline/run.ts'
import { remerge } from '../pipeline/remerge.ts'
import { applyMatureVerdicts, digestStateOf } from '../pipeline/verdicts.ts'
import { hasSkillPath } from '../pipeline/discover/filter.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry, AiVerdict, RemovedEntry } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-02-02T00:00:00Z' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const mkIndex = (plugins: PluginEntry[], removed: RemovedEntry[] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
const mkTgz = (files: Record<string, string> = { 'package.json': '{"name":"x","main":"i.js"}', 'index.js': 'export default {}' }): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), 'ir2tgz-'))
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

interface StubCfg {
  search?: { name: string; version?: string }[]
  ghSearch?: Record<string, unknown>[]
  packument?: (name: string) => unknown
  ghMeta?: Record<string, unknown> | number
  ghTree?: { paths: string[]; sha?: string; truncated?: boolean } | number
  tgz?: Buffer
}
const mkFetch = (cfg: StubCfg) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/-/v1/search')) {
    return new Response(JSON.stringify({ objects: (cfg.search ?? []).map(p => ({
      package: { name: p.name, version: p.version ?? '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' },
    })) }))
  }
  if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: cfg.ghSearch ?? [] }))
  if (url.includes('api.github.com/repos/')) {
    if (url.includes('/git/trees/')) {
      if (cfg.ghTree === 404 || !cfg.ghTree) return new Response('', { status: 404 })
      const t = cfg.ghTree as Exclude<StubCfg['ghTree'], number | undefined>
      return new Response(JSON.stringify({ tree: t.paths.map(path => ({ path })), sha: t.sha ?? 'abc123', truncated: t.truncated ?? false }))
    }
    if (cfg.ghMeta === 404 || !cfg.ghMeta) return new Response('', { status: 404 })
    return new Response(JSON.stringify(cfg.ghMeta))
  }
  if (url.includes('registry.npmjs.org')) {
    const name = decodeURIComponent(url.split('registry.npmjs.org/')[1]!.split('?')[0]!)
    const pk = cfg.packument?.(name)
    if (pk == null) return new Response('', { status: 404 })
    return new Response(JSON.stringify(pk))
  }
  if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
  if (url.includes('codeload.github.com') || url.endsWith('.tgz')) {
    return cfg.tgz ? new Response(new Uint8Array(cfg.tgz)) : new Response('', { status: 404 })
  }
  return new Response('', { status: 404 })
}) as typeof fetch

const ghHit = (over: Record<string, unknown> = {}) => ({
  full_name: 'owner/repo', id: 5, pushed_at: '2026-02-01T00:00:00Z', created_at: '2020-01-01',
  stargazers_count: 9, archived: false, fork: false, default_branch: 'main',
  topics: ['opencode-plugin'], license: { spdx_id: 'MIT' }, ...over,
})

describe('A: github-kind evidence regression — approved slot survives', () => {
  const prevGh = (approval: PluginEntry['approval']) => mkEntry('Owner/Repo', {
    slug: 'owner/repo', discoveredVia: ['github-topic'], approval,
    source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 5, version: 'oldsha' },
    latestVersion: null, modifiedAt: '2026-01-01T00:00:00Z',
    verification: { status: 'verified', level: 'load' },
  })
  const runWith = async (approval: PluginEntry['approval']) => {
    const dir = mkdtempSync(join(tmpdir(), 'ir2-gh-'))
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([prevGh(approval)])))
    return run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, forceGate: true,
      fetchFn: mkFetch({
        ghSearch: [ghHit()],
        ghMeta: { id: 5, full_name: 'Owner/Repo', archived: false },
        // HEAD moved (pushed_at ≠ modifiedAt) and the tree lost every
        // opencode signal — evidence gate fails on fresh data
        ghTree: { paths: ['README.md', 'src/index.js'], sha: 'regresssha' },
      }),
      now: '2026-02-02T00:00:00Z',
    })
  }
  it('approved entry is kept with a finding — not tombstoned', async () => {
    const idx = await runWith('approved')
    expect(idx.plugins).toHaveLength(1)
    const e = idx.plugins[0]!
    expect(e.name).toBe('Owner/Repo')
    expect(e.approval).toBe('approved')
    expect(e.source.version).toBe('oldsha')               // pin untouched
    expect(e.capabilities.findings.some(f => f.startsWith('sec:evidence-regressed@'))).toBe(true)
    expect(idx.removed).toHaveLength(0)
  })
  it('pending entry still tombstones normally (nothing displayed to protect)', async () => {
    const idx = await runWith('pending')
    expect(idx.plugins).toHaveLength(0)
    expect(idx.removed).toHaveLength(1)
    expect(idx.removed[0]!.reason).toBe('filtered')
  })
})

describe('B: remerge — remote tombstones newer than the entry epoch evict', () => {
  const tomb = (name: string, at: string): RemovedEntry => ({
    slug: name.toLowerCase(), name, disappearedAt: at, reason: 'manual',
  })
  it('withdrawn pending entry cannot resurrect through the publish retry', () => {
    // entry was in our snapshot (firstSeenAt old); remote tombstone is newer
    const ours = mkIndex([mkEntry('pkg', { approval: 'pending', firstSeenAt: '2026-01-01' })])
    const remote = mkIndex([], [tomb('pkg', '2026-02-01T00:00:00Z')])
    const out = remerge(ours, remote)
    expect(out.plugins).toHaveLength(0)
    expect(out.removed.some(r => r.name === 'pkg')).toBe(true)   // tombstone survives
  })
  it('an OLDER tombstone does not evict a rediscovered entry', () => {
    // rediscovery this run → firstSeenAt is fresh; the old tombstone predates it
    const ours = mkIndex([mkEntry('pkg', { firstSeenAt: '2026-02-02T00:00:00Z' })])
    const remote = mkIndex([], [tomb('pkg', '2026-01-15T00:00:00Z')])
    const out = remerge(ours, remote)
    expect(out.plugins).toHaveLength(1)
    expect(out.plugins[0]!.name).toBe('pkg')
  })
  it('unrelated tombstones leave live entries alone', () => {
    const ours = mkIndex([mkEntry('pkg'), mkEntry('other')])
    const remote = mkIndex([mkEntry('other')], [tomb('gone', '2026-02-01T00:00:00Z')])
    const out = remerge(ours, remote)
    expect(out.plugins.map(p => p.name).sort()).toEqual(['other', 'pkg'])
  })
})

describe('C: pendingUpdate.compat — the held version\'s engines/peer', () => {
  it('hold surgery stores the candidate compat; display keeps the shown version\'s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ir2-compat-'))
    const tgz = mkTgz()
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([mkEntry('p', {
      approval: 'approved', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'p', version: '1.0.0' },
      compat: { engines: 'node >=18' },
    })])))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({
        search: [{ name: 'p', version: '2.0.0' }],
        packument: () => ({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '1.0.0': { keywords: ['opencode'], main: 'i.js', engines: { node: '>=18' }, dist: { tarball: 'https://x/1.tgz' } },
            '2.0.0': { keywords: ['opencode'], main: 'i.js', engines: { node: '>=20' }, dist: { tarball: 'https://x/2.tgz' } },
          },
          time: { created: '2020-01-01', '1.0.0': 't', '2.0.0': 't2' },
        }),
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'p')!
    expect(e.latestVersion).toBe('1.0.0')                            // display pinned
    expect(e.compat.engines).toContain('node >=18')                 // displayed version's
    expect(e.pendingUpdate?.version).toBe('2.0.0')
    expect(e.pendingUpdate?.compat?.engines).toContain('node >=20')  // candidate's own
  })
  it('release promotes pu.compat; legacy holds without it keep status quo', () => {
    const DIGEST = '2026-02-01T21:00:00Z'
    const BEFORE = '2026-02-01T10:00:00Z'
    const mkPu = (over: Record<string, unknown> = {}) => ({
      version: '1.1.0',
      capabilities: { scannedAt: 't2', findings: [] as string[], redFlags: [] as string[] },
      verification: { status: 'verified' as const },
      heldAt: 'h', integrity: 'sha512-N', ...over,
    })
    const mkVerdict = (name: string, version: string, at: string): AiVerdict =>
      ({ name, version, verdict: 'pass', at, source: 'ai' })
    const e1 = mkEntry('p', { approval: 'approved', compat: { engines: 'node >=18' }, pendingUpdate: mkPu({ compat: { engines: 'node >=20' } }) as PluginEntry['pendingUpdate'] })
    const v1 = mkVerdict('p', '1.1.0', BEFORE)
    const [out1] = applyMatureVerdicts(mkIndex([e1]), [v1], digestStateOf(DIGEST, [v1])).index.plugins
    expect(out1!.latestVersion).toBe('1.1.0')
    expect(out1!.compat.engines).toContain('node >=20')             // candidate promoted
    const e2 = mkEntry('q', { approval: 'approved', compat: { engines: 'node >=18' }, pendingUpdate: mkPu() as PluginEntry['pendingUpdate'] })
    const v2 = mkVerdict('q', '1.1.0', BEFORE)
    const [out2] = applyMatureVerdicts(mkIndex([e2]), [v2], digestStateOf(DIGEST, [v2])).index.plugins
    expect(out2!.compat.engines).toContain('node >=18')              // legacy hold → status quo
  })
})

describe('D: hasSkillPath — .opencode/skills needs a directory boundary', () => {
  it('sibling prefixes and bare files no longer tag a skill part', () => {
    expect(hasSkillPath(new Set(['.opencode/skills-old/README.md']))).toBe(false)
    expect(hasSkillPath(new Set(['pkg/.opencode/skillsfoo/x.js']))).toBe(false)
    expect(hasSkillPath(new Set(['.opencode/skills']))).toBe(false)          // a FILE named skills
    expect(hasSkillPath(new Set(['x/.opencode/skills/y/SKILL.md']))).toBe(true)
    expect(hasSkillPath(new Set(['.opencode/skills/assets/x.js']))).toBe(true) // real dir prefix kept
  })
})
