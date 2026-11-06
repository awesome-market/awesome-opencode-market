/** audit #8 fresh-batch (docket flow, round 2):
 *  1. docket.yml `dry` input used `github.event.inputs.dry == true` —
 *     event.inputs.* are STRINGS; 'true' == true coerces to NaN==1 → never
 *     matched → a dry-run dispatch would silently perform LIVE issue
 *     writes (fail-open on the safety flag). Now uses typed `inputs.dry`.
 *  2. candidateVer/verifyTargetOf preferred pendingUpdate even when
 *     approval==='pending' — the B3 inverted state whose pu is always a
 *     stale shadow (dropped by the R-9 cleanup). The stale hold version
 *     would shadow the REAL pending candidate across diagnose/docket/
 *     digest/verify.
 *  3. issueBody phone labels told an ai:pass issue "人工放行（覆盖 AI
 *     concern）" — there is no concern to override on a pass issue. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { candidateVer } from '../pipeline/verdicts.ts'
import { verifyTargetOf } from '../pipeline/verify/plan.ts'
import { issueBody } from '../pipeline/docket.ts'
import type { PluginEntry } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-10', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'unverified', level: 'install' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkPu = (version: string) => ({
  version,
  capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  heldAt: 'h',
})

describe('B3 inverted state — the stale pu never shadows the pending candidate', () => {
  const inverted = mkEntry('p', { approval: 'pending', pendingUpdate: mkPu('9.9.9') })

  it('candidateVer returns the pending candidate (latestVersion), not the stale hold', () => {
    expect(candidateVer(inverted)).toBe('1.0.0')
    // legal states unchanged
    expect(candidateVer(mkEntry('p', { pendingUpdate: mkPu('1.1.0') }))).toBe('1.1.0')
    expect(candidateVer(mkEntry('p', { approval: 'pending' }))).toBe('1.0.0')
    expect(candidateVer(mkEntry('p'))).toBeUndefined()
  })

  it('verifyTargetOf measures the entry, not the stale hold', () => {
    const t = verifyTargetOf(inverted)
    expect(t.version).toBe('1.0.0')
    expect(t.verification.status).toBe('unverified')   // entry's own, not pu's 'verified'
    const held = verifyTargetOf(mkEntry('p', { pendingUpdate: mkPu('1.1.0') }))
    expect(held.version).toBe('1.1.0')                  // legal hold still wins
  })
})

describe('docket.yml — the dry input actually reaches the script', () => {
  const wf = readFileSync(join(__dirname, '..', '.github/workflows/docket.yml'), 'utf8')
  it('uses typed inputs.dry (event.inputs string never equals boolean true)', () => {
    expect(wf).toContain("inputs.dry && '--dry'")
    expect(wf).not.toContain('github.event.inputs.dry')
  })
})

describe('issueBody phone labels per verdict', () => {
  it('an ai:pass issue is not told the pass "covers an AI concern"', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', maturity: 'pending-announce' })
    expect(body).not.toContain('覆盖 AI concern')
    const con = issueBody({ name: 'p', version: '1.0.0', verdict: 'concern' })
    expect(con).toContain('覆盖 AI concern')
  })
})
