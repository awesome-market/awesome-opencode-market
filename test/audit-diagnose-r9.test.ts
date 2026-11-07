/** audit #4 fresh round (AI diagnosis flow), round 9 — pin the two
 *  load-bearing candidate contracts that had NO direct coverage:
 *
 *  1. epoch re-queue: a pending entry whose latest 'pass' predates the
 *     name's tombstone judged a DIFFERENT (dead) incarnation — the release
 *     gate refuses it via epochGoverning, so the queue must NOT count it as
 *     "already reviewed" or the recycled entry sits verdict-less forever.
 *  2. null-version (github-kind) exclusion: AI never reviews version-less
 *     entries — their verdict slot is name@null, written only by humans
 *     with the pinned-commit sha. An AI line on that key would carry no
 *     byte anchor (shaOk vacuous → could release moved bytes). docket's
 *     'none' aggregate depends on the same exclusion. */
import { describe, it, expect } from 'vitest'
import { unreviewedTargets } from '../pipeline/ai/diagnose.ts'
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

describe('audit#4 r9 — github-kind (version-less) entries never enter the AI queue', () => {
  const gh = entry({
    name: 'Owner/Repo', slug: 'owner/repo',
    source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
    latestVersion: null, // gh entries are version-less; name@null is their verdict slot
  })
  it('pending repo entry with no verdict → excluded (human-only release path)', () => {
    expect(unreviewedTargets(idx([gh]), [])).toEqual([])
  })
  it('--name targeting the repo still can\'t queue it — even --force stops at the null version', () => {
    expect(unreviewedTargets(idx([gh]), [], new Set(['owner/repo']))).toEqual([])
    // the !ver guard runs BEFORE the force override: a version-less entry has
    // no candidate to re-review, so --force can't conjure one either
    expect(unreviewedTargets(idx([gh]), [], new Set(['owner/repo']), { force: true })).toEqual([])
  })
  it('a human name@null verdict exists → still excluded (decided, never re-reviewed)', () => {
    const hv = v({ name: 'owner/repo', version: null, source: 'human', sha: 'c0ffee' })
    expect(unreviewedTargets(idx([gh]), [hv])).toEqual([])
  })
})
