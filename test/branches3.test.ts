import { describe, it, expect } from 'vitest'
import { searchByKeyword } from '../pipeline/discover/npm.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { fetchPackument, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { run } from '../pipeline/run.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

describe('branches round 3', () => {
  it('searchByKeyword: default size/maxPages + body without objects', async () => {
    const f1 = async () => mkRes({ objects: [] })
    expect((await searchByKeyword('k', { fetchFn: f1 as typeof fetch }))).toEqual([])
    const f2 = async () => mkRes({ total: 5 }) // no objects key → ?? []
    expect((await searchByKeyword('k', { fetchFn: f2 as typeof fetch, size: 1 }))).toEqual([])
  })
  it('searchTopic: token forwarded', async () => {
    let auth = ''
    const f = async (_i: RequestInfo | URL, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization ?? ''
      return mkRes({ items: [] })
    }
    await searchTopic('t', { token: 'x', fetchFn: f as typeof fetch })
    expect(auth).toBe('Bearer x')
  })
  it('fetchPackument: custom registry + license string + keywords missing', async () => {
    let seen = ''
    const f = async (input: RequestInfo | URL) => {
      seen = String(input)
      return mkRes({ 'dist-tags': { latest: '1' }, versions: { '1': { license: 'MIT', dist: {} } }, time: {} })
    }
    const p = await fetchPackument('x', { registry: 'https://mirror.local', fetchFn: f as typeof fetch })
    expect(seen).toContain('mirror.local')
    expect(p!.keywords).toEqual([])
  })
  it('downloads30d: downloads field missing → null', async () => {
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({})) as typeof fetch })).toBeNull()
  })
  it('scanTarball: media assets do not red-flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc4-'))
    mkdirSync(join(dir, 'pkg/logos'), { recursive: true })
    writeFileSync(join(dir, 'pkg/package.json'), '{"name":"p"}')
    writeFileSync(join(dir, 'pkg/logos/x.png'), Buffer.alloc(512, 0))
    execFileSync('tar', ['-czf', dir + '/p.tgz', '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const r = await scanTarball(readFileSync(dir + '/p.tgz'))
    expect(r.findings).toHaveLength(0)
  })
  it('run: candidate throws inside try → warn + continue', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [
        { package: { name: 'boom', version: '1', description: '', keywords: ['opencode'], links: {}, date: 't' } },
        { package: { name: 'fine', version: '1', description: '', keywords: ['opencode'], links: { repository: 'https://github.com/o/f' }, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/boom')) return new Response('not json', { status: 200 }) // json() throws
      if (url.includes('registry.npmjs.org/fine')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/f', keywords: ['opencode'], main: 'i.js', dist: {} } }, time: {} })
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, archived: false, pushed_at: 't' })
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const idx = await run({ outPath: join(mkdtempSync(join(tmpdir(), 'r-')), 'i.json'), fetchFn: f, now: 't' })
    expect(idx.plugins.map(p => p.name)).toEqual(['fine'])
  })
})
