// audit #2 (submission-flow, fresh round): submission-status must evaluate
// the SAME candidate version and verdict predicates the release gate uses —
// a status comment that disagrees with applyMatureVerdicts is a lie about
// whether the submission is blocked.
import { describe, it, expect, vi } from 'vitest'
import { CatalogIndex, AiVerdict } from '../src/schema.ts'
import { submissionStatuses, concernOn, upsertStatusComment } from '../pipeline/submission-status.ts'
import { latestVerdicts, latestHumanVerdicts } from '../pipeline/verdicts.ts'

const caps = { scannedAt: null, findings: [], redFlags: [] }
const ver = { status: 'unverified' as const }
const basePlugin = {
  name: 'p', slug: 'p', aliases: [], type: 'plugin' as const, discoveredVia: [],
  source: { kind: 'npm' as const, id: 'p' }, description: { en: '' }, features: [],
  category: [], license: null, deprecated: false, deprecatedMessage: null,
  replacement: null, createdAt: null, modifiedAt: null, maintainers: [],
  distTags: {}, firstSeenAt: 't', latestVersion: null, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: caps, verification: ver, compat: {},
}
const mkIdx = (plugins: unknown[], removed: unknown[] = []) =>
  CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins, removed })
const hv = (over: Partial<AiVerdict>): AiVerdict => AiVerdict.parse({
  name: 'p', verdict: 'concern', at: '2026-01-01T00:00:00Z', source: 'human', ...over,
})

describe('audit#2 — candidate version follows candidateVer, not stale hold', () => {
  // B3 inverted state: approval=pending AND a residual pendingUpdate. The
  // candidate under review is latestVersion — the stale hold's verdict key
  // must not shadow it (same order rule verdicts.ts documents as load-bearing).
  const pu = { version: '9.9.9', capabilities: caps, verification: ver, heldAt: 't' }
  const idx = mkIdx([{ ...basePlugin, name: 'pend-pkg', approval: 'pending', latestVersion: '2.0.0', pendingUpdate: pu }])
  const seeds = ['{"name":"pend-pkg","issue":2,"notified":false}']

  it('a human concern on the REAL candidate (latestVersion) blocks', () => {
    const rows = submissionStatuses(idx, seeds, [hv({ name: 'pend-pkg', version: '2.0.0' })])
    expect(rows[0]!.phase).toBe('blocked')
  })

  it('a concern keyed to the stale hold version does NOT block the candidate', () => {
    const rows = submissionStatuses(idx, seeds, [hv({ name: 'pend-pkg', version: '9.9.9' })])
    expect(rows[0]!.phase).toBe('review')
  })
})

describe('audit#2 — tombstone epoch gates the brake-lifting pass', () => {
  // brakeFor's lift requires epochGoverning(slotHuman): a pass stamped BEFORE
  // the name's latest tombstone judged a dead incarnation and must not
  // dissolve the standing brake — the status comment must agree with
  // applyMatureVerdicts, which still brakes.
  const idx = mkIdx(
    [{ ...basePlugin, name: 'p', approval: 'pending', latestVersion: '1.0.0' }],
    [{ slug: 'p', name: 'p', disappearedAt: '2026-02-01T00:00:00Z', reason: 'manual' }],
  )
  const seeds = ['{"name":"p","issue":2,"notified":false}']
  const verdicts = [
    hv({ name: 'p', version: null, at: '2026-01-01T00:00:00Z' }),              // package brake
    hv({ name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-01-15T00:00:00Z' }), // pre-tombstone pass — stale
  ]

  it('status shows blocked, matching the release gate', () => {
    const rows = submissionStatuses(idx, seeds, verdicts)
    expect(rows[0]!.phase).toBe('blocked')
  })

  it('a post-tombstone pass DOES lift the brake', () => {
    const rows = submissionStatuses(idx, seeds, [
      ...verdicts,
      hv({ name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-02-02T00:00:00Z' }),
    ])
    expect(rows[0]!.phase).toBe('review')
  })
})

describe('audit#2 — verdict lookup keys on the resolved entry identity', () => {
  // A github-kind entry reached via source.repo can carry a catalog name
  // different from the seed's repo string — a brake on the ENTRY's key must
  // still surface as blocked.
  const idx = mkIdx([{
    ...basePlugin, name: 'real-pkg', slug: 'real-pkg', approval: 'pending',
    source: { kind: 'github' as const, id: 'o/r', repo: 'o/r', version: 'a'.repeat(40) },
  }])
  it('human concern on the entry name blocks a repo-seeded issue', () => {
    const rows = submissionStatuses(idx, ['{"repo":"o/r","issue":7,"notified":false}'],
      [hv({ name: 'real-pkg', version: null })])
    expect(rows[0]!.phase).toBe('blocked')
  })
})

describe('audit#2 — concernOn delegates to slotVerdict', () => {
  it('returns the governing concern verdict or null', () => {
    const vs = [hv({ name: 'p', version: '1.0.0', source: 'ai' })]
    const { latest, human } = { latest: latestVerdicts(vs), human: latestHumanVerdicts(vs) }
    expect(concernOn('p', '1.0.0', latest, human)?.source).toBe('ai')
    expect(concernOn('p', '2.0.0', latest, human)).toBeNull()
  })
})

describe('audit#2 — status-comment marker is bot-scoped', () => {
  it('the comments lookup filters to github-actions[bot]', async () => {
    vi.resetModules()
    const calls: string[][] = []
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls.push(args)
        return ''   // no existing marker comment → POST path
      },
    }))
    const mod = await import('../pipeline/submission-status.ts')
    const row = { issue: 5, key: 'k', phase: 'queued' as const, phaseLabel: '排队中', detail: 'd' }
    expect(mod.upsertStatusComment('o/r', row, 'run1')).toBe(true)
    const jq = calls.flat().find(a => a.includes('submission-status -->'))
    expect(jq).toContain('github-actions[bot]')
    vi.doUnmock('node:child_process')
    vi.resetModules()
  })
})
