/** audit #1 fresh round (catalog-ingestion, round 8):
 *  1. refreshMeta fetched the npm packument + 30d downloads for EVERY entry —
 *     a github-kind 'owner/repo' name can never resolve one ('/' isn't a
 *     valid unscoped npm name), so both probes were guaranteed 404s, and the
 *     packument-authoritative repo resolution could only fall back to
 *     source.repo anyway. The probes are now kind-gated.
 *  2. refreshMeta never re-derived `sec:evidence-regressed` — the pin path
 *     strips/re-checks it and the full path re-derives it, but a reuse-path
 *     entry only sees refreshMeta: a keyword/entrypoint regression on the
 *     pinned latest, or its restoration, stayed invisible until the next
 *     version bump. Re-derived on the refresh cadence (same packument-only
 *     gate as the worker).
 *  3. rescanStaleGh reset moved commits to 'unverified' unconditionally — a
 *     no-payload slot (contains:[] / no plugin|skill parts) can never be
 *     re-queued by verifyQueued, so it displayed "还没验" forever where
 *     'skipped' was the honest state. The reset now requires a queueable
 *     payload.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const NOW = '2026-06-01T00:00:00Z'
const STALE = '2026-05-01T00:00:00Z'   // >7d before NOW → needsMetrics fires

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg', host: 'npm', repo: 'o/pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null, integrity: 'sha512-AAA=',
  metrics: { stars: 1, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: STALE },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: NOW, categories: {}, plugins, removed: [],
})

const pkFor = (name: string, evidence: boolean) => ({
  'dist-tags': { latest: '1.0.0' },
  versions: {
    '1.0.0': {
      repository: `https://github.com/o/${name}`, license: 'MIT',
      dist: { tarball: 'https://x/t.tgz', integrity: 'sha512-AAA=' },
      // evidence gate reads LATEST-version metadata: keyword OR readme-install
      // for the opencode-specific signal, plus an entry/readme artifact
      ...(evidence ? { keywords: ['opencode'], main: 'index.js' } : {}),
    },
  },
  time: {},
})
const searchHit = (name: string) => ({
  package: { name, version: '1.0.0', description: 'd',
    keywords: ['opencode'], links: { repository: `https://github.com/o/${name}` }, date: 't' },
})

function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'r8tgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

describe('refreshMeta: evidence-regressed re-derives on the reuse path', () => {
  it('stale marker clears when evidence is restored; fresh marker stamps on regression', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return new Response(JSON.stringify({ objects: [searchHit('pkg'), searchHit('pkg2')] }))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url === 'https://registry.npmjs.org/pkg') return new Response(JSON.stringify(pkFor('pkg', true)))
      if (url === 'https://registry.npmjs.org/pkg2') return new Response(JSON.stringify(pkFor('pkg2', false)))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
      if (url.includes('api.github.com/repos/'))
        return new Response(JSON.stringify({ id: 7, stargazers_count: 3, archived: false, fork: false,
          pushed_at: 't', license: { spdx_id: 'MIT' }, full_name: 'o/pkg' }))
      if (url.includes('raw.githubusercontent.com') && url.endsWith('package.json'))
        return new Response(JSON.stringify({ name: url.includes('o/pkg2') ? 'pkg2' : 'pkg' }))
      return new Response('', { status: 404 })
    }) as typeof fetch

    const d = mkdtempSync(join(tmpdir(), 'r8ev-'))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([
      e({ name: 'pkg', slug: 'o/pkg', latestVersion: '1.0.0',
        capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION,
          findings: ['sec:evidence-regressed@0.9.0'], redFlags: [] } }),
      e({ name: 'pkg2', slug: 'o/pkg2', latestVersion: '1.0.0',
        source: { kind: 'npm', id: 'pkg2', host: 'npm', repo: 'o/pkg2' },
        capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] } }),
    ])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: NOW })
    const p1 = out.plugins.find(p => p.name === 'pkg')!
    // restored evidence → the stale @0.9.0 marker clears, nothing replaces it
    expect(p1.capabilities.findings.filter(x => x.startsWith('sec:evidence-regressed'))).toHaveLength(0)
    const p2 = out.plugins.find(p => p.name === 'pkg2')!
    // regression on the pinned latest → flagged now, not at next version bump
    expect(p2.capabilities.findings).toContain('sec:evidence-regressed@1.0.0')
  })
})

describe('refreshMeta: github-kind entries never probe npm', () => {
  it('packument+downloads skipped; repo anchor stays the stored source.repo', async () => {
    const fetched: string[] = []
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      fetched.push(url)
      if (url.includes('/-/v1/search'))
        return new Response(JSON.stringify({ objects: [searchHit('pkg')] }))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      // a packument DOES answer for the name — the guard must still never call it
      if (url === 'https://registry.npmjs.org/pkg')
        return new Response(JSON.stringify({ 'dist-tags': { latest: '9.9.9' }, versions: {},
          repository: 'https://github.com/evil/x' }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
      if (url.includes('api.github.com/repos/'))
        return new Response(JSON.stringify({ id: 7, stargazers_count: 9, archived: false, fork: false,
          pushed_at: 't', license: { spdx_id: 'MIT' }, full_name: 'o/gh' }))
      return new Response('', { status: 404 })
    }) as typeof fetch

    const d = mkdtempSync(join(tmpdir(), 'r8gh-'))
    const oldPath = join(d, 'old.json')
    // synthetic github-kind entry whose name collides with an npm candidate —
    // schema-legal; latestVersion set so the reuse short-circuit applies
    writeFileSync(oldPath, JSON.stringify(idx([
      e({ name: 'pkg', slug: 'o/gh', latestVersion: '1.0.0', integrity: null,
        source: { kind: 'github', id: 'o/gh', repo: 'o/gh', version: 'sha1' },
        metrics: { stars: 1, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: STALE } }),
    ])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: NOW })
    expect(fetched.some(u => u.startsWith('https://registry.npmjs.org/pkg'))).toBe(false)
    expect(fetched.some(u => u.includes('api.npmjs.org/downloads'))).toBe(false)
    const got = out.plugins.find(p => p.name === 'pkg')!
    expect(got.source.repo).toBe('o/gh')
    expect(got.metrics.stars).toBe(9)
  })
})

describe('rescanStaleGh: moved-commit verify reset requires a queueable payload', () => {
  it('no-parts slot keeps its prior status; plugin slot resets to unverified', async () => {
    const tgz = mkTgz()
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(JSON.stringify({ objects: [] }))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('/git/trees/')) {
        const sha = url.includes('o/empty') ? 'newsha1' : 'newsha2'
        return new Response(JSON.stringify({ sha, truncated: false, tree: [{ path: 'package.json' }] }))
      }
      if (url.includes('api.github.com/repos/'))
        return new Response(JSON.stringify({ id: 7, stargazers_count: 3, archived: false, fork: false,
          pushed_at: 't', license: { spdx_id: 'MIT' } }))
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      return new Response('', { status: 404 })
    }) as typeof fetch

    const gh = (over: Partial<PluginEntry> = {}): PluginEntry => e({
      discoveredVia: ['github-topic'],
      latestVersion: null, integrity: null, modifiedAt: 't',
      metrics: { stars: 1, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: NOW },
      capabilities: { scannedAt: 't', rulesetVersion: 'old-rules', findings: [], redFlags: [] },
      ...over,
    })
    const d = mkdtempSync(join(tmpdir(), 'r8rs-'))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([
      gh({ name: 'o/empty', slug: 'o/empty', contains: [],
        source: { kind: 'github', id: 'o/empty', repo: 'o/empty', version: 'oldsha1' },
        verification: { status: 'skipped' } }),
      gh({ name: 'o/code', slug: 'o/code', contains: ['plugin'],
        source: { kind: 'github', id: 'o/code', repo: 'o/code', version: 'oldsha2' },
        verification: { status: 'verified' } }),
    ])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: NOW })
    const empty = out.plugins.find(p => p.name === 'o/empty')!
    // moved commit but nothing installable — 'skipped' stays the honest state
    expect(empty.verification.status).toBe('skipped')
    expect(empty.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    const code = out.plugins.find(p => p.name === 'o/code')!
    // moved commit + installable payload → re-queue honestly
    expect(code.verification.status).toBe('unverified')
    expect(code.source.version).toBe('newsha2')
  })
})
