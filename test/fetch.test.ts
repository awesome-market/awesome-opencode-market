import { describe, it, expect } from 'vitest'
import { fetchPackument, fetchTarball, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, fetchRepoPackageName, fetchRepoTree } from '../pipeline/fetch/github.ts'

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
  it('audit#4-residual: malformed repo-meta bodies degrade, never reject or type-lie', async () => {
    // non-object body → error status (was: b.id TypeError → rejected promise)
    for (const body of [null, [1], 'x']) {
      const r = await fetchRepoMeta('o/r', { fetchFn: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch })
      expect(r.status).toBe('error')
      expect(r.meta).toBeNull()
    }
    // field-level lies coerce: topics non-array → [], license non-object → null,
    // archived/fork strict-bool, strings stay strings (was: [...topics] crash
    // in run.ts classify args → per-candidate run-error)
    const d = { id: 'notnum', stargazers_count: 'many', archived: 'yes', fork: 1,
      pushed_at: 42, created_at: null, license: { spdx_id: 7 }, topics: 'not-array',
      default_branch: {}, full_name: ['x'] }
    const { meta, status } = await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes(d)) as typeof fetch })
    expect(status).toBe('ok')
    expect(meta).toMatchObject({ id: null, stars: 0, archived: false, fork: false,
      pushedAt: null, createdAt: null, license: null, topics: [], defaultBranch: null, fullName: null })
  })
  it('audit#4-residual: fetchRepoTree guards non-object body and non-array tree', async () => {
    // non-object bodies → error (null crashed before; array/scalar silently
    // looked like an empty tree)
    for (const body of [null, [1], 'x']) {
      const r = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes(body)) as typeof fetch })
      expect(r.status).toBe('error')
      expect(r.paths).toBeNull()
    }
    // a PRESENT non-array tree was a `.map` TypeError → reject; now honest error
    const bad = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes({ tree: 'not-array' })) as typeof fetch })
    expect(bad.status).toBe('error')
    expect(bad.paths).toBeNull()
    // absent/null tree keeps the pinned "empty tree" contract (coverage6:
    // tree missing → empty set, status ok)
    for (const body of [{}, { tree: null }]) {
      const r = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes(body)) as typeof fetch })
      expect(r.status).toBe('ok')
      expect(r.paths!.size).toBe(0)
    }
    // array tree: only string paths survive
    const ok = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes({ tree: [1, 'x', { path: 5 }, { path: 'ok/f' }, null] })) as typeof fetch })
    expect(ok.status).toBe('ok')
    expect([...(ok.paths ?? [])]).toEqual(['ok/f'])
    // truncated/sha coerce: non-bool truncated → false, non-string sha → null
    const r2 = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes({ tree: [], truncated: 'yes', sha: 9 })) as typeof fetch })
    expect(r2.truncated).toBe(false)
    expect(r2.sha).toBeNull()
  })
})
