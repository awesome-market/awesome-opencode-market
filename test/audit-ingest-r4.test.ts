/** audit #1 fresh round (catalog-ingestion, round 4):
 *  1. Ruleset-rescan rebuilds preserved non-scan FINDINGS (keepFindings, r3)
 *     but still rebuilt `redFlags` from raw scan output — so persistent
 *     identity-level flags nothing re-derives evaporated: `sec:repo-recreated`
 *     (trustFlags only fires while the two repoIds still differ; once merged
 *     carries the new id the brake silently lifted and a mature AI pass could
 *     release the hijacked identity) and `sec-delta:*` strong-rule markers
 *     (the rule is no longer "new" once findings converge). keepFlags now
 *     unions back payload-free `sec:*` flags + all `sec-delta:*`; payload
 *     flags (repo-moved-since-…, repo-pkg-changed) stay excluded because the
 *     rescan re-derives them with CURRENT values.
 *  2. mergeEntries' R-8 adopt-remote-release path promoted every
 *     version-scoped field except `compat` — a remotely released held
 *     version displayed its predecessor's engines/peer constraints for up
 *     to a metrics-refresh window. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const mkRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

function mkTgz(): Buffer {
  const dir = tmp('fatgz-')
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

const packument = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  'dist-tags': { latest: '1.0.0' },
  versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-old' }, ...extra } },
  time: { '1.0.0': 't' },
})

const baseFetch = (tgz: Buffer, route?: (url: string) => Response | null) =>
  (async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = route?.(url)
    if (hit) return hit
    if (url.includes('/-/v1/search')) {
      return mkRes({ objects: [
        { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
      ] })
    }
    if (url.includes('api.github.com/search')) return mkRes({ items: [] })
    if (url.includes('/git/trees/')) return mkRes({ tree: [
      { path: '.opencode/plugin/x.ts' }, { path: 'package.json' },
    ] })
    if (url.includes('registry.npmjs.org/good-pkg')) return new Response(packument('good-pkg'))
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
    return mkRes({}, 404)
  }) as typeof fetch

describe('rescan rebuilds keep persistent sec:/sec-delta: redFlags', () => {
  it('github gone-check rescan: keeps repo-recreated + sec-delta, drops stale payload flags', async () => {
    const tgz = mkTgz()
    const d = tmp('air4-')
    const oldEntry = e({
      name: 'o/gh', slug: 'o/gh', latestVersion: null,
      source: { kind: 'github', id: 'o/gh', repo: 'o/gh', repoId: 42, version: 'oldsha000' },
      integrity: null,
      capabilities: { scannedAt: 'old', rulesetVersion: 'r0',
        findings: ['sec:evidence-regressed@abc123'],
        // repo-recreated: NOTHING re-derives it after repoId converged (prev
        // and fresh both carry repoId 42) — without keepFlags it evaporates.
        // moved-since-review carries a stale payload — rescan re-derives with
        // current values, so the old one must NOT be kept either.
        redFlags: ['sec:repo-recreated', 'sec-delta:lifecycle-script', 'sec:repo-moved-since-review:deadbee'] },
      verification: { status: 'verified', integrity: 'oldsha000' },
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([oldEntry])))
    const f = baseFetch(tgz, url => {
      if (url.includes('api.github.com/repos/o/gh') && !url.includes('/git/trees/'))
        return mkRes({ stargazers_count: 1, full_name: 'o/gh', default_branch: 'main', id: 42 })
      if (url.includes('/git/trees/'))
        return mkRes({ tree: [{ path: '.opencode/plugin/x.ts' }], sha: 'oldsha000', truncated: false })
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'o/gh')!
    expect(p.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    // persistent identity flag survives — the repojack brake stays on
    expect(p.capabilities.redFlags).toContain('sec:repo-recreated')
    // delta marker survives too
    expect(p.capabilities.redFlags).toContain('sec-delta:lifecycle-script')
    // stale payload flag dropped — it would double-flag alongside the
    // re-derived current-sha variant
    expect(p.capabilities.redFlags.some(x => x.startsWith('sec:repo-moved-since-review'))).toBe(false)
  })

  it('npm gone-check rescan: keeps repo-recreated + sec-delta through scanOf', async () => {
    const tgz = mkTgz()
    const d = tmp('air4-')
    const oldEntry = e({
      name: 'gone-pkg', slug: 'gone-pkg', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'gone-pkg', repo: 'o/gone', repoId: 7 },
      capabilities: { scannedAt: 'old', rulesetVersion: 'r0',
        findings: [], redFlags: ['sec:repo-recreated', 'sec-delta:prepare-script', 'sec:name-reused'] },
      verification: { status: 'skipped' },
      integrity: 'sha512-old',
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([oldEntry])))
    const f = baseFetch(tgz, url => {
      if (url.includes('registry.npmjs.org/gone-pkg')) return new Response(packument('gone-pkg'))
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'gone-pkg')!
    expect(p.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(p.capabilities.redFlags).toContain('sec:repo-recreated')
    expect(p.capabilities.redFlags).toContain('sec-delta:prepare-script')
    expect(p.capabilities.redFlags).toContain('sec:name-reused')
  })

  it('pinned-hold ruleset rescan keeps the held slot’s delta flags', async () => {
    const tgz = mkTgz()
    const d = tmp('air4-')
    const oldEntry = e({
      name: 'held-pkg', slug: 'held-pkg', latestVersion: '1.0.0',
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      verification: { status: 'verified' },
      integrity: 'sha512-old',
      pendingUpdate: {
        version: '2.0.0', reason: 'awaiting-review', heldAt: 't',
        capabilities: { scannedAt: 'old', rulesetVersion: 'r0',
          findings: [], redFlags: ['sec-delta:lifecycle-script'] },
        verification: { status: 'unverified' },
        integrity: 'sha512-pu',
        publishedAt: 't2',
      },
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([oldEntry])))
    const f = baseFetch(tgz, url => {
      if (url.includes('/-/v1/search')) {
        return mkRes({ objects: [
          { package: { name: 'held-pkg', version: '2.0.0', keywords: ['opencode'], links: {}, date: 't' } },
        ] })
      }
      if (url.includes('registry.npmjs.org/held-pkg')) {
        return new Response(JSON.stringify({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-old' } },
            '2.0.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-pu' } },
          },
          time: { '1.0.0': 't', '2.0.0': 't2' },
        }))
      }
      return null
    })
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'held-pkg')!
    // pin stayed (no verdict) and the held tarball got re-scanned
    expect(p.pendingUpdate?.version).toBe('2.0.0')
    expect(p.pendingUpdate?.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(p.pendingUpdate?.capabilities.redFlags).toContain('sec-delta:lifecycle-script')
  })
})

describe('mergeEntries R-8: remote release of our held version adopts remote compat', () => {
  it('released pu → prev.compat wins, not our stale display compat', () => {
    const ours = e({
      name: 'np', slug: 'np', latestVersion: '1.0.0', compat: { engines: 'opencode >=1' },
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      verification: { status: 'verified' },
      pendingUpdate: {
        version: '2.0.0', reason: 'awaiting-review', heldAt: 't',
        capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
        verification: { status: 'unverified' },
      },
    })
    const remote = { version: '1' as const, generatedAt: 'x', categories: {}, removed: [],
      plugins: [e({ name: 'np', slug: 'np', latestVersion: '2.0.0',
        compat: { engines: 'opencode >=2' },
        capabilities: { scannedAt: 't2', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
        verification: { status: 'verified' as const } })] }
    const merged = mergeEntries([ours], remote, '2.2.5', RULESET_VERSION)
    const m = merged[0]!
    expect(m.pendingUpdate).toBeUndefined()
    expect(m.latestVersion).toBe('2.0.0')
    expect(m.compat).toEqual({ engines: 'opencode >=2' })
  })
})
