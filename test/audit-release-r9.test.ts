/** audit #7 (放行流 §7, 第 5 轮) — fresh independent pass found no production
 *  defect; the github-kind sha-anchor arm of the release gate had thin
 *  coverage: `shaAnchor(e)` for github-kind is `source.version` (the pinned
 *  commit), NOT an SRI — a human pass on commit A must not release commit B.
 *  npm arms (pu.integrity, e.integrity) are already pinned in G2; these pin
 *  the repo-side equivalents:
 *
 *  1. mature human pass + sha === source.version → release (positive anchor);
 *  2. mature human pass + sha !== source.version → refused (repo moved /
 *     re-tagged after review — the bytes reviewed are not the bytes shown);
 *  3. mature human pass + NO sha → release (legacy degrade: missing side
 *     can't be compared — spec: 任一侧缺失不拦);
 *  4. explainEntry on the mismatched arm reports the pin disagreement
 *     (等复审), not a misleading temporal gate. */
import { describe, it, expect } from 'vitest'
import { applyMatureVerdicts, explainEntry, digestStateOf } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const DIGEST = '2026-02-01T21:15:00Z'
const AFTER = '2026-02-01T10:00:00Z'

const ghEntry = (name: string, commitSha: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['github-topic'],
  source: { kind: 'github', id: name, version: commitSha }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: null, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'skipped', level: 'install' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const hv = (name: string, sha?: string): AiVerdict => ({
  name, version: null, verdict: 'pass', at: AFTER, source: 'human', ...(sha ? { sha } : {}),
})

describe('§7 github-kind sha anchor — reviewed bytes == released bytes', () => {
  it('mature human pass + sha === source.version → approved', () => {
    const e = ghEntry('o/r', 'commitA')
    const v = hv('o/r', 'commitA')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual(['o/r@null'])
    expect(r.index.plugins[0]!.approval).toBe('approved')
  })
  it('mature human pass + sha !== source.version → refused (repo moved after review)', () => {
    const e = ghEntry('o/r', 'commitB')           // reviewed commitA, branch now at B
    const v = hv('o/r', 'commitA')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual([])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('mature human pass + NO sha → approved (missing side = unverifiable, legacy degrade)', () => {
    const e = ghEntry('o/r', 'commitA')
    const v = hv('o/r')
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual(['o/r@null'])
  })
  it('explainEntry reports the sha pin disagreement, not a temporal gate', () => {
    const e = ghEntry('o/r', 'commitB')
    const v = hv('o/r', 'commitA')
    const s = explainEntry(e, [v], digestStateOf(DIGEST, [v]))
    expect(s[0]!.outcome).toBe('wait')
    expect(s[0]!.why).toContain('字节')
  })
  it('github-kind AI pass on a never-scanned slot is still ignored even with matching sha', () => {
    const e = ghEntry('o/r', 'commitA', {
      capabilities: { scannedAt: null, rulesetVersion: 'r', findings: [], redFlags: [] },
    })
    const v: AiVerdict = { name: 'o/r', version: null, verdict: 'pass', at: AFTER, source: 'ai', sha: 'commitA' }
    const r = applyMatureVerdicts(mkIndex([e]), [v], digestStateOf(DIGEST, [v]))
    expect(r.releases).toEqual([])
  })
})
