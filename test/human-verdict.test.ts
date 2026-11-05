/** H-series: pipeline/human-verdict.ts — the parser extracted from concern.yml's
 *  inline node -e. Covers the label / bare-comment / arg-comment / form
 *  channels plus the divergence + sanitization rules. */
import { describe, it, expect } from 'vitest'
import { resolveVerdictEvent, titleTarget, splitSpec } from '../pipeline/human-verdict.ts'
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
})
