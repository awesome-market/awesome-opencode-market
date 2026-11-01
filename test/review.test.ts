import { describe, it, expect } from 'vitest'
import { reviewPackage, renderReview } from '../pipeline/review.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

describe('review', () => {
  it('missing package → honest not-found', async () => {
    const r = await reviewPackage('nope', { fetchFn: (async () => mkRes({}, 404)) as typeof fetch })
    expect(r.exists).toBe(false)
    expect(renderReview(r)).toContain('not found')
  })
  it('existing package → evidence + scan + metrics', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org') && !url.includes('tgz')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/p', keywords: ['opencode'], main: 'i.js', license: 'MIT',
          dist: { tarball: 'https://x/t.tgz' } } },
        time: {},
      })
      if (url.includes('x/t.tgz')) return mkRes({}, 500) // tarball fail → findings empty
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 42 })
      return mkRes({}, 404)
    }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn: f })
    expect(r.exists).toBe(true)
    expect(r.evidence).toContain('keyword')
    expect(r.downloads30d).toBe(42)
    const md = renderReview(r)
    expect(md).toContain('keyword')
    expect(md).toContain('does not mean safe')
  })
})
