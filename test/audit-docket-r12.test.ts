/** audit #8 (审核单流 §8, 第 7 轮 — 遗留风险修复轮) — the residual risks the
 *  first pass recorded as "accepted" that turned out to be fixable:
 *
 *  1. stuckLabel detection used find() → only ONE verdict:* label surfaced,
 *     and verdict:blocked (concern.yml's "target didn't resolve" marker)
 *     wasn't folded in at all. Now EVERY stuck verdict label joins the body
 *     warning, sorted, and the wording admits blocked = unresolved target.
 *  2. issueBody.clean() escaped HTML/brackets but not `* _ ~ ` | @` — a
 *     crafted AI/plugin reason could fake emphasis, code spans, table
 *     breaks, or @mention a collaborator on the maintainer's highest-trust
 *     surface. Flag reasons sit INSIDE a code span where escapes render
 *     literally, so the constant 'sec:*' fallback bypasses clean() —
 *     scanner flag names are [a-z0-9:-] anyway.
 *  3. Aggregate row sorts degraded to NaN→insertion-order when heldAt was
 *     missing/unparseable — `|| 0` sorts unknown-age rows FIRST
 *     (fail-visible: a broken clock reads as most-suspect), deterministically.
 *  4. wantedByName/byName/aggregated keyed on raw name — a hand-drifted
 *     title's casing missed the live target and produced the wrong close
 *     reason. Lowercased like vkey everywhere.
 *  5. Close-comment idempotence peeked only at comments[-1] — a human reply
 *     AFTER the auto-close note made the retry re-post it. The jq now scans
 *     EVERY comment for the prefix.
 *  6. Flag-target human verdicts bypassed epochGoverning — the only
 *     human-map read in docketTargets without the stale-identity gate.
 *     flaggedAt freshness covers the normal case; the shared gate closes
 *     the pathological ordering (recycled name, weird stamp order).
 *  7. wanted/wantedByName could diverge on same-title collisions — verified
 *     last-wins for `wanted` is CORRECT (flag outranks none in rank order,
 *     so the live sec signal owns the body) and first-wins stays for
 *     wantedByName's close-reason naming; the maps now document why. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docketTargets, issueBody, main, NONE_BACKLOG, REPO_BACKLOG } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2020-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: '2020-01-01T00:00:00Z', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[], removed: CatalogIndex['removed'] = []): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed,
})
const hv = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'human', ...over,
})

describe('aggregate row ordering — missing heldAt sorts first, deterministically', () => {
  it('versioned none aggregate: broken-clock row precedes dated rows', () => {
    const t = docketTargets(idx([
      e({ name: 'aged-ok', capabilities: { scannedAt: '2020-06-01T00:00:00Z', findings: [], redFlags: [] } }),
      e({ name: 'clock-broken', capabilities: { scannedAt: 'not-a-date', findings: [], redFlags: [] }, firstSeenAt: 'also-broken' }),
    ]), [], null, { paused: true })
    const agg = t.find(x => x.name === NONE_BACKLOG)!
    expect(agg.backlog!.map(r => r.name)).toEqual(['clock-broken', 'aged-ok'])
  })
  it('repo-only aggregate: same rule — unknown age reads as most-suspect', () => {
    const t = docketTargets(idx([
      e({ name: 'repo-ok', latestVersion: null, capabilities: { scannedAt: '2020-06-01T00:00:00Z', findings: [], redFlags: [] } }),
      e({ name: 'repo-broken', latestVersion: null, capabilities: { scannedAt: 'junk', findings: [], redFlags: [] }, firstSeenAt: 'junk' }),
    ]), [])
    const agg = t.find(x => x.name === REPO_BACKLOG)!
    expect(agg.backlog!.map(r => r.name)).toEqual(['repo-broken', 'repo-ok'])
  })
})

describe('flag target — human verdicts pass through epochGoverning', () => {
  it('a pre-tombstone pass cannot retire the flag even when it postdates flaggedAt', () => {
    // pathological ordering the flaggedAt freshness check alone misses:
    // verdict.at sits BETWEEN flaggedAt and the tombstone — postdates()
    // would call it a decision, but it judged the DEAD incarnation
    const flagged = e({
      name: 'pkg', approval: 'approved', latestVersion: '1.0.0',
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: ['sec:repojack'], flaggedAt: '2026-01-10T00:00:00Z' },
    })
    const tomb = [{ slug: 'o/pkg', name: 'pkg', disappearedAt: '2026-02-01T00:00:00Z', reason: 'npm-404' as const }]
    const stalePass = hv({ at: '2026-01-20T00:00:00Z' }) // > flaggedAt, < tombstone
    const t = docketTargets(idx([flagged], tomb), [stalePass])
    expect(t).toEqual([expect.objectContaining({ name: 'pkg', verdict: 'flag' })])
  })
  it('a post-tombstone pass still retires the flag (gate is not a blanket block)', () => {
    const flagged = e({
      name: 'pkg', approval: 'approved', latestVersion: '1.0.0',
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: ['sec:repojack'], flaggedAt: '2026-01-10T00:00:00Z' },
    })
    const tomb = [{ slug: 'o/pkg', name: 'pkg', disappearedAt: '2026-01-05T00:00:00Z', reason: 'npm-404' as const }]
    const freshPass = hv({ at: '2026-01-20T00:00:00Z' }) // > flaggedAt AND > tombstone
    expect(docketTargets(idx([flagged], tomb), [freshPass])).toEqual([])
  })
})

describe('issueBody — markdown/mention hardening', () => {
  it('escapes emphasis, code-span, table, strikethrough, mention and HTML metachars', () => {
    const body = issueBody({ name: 'p', version: '1', verdict: 'concern',
      reason: 'a*b_c~d`e|f@g[h]<i>&j' })
    for (const esc of ['\\*', '\\_', '\\~', '\\`', '\\|', '\\@', '\\[h\\]', '&lt;i&gt;', '&amp;'])
      expect(body).toContain(esc)
    expect(body).not.toContain('a*b_c')
  })
  it("flag reason fallback 'sec:*' renders literally inside the code span", () => {
    const body = issueBody({ name: 'p', version: '1', verdict: 'flag' })
    expect(body).toContain('`sec:*`')
    expect(body).not.toContain('sec:\\*')
  })
  it('a real flag reason is still escaped — scanner charset makes it inert anyway', () => {
    const body = issueBody({ name: 'p', version: '1', verdict: 'flag', reason: 'sec:x [click](https://e)' })
    expect(body).toContain('\\[click\\]')
    expect(body).not.toContain('[click](https://e)')
  })
})

/* ---------- main() end-to-end ---------- */

const run = async (plugins: PluginEntry[], verdicts: AiVerdict[], issues: unknown[], removed: CatalogIndex['removed'] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'dk-r12-'))
  const idxPath = join(dir, 'index.json')
  const vPath = join(dir, 'v.jsonl')
  writeFileSync(idxPath, JSON.stringify(idx(plugins, removed)))
  writeFileSync(vPath, verdicts.map(x => JSON.stringify(x)).join('\n') + (verdicts.length ? '\n' : ''))
  const calls: string[][] = []
  const ghFn = (args: string[]) => {
    calls.push(args)
    if (args.includes('list')) return JSON.stringify(issues)
    if (args.includes('create')) return 'https://github.com/o/r/issues/42\n'
    if (args.includes('view')) return 'false'   // no prior auto-close note
    return ''
  }
  const saved = process.env.GH_REPO
  process.env.GH_REPO = 'o/r'
  try {
    await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
  } finally { process.env.GH_REPO = saved }
  return calls
}

describe('main — stuck verdict labels all fold into the body', () => {
  it('verdict:blocked + verdict:concern + verdict:pass render together, sorted', async () => {
    const plugins = [e({ capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] } })]
    const verdicts = [hv({ verdict: 'pass' as const, source: 'ai' as const })]
    // 'pkg'@1.0.0 is a wanted ai-pass target; the open issue carries THREE
    // stuck decision labels — none may be silently dropped
    const calls = await run(plugins, verdicts, [{
      number: 9, title: '[review] pkg@1.0.0', body: 'stale',
      labels: [{ name: 'review:pending' }, { name: 'verdict:blocked' }, { name: 'verdict:concern' }, { name: 'verdict:pass' }],
    }])
    const edit = calls.find(c => c.includes('edit') && c.includes('--body'))
    expect(edit).toBeTruthy()
    const body = edit![edit!.indexOf('--body') + 1]!
    expect(body).toContain('verdict:blocked`, `verdict:concern`, `verdict:pass')
    expect(body).toContain('未写盘')
    expect(body).toContain('verdict:blocked 即解析失败标记')
  })
})

describe('main — same-title target collision keeps the flag surface', () => {
  it('approved entry flagged on displayed slot + held pendingUpdate at the SAME version → one issue, flag body wins', async () => {
    // reachable edge: pendingUpdate.version === latestVersion makes the held
    // 'none' target and the flag target share issueTitle — last-wins must
    // hand the body to the live sec signal, not the routine hold
    const flagged = e({
      name: 'pkg', approval: 'approved', latestVersion: '1.0.0',
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: ['sec:repojack'], flaggedAt: '2026-01-10T00:00:00Z' },
      pendingUpdate: {
        version: '1.0.0', heldAt: '2020-01-01T00:00:00Z',
        capabilities: { scannedAt: '2020-01-01T00:00:00Z', findings: [], redFlags: [] },
        verification: { status: 'verified' },
      },
    })
    const calls = await run([flagged], [], [])
    const creates = calls.filter(c => c.includes('create'))
    expect(creates).toHaveLength(1)
    expect(creates[0]!.join(' ')).toContain('[review] pkg@1.0.0')
    const body = creates[0]![creates[0]!.indexOf('--body') + 1]!
    expect(body).toContain('身份级信号')
    expect(body).not.toContain('评审积压或诊断已停摆')
  })
})

describe('main — close path hardening', () => {
  it('close-note idempotence jq scans EVERY comment, not just the last', async () => {
    const calls = await run([], [], [{ number: 7, title: '[review] gone@1.0.0', labels: [] }])
    const view = calls.find(c => c.includes('view'))!
    const jq = view[view.indexOf('--jq') + 1]!
    expect(jq).toContain('.comments[]?')          // any-position scan
    expect(jq).not.toContain('.comments[-1]')     // the old last-only peek
    expect(jq).toContain('startswith("该版本的审核单已自动关闭")')
  })
  it("case-drifted title still resolves the entry — '已放行' not '不在索引中'", async () => {
    // '[review] PKG@1.0.0' parses name 'PKG'; the index holds 'pkg' —
    // case-insensitive lookup must find it for an honest close reason
    const released = e({ name: 'pkg', approval: 'approved' })
    const calls = await run([released], [], [{ number: 8, title: '[review] PKG@1.0.0', labels: [] }])
    const comment = calls.find(c => c.includes('comment'))
    expect(comment).toBeTruthy()
    expect(comment!.join(' ')).toContain('该版本已放行')
    expect(comment!.join(' ')).not.toContain('已不在 catalog 索引中')
  })
})
