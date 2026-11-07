/** audit #1 (round 3): declaredRepo must come from seedMeta on EVERY path —
 *  an organically-discovered candidate carrying a submission compared the
 *  search hit's repoUrl (same packument-derived field) instead of the
 *  submission's declared repo; worker-crash seeds get an honest 'run-error'
 *  outcome instead of silently queueing to the 30d dead-close. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../pipeline/run.ts'
import { REJECT_REASONS } from '../pipeline/submission-status.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const mkRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function mkTgz(): Buffer {
  const dir = tmp('a24tgz-')
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

const packument = (name: string, versionExtra: Record<string, unknown> = {}) => JSON.stringify({
  'dist-tags': { latest: '1.0.0' },
  versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' }, ...versionExtra } },
  time: { '1.0.0': 't' },
})

const baseFetch = (tgz: Buffer, route?: (url: string) => Response | null) =>
  (async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = route?.(url)
    if (hit) return hit
    if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
    if (url.includes('api.github.com/search')) return mkRes({ items: [] })
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
    return mkRes({}, 404)
  }) as typeof fetch

describe('A1-1 declared-mismatch reads the SUBMITTED repo, not the search hit', () => {
  it('organic candidate + name/repo seed → declared repo compared against packument repo', async () => {
    const tgz = mkTgz()
    const d = tmp('a24-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, JSON.stringify({ name: 'mix-pkg', repo: 'claimed/repo', issue: 7 }) + '\n')
    const f = baseFetch(tgz, url => {
      // the package is ALSO found organically — its search repoUrl points at
      // the SAME repo the packument declares ('real/other'). Comparing those
      // two identical values must not count as checking the submission hint.
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [
          { package: { name: 'mix-pkg', version: '1.0.0', keywords: ['opencode'],
            links: { repository: 'https://github.com/real/other' }, date: 't' } },
        ] })
      }
      if (url.includes('registry.npmjs.org/mix-pkg')) {
        return new Response(packument('mix-pkg', { repository: 'https://github.com/real/other' }))
      }
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 3, default_branch: 'main', id: 9 })
      if (url.includes('raw.githubusercontent.com/')) return mkRes({}, 404)
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', seedPath: seed })
    const p = out.plugins.find(x => x.name === 'mix-pkg')!
    expect(p.source.repo).toBe('real/other')
    expect(p.capabilities.findings).toContain('sec:repo-declared-mismatch:claimed/repo')
    expect(p.discoveredVia).toContain('submission')
  })

  it('seed-injected candidate still compares declared vs packument repo (regression)', async () => {
    const tgz = mkTgz()
    const d = tmp('a24-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, JSON.stringify({ name: 'only-seed', repo: 'claimed/repo' }) + '\n')
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/only-seed'))
        return new Response(packument('only-seed', { repository: 'https://github.com/real/other' }))
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 3, default_branch: 'main', id: 9 })
      if (url.includes('raw.githubusercontent.com/')) return mkRes({}, 404)
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', seedPath: seed })
    const p = out.plugins.find(x => x.name === 'only-seed')!
    expect(p.capabilities.findings).toContain('sec:repo-declared-mismatch:claimed/repo')
  })
})

describe('A1-2 a crashed seed gets a run-error outcome instead of silent queueing', () => {
  it('worker crash → seedOutcome run-error', async () => {
    const tgz = mkTgz()
    const d = tmp('a24-')
    const seed = join(d, 'seed.txt')
    const outcomesPath = join(d, 'outcomes.json')
    writeFileSync(seed, JSON.stringify({ name: 'crash-pkg', issue: 3 }) + '\n')
    const inner = baseFetch(tgz)
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      // a broken fetch impl (custom proxy returning null instead of a
      // Response) throws inside fetchPackument's res.status check — an
      // UNEXPECTED error, exactly the class run-error exists for. Malformed
      // doc FIELDS no longer crash: fetchPackument/fetchRepoMeta coerce them.
      if (url.includes('registry.npmjs.org/crash-pkg')) return null as unknown as Response
      // good-pkg keeps the index non-empty so the publish gate lets run() finish
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [
          { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
        ] })
      }
      if (url.includes('registry.npmjs.org/good-pkg')) return new Response(packument('good-pkg'))
      return inner(input)
    }) as typeof fetch
    await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't', seedPath: seed, seedOutcomesPath: outcomesPath })
    const outcomes = JSON.parse(readFileSync(outcomesPath, 'utf8')) as Record<string, string>
    expect(outcomes['crash-pkg']).toBe('run-error')
  })

  it('REJECT_REASONS renders every emitted code (run-error included)', () => {
    expect(REJECT_REASONS['run-error']).toBeTruthy()
  })
})
