/** audit #5 fresh round (round 10) — three findings from the independent
 *  re-audit of the human-verdict flow:
 *
 *  1. The [submit] defer was lowercase-only — submit.yml's verdict gate owns
 *     [submit]/[Submit]/[SUBMIT]; a case-variant title WITHOUT the submission
 *     label (pre-label window or label removed) let the same /concern comment
 *     be written by BOTH workflows (submit pins the seed version, concern
 *     writes a second differently-keyed verdict), and even a bare command
 *     left a spurious verdict:blocked + usage comment on submit's turf.
 *  2. INFO's pkgAll ignored entry kind — `o/r@*` resolved onto a github-kind
 *     entry (where the null key IS the slot verdict, never a package brake)
 *     still produced pkgAll=1: the ack claimed whole-package scope and the
 *     commit target rendered `o/r@*` for a single-slot entry.
 *  3. The pkgAll pass flag warning claimed "人工 pass 将压过 AI 侧顾虑放行" —
 *     false for package scope: a name@null pass only dissolves the package
 *     brake; flagged slots still need their own exact-key human pass
 *     (humanPassCovers is slot-keyed). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveVerdictEvent } from '../pipeline/human-verdict.ts'
import type { VerdictEvent } from '../pipeline/human-verdict.ts'

const ev = (over: Partial<VerdictEvent> = {}): VerdictEvent => ({
  event: 'issue_comment', action: 'created',
  issueTitle: 'some issue', issueBody: '', issueNumber: '7',
  commentBody: '', label: '', actor: 'terry',
  ...over,
})

const WF = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')

describe('audit#5-r10 — [submit] defer mirrors submit.yml casings', () => {
  it.each(['[submit] x', '[Submit] x', '[SUBMIT] x'])(
    'comment channel defers %s to submit.yml', (title) => {
      expect(resolveVerdictEvent(ev({ issueTitle: title, commentBody: '/concern pkg@1 r' })).skip)
        .toBe('submit')
    })
  it.each(['[submit] x', '[Submit] x', '[SUBMIT] x'])(
    'labeled channel defers %s to submit.yml', (title) => {
      expect(resolveVerdictEvent(ev({
        event: 'issues', action: 'labeled', label: 'verdict:pass',
        issueTitle: title, commentBody: '',
      })).skip).toBe('submit')
    })
  it('an exotic casing ([sUbMiT]) is a submission to NEITHER workflow — normal handling', () => {
    // submit.yml's gate lists exactly three casings; over-matching here would
    // defer to a workflow that never fires, silently eating the verdict
    const r = resolveVerdictEvent(ev({ issueTitle: '[sUbMiT] x', commentBody: '/concern pkg@1 r' }))
    expect(r.skip).toBeUndefined()
    expect(r).toMatchObject({ name: 'pkg', ver: '1', verdict: 'concern' })
  })
})

describe('audit#5-r10 — pkgAll is npm-package-scope only (entry kind decides)', () => {
  it('INFO computes pkgAll with the kind check — repo `*` is a slot verdict', () => {
    expect(WF).toContain('const pkgAll = v === "*" && !isRepo')
    // the null-version rule itself is unchanged: isRepo||pkgAll still empties v
    expect(WF).toContain('if (isRepo || pkgAll) v = ""')
  })
  it('ack flag warning splits package scope from slot scope honestly', () => {
    // package pass lifts only the package brake — flagged slots need their
    // own exact-key pass; the slot wording must not leak into pkgAll
    expect(WF).toContain('包级 pass 只解除整包刹车')
    expect(WF).toContain('人工 pass 将压过 AI 侧顾虑放行')
    expect(WF).toContain("msg += pkgAll")
  })
})
