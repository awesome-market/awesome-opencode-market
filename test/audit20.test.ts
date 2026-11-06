/** audit #8 (审核单流 §8) — regressions:
 *  1. issueBody must mirror the §7 humanPassCovers gate: an ai pass on a
 *     flagged/unscanned slot with a STANDING human pass releases under the
 *     human's authority — '只能人工放行' would page the maintainer over a
 *     self-resolving slot.
 *  2. closeReason: a flag issue closed by a human verdict (degraded-apply
 *     window — entry still approved+flagged in the index) must say
 *     'verdict 已决议', not '该版本已放行'; a decided repo-only pending must
 *     not claim '并入总单'. The released-version stale issue (approved,
 *     flags gone) keeps '已放行'. */
import { describe, it, expect } from 'vitest'
import { issueBody } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})
const hp = (over: Partial<AiVerdict> = {}): AiVerdict =>
  v({ source: 'human', ...over })

describe('§8: issueBody honors the human-pass cover on flagged/unscanned ai passes', () => {
  it('flagged slot + standing human pass → cover note, no "只能人工放行"', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass', redFlags: 2,
      verification: 'skipped', maturity: 'announced',
      humanVerdict: hp({ at: '2026-01-01T08:00:00Z' }),
    })
    expect(body).toContain('人工判词覆盖豁免')
    expect(body).not.toContain('只能人工放行')
    expect(body).not.toContain('旗标/未扫描锁定')
  })
  it('unscanned slot + standing human pass → cover note, no "只能人工放行"', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass', unscanned: true,
      verification: 'skipped', maturity: 'announced',
      humanVerdict: hp({ at: '2026-01-01T08:00:00Z' }),
    })
    expect(body).toContain('覆盖豁免')
    expect(body).not.toContain('只能人工放行')
    expect(body).not.toContain('旗标/未扫描锁定')
  })
  it('flagged slot, NO human verdict → the lock text stays', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass', redFlags: 2,
      verification: 'skipped', maturity: 'announced',
    })
    expect(body).toContain('只能人工放行')
    expect(body).toContain('旗标/未扫描锁定')
  })
  it('human CONCERN (sticky brake) on the key → lock text stays, no cover claim', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass', redFlags: 2,
      verification: 'skipped', maturity: 'announced',
      humanVerdict: hp({ verdict: 'concern', reason: 'no' }),
    })
    expect(body).toContain('只能人工放行')
    expect(body).not.toContain('覆盖豁免')
  })
  it('covered slot: the maturity phase promises the normal release, not a lock', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass', redFlags: 1,
      verification: 'verified', maturity: 'announced',
      humanVerdict: hp({ at: '2026-01-01T08:00:00Z' }),
    })
    expect(body).toContain('按班放行')
    expect(body).not.toContain('旗标/未扫描锁定')
  })
})

describe('§8: closeReason precision', () => {
  const runMain = async (index: CatalogIndex, verdicts: AiVerdict[], openIssues: object[]) => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'a20-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(index))
    writeFileSync(vPath, verdicts.map(x => JSON.stringify(x)).join('\n') + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify(openIssues)
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try { await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn) }
    finally { process.env.GH_REPO = saved }
    return calls.filter(c => c.includes('comment')).map(c => c.join(' ')).join('\n')
  }

  it('flag issue retired by human verdict (entry still approved+flagged) → verdict 已决议', async () => {
    const flagged = e({
      approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:integrity-drift'], flaggedAt: '2026-01-01T00:00:00Z' },
    })
    const comment = await runMain(idx([flagged]), [hp({ at: '2026-01-02T00:00:00Z' })],
      [{ number: 5, title: '[review] pkg@1.0.0', labels: [], body: 'x' }])
    expect(comment).toContain('verdict 已决议')
    expect(comment).not.toContain('已放行')
  })
  it('released-version stale issue (approved, flags gone) + verdict → 已放行 preserved', async () => {
    const released = e({ approval: 'approved' })
    const comment = await runMain(idx([released]), [v()],
      [{ number: 5, title: '[review] pkg@1.0.0', labels: [], body: 'x' }])
    expect(comment).toContain('已放行')
    expect(comment).not.toContain('已决议')
  })
  it('repo-only pending + null-key human verdict → verdict 已决议, not 并入总单', async () => {
    const repoOnly = e({ latestVersion: null, name: 'o/repo', slug: 'o/repo' })
    const comment = await runMain(idx([repoOnly]), [v({ version: null, source: 'human', name: 'o/repo' })],
      [{ number: 5, title: '[review] o/repo', labels: [], body: 'x' }])
    expect(comment).toContain('verdict 已决议')
    expect(comment).not.toContain('并入')
  })
  it('flag issue closed by rescan (flags gone, no verdict) → 已放行 stands', async () => {
    const cleared = e({ approval: 'approved' })
    const comment = await runMain(idx([cleared]), [],
      [{ number: 5, title: '[review] pkg@1.0.0', labels: [], body: 'x' }])
    expect(comment).toContain('已放行')
  })
  it('stale old-version issue + verdict on the OLD key + new target wanted → 已决议 (precise)', async () => {
    // pkg held at 2.0.0 with an ai pass (wanted); the 1.0.0 issue carries its own verdict
    const held = e({
      approval: 'approved',
      pendingUpdate: {
        version: '2.0.0',
        capabilities: { scannedAt: 't', findings: [], redFlags: [] },
        verification: { status: 'verified' }, heldAt: '2026-01-01T00:00:00Z',
      },
    })
    const comment = await runMain(idx([held]),
      [v({ version: '1.0.0', source: 'human' }), v({ version: '2.0.0' })],
      [{ number: 5, title: '[review] pkg@1.0.0', labels: [], body: 'x' }])
    expect(comment).toContain('verdict 已决议')
    expect(comment).not.toContain('目标已变更')
  })
})
