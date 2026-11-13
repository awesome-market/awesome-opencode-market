/** audit #4 fresh round (AI diagnosis flow), round 9 — pin the two
 *  load-bearing candidate contracts that had NO direct coverage:
 *
 *  1. epoch re-queue: a pending entry whose latest 'pass' predates the
 *     name's tombstone judged a DIFFERENT (dead) incarnation — the release
 *     gate refuses it via epochGoverning, so the queue must NOT count it as
 *     "already reviewed" or the recycled entry sits verdict-less forever.
 *  2. github-kind admission: version-less entries DO enter the queue once
 *     their commit pin is known (reviewPin admits source.version — the
 *     verdict lands on the name@'' slot with sha=the reviewed commit, so
 *     shaOk pins bytes exactly like dist.integrity does for npm). An entry
 *     withOUT a resolved sha stays out — no bytes to anchor. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unreviewedTargets, main as diagnoseMain } from '../pipeline/ai/diagnose.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const idx = (plugins: PluginEntry[], removed: CatalogIndex['removed'] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
const entry = (o: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', contains: ['plugin'],
  discoveredVia: 'npm-search', source: { kind: 'npm', id: 'pkg' },
  description: { en: 'd' }, features: {}, category: 'other', license: null,
  deprecated: false, deprecatedMessage: null, replacement: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  integrity: null, metrics: {}, capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
  approval: 'pending', approvalReason: null, pendingUpdate: null,
  verification: { status: 'skipped', level: 'install' }, compat: {}, ...o,
} as PluginEntry)
const v = (o: Partial<AiVerdict>): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...o,
} as AiVerdict)

describe('audit#4 r9 — epoch-gated re-queue of recycled names', () => {
  const tomb = [{ slug: 'pkg', name: 'pkg', disappearedAt: '2026-02-01T00:00:00Z', reason: 'npm-404' as const }]
  it('a pre-tombstone pass does not count as reviewed — recycled entry re-queues', () => {
    const e = entry({ latestVersion: '1.0.0' })       // re-entered under the same key
    const stalePass = v({ at: '2026-01-15T00:00:00Z' }) // judged the dead incarnation
    expect(unreviewedTargets(idx([e], tomb), [stalePass])).toHaveLength(1)
  })
  it('a post-tombstone pass governs the new incarnation — still decided', () => {
    const e = entry()
    const freshPass = v({ at: '2026-02-02T00:00:00Z' })
    expect(unreviewedTargets(idx([e], tomb), [freshPass])).toEqual([])
  })
  it('a pre-tombstone CONCERN still governs — recycled names inherit distrust', () => {
    const e = entry()
    const staleConcern = v({ verdict: 'concern', at: '2026-01-15T00:00:00Z' })
    expect(unreviewedTargets(idx([e], tomb), [staleConcern])).toEqual([])
  })
})

describe('audit#4 r9 — github-kind entries review at the pinned commit', () => {
  const gh = entry({
    name: 'Owner/Repo', slug: 'owner/repo',
    source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
    latestVersion: null, // gh entries are version-less; name@null is their verdict slot
  })
  it('pending repo entry WITH a resolved sha → queued (AI reviews the pinned commit)', () => {
    expect(unreviewedTargets(idx([gh]), [])).toHaveLength(1)
  })
  it('pending repo entry with NO resolved sha → excluded (no bytes to anchor a verdict to)', () => {
    const noSha = entry({
      name: 'Owner/Repo', slug: 'owner/repo',
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42 },
      latestVersion: null,
    })
    expect(unreviewedTargets(idx([noSha]), [])).toEqual([])
    // the pin guard runs BEFORE the force override: a version-less entry has
    // no bytes to re-review, so --force can't conjure one either
    expect(unreviewedTargets(idx([noSha]), [], new Set(['owner/repo']), { force: true })).toEqual([])
  })
  it('legacy github entry → admitted by default, excluded via includeLegacy:false', () => {
    const lg = entry({
      name: 'Owner/Repo', slug: 'owner/repo',
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
      latestVersion: null, approval: 'legacy',
    })
    expect(unreviewedTargets(idx([lg]), [])).toHaveLength(1)
    expect(unreviewedTargets(idx([lg]), [], null, { includeLegacy: false })).toEqual([])
  })
  it('an ai verdict on name@null → excluded (slot decided; a moved commit re-enters via the drift sweep)', () => {
    const av = v({ name: 'owner/repo', version: null, sha: 'c0ffee' })
    expect(unreviewedTargets(idx([gh]), [av])).toEqual([])
  })
  it('a human name@null verdict exists → still excluded (decided, never re-reviewed)', () => {
    const hv = v({ name: 'owner/repo', version: null, source: 'human', sha: 'c0ffee' })
    expect(unreviewedTargets(idx([gh]), [hv])).toEqual([])
  })
  it('main() emits version:null + sha:commit, fetches codeload at the PIN (never a mutable ref)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'gh-'))
    const ip = join(d, 'i.json'), vp = join(d, 'v.jsonl'), op = join(d, 'o.jsonl')
    // schema-valid github row — the r9 unit fixtures carry nulls the strict
    // CatalogIndex.parse rejects (approvalReason/pendingUpdate), so build the
    // on-disk shape directly: latestVersion:null IS the github form
    const ghRow = {
      name: 'Owner/Repo', slug: 'owner/repo', aliases: [], type: 'plugin',
      contains: ['plugin'], discoveredVia: ['github-topic'],
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
      description: { en: 'd' }, features: [], category: [], license: null,
      deprecated: false, deprecatedMessage: null, replacement: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: null, publishedAt: null,
      integrity: null,
      metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
      approval: 'pending', verification: { status: 'skipped', level: 'install' }, compat: {},
    }
    writeFileSync(ip, JSON.stringify(idx([ghRow as PluginEntry])))
    writeFileSync(vp, '')
    const urls: string[] = []
    // a codeload-shaped tarball: wrapper root is `<repo>-<sha>/`, not `package/`
    const { create } = await import('tar')
    const src = join(d, 'src', 'repo-c0ffee')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'SKILL.md'), '# repo skill\n')
    const tgzPath = join(d, 'r.tgz')
    await create({ gzip: true, file: tgzPath, cwd: join(d, 'src') }, ['repo-c0ffee/SKILL.md'])
    const tgz = readFileSync(tgzPath)
    const got: { version?: string | null | undefined; ids?: string[] } = {}
    await diagnoseMain(['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op], {
      l05: () => new Map<string, number>(),
      ornith: async (_e, m, o) => {
        got.version = o?.version; got.ids = m.map(x => x.id)
        return { verdict: 'pass' as const, reasonZh: 'ok', reasonEn: 'ok' }
      },
      fetchFn: (async (u: unknown) => { urls.push(String(u)); return new Response(new Uint8Array(tgz)) }) as unknown as typeof fetch,
      ping: async () => true,
    })
    const lines = readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.name).toBe('Owner/Repo')
    expect(lines[0]!.version).toBeNull()          // the github slot key — name@''
    expect(lines[0]!.sha).toBe('c0ffee')          // byte anchor = the pinned commit
    expect(urls).toEqual(['https://codeload.github.com/Owner/Repo/tar.gz/c0ffee'])
    expect(got.version).toBe('commit c0ffee')     // the judge sees the sha, not a phantom semver
    expect(got.ids).toContain('content:SKILL.md') // codeload wrapper root was stripped correctly
  })
})
