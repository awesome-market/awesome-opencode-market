import { describe, it, expect } from 'vitest'
import { searchByKeyword, discoverNpm } from '../pipeline/discover/npm.ts'
import { searchTopic, discoverGithub, normalizeRepoUrl, ghHeaders } from '../pipeline/discover/github.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence } from '../pipeline/discover/filter.ts'

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
})
