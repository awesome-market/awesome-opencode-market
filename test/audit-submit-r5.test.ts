/** audit #2 fresh round (submission-flow, round 5):
 *  $(grep|tail|awk) extraction assignments are set -e landmines — under the
 *  Actions default `bash -eo pipefail`, a grep that matches NOTHING exits 1,
 *  pipefail propagates it, and the assignment kills the step mid-run:
 *
 *    - review `scan` step: `createdAt: null` (package/repo not found, error
 *      verdict, unresolved repoSha) made the PC/PCN/repoSha greps no-match —
 *      EVERY invalid/error submission crashed before `v=` was emitted, so
 *      the friendly 'package not found' report never posted; the user got a
 *      'pipeline failed' alert instead. The edited-skip prior-comment scrape
 *      died identically for npm submissions (no repoSha/repoPkg markers).
 *    - verdict `v` step: the rvc.txt late-ingest scrape crashed on npm
 *      reviews (no repoSha marker) and on empty files — the flagged-override
 *      /approve path could never complete.
 *    - `git ls-remote …; LSRC=$?` died under -e on ANY failure — the
 *      catalog-absent vs connectivity distinction was dead code.
 *
 *  Regression guard below: every $() command substitution whose pipeline
 *  contains grep must carry an explicit `|| ...` fallback inside the
 *  substitution (or be an explicit non-assigning check), across ALL
 *  workflows — the class is fixed repo-wide, not just where it fired. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const wfDir = join(__dirname, '..', '.github', 'workflows')
const files = readdirSync(wfDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))

/** Lines holding `$(…)` command substitutions that run grep inside a pipe.
 *  The guard: the substitution must close with `|| …)` — `|| true`, a
 *  fallback command, or the `|| rc=$?` capture pattern. */
const dangers: string[] = []
for (const f of files) {
  const lines = readFileSync(join(wfDir, f), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    // find $( ... ) spans on this single line (workflow heredocs keep each
    // substitution on one line — all observed sites do)
    const re = /\$\(([^()]*)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(l))) {
      const inner = m[1]!
      if (!/\bgrep\b/.test(inner)) continue
      if (/\|\|[^()]*$/.test(inner) || inner.includes('||')) continue
      dangers.push(`${f}:${i + 1}: $(${inner})`)
    }
  }
}

describe('workflow extraction substitutions are set -e safe', () => {
  it('no $(…grep…) lacks an explicit || fallback', () => {
    expect(dangers).toEqual([])
  })

  it('submit.yml marker extractions carry || true', () => {
    const s = readFileSync(join(wfDir, 'submit.yml'), 'utf8')
    for (const marker of ['verdict: (clean', 'reviewedVersion:', 'repoSha:', 'repoPkg:', 'createdAt:', 'target:']) {
      const hits = s.split('\n').filter(l => l.includes(`grep -oE '${marker}`) && l.includes('$('))
      expect(hits.length).toBeGreaterThan(0)
      for (const h of hits) expect(h).toContain('|| true')
    }
  })

  it('submit.yml ls-remote keeps the 2-vs-other branch distinction', () => {
    const s = readFileSync(join(wfDir, 'submit.yml'), 'utf8')
    expect(s).toContain('git ls-remote --exit-code origin catalog >/dev/null 2>&1 || LSRC=$?')
  })
})
