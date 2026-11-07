/** audit #1 fresh round (catalog-ingestion, round 9):
 *  rescanStaleGh was gated on ruleset staleness alone — a github-kind entry
 *  kept alive by gone-check (fallen out of discovery) got ZERO tree fetches
 *  between ruleset bumps: upstream pushes never re-derived the
 *  repo-moved-since-* / repo-pkg-changed drift flags, never re-anchored
 *  source.version, never refreshed caps. Asymmetric with npm kept-entries
 *  (rescanStaleNpm runs the integrity-drift check free every run via the
 *  abbreviated packument) and with discovered gh entries (ghWorker
 *  re-derives on every pushedAt hit). The gone-check fetchRepoMeta already
 *  returned pushedAt — it was simply discarded. The rescan now also fires
 *  when pushedAt moved since the entry's last-seen value (modifiedAt IS
 *  last-seen pushedAt for github-kind entries), sharing the same
 *  rescanBudget, and records the observed pushedAt so the trigger doesn't
 *  refire every run.
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

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'o/kept', slug: 'o/kept', aliases: [], type: 'plugin', discoveredVia: ['github-topic'],
  source: { kind: 'github', id: 'o/kept', repo: 'o/kept', version: 'oldsha' },
  description: { en: 'a repo' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: 'oldpush', maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: null, publishedAt: null, integrity: null,
  metrics: { stars: 3, npmDownloads30d: null, checkedAt: NOW },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  contains: ['plugin'],
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: NOW, categories: {}, plugins, removed: [],
})

function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'r9tgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'kept', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "kept", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

const metaFor = (pushedAt: string) => JSON.stringify({
  id: 7, stargazers_count: 3, archived: false, fork: false,
  pushed_at: pushedAt, license: { spdx_id: 'MIT' }, full_name: 'o/kept',
})

/** discovery returns nothing → the stored entry falls to gone-check, which
 *  re-probes the repo and (on ok) hands it to rescanStaleGh */
const mkFetch = (pushedAt: string, fetched: string[]) => (async (input: RequestInfo | URL) => {
  const url = String(input)
  fetched.push(url)
  if (url.includes('/-/v1/search')) return new Response(JSON.stringify({ objects: [] }))
  if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
  if (url.includes('/git/trees/'))
    return new Response(JSON.stringify({ sha: 'newsha', truncated: false, tree: [{ path: 'package.json' }] }))
  if (url === 'https://api.github.com/repos/o/kept') return new Response(metaFor(pushedAt))
  if (url.includes('codeload.github.com')) return new Response(new Uint8Array(mkTgz()))
  return new Response('', { status: 404 })
}) as typeof fetch

describe('rescanStaleGh: pushedAt move triggers rescan on ruleset-current kept entries', () => {
  it('repo pushed since last-seen → tree fetched, pin re-anchored, moved commit re-queued', async () => {
    const fetched: string[] = []
    const f = mkFetch('newpush', fetched)
    const d = mkdtempSync(join(tmpdir(), 'r9mv-'))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([e()])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: NOW })
    // ruleset was already current — only the pushedAt arm could have fired
    expect(fetched.some(u => u.includes('/git/trees/'))).toBe(true)
    const got = out.plugins.find(p => p.name === 'o/kept')!
    expect(got.source.version).toBe('newsha')
    expect(got.modifiedAt).toBe('newpush')
    // moved pin + installable payload → honest re-queue, not a carried 'verified'
    expect(got.verification.status).toBe('unverified')
    expect(got.capabilities.rulesetVersion).toBe(RULESET_VERSION)
  })

  it('pushedAt unchanged → no tree fetch, entry passes through untouched', async () => {
    const fetched: string[] = []
    const f = mkFetch('oldpush', fetched)
    const d = mkdtempSync(join(tmpdir(), 'r9st-'))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idx([e()])))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: NOW })
    expect(fetched.some(u => u.includes('/git/trees/'))).toBe(false)
    expect(fetched.some(u => u.includes('codeload.github.com'))).toBe(false)
    const got = out.plugins.find(p => p.name === 'o/kept')!
    expect(got.source.version).toBe('oldsha')
    expect(got.modifiedAt).toBe('oldpush')
    expect(got.verification.status).toBe('verified')
  })
})
