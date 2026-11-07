/** audit #1 fresh round (catalog-ingestion, round 7):
 *  1. mergeEntries' sameRuleset slot restore unioned prevVer.capabilities.findings
 *     WHOLESALE — every `sec:`-namespaced finding once written (repo-mismatch,
 *     repo-dir-traversal, repo-declared-mismatch, evidence-regressed,
 *     maintainer-changed, sec-delta markers) was re-added forever even after the
 *     underlying condition was fixed: the detail page kept showing resolved
 *     alerts indefinitely. The prev side of the union now excludes the
 *     re-derivable `sec:`/`sec-delta:` set — every one of those signals is
 *     re-computed each run by the worker probes / trustFlags / rescan
 *     keepFindings on the fresh entry's own caps. Byte-stable scan findings
 *     (rule:file) still union; redFlags stay fully unioned (brakes are
 *     deliberately sticky).
 *  2. The heldPrev pin path reused heldPrev.capabilities verbatim and only
 *     ADDED current repo findings — refreshMeta filtered the re-derivable
 *     set but the pin path didn't, so a fixed repo name / moved-on evidence
 *     regression lingered on the pinned display slot every run. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg', host: 'npm' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const caps = (findings: string[], redFlags: string[] = []) =>
  ({ scannedAt: 't', rulesetVersion: RULESET_VERSION, findings, redFlags })

describe('mergeEntries: re-derivable sec findings cannot resurrect from prev', () => {
  it('stale sec:* findings on the stored slot drop; scan findings + redFlags still union', () => {
    const prev = e({
      name: 'p', slug: 'p',
      capabilities: caps(
        ['lifecycle-script:package.json', 'sec:repo-mismatch:old-name', 'sec:evidence-regressed@2.0.0', 'sec-delta:network-call'],
        ['sec-delta:prepare-script']),
    })
    // fresh entry: repo fixed, evidence restored, same byte-stable scan output
    const ours = e({
      name: 'p', slug: 'p',
      capabilities: caps(['lifecycle-script:package.json', 'sec:repo-mismatch:new-name']),
    })
    const m = mergeEntries([ours], idx([prev]), 'oc1', RULESET_VERSION)
    const f = m[0]!.capabilities.findings
    // resolved signals gone — the fixed repo name's NEW finding still lands
    expect(f).not.toContain('sec:repo-mismatch:old-name')
    expect(f).not.toContain('sec:evidence-regressed@2.0.0')
    expect(f).not.toContain('sec-delta:network-call')
    expect(f).toContain('sec:repo-mismatch:new-name')
    // byte-stable scan finding unions normally (dedup'd)
    expect(f.filter(x => x === 'lifecycle-script:package.json')).toHaveLength(1)
    // brakes stay sticky — the union on redFlags is deliberately conservative
    expect(m[0]!.capabilities.redFlags).toContain('sec-delta:prepare-script')
  })

  it('fresh-run sec findings still union in (worker output is authoritative)', () => {
    const prev = e({ name: 'q', slug: 'q', capabilities: caps([]) })
    const ours = e({
      name: 'q', slug: 'q',
      capabilities: caps(['sec:evidence-regressed@3.0.0']),
    })
    const m = mergeEntries([ours], idx([prev]), 'oc1', RULESET_VERSION)
    expect(m[0]!.capabilities.findings).toContain('sec:evidence-regressed@3.0.0')
  })
})

function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'runtgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

describe('run: held-entry pin path clears stale display-slot findings', () => {
  it('fixed repo name + moved-on regression drop off the pinned display caps', async () => {
    const tgz = mkTgz()
    const ver = '3.0.0'   // upstream latest — newer than the held 2.0.0
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'good-pkg', version: ver, description: 'd',
            keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } }] }))
      }
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org') && url.includes('good-pkg')) {
        return new Response(JSON.stringify({
          'dist-tags': { latest: ver },
          versions: {
            '1.0.0': { repository: 'https://github.com/o/good', license: 'MIT',
              dist: { tarball: 'https://x/t-1.tgz' }, keywords: ['opencode'], main: 'index.js' },
            '2.0.0': { repository: 'https://github.com/o/good', license: 'MIT',
              dist: { tarball: 'https://x/t-2.tgz' }, keywords: ['opencode'], main: 'index.js' },
            '3.0.0': { repository: 'https://github.com/o/good', license: 'MIT',
              dist: { tarball: 'https://x/t-3.tgz' }, keywords: ['opencode'], main: 'index.js' },
          },
          time: {},
        }))
      }
      if (url.includes('x/t-')) return new Response(new Uint8Array(tgz))
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [
        { path: '.opencode/plugin/x.ts' }, { path: 'package.json' }, { path: 'README.md' }] }))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 3, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
      // repo package.json now names the package correctly — last run's
      // mismatch/regression findings are stale and must clear
      if (url.includes('raw.githubusercontent.com') && url.includes('package.json'))
        return new Response(JSON.stringify({ name: 'good-pkg' }))
      if (url.includes('/contents/')) return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch

    const d = mkdtempSync(join(tmpdir(), 'pin-'))
    const oldPath = join(d, 'old.json')
    // hand-build the prior index: approved v1.0.0 display + held v2.0.0,
    // display caps carrying the stale findings a previous run wrote
    const prior = e({
      name: 'good-pkg', slug: 'o/good', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'good-pkg', host: 'npm', repo: 'o/good' },
      capabilities: caps(['sec:repo-mismatch:old-name', 'sec:evidence-regressed@9.9.9', 'lifecycle-script:package.json']),
      pendingUpdate: {
        version: '2.0.0', heldAt: 't', reason: 'awaiting-review',
        capabilities: caps([]), verification: { status: 'unverified' },
      },
    })
    writeFileSync(oldPath, JSON.stringify(idx([prior])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    const got = out.plugins.find(p => p.name === 'good-pkg')!
    // hold still pinned — the pin path ran, not a fresh candidate build
    expect(got.pendingUpdate?.version).toBe('2.0.0')
    expect(got.latestVersion).toBe('1.0.0')
    expect(got.capabilities.findings).not.toContain('sec:repo-mismatch:old-name')
    expect(got.capabilities.findings).not.toContain('sec:evidence-regressed@9.9.9')
    // byte-stable scan finding survives (it describes the pinned bytes)
    expect(got.capabilities.findings).toContain('lifecycle-script:package.json')
  })
})
