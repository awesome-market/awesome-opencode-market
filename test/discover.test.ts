import { describe, it, expect } from 'vitest'
import { searchByKeyword, discoverNpm } from '../pipeline/discover/npm.ts'
import { searchTopic, searchCode, discoverGithub, normalizeRepoUrl, ghHeaders } from '../pipeline/discover/github.ts'
import { filterByStars, repoToNpm } from '../pipeline/discover/seed.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence, hasRepoEvidence } from '../pipeline/discover/filter.ts'

const mkRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('discover/npm', () => {
  it('maps search objects to candidates', async () => {
    const f = async () => mkRes({
      objects: [{
        package: { name: 'a', version: '1.0.0', description: 'd', keywords: ['opencode'],
          links: { repository: 'https://github.com/o/a' }, date: '2026-01-01' },
      }],
      total: 1,
    })
    const r = await searchByKeyword('opencode', { fetchFn: f as typeof fetch, size: 250 })
    expect(r[0]).toMatchObject({ name: 'a', repoUrl: 'https://github.com/o/a' })
  })
  it('paginates until short page', async () => {
    let calls = 0
    const f = async () => {
      calls++
      return mkRes({ objects: calls === 1
        ? Array.from({ length: 2 }, (_, i) => ({ package: { name: `p${i}`, version: '1', links: {} } }))
        : [] })
    }
    const r = await searchByKeyword('k', { fetchFn: f as typeof fetch, size: 2 })
    expect(r).toHaveLength(2)
    expect(calls).toBe(2)
  })
  it('stops on non-ok', async () => {
    const r = await searchByKeyword('k', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })
    expect(r).toEqual([])
  })
  it('discoverNpm dedupes across keywords', async () => {
    const f = async () => mkRes({ objects: [{ package: { name: 'same', version: '1', links: {} } }] })
    const m = await discoverNpm(['k1', 'k2'], { fetchFn: f as typeof fetch })
    expect(m.size).toBe(1)
    expect(m.get('same')!.discoveredVia).toEqual(['npm-keyword'])
  })
})

describe('discover/github', () => {
  const gh = (items: unknown[]) => async () => mkRes({ items })
  it('maps repo items', async () => {
    const f = gh([{ full_name: 'o/r', description: 'd', archived: false, fork: false,
      pushed_at: 't', stargazers_count: 5, default_branch: 'main' }])
    const r = await searchTopic('opencode', { fetchFn: f as typeof fetch })
    expect(r[0]).toMatchObject({ fullName: 'o/r', stars: 5 })
  })
  it('dedupes across topics', async () => {
    const f = gh([{ full_name: 'o/r', description: null, archived: false, fork: false,
      pushed_at: null, stargazers_count: 0, default_branch: 'main' }])
    const m = await discoverGithub(['t1', 't2'], { fetchFn: f as typeof fetch })
    expect(m.size).toBe(1)
  })
  it('normalizeRepoUrl handles all forms', () => {
    expect(normalizeRepoUrl('git+https://github.com/o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('git@github.com:o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('ssh://git@github.com/o/r')).toBe('o/r')
    expect(normalizeRepoUrl('https://github.com/o/r/')).toBe('o/r')
    expect(normalizeRepoUrl('https://gitlab.com/o/r')).toBeNull()
    expect(normalizeRepoUrl(null)).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
  })
  it('ghHeaders includes auth when token present', () => {
    expect(ghHeaders('t').Authorization).toBe('Bearer t')
    expect(ghHeaders().Authorization).toBeUndefined()
  })
})

describe('audit#4-residual-2: discovery surfaces degrade malformed docs (run-killer class)', () => {
  // run.ts awaits discoverNpm+discoverGithub bare — any throw here used to
  // reject the whole catalog run, not just one candidate
  const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('searchByKeyword: non-object body / non-array objects / missing package.name degrade, never reject', async () => {
    for (const body of [null, [1], 'x', {}, { objects: 'str' }, { objects: [null, {}, { package: null }, { package: 'x' }] }]) {
      const r = await searchByKeyword('k', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    // nameless/wrong-typed-name hits are dropped (name is the dedupe key);
    // surviving hit gets every field normalized
    const r = await searchByKeyword('k', { fetchFn: (async () => jsonRes({ objects: [
      { package: { name: 42, version: '1' } },
      { package: { version: '1' } },
      { package: { name: 'ok', version: 7, description: {}, keywords: 'x',
        links: 5, date: 9 } },
      { package: { name: 'ok2', version: '2', keywords: ['a', 1, 'b'],
        links: { repository: 42 }, date: 't' } },
    ] })) as typeof fetch })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ name: 'ok', version: '', description: '', keywords: [], repoUrl: null, publishedAt: null })
    expect(r[1]).toMatchObject({ name: 'ok2', version: '2', keywords: ['a', 'b'], repoUrl: null, publishedAt: 't' })
  })

  it('searchByKeyword: fetch throw and invalid JSON warn+truncate instead of rejecting', async () => {
    const r1 = await searchByKeyword('k', { fetchFn: (async () => { throw new Error('net down') }) as typeof fetch })
    expect(r1).toEqual([])
    const r2 = await searchByKeyword('k', { fetchFn: (async () => new Response('not-json{{{', { status: 200 })) as typeof fetch })
    expect(r2).toEqual([])
  })

  it('searchTopic: non-object body/items and nameless hits degrade; fields normalize', async () => {
    for (const body of [null, [1], 'x', {}, { items: 'str' }, { items: [null, {}, { full_name: 42 }, { full_name: null }] }]) {
      const r = await searchTopic('t', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    const r = await searchTopic('t', { fetchFn: (async () => jsonRes({ items: [
      { full_name: 'o/r', description: 9, archived: 'yes', fork: 1,
        pushed_at: 5, stargazers_count: 'many', default_branch: {}, id: 'x',
        created_at: [], license: { spdx_id: 7 }, topics: 'not-array' },
      { full_name: 'o/r2', archived: true, fork: false, stargazers_count: 3,
        default_branch: 'dev', license: { spdx_id: 'MIT' }, topics: ['a', 2] },
    ] })) as typeof fetch })
    expect(r).toHaveLength(2)
    // 'yes'/1 are NOT true — strict-bool like fetchRepoMeta; wrong-typed
    // fields coerce instead of lying downstream
    expect(r[0]).toMatchObject({ fullName: 'o/r', description: '', archived: false, fork: false,
      pushedAt: null, stars: 0, defaultBranch: 'HEAD', id: null, createdAt: null,
      license: null, topics: [] })
    expect(r[1]).toMatchObject({ fullName: 'o/r2', archived: true, stars: 3,
      defaultBranch: 'dev', license: 'MIT', topics: ['a'] })
  })

  it('searchTopic: fetch throw warns+truncates instead of rejecting', async () => {
    const r = await searchTopic('t', { fetchFn: (async () => { throw new Error('boom') }) as typeof fetch })
    expect(r).toEqual([])
  })

  it('searchCode: repository must be an object with string full_name; fields normalize', async () => {
    for (const body of [null, {}, { items: 'x' }, { items: [{}, { repository: null }, { repository: 42 }, { repository: { full_name: {} } }] }]) {
      const r = await searchCode('q', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    const r = await searchCode('q', { fetchFn: (async () => jsonRes({ items: [
      { repository: { full_name: 'o/rc', archived: 'yes', fork: 1, stargazers_count: 'n',
        default_branch: 9, pushed_at: null, license: 'MIT', topics: {}, id: 'i' } },
    ] })) as typeof fetch })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ fullName: 'o/rc', archived: false, fork: false, stars: 0,
      defaultBranch: 'HEAD', license: null, topics: [], id: null })
  })

  it('discoverGithub survives a malformed page end-to-end (dedupe still works)', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/search/code')) return jsonRes({ items: [{ repository: { full_name: 'o/rc' } }] })
      return jsonRes({ items: [
        { full_name: 'o/r', archived: false, fork: false, stargazers_count: 1, default_branch: 'main' },
        { full_name: 42 },
        'junk',
      ] })
    }) as typeof fetch
    const m = await discoverGithub(['t1'], { token: 'tok', fetchFn: f })
    expect(m.get('o/r')!.fullName).toBe('o/r')
    expect(m.get('o/rc')!.discoveredVia).toContain('code-search')
  })

  it('seed.ts: filterByStars skips non-object bodies; repoToNpm requires string name', async () => {
    const repos = ['o/a', 'o/b', 'o/c']
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/o/a')) return jsonRes(null)
      if (url.includes('/o/b')) return jsonRes({ stargazers_count: 'many', archived: false })
      return jsonRes({ stargazers_count: 60, archived: false, default_branch: 'main' })
    }) as typeof fetch
    const starred = await filterByStars(repos, 50, { fetchFn: f })
    expect(starred).toEqual([{ repo: 'o/c', stars: 60, branch: 'main' }])
    // repoToNpm: truthy non-string name is not an npm name
    const f2 = (async () => jsonRes({ name: 42 })) as typeof fetch
    expect(await repoToNpm('o/x', { fetchFn: f2 })).toBeNull()
    const f3 = (async () => jsonRes({ name: 'real-pkg' })) as typeof fetch
    expect(await repoToNpm('o/x', { fetchFn: f3 })).toBe('real-pkg')
  })
})

describe('discover/filter', () => {
  it('preAdmit rejects archived and fork-only', () => {
    expect(preAdmit({ name: 'a', repoUrl: 'o/a', archived: true }).admit).toBe(false)
    expect(preAdmit({ name: 'a', repoUrl: 'o/a', fork: true, hasOwnCommits: false }).admit).toBe(false)
    expect(preAdmit({ name: 'a', repoUrl: 'o/a' }).admit).toBe(true)
  })
  it('template spam: ≥6 same-stem names', () => {
    expect(looksLikeTemplateSpam(['mp-a1', 'mp-a2', 'mp-a3', 'mp-a4', 'mp-a5', 'mp-a6'])).toBe(true)
    expect(looksLikeTemplateSpam(['a', 'b', 'c'])).toBe(false)
  })
  it('evidence: keyword alone insufficient', () => {
    expect(hasPluginEvidence({ keywords: ['opencode'] }).ok).toBe(false)
    expect(hasPluginEvidence({ keywords: ['opencode'], main: 'dist/index.js' }).ok).toBe(true)
    // an entry point alone is not plugin evidence — any npm package has one
    expect(hasPluginEvidence({ main: 'x.js' }).ok).toBe(false)
    expect(hasPluginEvidence({ keywords: ['opencode'], readme: 'add to opencode.json plugin list' }).ok).toBe(true)
    expect(hasPluginEvidence({}).ok).toBe(false)
  })
  it('repo evidence: topic tag alone insufficient', () => {
    const S = (...p: string[]) => new Set(p)
    // generic 'opencode' topic + a bare package.json → just an opencode-related
    // project, not an extension
    expect(hasRepoEvidence(S('package.json', 'README.md'), ['opencode']).ok).toBe(false)
    // extension-specific topic + package.json → installable plugin
    expect(hasRepoEvidence(S('package.json'), ['opencode-plugin']).ok).toBe(true)
    // 'agent-skill' is cross-host generic — not an opencode signal (R-4)
    expect(hasRepoEvidence(S('package.json'), ['agent-skill']).ok).toBe(false)
    // a bare SKILL.md is an artifact but proves nothing about the host (R-4)
    expect(hasRepoEvidence(S('SKILL.md'), []).ok).toBe(false)
    expect(hasRepoEvidence(S('skills/x/SKILL.md'), ['opencode']).ok).toBe(false)
    // opencode-* topic + skill artifact → skill repo for this host
    expect(hasRepoEvidence(S('SKILL.md'), ['opencode-skill']).ok).toBe(true)
    expect(hasRepoEvidence(S('skills/x/SKILL.md', 'package.json'), ['opencode-plugin']).ok).toBe(true)
    // .opencode/ content + package.json → real plugin project
    expect(hasRepoEvidence(S('.opencode/plugin/x.ts', 'package.json'), []).ok).toBe(true)
    // .opencode/ alone without artifact → config share, not installable
    expect(hasRepoEvidence(S('.opencode/notes.txt'), []).ok).toBe(false)
    // opencode.json alone → project config, not an extension
    expect(hasRepoEvidence(S('opencode.json'), []).ok).toBe(false)
    expect(hasRepoEvidence(S('opencode.json', 'package.json'), []).ok).toBe(true)
    // nothing at all → reject
    expect(hasRepoEvidence(S('README.md'), []).ok).toBe(false)
  })
})
