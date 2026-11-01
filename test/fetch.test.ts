import { describe, it, expect } from 'vitest'
import { fetchPackument, fetchTarball, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, repoFileExists } from '../pipeline/fetch/github.ts'

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
    const p = await fetchPackument('x', { fetchFn: (async () => mkRes(doc)) as typeof fetch })
    expect(p).toMatchObject({ latest: '2.0.0', repository: 'git+https://github.com/o/r.git', license: 'MIT' })
  })
  it('returns null on 404', async () => {
    expect(await fetchPackument('x', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).toBeNull()
  })
  it('handles string repository + license object', async () => {
    const d = { 'dist-tags': { latest: '1' },
      versions: { '1': { repository: 'https://github.com/o/r', license: { type: 'Apache-2.0' }, dist: {} } },
      time: {} }
    const p = await fetchPackument('x', { fetchFn: (async () => mkRes(d)) as typeof fetch })
    expect(p!.license).toBe('Apache-2.0')
  })
  it('fetchTarball returns buffer, throws on failure', async () => {
    const ok = async () => new Response(new Uint8Array([1, 2, 3]))
    expect((await fetchTarball('u', { fetchFn: ok as typeof fetch })).length).toBe(3)
    await expect(fetchTarball('u', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })).rejects.toThrow()
  })
  it('downloads30d parses + null on error', async () => {
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({ downloads: 42 })) as typeof fetch })).toBe(42)
    expect(await fetchDownloads30d('x', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })).toBeNull()
  })
})

describe('fetch/github', () => {
  it('fetchRepoMeta maps fields', async () => {
    const f = async () => mkRes({ stargazers_count: 9, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } })
    expect(await fetchRepoMeta('o/r', { fetchFn: f as typeof fetch })).toMatchObject({ stars: 9, license: 'MIT' })
  })
  it('NOASSERTION license → null', async () => {
    const f = async () => mkRes({ stargazers_count: 0, archived: false, pushed_at: null, license: { spdx_id: 'NOASSERTION' } })
    expect((await fetchRepoMeta('o/r', { fetchFn: f as typeof fetch }))!.license).toBeNull()
  })
  it('repoFileExists true/false on status', async () => {
    expect(await repoFileExists('o/r', 'SKILL.md', { fetchFn: (async () => new Response('', { status: 200 })) as typeof fetch })).toBe(true)
    expect(await repoFileExists('o/r', 'NOPE', { fetchFn: (async () => new Response('', { status: 404 })) as typeof fetch })).toBe(false)
  })
})
