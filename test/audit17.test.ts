/** Audit task #5 — human-verdict flow (.github/workflows/concern.yml +
 *  pipeline/human-verdict.ts + bin/catalog-append.sh).
 *  The parser/dedupe contract lives in human-verdict.test.ts; this file guards
 *  the workflow-level invariants found by the fresh §5 audit:
 *   1. the exists-step catalog fetch must be tip-only (14MB/commit history is
 *      unbounded cost per verdict event) + forced refspec for a rewritten remote
 *   2. /retest must accept edited comments like the verdict commands do — a
 *      maintainer typo-fixing a comment expects the dispatch to fire
 *   3. retest's target lookup uses the same name→source.repo dual-key as the
 *      verdict channel ('/retest owner/repo' on an npm twin is not "不在目录")
 *   4. no dead plumbing (approval output/env, TRANSIENT) drifts back in
 *  plus regression guards on the prior §5 fixes that are workflow-visible. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveVerdictEvent, type VerdictEvent } from '../pipeline/human-verdict.ts'

const WF = readFileSync('.github/workflows/concern.yml', 'utf8')
const SH = readFileSync('bin/catalog-append.sh', 'utf8')

/** Slice one job's text block out of the workflow (job keys sit at 2-space
 *  indent under `jobs:`; the next sibling job or dedent ends the block). */
function jobBlock(name: string): string {
  const m = WF.match(new RegExp(`^  ${name}:\\n`, 'm'))
  if (!m) return ''
  const start = m.index!
  const rest = WF.slice(start + m[0].length)
  const next = rest.search(/^  [a-zA-Z_][\w-]*:\n/m)
  return next === -1 ? rest : rest.slice(0, next)
}
const VERDICT = jobBlock('verdict')
const RETEST = jobBlock('retest')
const TRIAGE = jobBlock('triage')
/** the `if:` scalar of a job block — folded literal may span lines; ends at
 *  the next 4-space-indented job key (`    runs-on:` etc.) — content lines
 *  sit deeper and may themselves start with letters */
const jobIf = (block: string) => block.match(/^    if: >-([\s\S]*?)^    [a-z]/m)?.[1] ?? ''

describe('concern.yml — catalog fetch is shallow + forced (§5-1)', () => {
  it('every catalog fetch in the workflow is tip-only', () => {
    const fetches = WF.match(/git fetch[^\n]*/g) ?? []
    expect(fetches.length).toBeGreaterThan(0)
    for (const f of fetches) {
      expect(f).toContain('--depth=1')
      expect(f).toContain('+refs/heads/catalog')
    }
    // no bare full-depth fetch survives anywhere
    expect(WF).not.toMatch(/git fetch -q origin catalog/)
    expect(WF).not.toMatch(/git fetch origin catalog/)
  })
  it('catalog-append.sh is shallow+forced too', () => {
    for (const f of SH.match(/git fetch[^\n]*/g) ?? []) {
      expect(f).toContain('--depth=1')
      expect(f).toContain('+refs/heads/catalog')
    }
  })
})

describe('concern.yml — /retest accepts edited comments (§5-2)', () => {
  it('retest job gate includes created + edited, maintainer-only, no PRs/submissions', () => {
    const cond = jobIf(RETEST)
    expect(cond).toContain('issue_comment')
    expect(cond).toContain('created')
    expect(cond).toContain('edited')
    expect(cond).toContain('COLLABORATOR')
    expect(cond).toContain('MEMBER')
    expect(cond).toContain('OWNER')
    expect(cond).toContain('pull_request')
    expect(cond).toContain('submission')
  })
  it('verdict channel also accepts edited — parity check', () => {
    const cond = jobIf(VERDICT)
    expect(cond).toContain('edited')
    expect(cond).toContain('created')
  })
})

describe('concern.yml — retest dual-key target lookup (§5-3)', () => {
  it('falls back to source.repo like the verdict exists step does', () => {
    expect(RETEST).toContain('source?.repo')
    expect(RETEST).toContain('name.toLowerCase() === n.toLowerCase()')
    // same dual-key in the verdict exists step
    expect(VERDICT).toContain('source?.repo')
  })
  it('github entries with source.version are installable in retest', () => {
    expect(RETEST).toContain('ghInstallable')
    expect(RETEST).toContain('source?.version')
  })
})

describe('concern.yml — no dead plumbing (§5-4)', () => {
  it('APPROVAL/TRANSIENT removed', () => {
    expect(WF).not.toMatch(/APPROVAL/)
    expect(WF).not.toMatch(/TRANSIENT/)
    expect(WF).not.toMatch(/approval=/)
  })
})

describe('concern.yml — prior §5 fixes still hold (regression guards)', () => {
  it('retest fetches index.json with the raw media type (>1MB contents API limit)', () => {
    expect(RETEST).toContain('application/vnd.github.raw')
    // the raw accept header must be on the gh api call that writes the index
    expect(RETEST).toMatch(/gh api[^\n]*index\.json[\s\S]*?vnd\.github\.raw/)
  })
  it('[submit]/submission-label issues are excluded from the verdict job', () => {
    expect(jobIf(VERDICT)).toContain('submission')
  })
  it('labeled events are permission-gated via the collaborators API, retried once', () => {
    expect(WF).toContain('collaborators/$ACTOR/permission')
    expect(WF).toContain('for t in 1 2')
  })
  it('write failures + cancellation leave a visible comment', () => {
    expect(VERDICT).toMatch(/failure\(\) \|\| cancelled\(\)/)
  })
  it('triage job explains + closes non-maintainer [concern] issues', () => {
    expect(TRIAGE).toBeTruthy()
    expect(jobIf(TRIAGE)).toContain('[concern]')
  })
  it('APPLY_ONLY heal step exists for a verdict that landed without index fold', () => {
    expect(VERDICT).toContain('APPLY_ONLY:')
    expect(VERDICT).toContain('APPLY_INDEX:')
  })
  it('verdict commands tolerate leading whitespace + case variants in the gate', () => {
    const cond = jobIf(VERDICT)
    // shorthand-prefix gate: /c /a cover /concern /approve + typos like /cncern
    for (const s of ["'/c'", "'/C'", "'/a'", "'/A'", "' /c'", "' /a'"]) expect(cond).toContain(s)
    expect(cond).toContain('created')
    expect(cond).toContain('edited')
  })
  it('mismatch keeps the issue open — ack returns before the close', () => {
    const ack = VERDICT.slice(VERDICT.indexOf('MISMATCH'))
    expect(ack).toContain('return')
  })
})

describe('catalog-append.sh — write-loop invariants', () => {
  it('exact-duplicate lines are never appended twice', () => {
    expect(SH).toMatch(/grep -qxF/)
  })
  it('status protocol emits ok/degraded/skipped/failed for the ack', () => {
    for (const s of ['ok', 'degraded', 'skipped', 'failed']) expect(SH).toContain(s)
    expect(SH).toContain('STATUS_FILE')
  })
  it('APPLY_ONLY heals a landed verdict; APPLY_INDEX folds in the same commit', () => {
    expect(SH).toContain('APPLY_ONLY')
    expect(SH).toContain('APPLY_INDEX')
    expect(SH).toContain('release.ts')
  })
  it('empty staged diff = already-landed (idempotent retry)', () => {
    expect(SH).toMatch(/diff --cached --quiet/)
  })
  it('retries fetch → worktree-rebuild → commit → push across races', () => {
    expect(SH).toMatch(/for i in 1 2 3 4/)
    expect(SH).toMatch(/git worktree add .*origin\/catalog --detach/)
    expect(SH).toMatch(/push .*HEAD:catalog/)
    expect(SH).toMatch(/push rejected .*retrying/)
  })
})

describe('human-verdict.ts — §5 edges re-verified', () => {
  const ev = (over: Partial<VerdictEvent> = {}): VerdictEvent => ({
    event: 'issue_comment', action: 'created',
    issueTitle: '[review] pkg@1.0.0', issueBody: '', issueNumber: '7',
    commentBody: '/approve', label: '', actor: 'terry',
    ...over,
  })
  it('pkg@* survives as the package-scope marker (not cleaned away)', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: 'x', commentBody: '/concern evil@* bad' }))
    expect(r).toMatchObject({ name: 'evil', ver: '*' })
  })
  it('edited comment replays resolve identically (dedupe, not dedupe-by-skip)', () => {
    const a = resolveVerdictEvent(ev({ commentBody: '/concern steals data' }))
    const b = resolveVerdictEvent(ev({ action: 'edited', commentBody: '/concern steals data' }))
    expect(a).toEqual(b)
  })
  it('#comment-ref reason is not swallowed as a spec', () => {
    const r = resolveVerdictEvent(ev({ commentBody: '/concern see #42' }))
    expect(r.name).toBe('pkg')                        // title target stands
    expect(r.reason).toBe('see #42')
  })
  it('a/b/c (three-segment) is neither repo nor sane name → exists-check path', () => {
    const r = resolveVerdictEvent(ev({ issueTitle: 'x', commentBody: '/concern a/b/c sus' }))
    expect(r.name).toBe('a/b/c')
    expect(r.isrepo).toBeUndefined()
  })
})
