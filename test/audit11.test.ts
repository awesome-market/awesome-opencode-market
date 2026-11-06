// audit11 — catalog-ingestion audit (task 1): repo-identity URL injection via
// dot-segments, gh-seed repo validation, ghWorker per-candidate isolation,
// hold-pin metrics honesty.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeRepoUrl } from '../pipeline/discover/github.ts'
import { run } from '../pipeline/run.ts'
import { REJECT_REASONS } from '../pipeline/submission-status.ts'

const TGZ_STUB = { 'package.json': JSON.stringify({ name: 'x', main: 'i.js' }), 'index.js': 'export default {}' }

// same fetch-stub shape as audit10: routes npm search/packument/tarball +
// github search/meta/tree/raw/codeload; anything unconfigured 404s
const mkFetch = (cfg: {
  search?: { name: string }[]
  packument?: (name: string) => unknown
  ghMeta?: Record<string, unknown> | number
  ghTree?: { paths: string[]; sha?: string } | number
  tgz?: Buffer
} = {}) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/-/v1/search')) {
    return new Response(JSON.stringify({ objects: (cfg.search ?? []).map(p => ({
      package: { name: p.name, version: '1.0.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' },
    })) }))
  }
  if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
  if (url.includes('api.github.com/repos/')) {
    if (url.includes('/git/trees/')) {
      if (!cfg.ghTree || cfg.ghTree === 404) return new Response('', { status: 404 })
      const t = cfg.ghTree as Exclude<typeof cfg.ghTree, number | undefined>
      return new Response(JSON.stringify({ tree: t.paths.map(path => ({ path })), sha: t.sha ?? 'abc123' }))
    }
    if (!cfg.ghMeta || cfg.ghMeta === 404) return new Response('', { status: 404 })
    return new Response(JSON.stringify(cfg.ghMeta))
  }
  if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 404 })
  if (url.includes('registry.npmjs.org')) {
    const name = decodeURIComponent(url.split('registry.npmjs.org/')[1]!.split('?')[0]!)
    const pk = cfg.packument?.(name)
    if (pk == null) return new Response('', { status: 404 })
    return new Response(JSON.stringify(pk))
  }
  if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 5 }))
  if (url.includes('codeload.github.com') || url.endsWith('.tgz')) {
    return cfg.tgz ? new Response(new Uint8Array(cfg.tgz)) : new Response('', { status: 404 })
  }
  return new Response('', { status: 404 })
}) as typeof fetch

function mkTgz(files: Record<string, string> = TGZ_STUB): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'a11tgz-'))
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
const pkWith = (name: string) => ({
  'dist-tags': { latest: '1.0.0' },
  versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: `https://x/${name}.tgz` } } },
  time: { created: '2020-01-01', '1.0.0': 't1' },
})

describe('normalizeRepoUrl — dot-segment / charset guard', () => {
  it('rejects traversal and malformed repo identities', () => {
    for (const bad of ['../x', 'github.com/../x', 'https://github.com/../repos/o/r', 'a/./b', 'a b/c', 'a/%2e%2e/c', 'o//r', 'a/b/c', '']) {
      expect(normalizeRepoUrl(bad), bad).toBeNull()
    }
  })
  it('still accepts every legit form', () => {
    expect(normalizeRepoUrl('owner/repo')).toBe('owner/repo')
    expect(normalizeRepoUrl('Owner/Repo')).toBe('Owner/Repo')
    expect(normalizeRepoUrl('github:o/r')).toBe('o/r')
    expect(normalizeRepoUrl('https://github.com/o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('git@github.com:o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('owner/re.po_with-dash')).toBe('owner/re.po_with-dash')
    // GitHub owners are alnum+hyphen — 'github.com/a' is NOT owner/repo
    expect(normalizeRepoUrl('github.com/a')).toBeNull()
    expect(normalizeRepoUrl('git hub/o/r')).toBeNull()
  })
})

describe('run — gh seed repo must be canonical owner/repo', () => {
  it('repo-only seed with traversal repo → invalid-repo outcome, no entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11-badrepo-'))
    const seed = join(dir, 's.txt')
    writeFileSync(seed, JSON.stringify({ repo: '../repos/o/r', issue: 7 }) + '\n')
    const outcomes = join(dir, 'out.json')
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seed, seedOutcomesPath: outcomes,
      fetchFn: mkFetch({ tgz: mkTgz() }), now: '2026-11-06T00:00:00Z', forceGate: true,
    })
    expect(idx.plugins).toHaveLength(0)
    const oc = JSON.parse(readFileSync(outcomes, 'utf8'))
    expect(oc['../repos/o/r']).toBe('invalid-repo')
    expect(REJECT_REASONS['invalid-repo']).toBeTruthy()
  })

  it('name+repo seed with malformed repo → npm entry survives, repo hint dropped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11-namerepo-'))
    const seed = join(dir, 's.txt')
    writeFileSync(seed, JSON.stringify({ name: 'good-pkg', repo: '../x', issue: 9 }) + '\n')
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seed,
      fetchFn: mkFetch({ search: [{ name: 'good-pkg' }], packument: n => pkWith(n), tgz: mkTgz() }),
      now: '2026-11-06T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'good-pkg')
    expect(e).toBeTruthy()
    // the bad repo hint must not leak into source.repo or the slug
    expect(e!.source.repo).not.toBe('../x')
    expect(e!.slug).not.toContain('..')
  })

  it('legacy github: line with traversal → ignored with warning, no entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11-ghline-'))
    const seed = join(dir, 's.txt')
    writeFileSync(seed, 'github:../repos/o/r\n')
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seed,
      fetchFn: mkFetch({ tgz: mkTgz() }), now: '2026-11-06T00:00:00Z', forceGate: true,
    })
    expect(idx.plugins).toHaveLength(0)
  })

  it('well-formed repo-only JSON seed still lands github-kind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11-goodrepo-'))
    const seed = join(dir, 's.txt')
    writeFileSync(seed, JSON.stringify({ repo: 'Owner/Repo', issue: 3 }) + '\n')
    const idx = await run({
      outPath: join(dir, 'i.json'), seedPath: seed,
      fetchFn: mkFetch({
        ghMeta: { id: 1, full_name: 'Owner/Repo', archived: false, pushed_at: 't', created_at: '2020-01-01', stargazers_count: 2 },
        ghTree: { paths: ['.opencode/plugin/x.js', 'package.json'], sha: 'sha1' },
        tgz: mkTgz(),
      }),
      now: '2026-11-06T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.source.kind === 'github')
    expect(e).toBeTruthy()
    expect(e!.slug).toBe('owner/repo')
    expect(e!.name).toBe('Owner/Repo')
  })
})
