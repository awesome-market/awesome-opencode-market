import { describe, it, expect } from 'vitest'
import { searchByKeyword } from '../pipeline/discover/npm.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { fetchPackument } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta } from '../pipeline/fetch/github.ts'
import { RULES } from '../pipeline/scan/rules.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { cacheKey } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

describe('branch coverage', () => {
  it('searchByKeyword default opts + missing fields', async () => {
    const f = async () => mkRes({ objects: [{ package: { name: 'x', version: '1' } }] })
    const r = await searchByKeyword('k', { fetchFn: f as typeof fetch })
    expect(r[0]).toMatchObject({ description: '', keywords: [], repoUrl: null, publishedAt: null })
  })
  it('searchTopic stops on non-ok + paginates full page', async () => {
    let calls = 0
    const f = async () => {
      calls++
      if (calls === 1) return mkRes({ items: Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, description: null, archived: false, fork: false, pushed_at: null, stargazers_count: 0, default_branch: 'main' })) })
      return mkRes({}, 403)
    }
    const r = await searchTopic('t', { fetchFn: f as typeof fetch })
    expect(r).toHaveLength(100)
  })
  it('fetchPackument: no dist-tags / missing version record', async () => {
    const { pk: p1 } = await fetchPackument('x', { fetchFn: (async () => mkRes({ versions: {}, time: {} })) as typeof fetch })
    expect(p1!.latest).toBeNull()
    const { pk: p2 } = await fetchPackument('x', { fetchFn: (async () => mkRes({ 'dist-tags': { latest: '9' }, versions: {}, time: {} })) as typeof fetch })
    expect(p2!.tarballUrl).toBeNull()
    expect(p2!.latestPublishedAt).toBeNull()
  })
  it('fetchRepoMeta null on non-ok', async () => {
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).status).toBe('not-found')
  })
  it('rules: non-matching paths', () => {
    const life = RULES.find(r => r.id === 'lifecycle-script')!
    expect(life.test('package/package.json', '{"scripts":{}}')).toBeNull()
    const net = RULES.find(r => r.id === 'network-call')!
    expect(net.test('f.js', null)).toBeNull()
    expect(net.test('f.js', 'no net here')).toBeNull()
    const ip = RULES.find(r => r.id === 'literal-ip')!
    expect(ip.test('f.js', null)).toBeNull()
    expect(ip.test('f.js', 'no ips')).toBeNull()
    const obf = RULES.find(r => r.id === 'obfuscation')!
    expect(obf.test('f.js', null)).toBeNull()
    expect(obf.test('f.js', 'clean code')).toBeNull()
    expect(obf.test('f.js', 'x' + '\\x41'.repeat(9))).toBeTruthy() // hex blob branch
    const cred = RULES.find(r => r.id === 'credential-read')!
    expect(cred.test('f.js', null)).toBeNull()
    expect(cred.test('f.js', 'safe')).toBeNull()
    expect(cred.test('README.md', 'reads ~/.ssh/id_rsa')).toBeNull()  // docs don't fire
    expect(cred.test('f.ts', 'fs.read("~/.ssh/id_rsa")')).toBeTruthy() // code does
    const cp = RULES.find(r => r.id === 'child-process')!
    expect(cp.test('f.js', null)).toBeNull()
    expect(cp.test('f.js', 'plain')).toBeNull()
    const prep = RULES.find(r => r.id === 'prepare-script')!
    expect(prep.test('other.js', '"prepare":"x"')).toBeNull()
    expect(prep.test('a/package.json', '{"prepare":"x"}')).toBeTruthy()
  })
  it('scanTarball: dirs + non-text files skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc2-'))
    mkdirSync(join(dir, 'pkg/sub'), { recursive: true })
    writeFileSync(join(dir, 'pkg/package.json'), '{"name":"p"}')
    writeFileSync(join(dir, 'pkg/sub/data.dat'), 'eval(hide) .ssh') // non-text ext: skipped
    execFileSync('tar', ['-czf', dir + '/p.tgz', '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const r = await scanTarball(readFileSync(dir + '/p.tgz'))
    expect(r.fileCount).toBe(2)
    expect(r.findings).toHaveLength(0)
  })
  it('cacheKey null version', () => {
    expect(cacheKey({ name: 'a', latestVersion: null }, '2')).toBe('a@?+2')
  })
  it('run: packument 404 skipped + scan failure tolerated', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'gone', version: '1', description: '', keywords: ['opencode'], links: {}, date: 't' } },
        { package: { name: 'evid', version: '1', description: '', keywords: ['opencode'], links: { repository: 'https://github.com/o/e' }, date: 't' } },
      ] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('gone')) return mkRes({}, 404)
      if (url.includes('registry.npmjs.org/evid')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/e', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/bad.tgz' } } },
        time: {},
      })
      if (url.includes('x/bad.tgz')) return mkRes({}, 500)
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, archived: false, pushed_at: 't' })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const dir = mkdtempSync(join(tmpdir(), 'run2-'))
    const idx = await run({ outPath: join(dir, 'i.json'), fetchFn: f, now: 't' })
    // evid survives (scan failure tolerated, scannedAt stays null); gone dropped
    expect(idx.plugins.map(p => p.name)).toEqual(['evid'])
    expect(idx.plugins[0]!.capabilities.scannedAt).toBeNull()
  })
  it('run: old index merge via oldIndexPath', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run3-'))
    const oldPath = join(dir, 'old.json')
    writeFileSync(oldPath, JSON.stringify({ version: '1', generatedAt: 'x', categories: { tools: { en: 'Custom' } },
      plugins: [{ name: 'evid', slug: 'o/e', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
        source: { kind: 'npm', id: 'evid' }, description: { en: '' }, category: [], license: null,
        deprecated: false, replacement: null, firstSeenAt: '2020-01-01', latestVersion: '1', publishedAt: null,
        metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
        capabilities: { scannedAt: 's', findings: ['f'], redFlags: [] },
        verification: { status: 'verified' }, compat: {} }] }))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'evid', version: '1', description: '', keywords: ['opencode'], links: { repository: 'https://github.com/o/e' }, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/evid')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/e', keywords: ['opencode'], main: 'i.js', dist: {} } }, time: {} })
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, archived: false, pushed_at: 't' })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    expect(idx.plugins[0]!.verification.status).toBe('verified') // merged from old
    expect(idx.plugins[0]!.firstSeenAt).toBe('2020-01-01')
    // only canonical taxonomy ids survive the merge — and their names are
    // rewritten to CAT_NAMES canonical labels (author strings can't mint)
    expect(idx.categories.tools!.zh).toBe('工具与能力')
  })

  it('run: archived github repo filtered by preAdmit', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'keeper', version: '1', description: '', keywords: ['opencode'], links: {}, date: 't' } },
      ] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [
        { full_name: 'a/archived', html_url: 'https://github.com/a/archived', description: 'opencode plugin', stargazers_count: 5, archived: true, fork: false, pushed_at: 't' },
      ] })
      if (url.includes('registry.npmjs.org/keeper')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/k', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/k.tgz' } } },
        time: {},
      })
      if (url.includes('x/k.tgz')) {
        const pkg = mkdtempSync(join(tmpdir(), 'kp-'))
        mkdirSync(join(pkg, 'pkg'), { recursive: true })
        writeFileSync(join(pkg, 'pkg', 'i.js'), 'export default {}')
        execFileSync('tar', ['-czf', pkg + '/k.tgz', '-C', pkg, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
        return new Response(readFileSync(pkg + '/k.tgz'), { status: 200 })
      }
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const dir = mkdtempSync(join(tmpdir(), 'rungh-'))
    const idx = await run({ outPath: join(dir, 'i.json'), fetchFn: f, now: 't' })
    expect(idx.plugins.map(p => p.name)).toEqual(['keeper'])
  })
})
