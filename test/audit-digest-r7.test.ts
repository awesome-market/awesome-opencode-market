/** audit #6 (日报流 §6) fresh pass — gaps found independently of prior rounds:
 *  1. main() usage errors called `exit('usage: …')` — process.exit(string)
 *     throws ERR_INVALID_ARG_TYPE, so the usage text never printed (same
 *     class fixed in diagnose.ts); --date also accepted any garbage into
 *     `new Date()` where toISOString() later threw a bare RangeError.
 *  2. digest.yml's worktree cleanup only handled the removable shape — a
 *     stray non-worktree dir or a missing-but-registered registration wedged
 *     `worktree add` on every attempt (the three-shape fix applied to
 *     catalog-append.sh/verify.yml was missing here).
 *  3. watchdog last_touch() conflated an API failure with "paged out, no
 *     match" (both → 0): a verdicts-probe outage while the index probe
 *     succeeded fired leg5 "worker never wired" as a false alert. Probe
 *     failure now returns -1; the `>0` gates and leg5's `=0` both skip it.
 *  4. [FALSE POSITIVE — retracted] versionCell's `e?.pendingUpdate` disjunct
 *     looked B3-blind, but PendingUpdate.version is z.string() (non-null)
 *     and github-kind entries never carry pendingUpdate — the disjunct
 *     already reads exactly "has a versioned slot". The pin tests below
 *     assert the original semantics stay intact. */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { digestStateOf } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'human', reason?: string): AiVerdict => ({
  name, version, verdict, at, source, ...(reason ? { reason } : {}),
})
const NOW = new Date('2026-02-01T21:15:00Z')
const T = '2026-02-01T10:00:00Z'

/** a version:null verdict row lands in §③ via the concern channel — its
 *  版本 cell is the versionCell under test */
const row = (index: CatalogIndex, verdict: AiVerdict) =>
  renderDigest({ index, verdicts: [verdict], prev: digestStateOf('2026-01-31T21:00:00Z', []), now: NOW })

describe('§③ versionCell — null-key verdicts distinguish slot-vs-package scope', () => {
  it('github-kind entry (no versioned slots possible): name\\0 verdict renders —', () => {
    const gh = mkEntry('o/r', {
      source: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'abc123' },
      latestVersion: null, approval: 'approved',
    })
    const md = row(mkIndex([gh]), v('o/r', null, 'concern', T))
    expect(md).toContain('| o/r | — |')
    expect(md).not.toContain('—（包级）')
  })
  it('npm entry with a held version: name\\0 verdict renders —（包级）', () => {
    const e = mkEntry('pkg', {
      approval: 'approved',
      pendingUpdate: {
        version: '2.0.0', heldAt: '2026-01-10T00:00:00Z', reason: 'awaiting-review',
        capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
        verification: { status: 'verified', level: 'load' },
      },
    })
    const md = row(mkIndex([e]), v('pkg', null, 'concern', T))
    expect(md).toContain('—（包级）')
  })
  it('name absent from index: still renders — (no entry → no versioned slot)', () => {
    const md = row(mkIndex([mkEntry('other')]), v('ghost', null, 'concern', T))
    expect(md).toContain('ghost ⚠️不在目录')
    expect(md).toContain('| ghost ⚠️不在目录 | — |')
  })
})

describe('§① fresh rows — same-akey amend renders the corrected reason', () => {
  it('reason-only amend (reused `at`) shows the LATER line, not the stale one', () => {
    // amendAt deliberately reuses the prior human line's `at`, so the
    // corrected verdict shares its akey — first-in-file wins would keep
    // announcing the reason the maintainer just fixed.
    const e = mkEntry('pkg-amend')
    const idx = mkIndex([e])
    const md = renderDigest({
      index: idx,
      verdicts: [
        v('pkg-amend', '1.0.0', 'pass', T, 'human', 'stale pre-amend reason'),
        v('pkg-amend', '1.0.0', 'pass', T, 'human', 'corrected reason'),
      ],
      prev: digestStateOf('2026-01-31T21:00:00Z', []),
      now: NOW,
    })
    expect(md).toContain('corrected reason')
    expect(md).not.toContain('stale pre-amend reason')
    // exactly one row for the akey — dedupe still holds
    expect(md.match(/pkg-amend/g)?.length).toBeGreaterThan(0)
  })
})

describe('digest.ts CLI — usage errors are readable, not TypeError stacks', () => {
  const run = (args: string[]) => {
    try {
      execFileSync('npx', ['tsx', 'pipeline/ai/digest.ts', ...args],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, err: '' }
    } catch (e: any) {
      return { code: e.status ?? -1, err: String(e.stderr ?? '') }
    }
  }
  it('missing args → exit 1 + usage text, no ERR_INVALID_ARG_TYPE', () => {
    const r = run([])
    expect(r.code).toBe(1)
    expect(r.err).toContain('usage:')
    expect(r.err).not.toContain('ERR_INVALID_ARG_TYPE')
  })
  it('--date garbage → exit 1 + shape hint, no RangeError stack', () => {
    const r = run(['--date', 'tomorrow', '--index', '/dev/null', '--verdicts', '/dev/null', '--state', '/dev/null', '--out-dir', '/tmp'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('YYYY-MM-DD')
    expect(r.err).not.toContain('Invalid time value')
  })
})

describe('digest.yml workflow contract (audit #6 fresh pass)', () => {
  const wf = readFileSync(new URL('../.github/workflows/digest.yml', import.meta.url), 'utf8')
  it('worktree cleanup covers all three wedge shapes before `worktree add`', () => {
    const i = wf.indexOf('git worktree add /tmp/cat')
    expect(i).toBeGreaterThan(-1)
    const pre = wf.slice(0, i)
    expect(pre).toContain('git worktree remove /tmp/cat')
    expect(pre).toContain('rm -rf /tmp/cat')
    expect(pre).toContain('git worktree prune')
  })
  it('watchdog probe failure is a distinct -1, not the no-history 0 that leg5 keys on', () => {
    const i = wf.indexOf('last_touch()')
    expect(i).toBeGreaterThan(-1)
    expect(wf.slice(i, i + 1400)).toContain('echo -1')
    // leg5 still fires only on a real "no matching commit" (0)
    const l5 = wf.indexOf('从未出现 ai-diagnose:')
    expect(wf.slice(Math.max(0, l5 - 400), l5)).toContain('= 0')
  })
})
