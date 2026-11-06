/** audit #5 fresh pass — human-verdict flow gaps found independently of the
 *  earlier audit rounds:
 *  1. repo-shaped specs kept their typed version — `/concern o/r@1.5` on an
 *     npm twin resolved to the index slot instead of 1.5; `o/r@*` lost the
 *     package scope (the parser cleared `ver` before the entry KIND was
 *     known; the workflow's INFO branch already nulls it for github-kind).
 *  2. retargetedIssueTarget compared name only — a form edit of the 版本
 *     field stranded the old version's keyed verdict invisibly.
 *  3. dedupeReport emitted raw jsonl field values into the k=v output
 *     protocol — a line carrying whitespace in name/version/at could inject
 *     forged outputs (unresolved=1 / dup=1) into $GITHUB_OUTPUT.
 *  4. concern.yml's retest resolver ignored the B3 slot rule — a pending
 *     entry with a residual pendingUpdate read the stale hold's
 *     version/flags for its warnings. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveVerdictEvent, dedupeReport } from '../pipeline/human-verdict.ts'
import type { VerdictEvent } from '../pipeline/human-verdict.ts'

const ev = (over: Partial<VerdictEvent> = {}): VerdictEvent => ({
  event: 'issue_comment', action: 'created',
  issueTitle: 'some issue', issueBody: '', issueNumber: '7',
  commentBody: '', label: '', actor: 'terry',
  ...over,
})

const L = (o: object) => JSON.stringify(o)

describe('repo-shaped spec keeps the typed version (kind decides downstream)', () => {
  it('/concern o/r@1.5 → ver survives; the index-kind check decides null-vs-slot', () => {
    // before: ver was cleared on the repo SHAPE → an npm-twin target resolved
    // to the index-held slot instead of the maintainer's explicit 1.5
    const r = resolveVerdictEvent(ev({ commentBody: '/concern o/r@1.5 sus' }))
    expect(r).toMatchObject({ name: 'o/r', ver: '1.5', verdict: 'concern', isrepo: '1' })
  })
  it('/concern o/r@* → package scope survives for an npm twin', () => {
    // before: '*' was destroyed with ver → the package-level brake silently
    // degraded to a single-slot verdict
    const r = resolveVerdictEvent(ev({ commentBody: '/concern o/r@* everything' }))
    expect(r).toMatchObject({ name: 'o/r', ver: '*', verdict: 'concern' })
  })
  it('[review] o/r@1.5 title + label → typed version carried to the kind check', () => {
    const r = resolveVerdictEvent(ev({
      event: 'issues', action: 'labeled', label: 'verdict:pass',
      issueTitle: '[review] o/r@1.5', commentBody: '',
    }))
    expect(r).toMatchObject({ name: 'o/r', ver: '1.5', verdict: 'pass' })
  })
  it('crafted version on a repo spec still sanitizes to blank', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern o/r@$(id) sus' }))
    expect(r).toMatchObject({ name: 'o/r', ver: '' })
  })
  it('version compare vs title target now works for repo specs (mismatch honest)', () => {
    // [review] o/r@2.0 + arg o/r@1.5 — different versions → mismatch flags;
    // before, ver was cleared before the compare so it could never fire
    const r = resolveVerdictEvent(ev({
      issueTitle: '[review] o/r@2.0', commentBody: '/concern o/r@1.5 sus',
    }))
    expect(r.mismatch).toBeDefined()
  })
})

describe('dedupeReport — k=v output protocol is injection-safe', () => {
  it('a poisoned verdict line cannot inject output keys', () => {
    const lines = [
      L({ name: 'evil\nunresolved=1', version: 'x\ndup=1', verdict: 'concern',
          source: 'human', issue: 5, at: '2026-01-01T00:00:00Z' }),
      L({ name: 'p', version: '1', verdict: 'pass', source: 'human',
          issue: 5, at: '2026-01-01T00:00\ndeadslot=1' }),
    ]
    const r = dedupeReport(lines, 'p', '1', 'concern', 'why', 5)
    for (const v of Object.values(r)) expect(v).not.toMatch(/\s/)
    // prev still reports the real override — flattened, not dropped
    expect(r.prev).toBe('pass@2026-01-01T00:00deadslot=1')
    // previssue surfaces the poisoned-name line — as inert text
    expect(r.previssue).toBe('evilunresolved=1@xdup=1')
  })
  it('dup=1 suppresses amend/prev like the old CLI did', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'concern', source: 'human', reason: 'same', at: 't' })]
    const r = dedupeReport(lines, 'p', '1', 'concern', 'same')
    expect(r).toMatchObject({ dup: '1', amend: '', prev: '', previssue: '' })
  })
  it('reason-only amend returns the prior at; override reports prev', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', source: 'human', reason: 'old', at: '2026-01-01T00:00:00Z' }),
    ]
    expect(dedupeReport(lines, 'p', '1', 'pass', 'new reason').amend).toBe('2026-01-01T00:00:00Z')
    expect(dedupeReport(lines, 'p', '1', 'concern', 'flip').prev).toBe('pass@2026-01-01T00:00:00Z')
  })
  it('previssue renders name@*, bare o/r, and name@ver shapes readably', () => {
    expect(dedupeReport(
      [L({ name: 'pkg', version: null, verdict: 'concern', source: 'human', issue: 9 })],
      'pkg', '2', 'concern', 'x', 9,
    ).previssue).toBe('pkg@*')
    expect(dedupeReport(
      [L({ name: 'o/r', version: null, verdict: 'concern', source: 'human', issue: 9 })],
      'pkg', '2', 'concern', 'x', 9,
    ).previssue).toBe('o/r')
    expect(dedupeReport(
      [L({ name: 'old', version: '1', verdict: 'concern', source: 'human', issue: 9 })],
      'new', '2', 'concern', 'x', 9,
    ).previssue).toBe('old@1')
  })
  it('same-name different-version retarget now surfaces via previssue', () => {
    // form edit changed only 版本: pkg@1 → pkg@2 — the pkg@1 brake still lives
    const lines = [L({ name: 'pkg', version: '1', verdict: 'concern', source: 'human', issue: 9 })]
    expect(dedupeReport(lines, 'pkg', '2', 'concern', 'x', 9).previssue).toBe('pkg@1')
    // same key → no warning
    expect(dedupeReport(lines, 'pkg', '1', 'concern', 'x', 9).previssue).toBe('')
  })
})

describe('concern.yml workflow contract (audit #5 fresh pass)', () => {
  const wf = readFileSync(new URL('../.github/workflows/concern.yml', import.meta.url), 'utf8')
  it('retest resolver honors the B3 slot rule — pending entries read their own fields', () => {
    // a residual pendingUpdate on a pending entry is the inverted state: its
    // version/flags describe the stale hold, not the verifiable target
    const i = wf.indexOf('const pu =')
    expect(i).toBeGreaterThan(-1)
    expect(wf.slice(i, i + 400)).toContain("approval === 'pending' ? undefined : e?.pendingUpdate")
  })
  it('resolve passes the typed version through — the INFO kind check owns the null rule', () => {
    // guard the parser-side contract: `if (repo) ver = ''` must not come back —
    // the entry-kind check (isRepo) in the INFO step is the one place that
    // may null a version
    const hv = readFileSync(new URL('../pipeline/human-verdict.ts', import.meta.url), 'utf8')
    expect(hv).not.toMatch(/if \(repo\) ver = ''/)
    const i = wf.indexOf('if (isRepo || pkgAll) v = ""')
    expect(i).toBeGreaterThan(-1)
  })
})
