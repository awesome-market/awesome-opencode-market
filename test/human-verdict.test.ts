/** H-series: pipeline/human-verdict.ts — the parser extracted from concern.yml's
 *  inline node -e. Covers the label / bare-comment / arg-comment / form
 *  channels plus the divergence + sanitization rules. */
import { describe, it, expect } from 'vitest'
import { resolveVerdictEvent, titleTarget, splitSpec, isDupVerdict, amendAt } from '../pipeline/human-verdict.ts'
import type { VerdictEvent } from '../pipeline/human-verdict.ts'

const ev = (over: Partial<VerdictEvent> = {}): VerdictEvent => ({
  event: 'issue_comment', action: 'created',
  issueTitle: '[review] pkg@1.0.0', issueBody: '', issueNumber: '7',
  commentBody: '/approve', label: '', actor: 'terry',
  ...over,
})

const FORM_BODY = `### npm 包名或 owner/repo

evilpkg

### 版本（可留空）

2.0.0

### 操作 / Action

拦截 (concern)

### 理由 / Reason

sus C# wrapper, see #123
second line kept`

describe('titleTarget / splitSpec', () => {
  it('parses plain, scoped, and version-less titles', () => {
    expect(titleTarget('[review] pkg@1.2.3')).toEqual({ name: 'pkg', ver: '1.2.3' })
    expect(titleTarget('[review] @s/p@2.0.0')).toEqual({ name: '@s/p', ver: '2.0.0' })
    expect(titleTarget('[review] @s/p')).toEqual({ name: '@s/p', ver: '' })
    expect(titleTarget('[review] owner/repo')).toEqual({ name: 'owner/repo', ver: '' })
    expect(titleTarget('[concern] free text')).toBeNull()
    expect(titleTarget('random title')).toBeNull()
  })
  it('splitSpec: last @ wins; leading @ is scope not version', () => {
    expect(splitSpec('a@b@c')).toEqual({ name: 'a@b', ver: 'c' })
    expect(splitSpec('pkg@')).toEqual({ name: 'pkg', ver: '' })
  })
})

describe('label channel', () => {
  const labeled = (label: string, title = '[review] pkg@1.0.0') =>
    ev({ event: 'issues', action: 'labeled', label, issueTitle: title, commentBody: '' })

  it('verdict:pass → pass on the titled target', () => {
    const r = resolveVerdictEvent(labeled('verdict:pass'))
    expect(r).toMatchObject({ name: 'pkg', ver: '1.0.0', verdict: 'pass' })
    expect(r.reason).toContain('verdict:pass')
    expect(r.reason).toContain('terry')
    expect(r.reason).toContain('#7')
  })
  it('verdict:concern → concern; repo title → null version path', () => {
    const r = resolveVerdictEvent(labeled('verdict:concern', '[review] owner/repo'))
    expect(r).toMatchObject({ name: 'owner/repo', ver: '', verdict: 'concern' })
  })
  it('non-review title → noresolve', () => {
    expect(resolveVerdictEvent(labeled('verdict:pass', '[submit] x')).skip).toBe('submit')
    expect(resolveVerdictEvent(labeled('verdict:pass', 'hello')).skip).toBe('noresolve')
  })
  it('a non-verdict label on a [review] issue → noresolve, never a brake', () => {
    // the gate whitelists verdict:* labels today; the parser is the contract —
    // a stray label must not silently degrade to concern
    expect(resolveVerdictEvent(labeled('review:pending')).skip).toBe('noresolve')
    expect(resolveVerdictEvent(labeled('bug')).skip).toBe('noresolve')
  })
})

describe('comment channel', () => {
  it('bare /approve on [review] → title target', () => {
    expect(resolveVerdictEvent(ev())).toMatchObject({ name: 'pkg', ver: '1.0.0', verdict: 'pass' })
  })
  it('bare /concern + reason on [review] → title target + reason', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern steals data' }))
    expect(r).toMatchObject({ name: 'pkg', ver: '1.0.0', verdict: 'concern', reason: 'steals data' })
  })
  it('arg spec on a non-review issue → arg target', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: 'some other issue', commentBody: '/concern evil@2.0.0 malware' }))
    expect(r).toMatchObject({ name: 'evil', ver: '2.0.0', verdict: 'concern', reason: 'malware' })
    expect(r.mismatch).toBeUndefined()
  })
  it('arg spec diverging from the [review] title → mismatch flagged', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern other@9.9.9 oops' }))
    expect(r).toMatchObject({ name: 'other', ver: '9.9.9', verdict: 'concern' })
    expect(r.mismatch).toContain('other@9.9.9')
    expect(r.mismatch).toContain('pkg@1.0.0')
  })
  it('arg spec matching the title → no mismatch', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern pkg@1.0.0 yes' }))
    expect(r.name).toBe('pkg'); expect(r.mismatch).toBeUndefined()
  })
  it('arg version differing from titled version → mismatch', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern pkg@2.0.0' }))
    expect(r.mismatch).toBeDefined()
  })
  it('repo arg on review issue → owner/repo, version cleared', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern o/r suspicious' }))
    expect(r).toMatchObject({ name: 'o/r', ver: '' })
    expect(r.mismatch).toBeDefined()
  })
  it('bare command on [concern] form issue → body package field', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: '[concern] whatever title', issueBody: FORM_BODY, commentBody: '/approve' }))
    expect(r).toMatchObject({ name: 'evilpkg', ver: '2.0.0', verdict: 'pass' })
  })
  it('bare command on a plain issue → noresolve', () => {
    expect(resolveVerdictEvent(ev({ issueTitle: 'plain issue' })).skip).toBe('noresolve')
  })
  it('/concerned (prefix typo) → noresolve, not a verdict', () => {
    expect(resolveVerdictEvent(ev({ commentBody: '/concerned about this' })).skip).toBe('noresolve')
  })
  it('crafted version chars are sanitized → blank → index-first', () => {
    // `pkg@$(id)`: garbage version cleaned to "" → index resolves the held
    // version; metachars never survive into a verdict record
    const r = resolveVerdictEvent(ev({ commentBody: '/concern pkg@$(id) pwn' }))
    expect(r).toMatchObject({ name: 'pkg', ver: '' })
    expect(r.mismatch).toBeUndefined()
  })
  it('crafted version in a TITLE is dropped → blank → index-first', () => {
    const r = resolveVerdictEvent(ev({ event: 'issues', action: 'labeled', label: 'verdict:concern', issueTitle: '[review] pkg@$(cmd)' }))
    expect(r).toMatchObject({ name: 'pkg', ver: '' })
  })
  it('reason-only arg whose first word is package-charset still resolves as spec (documented ambiguity)', () => {
    // /concern looks bad → "looks" is charset-valid → treated as spec; the
    // index-exists check downstream is the feedback loop for this case
    const r = resolveVerdictEvent(ev({ issueTitle: 'x', commentBody: '/concern looks bad' }))
    expect(r.name).toBe('looks')
  })
  it('[submit] title defers to submit.yml', () => {
    expect(resolveVerdictEvent(ev({ issueTitle: '[submit] pkg' })).skip).toBe('submit')
  })
  it('multiline comment reason collapses to one line', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: 'x', commentBody: '/concern e@1 bad\nstuff\nhere' }))
    expect(r.reason).toBe('bad stuff here')
    expect(r.reason).not.toContain('\n')
  })
})

describe('form channel (issues opened/edited)', () => {
  const form = (action: 'opened' | 'edited' = 'opened', body = FORM_BODY) =>
    ev({ event: 'issues', action, issueTitle: '[concern] x', issueBody: body, commentBody: '' })

  it('parses package/version/action/reason from ### sections', () => {
    const r = resolveVerdictEvent(form())
    expect(r).toMatchObject({ name: 'evilpkg', ver: '2.0.0', verdict: 'concern' })
    expect(r.reason).toContain('sus C# wrapper, see #123')   // '#' preserved (H-8)
    expect(r.reason).toContain('second line kept')           // multi-line kept
  })
  it('edited re-parses current body — maintainer can fix a typo', () => {
    const r = resolveVerdictEvent(form('edited', FORM_BODY.replace('evilpkg', 'fixedpkg')))
    expect(r.name).toBe('fixedpkg')
  })
  it('放行 (pass) action → pass; empty version → blank', () => {
    const body = FORM_BODY.replace('拦截 (concern)', '放行 (pass)').replace('2.0.0', '_No response_')
    const r = resolveVerdictEvent(form('opened', body))
    expect(r).toMatchObject({ verdict: 'pass', ver: '' })
  })
  it('repo target in form → version cleared', () => {
    const r = resolveVerdictEvent(form('opened', FORM_BODY.replace('evilpkg', 'o/r')))
    expect(r).toMatchObject({ name: 'o/r', ver: '' })
  })
  it('missing package → noresolve', () => {
    expect(resolveVerdictEvent(form('opened', '### 操作 / Action\n\n拦截 (concern)')).skip).toBe('noresolve')
  })
  it('action word-boundary: "compass"/"bypass" → concern, never fail-open', () => {
    const body = FORM_BODY.replace('拦截 (concern)', 'compass override')
    expect(resolveVerdictEvent(form('opened', body)).verdict).toBe('concern')
    const body2 = FORM_BODY.replace('拦截 (concern)', 'bypass now')
    expect(resolveVerdictEvent(form('opened', body2)).verdict).toBe('concern')
  })
  it('action "PASS" uppercase still maps to pass (case-insensitive word)', () => {
    const body = FORM_BODY.replace('拦截 (concern)', 'PASS')
    expect(resolveVerdictEvent(form('opened', body)).verdict).toBe('pass')
  })
  it('a newline smuggled into the package field is collapsed, not injected', () => {
    // a multi-line name would inject extra k=v lines into $GITHUB_OUTPUT —
    // the value lands pre-exists-check, so an unsanitized newline is a
    // protocol break, not just ugly text
    const body = FORM_BODY.replace('evilpkg', 'evil\nskip=noresolve')
    const r = resolveVerdictEvent(form('opened', body))
    expect(r.name).not.toContain('\n')
    expect(r.name).toBe('evil skip=noresolve')
  })
})

describe('case-insensitive commands + isrepo output (HV-6/HV-7)', () => {
  it('/Approve and /CONCERN parse — phone autocapitalize is a real channel', () => {
    expect(resolveVerdictEvent(ev({ commentBody: '/Approve' }))).toMatchObject({ name: 'pkg', verdict: 'pass' })
    const r = resolveVerdictEvent(ev({ commentBody: '/CONCERN looks evil' }))
    expect(r.verdict).toBe('concern')
    expect(r.reason).toBe('looks evil')
  })
  it('isrepo=1 emitted for owner/repo targets; absent for npm names', () => {
    expect(resolveVerdictEvent(ev({ commentBody: '/concern o/r sus' })).isrepo).toBe('1')
    expect(resolveVerdictEvent(ev({ commentBody: '/concern pkg sus' })).isrepo).toBeUndefined()
    // labeled path on a repo-titled review also emits it
    expect(resolveVerdictEvent(ev({ event: 'issues', action: 'labeled', label: 'verdict:pass', issueTitle: '[review] o/r' })).isrepo).toBe('1')
  })
})

describe('isDupVerdict — semantic dedupe (HV-2)', () => {
  const L = (o: object) => JSON.stringify(o)
  it('identical latest human line → dup', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', reason: 'ok', source: 'human', at: 't1' })]
    expect(isDupVerdict(lines, 'p', '1', 'pass', 'ok')).toBe(true)
  })
  it('latest line is a DIFFERENT verdict → not dup (flip must record)', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'concern', reason: 'r', source: 'human' }),
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'ok', source: 'human' }),
    ]
    expect(isDupVerdict(lines, 'p', '1', 'concern', 'r')).toBe(false)
  })
  it('AI verdict on top does NOT dedupe a human write (source = stickiness signal)', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'concern', reason: 'r', source: 'ai' })]
    expect(isDupVerdict(lines, 'p', '1', 'concern', 'r')).toBe(false)
  })
  it('different version key → not dup; malformed lines skipped', () => {
    const lines = ['{bad', L({ name: 'p', version: '2', verdict: 'pass', reason: '', source: 'human' })]
    expect(isDupVerdict(lines, 'p', '1', 'pass', '')).toBe(false)
    expect(isDupVerdict(lines, 'p', '2', 'pass', '')).toBe(true)
  })
  it('reason-less records (undefined) match empty reason', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', source: 'human' })]
    expect(isDupVerdict(lines, 'p', '1', 'pass', '')).toBe(true)
  })
  it('reason compared normalized — stored multiline vs collapsed arg text', () => {
    // a writer that stored raw multiline vs a caller passing the collapsed
    // reason must still dedupe
    const lines = [L({ name: 'p', version: '1', verdict: 'concern', reason: 'bad\nstuff', source: 'human' })]
    expect(isDupVerdict(lines, 'p', '1', 'concern', 'bad stuff')).toBe(true)
  })
})

describe('amendAt — reason-only amendment keeps maturity (HV-2 counterpart)', () => {
  const L = (o: object) => JSON.stringify(o)
  const AT = '2026-01-01T00:00:00.000Z'
  it('latest human line: same verdict, different reason → reuses its at', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', reason: 'old reason', source: 'human', at: AT })]
    expect(amendAt(lines, 'p', '1', 'pass', 'new reason')).toBe(AT)
  })
  it('same verdict + same reason → null (isDupVerdict owns that case)', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', reason: 'r', source: 'human', at: AT })]
    expect(amendAt(lines, 'p', '1', 'pass', 'r')).toBeNull()
  })
  it('verdict flip is a new decision, not an amendment → null', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'concern', reason: 'r', source: 'human', at: AT })]
    expect(amendAt(lines, 'p', '1', 'pass', 'r2')).toBeNull()
  })
  it('AI line on top → null: the human verdict must land with a fresh at', () => {
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'old', source: 'human', at: AT }),
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'ai saw x', source: 'ai', at: '2026-01-02T00:00:00.000Z' }),
    ]
    expect(amendAt(lines, 'p', '1', 'pass', 'edited reason')).toBeNull()
  })
  it('an older matching line under a non-matching latest → null', () => {
    // amend only reads the LATEST line for the key — an older human line
    // under a different verdict does not anchor the new write
    const lines = [
      L({ name: 'p', version: '1', verdict: 'pass', reason: 'old', source: 'human', at: AT }),
      L({ name: 'p', version: '1', verdict: 'concern', reason: 'brake', source: 'human', at: '2026-01-02T00:00:00.000Z' }),
    ]
    expect(amendAt(lines, 'p', '1', 'pass', 'new reason')).toBeNull()
  })
  it('malformed/missing at on the matched line → null (never propagate junk)', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', reason: 'old', source: 'human', at: 'not-a-date' })]
    expect(amendAt(lines, 'p', '1', 'pass', 'new')).toBeNull()
  })
  it('key mismatch → null', () => {
    const lines = [L({ name: 'p', version: '1', verdict: 'pass', reason: 'old', source: 'human', at: AT })]
    expect(amendAt(lines, 'p', '2', 'pass', 'new')).toBeNull()
    expect(amendAt(lines, 'q', '1', 'pass', 'new')).toBeNull()
  })
})

describe('sentinel [review] titles (repo-only aggregate issue)', () => {
  const AGG = '[review] (repo-only backlog)'
  it('titleTarget → null: a placeholder name can never be a real target', () => {
    expect(titleTarget(AGG)).toBeNull()
    expect(titleTarget('[review] (anything)')).toBeNull()
  })
  it('labels on the aggregate resolve to noresolve — labels only work on per-target issues', () => {
    const r = resolveVerdictEvent(ev({ event: 'issues', action: 'labeled',
      label: 'verdict:pass', issueTitle: AGG, commentBody: '' }))
    expect(r.skip).toBe('noresolve')
  })
  it('/approve owner/repo lands on the arg — no phantom mismatch vs the sentinel', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: AGG, commentBody: '/approve acme/tool' }))
    expect(r.skip).toBeUndefined()
    expect(r).toMatchObject({ name: 'acme/tool', verdict: 'pass' })
    expect(r.mismatch).toBeUndefined()
  })
  it('/concern acme/tool reason → lands with reason, no mismatch', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: AGG, commentBody: '/concern acme/tool looks dead' }))
    expect(r).toMatchObject({ name: 'acme/tool', verdict: 'concern', reason: 'looks dead' })
    expect(r.mismatch).toBeUndefined()
  })
  it('bare charset name also resolves on an untitled issue', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: AGG, commentBody: '/approve left-pad' }))
    expect(r).toMatchObject({ name: 'left-pad', verdict: 'pass' })
  })
  it('bare /approve on the aggregate → noresolve (no target to infer)', () => {
    expect(resolveVerdictEvent(ev({ issueTitle: AGG })).skip).toBe('noresolve')
  })
})
