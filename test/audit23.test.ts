import { describe, it, expect } from 'vitest'
import { latestVerdicts, latestHumanVerdicts, vkey } from '../pipeline/verdicts.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const V = (verdict: string, at: string, source = 'ai', version = '1.0.0') =>
  ({ name: 'p', version, verdict, at, source }) as any
const PAST = '2025-01-01T00:00:00Z'
const PAST2 = '2025-01-02T00:00:00Z'
const FUTURE = '2999-01-01T00:00:00Z'

describe('audit residuals — fixable risks (lock reclaim / gates / future at)', () => {
  it('a far-future at never ranks as latest — later real verdicts win', () => {
    // file order: future line sits BETWEEN two real ones
    const vs = [V('pass', PAST), V('concern', FUTURE), V('concern', PAST2)]
    const latest = latestVerdicts(vs)
    expect(latest.get(vkey('p', '1.0.0'))!.at).toBe(PAST2)
    // same for the human-brake layer — a future-dated human line must not
    // pin a brake (or a pass) on top of all later real judgments
    const hv = [V('pass', PAST, 'human'), V('concern', FUTURE, 'human'), V('concern', PAST2, 'human')]
    expect(latestHumanVerdicts(hv).get(vkey('p', '1.0.0'))!.at).toBe(PAST2)
    // normal clock skew still ranks — the grace is minutes, not days
    const skew = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const vs2 = [V('pass', PAST), V('concern', skew)]
    expect(latestVerdicts(vs2).get(vkey('p', '1.0.0'))!.at).toBe(skew)
  })

  it('ai-diagnose.sh reclaims stale locks atomically (mv-swap, no rmdir+mkdir race)', () => {
    const src = readFileSync(join(__dirname, '..', 'bin', 'ai-diagnose.sh'), 'utf8')
    // the atomic path: rename the stale dir aside, then mkdir the fresh lock
    expect(src).toContain('mv "$LOCK" "$LOCK.stale.$$"')
    // the racy pattern must be gone: a plain rmdir of the LIVE lock path
    // before mkdir would let a second reclaimer delete the winner's new lock
    expect(src).not.toMatch(/rmdir "\$LOCK" 2>\/dev\/null && mkdir/)
    // the reclaim still requires the age check first
    const reclaim = src.match(/if \[ "\$AGE" -gt 7200 \] && mv[^;]+; then/)
    expect(reclaim).toBeTruthy()
  })

  it('concern.yml verdict job accepts whitespace-padded commands via word contains', () => {
    const src = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')
    // the old gate only covered 0/1 leading spaces — word-level contains
    // catches any padding while noresolve→grep keeps over-matching silent
    expect(src).toContain("contains(github.event.comment.body, '/concern')")
    expect(src).toContain("contains(github.event.comment.body, '/approve')")
    expect(src).toContain("contains(github.event.comment.body, '/CONCERN')")
    expect(src).toContain("contains(github.event.comment.body, '/APPROVE')")
  })

  it('concern.yml retest job stays anchored but covers deeper padding', () => {
    const src = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')
    const retest = src.match(/retest:\n\s+if: >-([\s\S]*?)runs-on:/)!
    expect(retest).toBeTruthy()
    const gate = retest[1]!
    // mid-text '/retest' can dispatch real work — contains() must NOT appear
    expect(gate).not.toContain("contains(github.event.comment.body, '/retest')")
    // but multi-space indents now match (2/3/4 spaces)
    expect(gate).toContain("'  /retest'")
    expect(gate).toContain("'   /retest'")
    expect(gate).toContain("'    /retest'")
  })
})
