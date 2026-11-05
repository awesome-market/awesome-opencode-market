import { describe, it, expect } from 'vitest'
import { reviewPackage, reviewRepo, renderReview, renderRepoReview, verdict, repoVerdict } from '../pipeline/review.ts'

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

  it('verdict: clean/flagged/invalid', () => {
    const base = { name: 'x', exists: true, evidence: ['keyword'], findings: [], redFlags: [], downloads30d: null, repo: null, createdAt: null }
    expect(verdict(base)).toBe('clean')
    expect(verdict({ ...base, redFlags: ['rf'] })).toBe('flagged')
    expect(verdict({ ...base, exists: false })).toBe('invalid')
    // no opencode-specific evidence → invalid, even with zero red flags
    expect(verdict({ ...base, evidence: ['entry'] })).toBe('invalid')
    expect(verdict({ ...base, evidence: [] })).toBe('invalid')
  })

  it('report records the REVIEWED version + integrity — a human pass pins to it', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org') && !url.includes('tgz')) return mkRes({
        'dist-tags': { latest: '2.3.0' },
        versions: { '2.3.0': { keywords: ['opencode'], main: 'i.js',
          dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-AAA=' } } },
        time: {},
      })
      if (url.includes('x/t.tgz')) return mkRes({}, 500)
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn: f })
    expect(r.version).toBe('2.3.0')
    expect(r.integrity).toBe('sha512-AAA=')
    const md = renderReview(r)
    expect(md).toContain('p@2.3.0')
    expect(md).toContain('sha512-AAA=')
    expect(md).toContain('<!-- reviewedVersion: 2.3.0 -->')
    // verdict marker still lands LAST — package-controlled text can't fake it
    expect(md.trim().endsWith(`<!-- verdict: ${verdict(r)} -->`)).toBe(true)
  })

  it('findings list folds into <details> — red flags stay visible', async () => {
    const md = renderReview({ name: 'p', exists: true, evidence: ['keyword'], downloads30d: null,
      repo: null, createdAt: null, version: '1', integrity: null,
      findings: ['r: f — d', 'r2: g — d2'], redFlags: ['rf: x'] })
    expect(md).toContain('<details><summary>### Findings (2)</summary>')
    expect(md).toContain('### ⚠️ Red flags (1)\n- rf: x')
  })
})

describe('reviewRepo', () => {
  const ghFetch = (o: { tree?: { path: string }[]; sha?: string; meta?: object; metaStatus?: number; tgz?: Buffer; pkgName?: string }) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.github.com/repos') && url.includes('/git/trees/'))
        return mkRes({ tree: o.tree ?? [], sha: o.sha ?? 'abc123' })
      if (url.includes('api.github.com/repos'))
        return mkRes(o.meta ?? { id: 1, stargazers_count: 9, topics: ['opencode-skill'], created_at: 'c', pushed_at: 'p' }, o.metaStatus ?? 200)
      if (url.includes('raw.githubusercontent.com'))
        return o.pkgName ? mkRes({ name: o.pkgName }) : mkRes({}, 404)
      if (url.includes('codeload.github.com'))
        return new Response(new Uint8Array(o.tgz ?? Buffer.from('x')), { status: o.tgz ? 200 : 500 })
      return mkRes({}, 404)
    }) as typeof fetch

  it('missing repo → invalid, not clean', async () => {
    const r = await reviewRepo('o/gone', { fetchFn: ghFetch({ metaStatus: 404 }) })
    expect(r.exists).toBe(false)
    expect(repoVerdict(r)).toBe('invalid')
    expect(renderRepoReview(r)).toContain('not found')
  })

  it('repo with evidence gets tree identity + pkgName + verdict marker last', async () => {
    const r = await reviewRepo('o/sk', { fetchFn: ghFetch({
      tree: [{ path: '.opencode/skills/x/SKILL.md' }, { path: 'README.md' }],
      sha: 'deadbee', pkgName: 'oc-skill-x',
    }) })
    expect(r.exists).toBe(true)
    expect(r.treeSha).toBe('deadbee')
    expect(r.pkgName).toBe('oc-skill-x')
    expect(r.evidence.length).toBeGreaterThan(0)
    const md = renderRepoReview(r)
    expect(md).toContain('deadbee')
    expect(md).toContain('oc-skill-x')
    expect(md.trim()).toMatch(/<!-- verdict: (clean|flagged|invalid) -->$/)
  })

  it('bare SKILL.md without opencode trace → invalid (mirrors catalog gate)', async () => {
    const r = await reviewRepo('o/bare', { fetchFn: ghFetch({
      tree: [{ path: 'skills/x/SKILL.md' }],
      meta: { id: 1, stargazers_count: 1, topics: [], created_at: 'c' },
    }) })
    expect(repoVerdict(r)).toBe('invalid')
  })

  it('repoVerdict: evidence + redFlags → flagged', () => {
    const base = { repo: 'o/r', exists: true, evidence: ['opencode-dir'], findings: [], redFlags: [], treeSha: 's', createdAt: 'c', stars: 1, pkgName: null, truncated: false }
    expect(repoVerdict(base)).toBe('clean')
    expect(repoVerdict({ ...base, redFlags: ['rf'] })).toBe('flagged')
    expect(repoVerdict({ ...base, evidence: [] })).toBe('invalid')
    expect(repoVerdict({ ...base, exists: false })).toBe('invalid')
  })
})
