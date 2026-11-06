// coverage11 — catalog-ingestion audit batch: cap semantics, repo-identity
// case normalisation, compat fill, seed-gh meta backfill, redirect hardening,
// obfuscation scoping, binary-severity, prerelease ordering, forceGate.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { compatStrings, fetchPackument, fetchTarball } from '../pipeline/fetch/npm.ts'
import { versionCmp } from '../pipeline/publish/merge.ts'
import { hasRepoEvidence, hasSkillPath } from '../pipeline/discover/filter.ts'
import { normalizeRepoUrl } from '../pipeline/discover/github.ts'
import { parseSubmission } from '../pipeline/submission.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { mapPool } from '../pipeline/pool.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

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
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})

function mkTgz(files: Record<string, string | Uint8Array>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'a10tgz-'))
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

// One fetch stub routes the whole pipeline surface: npm search/packument/
// tarball/downloads + github search/meta/tree/raw/codeload. Anything not
// configured 404s — fail-closed is the pipeline's default posture.
interface StubCfg {
  search?: { name: string; version?: string }[]
  ghSearch?: Record<string, unknown>[]
  packument?: (name: string) => unknown
  ghMeta?: Record<string, unknown> | number
  ghTree?: { paths: string[]; sha?: string; truncated?: boolean } | number
  ghRaw?: Record<string, unknown> | number
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
  if (url.includes('raw.githubusercontent.com')) {
    if (cfg.ghRaw === 404 || !cfg.ghRaw) return new Response('', { status: 404 })
    return new Response(JSON.stringify(cfg.ghRaw))
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

const pkWith = (name: string, version = '1.0.0', over: Record<string, unknown> = {}) => ({
  'dist-tags': { latest: version },
  versions: { [version]: { keywords: ['opencode'], main: 'index.js', dist: { tarball: `https://x/${name}.tgz` }, ...over } },
  time: { created: '2020-01-01', [version]: 't1' },
})

describe('compatStrings — attacker-capped compat display', () => {
  it('string engines / object engines / peer object → display strings', () => {
    expect(compatStrings('>=18', undefined)).toEqual({ engines: '>=18' })
    expect(compatStrings({ node: '>=18', npm: '9' }, { react: '^17' })).toEqual({ engines: 'node >=18; npm 9', peer: 'react@^17' })
    expect(compatStrings(undefined, undefined)).toEqual({})
    expect(compatStrings(['weird'], 'nope')).toEqual({})
  })
  it('length caps hold', () => {
    const c = compatStrings('x'.repeat(400), { a: 'y'.repeat(600) })
    expect(c.engines!.length).toBe(300)
    expect(c.peer!.length).toBe(500)
  })
})

describe('versionCmp — prerelease ordering', () => {
  it.each([
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-1', '1.0.0-rc', -1],        // numeric identifier < alphanumeric
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0-beta.5', '1.0.0', -1],
    ['1.0.0-beta.5', '1.0.0-beta.5', 0],
    ['abc', '1.0.0', 0],
    [null, '1.0.0', 0],
  ])('%s vs %s → %d', (a, b, want) => expect(versionCmp(a, b)).toBe(want))
})

describe('normalizeRepoUrl — github: shorthand', () => {
  it('github:owner/repo parses like the full URL form', () => {
    expect(normalizeRepoUrl('github:owner/repo')).toBe('owner/repo')
    expect(normalizeRepoUrl('github:Owner/Repo#deadbeef')).toBe('Owner/Repo')
    expect(normalizeRepoUrl('gitlab:owner/repo')).toBeNull()
    expect(normalizeRepoUrl('git+ssh://git@github.com/owner/repo.git')).toBe('owner/repo')
  })
})

describe('hasRepoEvidence — monorepo depth + R-4 specificity', () => {
  it('nested .opencode/ counts at any depth', () => {
    const ev = hasRepoEvidence(new Set(['packages/x/.opencode/plugin/a.js', 'packages/x/package.json']), [])
    expect(ev.ok).toBe(true)
    expect(ev.via).toContain('opencode-dir')
    expect(ev.via).toContain('opencode-artifact')
  })
  it('bare SKILL.md is not opencode-specific; opencode-skill topic lifts it', () => {
    expect(hasRepoEvidence(new Set(['skills/x/SKILL.md']), []).ok).toBe(false)
    expect(hasRepoEvidence(new Set(['skills/x/SKILL.md']), ['opencode-skill']).ok).toBe(true)
  })
  it('hasSkillPath sees nested skill payloads', () => {
    expect(hasSkillPath(new Set(['a/b/SKILL.md']))).toBe(true)
    expect(hasSkillPath(new Set(['x/.opencode/skills/y/SKILL.md']))).toBe(true)
    expect(hasSkillPath(new Set(['README.md']))).toBe(false)
  })
})

describe('parseSubmission — label aliases + repo lowercase', () => {
  it('npm 包名或 owner/repo label resolves the package name', () => {
    const s = parseSubmission('### npm 包名或 owner/repo\n\nmy-pkg\n\n### 类型\n\nskill\n')
    expect(s.name).toBe('my-pkg')
    expect(s.type).toBe('skill')
  })
  it('repo field is canonicalised lowercase', () => {
    const s = parseSubmission('### GitHub repository / GitHub 仓库地址\n\nhttps://github.com/Owner/Repo.git\n')
    expect(s.repo).toBe('owner/repo')
    expect(s.kind).toBe('repo')
  })
})

describe('fetchTarball — redirect chain hardening', () => {
  const mkRes = (status: number, init: { location?: string; body?: string } = {}) =>
    new Response(init.body ?? null, { status, headers: init.location ? { location: init.location } : {} })
  it('rejects non-https entry urls', async () => {
    await expect(fetchTarball('http://x/p.tgz', { fetchFn: fetch })).rejects.toThrow('must be https')
    await expect(fetchTarball('file:///etc/passwd', { fetchFn: fetch })).rejects.toThrow('must be https')
  })
  it('rejects redirect downgrade to http', async () => {
    const f = (async () => mkRes(302, { location: 'http://evil/x.tgz' })) as typeof fetch
    await expect(fetchTarball('https://x/p.tgz', { fetchFn: f })).rejects.toThrow('non-https')
  })
  it('rejects missing Location and >5 hops', async () => {
    const noLoc = (async () => mkRes(302)) as typeof fetch
    await expect(fetchTarball('https://x/p.tgz', { fetchFn: noLoc })).rejects.toThrow('without Location')
    const loop = (async () => mkRes(302, { location: 'https://x/next.tgz' })) as typeof fetch
    await expect(fetchTarball('https://x/p.tgz', { fetchFn: loop })).rejects.toThrow('>5 hops')
  })
  it('follows a legit https chain', async () => {
    let n = 0
    const f = (async () => {
      n++
      return n <= 2 ? mkRes(302, { location: `https://cdn/hop${n}.tgz` }) : mkRes(200, { body: 'payload' })
    }) as typeof fetch
    const buf = await fetchTarball('https://x/p.tgz', { fetchFn: f })
    expect(buf.toString()).toBe('payload')
    expect(n).toBe(3)
  })
})

describe('fetchPackument — abbreviated document reuse', () => {
  it('sends the install-v1 Accept header and still parses latest', async () => {
    let accept: string | null = null
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      accept = (init?.headers as Record<string, string>)?.Accept ?? null
      return new Response(JSON.stringify({ 'dist-tags': { latest: '9.9.9' }, versions: { '9.9.9': { dist: { tarball: 'https://x/t.tgz' } } } }))
    }) as typeof fetch
    const { pk, status } = await fetchPackument('p', { fetchFn: f, abbreviated: true })
    expect(status).toBe('ok')
    expect(accept).toBe('application/vnd.npm.install-v1+json')
    expect(pk!.latest).toBe('9.9.9')
    expect(pk!.tarballUrl).toBe('https://x/t.tgz')
  })
})

describe('scan — code-scoped obfuscation + known-binary severity', () => {
  it('eval( in docs is ignored; in code it flags', async () => {
    const r = await scanTarball(mkTgz({
      'package.json': JSON.stringify({ name: 'p' }),
      'README.md': 'you can eval(code) like this',
      'evil.ts': 'eval(input); new Function("x")',
    }))
    const obf = r.findings.filter(f => f.rule === 'obfuscation')
    expect(obf).toHaveLength(1)
    expect(obf[0]!.file).toContain('evil.ts')
    expect(r.redFlags.some(f => f.rule === 'obfuscation')).toBe(true)
  })
  it('wasm/native payloads are medium findings, not red flags', async () => {
    const bin = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
    const r = await scanTarball(mkTgz({
      'package.json': JSON.stringify({ name: 'p' }),
      'parser.wasm': bin,
      'addon.node': bin,
    }))
    const blobs = r.findings.filter(f => f.rule === 'binary-blob')
    expect(blobs.length).toBe(2)
    expect(blobs.every(f => f.severity === 'medium')).toBe(true)
    expect(r.redFlags).toHaveLength(0)
    // an UNKNOWN binary type still flags high
    const r2 = await scanTarball(mkTgz({ 'package.json': JSON.stringify({ name: 'p' }), 'mystery.xyz': bin }))
    expect(r2.findings.find(f => f.rule === 'binary-blob')!.severity).toBe('high')
  })
})

describe('mapPool — bounded concurrency', () => {
  it('never exceeds the cap and drains every item', async () => {
    let live = 0, peak = 0, done = 0
    await mapPool(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--; done++
    })
    expect(done).toBe(30)
    expect(peak).toBeLessThanOrEqual(4)
  })
})

describe('run — cap bounds NEW candidates only (存量+seed 豁免)', () => {
  it('existing entries do not consume the new-discovery budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-cap-'))
    // a,b already in the index (ruleset current → reuse path); c,d are NEW.
    // Old semantics: newCap = 2-2 = 0 → c,d silently never admitted.
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([mkEntry('a'), mkEntry('b')])))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, maxEntries: 2,
      fetchFn: mkFetch({ search: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }], packument: n => pkWith(n), tgz }),
      now: '2026-02-02T00:00:00Z',
    })
    const names = idx.plugins.map(p => p.name).sort()
    expect(names).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('run — compat fill from packument + repo package.json', () => {
  it('npm entry compat carries engines/peerDependencies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-compat-'))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'),
      fetchFn: mkFetch({
        search: [{ name: 'x' }],
        packument: () => pkWith('x', '1.0.0', { engines: { node: '>=18' }, peerDependencies: { opencode: '^1' } }),
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'x')!
    expect(e.compat.engines).toContain('node >=18')
    expect(e.compat.peer).toContain('opencode@^1')
  })
})

describe('run — seed github: candidate backfills real repo meta', () => {
  it('repoId/canonical-casing/stars anchored before the evidence gate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-seedgh-'))
    const seedPath = join(dir, 'seeds.txt')
    writeFileSync(seedPath, 'github:owner/repo\n')
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x' }), 'x.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), seedPath,
      fetchFn: mkFetch({
        ghMeta: { id: 42, full_name: 'Owner/Repo', created_at: '2020-01-01', pushed_at: '2026-01-10T00:00:00Z', stargazers_count: 7, archived: false, default_branch: 'main', topics: ['opencode-plugin'] },
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'], sha: 'deadbeef' },
        ghRaw: { name: 'x', engines: { node: '>=18' } },
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.slug === 'owner/repo')!
    expect(e).toBeTruthy()
    expect(e.name).toBe('Owner/Repo')                       // canonical API casing
    expect(e.source.repoId).toBe(42)                       // repojacking anchor
    expect(e.source.version).toBe('deadbeef')
    expect(e.createdAt).toBe('2020-01-01')                 // name-reuse tombstone anchor
    expect(e.metrics.stars).toBe(7)
    expect(e.compat.engines).toContain('node >=18')        // repo package.json compat
    expect(e.discoveredVia).toContain('submission')
  })
  it('archived seed repo is rejected before admission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-seedarch-'))
    const seedPath = join(dir, 'seeds.txt')
    writeFileSync(seedPath, 'github:owner/repo\n')
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), seedPath,
      fetchFn: mkFetch({
        search: [{ name: 'x' }], packument: n => pkWith(n), tgz,
        ghMeta: { id: 42, full_name: 'Owner/Repo', archived: true },
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'] },
      }),
      now: '2026-02-02T00:00:00Z',
    })
    expect(idx.plugins.find(p => p.slug === 'owner/repo')).toBeUndefined()
    expect(idx.plugins.find(p => p.name === 'x')).toBeTruthy()
  })
})

describe('run — github identity is case-insensitive', () => {
  it('Owner/Repo stored + owner/repo candidate → reuse, single entry, name stable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-ghcase-'))
    const prev = mkEntry('Owner/Repo', {
      slug: 'owner/repo', discoveredVia: ['github-topic'],
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 5 },
      latestVersion: null, modifiedAt: '2026-01-10T00:00:00Z',
      verification: { status: 'skipped', level: 'install' },
    })
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([prev])))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath,
      fetchFn: mkFetch({
        ghSearch: [{ full_name: 'owner/repo', id: 5, pushed_at: '2026-01-10T00:00:00Z', created_at: '2020-01-01', stargazers_count: 9, archived: false, fork: false, default_branch: 'main', topics: ['opencode-plugin'] }],
      }),
      now: '2026-02-02T00:00:00Z',
    })
    expect(idx.plugins).toHaveLength(1)
    expect(idx.plugins[0]!.name).toBe('Owner/Repo')        // established casing wins
    expect(idx.plugins[0]!.metrics.stars).toBe(9)          // metrics refreshed from search
    expect(idx.removed).toHaveLength(0)                    // no phantom tombstone
  })
})

describe('run — declared skill type does not strip a real plugin entry point', () => {
  it('type=skill seed + main + SKILL.md → contains both parts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-skillparts-'))
    const seedPath = join(dir, 'seeds.txt')
    writeFileSync(seedPath, JSON.stringify({ name: 'sp', type: 'skill' }) + '\n')
    const tgz = mkTgz({
      'package.json': JSON.stringify({ name: 'sp', main: 'index.js' }),
      'index.js': 'export default {}',
      'SKILL.md': '# skill',
    })
    const idx = await run({
      outPath: join(dir, 'out.json'), seedPath,
      fetchFn: mkFetch({ search: [], packument: n => pkWith(n), tgz }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'sp')!
    expect(e.contains).toContain('plugin')
    expect(e.contains).toContain('skill')
    expect(e.type).toBe('skill')                           // the badge follows the declaration
  })
})

describe('run — forceGate + resilience edges', () => {
  const tenOld = () => mkIndex(Array.from({ length: 10 }, (_, i) => mkEntry(`old${i}`)))
  it('corruption gate throws; --force-gate publishes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-gate-'))
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(tenOld()))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    // old names must 404 their gone-check probe or the gate never sees a drop
    const cfg: StubCfg = { search: [{ name: 'x' }], packument: n => n === 'x' ? pkWith(n) : null, tgz }
    await expect(run({ outPath: join(dir, 'o1.json'), oldIndexPath: oldPath, fetchFn: mkFetch(cfg), now: '2026-02-02T00:00:00Z' }))
      .rejects.toThrow('publish gate')
    const idx = await run({ outPath: join(dir, 'o2.json'), oldIndexPath: oldPath, fetchFn: mkFetch(cfg), forceGate: true, now: '2026-02-02T00:00:00Z' })
    expect(idx.plugins.map(p => p.name)).toEqual(['x'])
    expect(idx.removed).toHaveLength(10)
  })
  it('missing seed file warns but does not abort the run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-noseed-'))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), seedPath: join(dir, 'does-not-exist.txt'),
      fetchFn: mkFetch({ search: [{ name: 'x' }], packument: () => pkWith('x'), tgz }),
      now: '2026-02-02T00:00:00Z',
    })
    expect(idx.plugins.find(p => p.name === 'x')).toBeTruthy()
  })
  it('blocklist rows written in display case still block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-bl-'))
    writeFileSync(join(dir, 'bl.json'), JSON.stringify({ names: ['Bad-Pkg'], slugs: [] }))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), blocklistPath: join(dir, 'bl.json'),
      fetchFn: mkFetch({ search: [{ name: 'bad-pkg' }, { name: 'x' }], packument: n => pkWith(n), tgz }),
      now: '2026-02-02T00:00:00Z',
    })
    expect(idx.plugins.find(p => p.name === 'bad-pkg')).toBeUndefined()
    expect(idx.plugins.find(p => p.name === 'x')).toBeTruthy()
  })
  it('truncated tree still admits on evidence but records sec:tree-truncated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-trunc-'))
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x' }), 'x.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'),
      fetchFn: mkFetch({
        ghSearch: [{ full_name: 'o/r', id: 1, pushed_at: '2026-01-10T00:00:00Z', created_at: '2020-01-01', archived: false, fork: false, default_branch: 'main', topics: ['opencode-plugin'] }],
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'], sha: 'abc', truncated: true },
        ghRaw: { name: 'x' },
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.slug === 'o/r')
    expect(e).toBeTruthy()
    expect(e!.capabilities.findings).toContain('sec:tree-truncated')
  })
})

describe('run — ruleset rescan keeps github drift flags (aged-out entries)', () => {
  // gone-check → rescanStaleGh re-anchors source.version to the new HEAD just
  // like ghWorker does — without the drift flags a moved repo would silently
  // re-point an approved entry's install pin at unreviewed bytes
  it('approved github entry aged out + moved HEAD → sec:repo-moved-since-release', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-ghrescan-'))
    const prev = mkEntry('Owner/Repo', {
      slug: 'owner/repo', discoveredVia: ['github-topic'],
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 5, version: 'oldsha' },
      latestVersion: null, approval: 'approved',
      capabilities: { scannedAt: 't', rulesetVersion: 'r0', findings: [], redFlags: [] },
    })
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([prev])))
    const vf = join(dir, 'v.jsonl')
    writeFileSync(vf, JSON.stringify({
      name: 'Owner/Repo', version: null, verdict: 'pass', source: 'human',
      at: '2026-01-15T00:00:00Z', sha: 'oldsha', by: 'terry',
    }) + '\n')
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf,
      fetchFn: mkFetch({
        ghMeta: { id: 5, full_name: 'Owner/Repo', archived: false, pushed_at: '2026-01-20T00:00:00Z', created_at: '2020-01-01', stargazers_count: 3 },
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'], sha: 'newsha0000000000000000000001' },
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.slug === 'owner/repo')!
    expect(e).toBeTruthy()
    expect(e.source.version).toBe('newsha0000000000000000000001')
    expect(e.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(e.capabilities.redFlags).toContain('sec:repo-moved-since-release:newsha000000')
    expect(idx.removed).toHaveLength(0)
  })
  it('same-sha rescan adds no drift flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a10-ghrescan2-'))
    const prev = mkEntry('Owner/Repo', {
      slug: 'owner/repo', discoveredVia: ['github-topic'],
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 5, version: 'samehash' },
      latestVersion: null, approval: 'approved',
      capabilities: { scannedAt: 't', rulesetVersion: 'r0', findings: [], redFlags: [] },
    })
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify(mkIndex([prev])))
    const vf = join(dir, 'v.jsonl')
    writeFileSync(vf, JSON.stringify({
      name: 'Owner/Repo', version: null, verdict: 'pass', source: 'human',
      at: '2026-01-15T00:00:00Z', sha: 'samehash', by: 'terry',
    }) + '\n')
    const tgz = mkTgz({ 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' })
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf,
      fetchFn: mkFetch({
        ghMeta: { id: 5, full_name: 'Owner/Repo', archived: false, pushed_at: '2026-01-20T00:00:00Z', created_at: '2020-01-01', stargazers_count: 3 },
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'], sha: 'samehash' },
        tgz,
      }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.slug === 'owner/repo')!
    expect(e.capabilities.redFlags.filter(f => f.startsWith('sec:repo-moved'))).toHaveLength(0)
  })
})
