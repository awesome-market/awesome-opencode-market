/** audit #4 fresh-batch (AI diagnose flow, round 2):
 *  1. diagnose.paused checks read the REMOTE flag (origin/catalog ref), not
 *     the worktree file — a stray untracked flag (crashed pause between the
 *     write and git add) must not fake "already paused" nor self-skip the
 *     worker forever.
 *  2. latestShaVerdicts honors the same future-stamp exemption as
 *     latestVerdicts — a far-future `at` must not pin a judgment over every
 *     later real verdict for those bytes (sha reuse would copy it onto new
 *     versions forever). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { latestShaVerdicts } from '../pipeline/ai/diagnose.ts'
import type { AiVerdict } from '../src/schema.ts'

const v = (at: string, verdict: 'pass' | 'concern', sha = 'sha512-x'): AiVerdict => ({
  name: 'p', version: '1.0.0', verdict, at, source: 'ai', sha,
})

describe('ai-diagnose.sh — pause flag reads remote truth', () => {
  const sh = readFileSync(join(__dirname, '..', 'bin/ai-diagnose.sh'), 'utf8')

  it('pause/resume fast-path checks origin/catalog, not the worktree file', () => {
    const seg = sh.slice(sh.indexOf('for i in 1 2 3 4; do'), sh.indexOf('flag already in desired state'))
    expect(seg).toContain('cat-file -e "origin/catalog:$FLAG"')
    expect(seg).not.toContain('[ -f "$CAT/$FLAG" ]')
  })

  it('self-skip checks the remote ref — a stray untracked flag cannot wedge the loop', () => {
    const seg = sh.slice(sh.indexOf('refusing to review stale state'), sh.indexOf('touch ai-verdicts.jsonl'))
    expect(seg).toContain('git cat-file -e origin/catalog:diagnose.paused')
    expect(seg).not.toContain('[ -f diagnose.paused ]')
  })
})

describe('latestShaVerdicts — future-stamp exemption', () => {
  it('a far-future `at` cannot pin the sha verdict over a later real one', () => {
    const future = new Date(Date.now() + 86400_000).toISOString()
    const m = latestShaVerdicts([
      v('2026-01-01T00:00:00Z', 'pass'),
      v(future, 'concern'), // the pin attack: must be ignored
      v('2026-01-02T00:00:00Z', 'concern'),
    ])
    expect(m.get('p\0sha512-x')?.at).toBe('2026-01-02T00:00:00Z')
  })

  it('newest rankable line still wins (ordering regression)', () => {
    const m = latestShaVerdicts([
      v('2026-01-02T00:00:00Z', 'concern'),
      v('2026-01-01T00:00:00Z', 'pass'), // listed later, older `at`
    ])
    expect(m.get('p\0sha512-x')?.verdict).toBe('concern')
  })
})
