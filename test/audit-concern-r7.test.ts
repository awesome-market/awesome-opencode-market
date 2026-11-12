// audit #5 fresh round — the dedupe/prev/amend/retarget scans in
// human-verdict.ts read raw jsonl lines but never applied the governing
// view's filters: loadVerdicts drops lines without a valid `at`, and
// latestVerdicts/latestHumanVerdicts exclude far-future stamps via
// rankable() (>10min clock-skew grace). A future-dated line is INERT to
// the release gate yet was treated as "latest" here — worst case,
// amendAt would stamp a NEW verdict with the phantom's future `at`,
// minting a permanently-inert judgment; isDupVerdict could skip a
// verdict that never actually governs (brake silently lost).
import { describe, it, expect } from 'vitest'
import { isDupVerdict, amendAt, overriddenHuman, retargetedIssueTarget, dedupeReport } from '../pipeline/human-verdict.ts'

const FUTURE = '2999-01-01T00:00:00.000Z'   // far beyond the 10min rankable grace
const PAST = '2026-01-01T00:00:00.000Z'
const L = (o: Record<string, unknown>) => JSON.stringify(o)

describe('audit#5-r7 — dedupe scans honor the governing (rankable) view', () => {
  it('isDupVerdict: an inert future-dated twin must not satisfy dedupe — the governing verdict still lands', () => {
    // governing latest = human pass@PAST; the future concern is invisible to
    // latestHumanVerdicts. Re-firing the SAME concern+reason must NOT dedupe
    // against the phantom — the brake has to reach the ledger.
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'ok', source: 'human', at: PAST }),
      L({ name: 'p', version: '1', verdict: 'concern', reason: 'bad', source: 'human', at: FUTURE }),
    ]
    expect(isDupVerdict(lines, 'p', '1', 'concern', 'bad')).toBe(false)
    // and the symmetric case: identical re-fire against the GOVERNING line
    // still dedupes (the phantom below it changes nothing)
    expect(isDupVerdict(lines, 'p', '1', 'pass', 'ok')).toBe(true)
  })

  it('amendAt: never reuses an inert future `at` — the amended verdict would inherit the phantom date', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'reason A', source: 'human', at: PAST }),
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'reason B', source: 'human', at: FUTURE }),
    ]
    // governing latest human = pass@PAST reason-A; fire pass reason-C →
    // amend must reuse PAST's at, not stamp the future date onto the new line
    expect(amendAt(lines, 'p', '1', 'pass', 'reason C')).toBe(PAST)
  })

  it('overriddenHuman: an inert future flip is not a reversal — no false "覆盖了更新裁决" warning', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'ok', source: 'human', at: PAST, issue: 1 }),
      L({ name: 'p', version: '1', verdict: 'concern', reason: 'x', source: 'human', at: FUTURE, issue: 2 }),
    ]
    // governing human = pass; firing pass again reverses NOTHING
    expect(overriddenHuman(lines, 'p', '1', 'pass')).toBeNull()
    // firing concern DOES reverse the governing pass — warning stands
    expect(overriddenHuman(lines, 'p', '1', 'concern')).toEqual({ verdict: 'pass', at: PAST })
  })

  it('retargetedIssueTarget: phantom same-issue verdicts on other keys stay invisible', () => {
    const lines = [
      L({ name: 'old', version: null, verdict: 'concern', reason: 'x', source: 'human', at: FUTURE, issue: 9 }),
      L({ name: 'cur', version: '2', verdict: 'pass', reason: 'y', source: 'human', at: PAST, issue: 9 }),
    ]
    // the only OTHER-key line for issue 9 is future-dated → nothing to warn about
    expect(retargetedIssueTarget(lines, 9, 'cur', '2')).toBeNull()
  })

  it('dedupeReport end-to-end: prev/amend reflect governing lines only', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'ok', source: 'human', at: PAST }),
      L({ name: 'p', version: '1', verdict: 'concern', reason: 'brake', source: 'human', at: FUTURE }),
    ]
    const r = dedupeReport(lines, 'p', '1', 'pass', 'ok', 5)
    expect(r.dup).toBe('1')          // identical to the GOVERNING pass
    expect(r.prev).toBe('')          // the future concern overrides nothing real
    expect(r.amend).toBe('')
  })
})
