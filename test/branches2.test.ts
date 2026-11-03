import { describe, it, expect } from 'vitest'
import { searchByKeyword, discoverNpm } from '../pipeline/discover/npm.ts'
import { searchTopic, discoverGithub } from '../pipeline/discover/github.ts'
import { fetchPackument } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, repoFileExists } from '../pipeline/fetch/github.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { PluginEntry } from '../src/schema.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })
const mkEntry = (name: string, v = '1'): PluginEntry => ({
  name, slug: name, aliases: ['x'], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: '' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2020-01-01', latestVersion: v, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
})

describe('branches round 2', () => {
  it('npm search: full page then short page', async () => {
    let n = 0
    const f = async () => {
      n++
      return mkRes({ objects: n === 1
        ? Array.from({ length: 250 }, (_, i) => ({ package: { name: `p${i}`, version: '1' } }))
        : [{ package: { name: 'last', version: '1' } }] })
    }
    expect((await searchByKeyword('k', { fetchFn: f as typeof fetch, size: 250 })).length).toBe(251)
  })
  it('discoverNpm: same pkg via second keyword appends channel once', async () => {
    let kw = ''
    const f = async (input: RequestInfo | URL) => {
      kw = String(input)
      return mkRes({ objects: [{ package: { name: 'dup', version: '1', links: {} } }] })
    }
    const m = await discoverNpm(['a', 'b'], { fetchFn: f as typeof fetch })
    expect(m.get('dup')!.discoveredVia).toEqual(['npm-keyword'])
    expect(kw).toContain('b')
  })
  it('discoverGithub: existing entry keeps single channel', async () => {
    const f = async () => mkRes({ items: [{ full_name: 'o/r', description: null, archived: false, fork: true, pushed_at: null, stargazers_count: 0, default_branch: 'main' }] })
    const m = await discoverGithub(['t1', 't2'], { fetchFn: f as typeof fetch })
    expect(m.get('o/r')!.discoveredVia).toEqual(['github-topic'])
  })
  it('fetchPackument: lic object without type + deprecated', async () => {
    const doc = { 'dist-tags': { latest: '1' },
      versions: { '1': { license: {}, deprecated: 'yes', dist: {} } }, time: {} }
    const { pk: p } = await fetchPackument('x', { fetchFn: (async () => mkRes(doc)) as typeof fetch })
    expect(p!.license).toBeNull()
    expect(p!.deprecated).toBe(true)
    expect(p!.repository).toBeNull()
  })
  it('fetchRepoMeta: archived true + missing license block + token', async () => {
    const f = async (_i: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      return mkRes({ stargazers_count: 0, archived: true, pushed_at: 't' })
    }
    const { meta: r } = await fetchRepoMeta('o/r', { token: 'tok', fetchFn: f as typeof fetch })
    expect(r).toMatchObject({ archived: true, license: null })
  })
  it('repoFileExists: branch param in query', async () => {
    let seen = ''
    const f = async (input: RequestInfo | URL) => { seen = String(input); return new Response('', { status: 200 }) }
    await repoFileExists('o/r', 'SKILL.md', { branch: 'dev', token: 't', fetchFn: f as typeof fetch })
    expect(seen).toContain('ref=dev')
  })
  it('scanTarball: AppleDouble ._ files skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc3-'))
    mkdirSync(join(dir, 'pkg'))
    writeFileSync(join(dir, 'pkg/package.json'), '{"name":"p"}')
    writeFileSync(join(dir, 'pkg/index.js'), 'x=1')
    // macOS tar without COPYFILE_DISABLE emits ._ files
    execFileSync('tar', ['-czf', dir + '/p.tgz', '-C', dir, 'pkg'])
    const r = await scanTarball(readFileSync(dir + '/p.tgz'))
    expect(r.findings.filter(f => f.rule === 'binary-blob')).toHaveLength(0)
  })
  it('mergeEntries: aliases + discoveredVia union', () => {
    const old = { version: '1' as const, generatedAt: 'x', categories: {},
      plugins: [{ ...mkEntry('a'), aliases: ['old-alias'], discoveredVia: ['github-topic' as const] }], removed: [] }
    const merged = mergeEntries([{ ...mkEntry('a'), aliases: ['new-alias'] }], old, '2.2.5')
    expect(merged[0]!.aliases).toEqual(expect.arrayContaining(['old-alias', 'new-alias']))
    expect(merged[0]!.discoveredVia).toContain('github-topic')
  })
  it('run: redFlag entry → verification.skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rtgz-'))
    mkdirSync(join(dir, 'pkg'))
    writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'evil', scripts: { postinstall: 'x' } }))
    execFileSync('tar', ['-czf', dir + '/p.tgz', '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const tgz = readFileSync(dir + '/p.tgz')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'evil-pkg', version: '1', description: '', keywords: ['opencode'], links: { repository: 'https://github.com/o/e' }, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/evil-pkg')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/e', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } }, time: {} })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, archived: false, pushed_at: 't' })
      if (url.includes('/contents/SKILL.md')) return new Response('', { status: 200 }) // hasSkill branch
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = join(mkdtempSync(join(tmpdir(), 'ro-')), 'i.json')
    const idx = await run({ outPath: out, fetchFn: f, now: 't' })
    const e = idx.plugins[0]!
    expect(e.verification.status).toBe('skipped')
    expect(e.capabilities.redFlags.length).toBeGreaterThan(0)
    expect(e.contains).toEqual(['skill'])
  })
})
