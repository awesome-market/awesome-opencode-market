import { describe, it, expect } from 'vitest'
import { extractRepos, filterByStars, repoToNpm, buildSeedList } from '../pipeline/discover/seed.ts'

const md = `# awesome
- [a](https://github.com/o1/p1) one
- [b](https://github.com/o2/p2.git) two
- [dup](https://github.com/o1/p1)
- [self](https://github.com/awesome-opencode/x)
text https://github.com/o3/p3/ trailing`

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

describe('seed', () => {
  it('extractRepos dedups, strips .git/trailing, skips self', () => {
    expect(extractRepos(md)).toEqual(['o1/p1', 'o2/p2', 'o3/p3'])
  })
  it('filterByStars keeps ≥min, drops archived, sorts desc', async () => {
    const f = (async (u: RequestInfo | URL) => {
      const r = String(u).split('/repos/')[1]
      return mkRes(r === 'o1/p1' ? { stargazers_count: 10 } :
        r === 'o2/p2' ? { stargazers_count: 500, archived: true } : { stargazers_count: 200 })
    }) as typeof fetch
    const out = await filterByStars(['o1/p1', 'o2/p2', 'o3/p3'], 50, { fetchFn: f })
    expect(out).toEqual([{ repo: 'o3/p3', stars: 200 }])
  })
  it('repoToNpm reads package.json name; null on fail', async () => {
    const ok = (async () => mkRes({ name: '@x/y' })) as typeof fetch
    expect(await repoToNpm('a/b', { fetchFn: ok })).toBe('@x/y')
    const bad = (async () => mkRes({}, 404)) as typeof fetch
    expect(await repoToNpm('a/b', { fetchFn: bad })).toBeNull()
  })
  it('buildSeedList end-to-end with injected fetch', async () => {
    const f = (async (u: RequestInfo | URL) => {
      const s = String(u)
      if (s.includes('raw.githubusercontent') && s.includes('README')) return mkRes(md.replace(/[{}[\]]/g, ''))
      if (s.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 100 })
      if (s.includes('package.json')) return mkRes({ name: 'pkg-x' })
      return mkRes({}, 404)
    }) as typeof fetch
    const names = await buildSeedList({ url: 'https://raw.githubusercontent.com/x/main/README.md', minStars: 1, fetchFn: f })
    expect(names.length).toBeGreaterThan(0)
    expect(names.every(n => n === 'pkg-x' || n.startsWith('github:'))).toBe(true)
  })
})

describe('seed branches', () => {
  it('filterByStars skips non-ok responses', async () => {
    const f = (async () => new Response('x', { status: 403 })) as typeof fetch
    expect(await filterByStars(['a/b'], 1, { fetchFn: f })).toEqual([])
  })
  it('buildSeedList falls back to github: prefix when no package.json', async () => {
    const f = (async (u: RequestInfo | URL) => {
      const s = String(u)
      if (s.includes('README')) return mkRes('- [x](https://github.com/z/w) repo')
      if (s.includes('repos/')) return mkRes({ stargazers_count: 99 })
      return mkRes({}, 404)
    }) as typeof fetch
    const n = await buildSeedList({ url: 'https://raw.githubusercontent.com/x/y/README.md', minStars: 1, fetchFn: f })
    expect(n).toEqual(['github:z/w'])
  })
  it('repoToNpm tries master when main fails; non-json → null', async () => {
    const f = (async (u: RequestInfo | URL) =>
      String(u).includes('/master/') ? mkRes({ name: 'mp' }) : new Response('not json{', { status: 200 })) as typeof fetch
    expect(await repoToNpm('a/b', { fetchFn: f })).toBe('mp')
    const bad = (async () => new Response('{bad', { status: 200 })) as typeof fetch
    expect(await repoToNpm('a/b', { fetchFn: bad })).toBeNull()
  })
})
