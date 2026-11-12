/** audit #5 fresh round (human-verdict flow), round 9 — pin concern.yml
 *  workflow-text contracts that had NO coverage after a clean independent
 *  audit (the parser/dedupe/kind-resolution semantics are all pinned by
 *  human-verdict.test.ts + r5/r6/r7 audit files):
 *
 *  1. feedback gate — usage help only on command-shaped comments: the
 *     anchored concern/approve grep is what keeps `/close`/`/check`
 *     mentions on unrelated issues silent while `/concerned` typos get help.
 *  2. `[review] (` sentinel aggregate — a noresolve there must exit silently
 *     (labels/comments on a standing aggregate are noops, not blocked).
 *  3. site-dispatch apply merge — a brake only dispatches when the EFFECTIVE
 *     apply (heal ?? app) isn't degraded; a degraded fold must not claim the
 *     public site is current.
 *  4. labeled branch — sender!=bot + verdict:* label + [review] title only.
 *  5. exists step — catalog bootstrap gets the dedicated `exists=nobranch`
 *     answer (not a generic "not in index" verdict:blocked report).
 *  6. append gate — `unresolved != '1'` keeps a no-version npm verdict from
 *     landing as a dead name@null line. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const YML = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')

describe('audit#5 r9 — concern.yml unpinned workflow contracts', () => {
  it('feedback only comments on command-shaped bodies (silent /close & friends)', () => {
    expect(YML).toContain("grep -qiE '^[[:space:]]*/(concern|approve)'")
    expect(YML).toContain('not a verdict command — silent skip')
  })
  it('[review] ( sentinel aggregates exit the feedback step silently', () => {
    expect(YML).toContain('"[review] ("*')
    expect(YML).toContain('sentinel aggregate — no target to resolve')
  })
  it('site dispatch merges heal ?? app — a degraded effective apply never claims the site is current', () => {
    expect(YML).toContain("(steps.heal.outputs.apply || steps.app.outputs.apply) != 'degraded'")
  })
  it('labeled branch: bot sender excluded + only verdict:* labels + [review] titles', () => {
    expect(YML).toContain("github.event.sender.login != 'github-actions[bot]'")
    expect(YML).toContain("github.event.label.name == 'verdict:pass' || github.event.label.name == 'verdict:concern'")
    expect(YML).toContain("startsWith(github.event.issue.title, '[review]')")
  })
  it('catalog bootstrap resolves to exists=nobranch, not a generic not-in-index block', () => {
    expect(YML).toContain('exists=nobranch')
    expect(YML).toContain('catalog 数据面（catalog 分支）尚未初始化')
  })
  it('append + ack gates refuse an unresolved npm target (no name@null dead letter)', () => {
    expect(YML).toContain("steps.n.outputs.unresolved != '1' && steps.n.outputs.dup != '1'")
    // heal still requires unresolved != 1 — a re-fired dead command can't fold junk either
    expect(YML).toContain("steps.n.outputs.unresolved != '1' && (steps.n.outputs.dup == '1' || steps.app.outputs.apply == 'degraded')")
  })
  it('retest gate is an anchored prefix with bounded padding (mid-text mentions never dispatch)', () => {
    // unlike the verdict channel (contains() is safe — parser rejects), a
    // mid-text '/retest' would dispatch real work: startsWith only
    expect(YML).not.toContain("contains(github.event.comment.body, '/retest')")
    for (const pad of ["'/retest'", "' /retest'", "'  /retest'"])
      expect(YML).toContain(`startsWith(github.event.comment.body, ${pad}`)
  })
})
