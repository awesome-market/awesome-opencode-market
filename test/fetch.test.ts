import { describe, it, expect } from 'vitest'
import { fetchPackument, fetchTarball, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, fetchRepoPackageName } from '../pipeline/fetch/github.ts'

const mkRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('fetch/npm', () => {
  const doc = {
    'dist-tags': { latest: '2.0.0' },
    versions: { '2.0.0': {
      repository: { url: 'git+https://github.com/o/r.git' }, license: 'MIT',
      dist: { tarball: 'https://r/t.tgz' }, keywords: ['opencode'], main: 'dist/i.js',
    } },
    time: { '2.0.0': '2026-01-01' },
  }
  it('parses packument', async () => {
    const { pk: p } = await fetchPackument('x', { fetchFn: (async () => mkRes(doc)) as typeof fetch })
    expect(p).toMatchObject({ latest: '2.0.0', repository: 'git+https://github.com/o/r.git', license: 'MIT' })
  })
  it('returns null on 404', async () => {
    expect((await fetchPackument('x', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).status).toBe('not-found')
  })
  it('integrityOf maps per-version dist.integrity, missing → absent', async () => {
    const d = { 'dist-tags': { latest: '2' }, versions: {
      '1': { dist: { tarball: 't', integrity: 'sha512-AAA=' } },
      '2': { dist: { tarball: 't' } },
    }, time: {} }
    const { pk: p } = await fetchPackument('x', { fetchFn: (async () => mkRes(d)) as typeof fetch })
    expect(p!.integrityOf['1']).toBe('sha512-AAA=')
    expect(p!.integrityOf['2']).toBeUndefined()
  })
  it('handles string repository + license object', async () => {
    const d = { 'dist-tags': { latest: '1' },
      versions: { '1': { repository: 'https://github.com/o/r', license: { type: 'Apache-2.0' }, dist: {} } },
      time: {} }
    const { pk: p } = await fetchPackument('x', { fetchFn: (async () => mkRes(d)) as typeof fetch })
    expect(p!.license).toBe('Apache-2.0')
  })
  it('audit#4: non-object packument body degrades to error — never rejects', async () => {
    // a 200 with literal `null`/array/scalar body used to escape as a rejected
    // promise (doc['dist-tags'] TypeError) — diagnose's pkOf→shaFor→mapPool
    // dies whole-run on one bad registry response; the contract is degrade
    for (const body of [null, [1, 2], 'str', 42]) {
      const r = await fetchPackument('x', {
        fetchFn: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
      })
      expect(r.status).toBe('error')
      expect(r.pk).toBeNull()
    }
  })
  it('audit#4: non-array maintainers/keywords degrade to empty, not a crash', async () => {
    const d = { 'dist-tags': { latest: '1' },
      versions: { '1': { dist: { tarball: 't', integrity: 'sha512-A=' }, keywords: 'notalist', engines: 'node>=18' } },
      maintainers: 'not-an-array', time: {} }
    const { pk: p, status } = await fetchPackument('x', { fetchFn: (async () => mkRes(d)) as typeof fetch })
    expect(status).toBe('ok')
    expect(p!.maintainers).toEqual([])
    expect(p!.keywords).toEqual([])
    expect(p!.compatOf['1']!.engines).toBe('node>=18')   // good fields still parse
  })
  it('fetchTarball returns buffer, throws on failure', async () => {
    const ok = async () => new Response(new Uint8Array([1, 2, 3]))
    expect((await fetchTarball('https://x/t', { fetchFn: ok as typeof fetch })).length).toBe(3)
    await expect(fetchTarball('https://x/t', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })).rejects.toThrow()
  })
  it('fetchTarball rejects non-https and malformed urls', async () => {
    const ok = async () => new Response(new Uint8Array([1]))
    await expect(fetchTarball('http://x/t', { fetchFn: ok as typeof fetch })).rejects.toThrow('https')
    await expect(fetchTarball('file:///etc/passwd', { fetchFn: ok as typeof fetch })).rejects.toThrow('https')
    await expect(fetchTarball('not a url', { fetchFn: ok as typeof fetch })).rejects.toThrow('malformed')
  })
  it('downloads30d parses + null on error', async () => {
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({ downloads: 42 })) as typeof fetch })).toBe(42)
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).toBeNull()
  })
})

describe('fetch/github', () => {
  it('fetchRepoMeta maps fields', async () => {
    const f = async () => mkRes({ stargazers_count: 9, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } })
    expect((await fetchRepoMeta('o/r', { fetchFn: f as typeof fetch })).meta).toMatchObject({ stars: 9, license: 'MIT' })
  })
  it('NOASSERTION license → null', async () => {
    const f = async () => mkRes({ stargazers_count: 0, archived: false, pushed_at: null, license: { spdx_id: 'NOASSERTION' } })
    expect((await fetchRepoMeta('o/r', { fetchFn: f as typeof fetch })).meta!.license).toBeNull()
  })
  it('fetchRepoPackageName reads name from raw CDN + monorepo dir', async () => {
    const urls: string[] = []
    const f = (async (input: RequestInfo | URL) => { urls.push(String(input)); return mkRes({ name: 'sub-pkg' }) }) as typeof fetch
    expect((await fetchRepoPackageName('o/mono', { dir: 'packages/sub', fetchFn: f })).pkgName).toBe('sub-pkg')
    expect(urls[0]).toContain('packages/sub/package.json')
  })
  it('fetchRepoPackageName: 404 → not-found, non-json name → null', async () => {
    expect((await fetchRepoPackageName('o/r', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).status).toBe('not-found')
    expect((await fetchRepoPackageName('o/r', { fetchFn: (async () => mkRes({ name: 42 })) as typeof fetch })).pkgName).toBeNull()
  })
})
