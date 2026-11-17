import { describe, it, expect } from 'vitest'
import { docketTargets, issueTitle, issueBody } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'
import type { FlagContext } from '../pipeline/ai/flag-context.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
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

describe('docketTargets', () => {
  it('pending entry + ai pass → open decision', () => {
    const t = docketTargets(idx([e()]), [v()])
    // 't' fixtures are unparseable → heldAt is OMITTED, never rendered as garbage
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
      slug: 'o/pkg', findings: 0, redFlags: 0, scannedAt: 't', src: { kind: 'npm', id: 'pkg' }, description: 'a pkg' }])
  })
  it('ai pass maturity phase follows digest-state membership', () => {
    const ver = v()
    const announced = { lastDigestAt: '2026-01-02T00:00:00Z', announced: [`${ver.name}\0${ver.version}\0${ver.at}`], day: '2026-01-02', dayAnnounced: [] }
    expect(docketTargets(idx([e()]), [ver], announced)[0]!.maturity).toBe('announced')
    expect(docketTargets(idx([e()]), [ver], null)[0]!.maturity).toBe('pending-announce')
  })
  it('ai concern on pendingUpdate → open decision for THAT version', () => {
    const t = docketTargets(idx([e({
      approval: 'approved',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })]), [v({ version: '2.0.0', verdict: 'concern' })])
    expect(t).toEqual([{ name: 'pkg', version: '2.0.0', verdict: 'concern', verification: 'verified', maturity: 'pending-announce',
      slug: 'o/pkg', findings: 0, redFlags: 0, sitePage: true, scannedAt: 't', src: { kind: 'npm', id: 'pkg' },
      description: 'a pkg', prevRef: { kind: 'version', value: '1.0.0' } }])
  })
  it('human verdict already rules → no docket entry', () => {
    expect(docketTargets(idx([e()]), [v({ source: 'human' })])).toEqual([])
  })
  it('released entry → no docket entry', () => {
    expect(docketTargets(idx([e({ approval: 'approved' })]), [v()])).toEqual([])
  })
  it('no verdict yet → AI queue will handle, no human ask', () => {
    // young candidate clock → still AI-owned; 't' fixtures are unparseable
    // and would (correctly) fail-visible as aged — use real stamps here
    const recent = { scannedAt: '2026-01-04T12:00:00Z', findings: [] as string[], redFlags: [] as string[] }
    expect(docketTargets(idx([e({ firstSeenAt: '2026-01-04T00:00:00Z', capabilities: recent })]), [], null,
      { now: '2026-01-05T00:00:00Z' })).toEqual([])
  })
  it('candidate clock: pending entry re-scanned recently stays young even when firstSeenAt is ancient', () => {
    // F1 regression — firstSeenAt is entry-level and survives version bumps;
    // the candidate slot's scannedAt is the real hold clock (same source
    // order as diagnose's candidateHeldAt)
    const t = docketTargets(idx([e({
      firstSeenAt: '2020-01-01T00:00:00Z',
      capabilities: { scannedAt: '2026-01-04T12:00:00Z', findings: [], redFlags: [] },
    })]), [], null, { now: '2026-01-05T00:00:00Z' })
    expect(t).toEqual([])
  })
  it('candidate clock: old scannedAt wins over newer firstSeenAt → aged none issue shows the scan stamp', () => {
    const t = docketTargets(idx([e({
      firstSeenAt: '2026-01-04T00:00:00Z',
      capabilities: { scannedAt: '2020-06-01T00:00:00Z', findings: [], redFlags: [] },
    })]), [], null, { now: '2026-01-05T00:00:00Z' })
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'none', verification: 'verified',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: '2020-06-01T00:00:00Z', scannedAt: '2020-06-01T00:00:00Z', src: { kind: 'npm', id: 'pkg' },
      description: 'a pkg' }])
  })
  it('unparseable hold clock → fail-VISIBLE none issue, never silent suppression', () => {
    const t = docketTargets(idx([e({
      firstSeenAt: 'not-a-date',
      capabilities: { scannedAt: null, findings: [], redFlags: [] },
    })]), [], null, { now: '2026-01-05T00:00:00Z' })
    expect(t[0]!.verdict).toBe('none')
    expect(t[0]!.unscanned).toBe(true)
  })
  it('package-level human concern (name@null) suppresses per-version targets — the brake IS the decision', () => {
    const t = docketTargets(idx([e()]), [
      v({ verdict: 'pass' }),
      v({ version: null, verdict: 'concern', source: 'human', at: '2026-01-02T00:00:00Z' }),
    ])
    expect(t).toEqual([])
  })
  it('package brake also suppresses the aged-none surface (a decision already exists)', () => {
    const t = docketTargets(idx([e({ firstSeenAt: '2020-01-01T00:00:00Z' })]), [
      v({ version: null, verdict: 'concern', source: 'human' }),
    ], null, { now: '2026-01-05T00:00:00Z' })
    expect(t).toEqual([])
  })
  it('a newer human pass on the slot lifts the package brake → target returns', () => {
    const t = docketTargets(idx([e()]), [
      v({ version: null, verdict: 'concern', source: 'human', at: '2026-01-01T00:00:00Z' }),
      v({ verdict: 'pass', source: 'human', at: '2026-01-03T00:00:00Z' }),
      v({ verdict: 'concern', at: '2026-01-04T00:00:00Z' }),
    ])
    expect(t[0]!.verdict).toBe('concern')
  })
  it('repo-only pendings aggregate into ONE standing backlog issue (no per-entry flood)', () => {
    const t = docketTargets(idx([e({ latestVersion: null }), e({ name: 'o/r2', slug: 'o/r2', latestVersion: null })]), [])
    // 't' stamps unparseable → heldAt omitted; scanned entries carry no marks
    expect(t).toEqual([{ name: '(repo-only backlog)', version: null, verdict: 'none',
      backlog: [{ name: 'pkg' }, { name: 'o/r2' }] }])
  })
  it('repo-only backlog rows carry scan counters — a flagged repo must not look clean', () => {
    const t = docketTargets(idx([
      e({ name: 'o/flagged', slug: 'o/flagged', latestVersion: null,
        capabilities: { scannedAt: 't', findings: ['f1', 'f2'], redFlags: ['sec:x'] } }),
      e({ name: 'o/blind', slug: 'o/blind', latestVersion: null,
        capabilities: { scannedAt: null, findings: [], redFlags: [] } }),
      e({ latestVersion: null }),
    ]), [])
    const rows = t[0]!.backlog!
    expect(rows.find(r => r.name === 'o/flagged')).toMatchObject({ redFlags: 1, findings: 2 })
    expect(rows.find(r => r.name === 'o/blind')).toMatchObject({ unscanned: true })
    const body = issueBody(t[0]!)
    expect(body).toContain('o/flagged`（⚠️ 红旗 1 / findings 2')
    expect(body).toContain('o/blind`（⚠️ 未跑过静态扫描（不等于安全）')
  })
  it('aged versioned holds past NONE_ISSUE_CAP fold into ONE (unreviewed backlog) aggregate', () => {
    const aged = (n: string) => e({ name: n, slug: `o/${n}`, firstSeenAt: '2020-01-01T00:00:00Z' })
    const nine = Array.from({ length: 9 }, (_, i) => aged(`p${i}`))
    const t = docketTargets(idx(nine), [], null, { now: '2026-01-05T00:00:00Z' })
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ name: '(unreviewed backlog)', version: null, verdict: 'none' })
    expect(t[0]!.backlog).toHaveLength(9)
    expect(t[0]!.backlog![0]).toMatchObject({ name: 'p0', version: '1.0.0', verification: 'verified' })
    // at the threshold → per-entry issues keep the rich surface
    const eight = docketTargets(idx(nine.slice(0, 8)), [], null, { now: '2026-01-05T00:00:00Z' })
    expect(eight).toHaveLength(8)
    expect(eight.every(x => x.verdict === 'none' && x.name !== '(unreviewed backlog)')).toBe(true)
  })
  it('(unreviewed backlog) rows show verify state + flags; /approve routes name@ver per line', () => {
    const aged = (n: string, over: Partial<PluginEntry> = {}) =>
      e({ name: n, slug: `o/${n}`, firstSeenAt: '2020-01-01T00:00:00Z', ...over })
    const eleven = [
      ...Array.from({ length: 8 }, (_, i) => aged(`p${i}`)),
      aged('flagged', { capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] },
        verification: { status: 'skipped' } }),
    ]
    const t = docketTargets(idx(eleven), [], null, { now: '2026-01-05T00:00:00Z' })
    const body = issueBody(t[0]!)
    expect(body).toContain('未评审积压总单')
    expect(body).toContain('`flagged@1.0.0`（⚠️ 红旗 1 / 有高危信号没跑）')
    expect(body).toContain('`p0@1.0.0`（已实测可装可用）')
    expect(body).toContain('/approve 包名@版本')
  })
  it('repo-only pending WITH a human verdict → decided, no standing issue', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]),
      [v({ version: null, source: 'human', verdict: 'pass' })])
    expect(t).toEqual([])
  })
  it('non-pending repo entry → nothing to decide', () => {
    expect(docketTargets(idx([e({ latestVersion: null, approval: 'approved' })]), [])).toEqual([])
  })
  it('latest wins: ai pass then human concern → excluded', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'concern', source: 'human' }),
    ])
    expect(t).toEqual([])
  })
  it('issueTitle: versioned and version-less', () => {
    expect(issueTitle({ name: 'pkg', version: '1.0.0' })).toBe('[review] pkg@1.0.0')
    expect(issueTitle({ name: '@s/p', version: '2.0.0' })).toBe('[review] @s/p@2.0.0')
    expect(issueTitle({ name: 'o/r', version: null })).toBe('[review] o/r')
  })
  it('ai pass over a standing human concern → re-review target carries the brake context (K-3)', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z', verdict: 'concern', source: 'human', reason: 'manual brake' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'pass', source: 'ai', reason: '干净', reasonEn: 'clean' }),
    ])
    expect(t[0]!.verdict).toBe('pass')
    expect(t[0]!.reason).toBe('干净')
    expect(t[0]!.reasonEn).toBe('clean')
    expect(t[0]!.humanVerdict?.verdict).toBe('concern')
    expect(t[0]!.humanVerdict?.reason).toBe('manual brake')
  })
  it('held past NO_VERDICT_AGE_MS with zero verdicts → standing none issue (diagnose stalled)', () => {
    const t = docketTargets(idx([e({ firstSeenAt: '2026-01-01T00:00:00Z' })]), [], null,
      { now: '2026-01-05T00:00:00Z' })
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'none', verification: 'verified',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: '2026-01-01T00:00:00Z', scannedAt: 't', src: { kind: 'npm', id: 'pkg' },
      description: 'a pkg' }])
  })
  it('young hold without verdict stays AI-owned — no issue inside the age window', () => {
    expect(docketTargets(idx([e({ firstSeenAt: '2026-01-04T00:00:00Z' })]), [], null,
      { now: '2026-01-05T00:00:00Z' })).toEqual([])
  })
  it('flag: live entry with identity sec redFlags → standing issue on displayed key', () => {
    const t = docketTargets(idx([e({ approval: 'approved', publishedAt: '2026-01-01T00:00:00Z',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-recreated'] } })]), [])
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'flag', reason: 'sec:repo-recreated',
      verification: 'verified', slug: 'o/pkg', findings: 0, redFlags: 1, publishedAt: '2026-01-01T00:00:00Z',
      redFlagList: ['sec:repo-recreated'], sitePage: true, scannedAt: 't' }])
  })
  it('flag retired only by a human verdict that POSTDATES the flag (flaggedAt)', () => {
    const flaggedAt = (stamp?: string) => e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:name-reused'], ...(stamp ? { flaggedAt: stamp } : {}) } })
    // verdict at 2026-01-01 postdates flag observed 2020-01-01 → decided
    expect(docketTargets(idx([flaggedAt('2020-01-01T00:00:00Z')]), [v({ source: 'human' })])).toEqual([])
    // flag observed AFTER the human verdict — the verdict decided the bytes,
    // not a repojack that arrived later → the flag still needs a surface
    expect(docketTargets(idx([flaggedAt('2027-01-01T00:00:00Z')]), [v({ source: 'human' })])
      .some(t => t.verdict === 'flag')).toBe(true)
    // flaggedAt absent (legacy data): can't prove the verdict saw the flag → surface
    expect(docketTargets(idx([flaggedAt()]), [v({ source: 'human' })])
      .some(t => t.verdict === 'flag')).toBe(true)
    // pending entries never flag — their held version already has a channel
    expect(docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:name-reused'] } })]), [])
      .every(t => t.verdict !== 'flag')).toBe(true)
  })
  it('targets sort pass → none → concern → flag (freshest issues = most urgent)', () => {
    const mk = (n: string, over: Partial<PluginEntry> = {}) =>
      e({ name: n, slug: `o/${n}`, firstSeenAt: 't', ...over })
    const t = docketTargets(idx([
      mk('flagpkg', { approval: 'approved', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } }),
      mk('flag2', { approval: 'approved', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:y'] } }),
      mk('concpkg'),
      mk('nonepkg', { firstSeenAt: '2020-01-01T00:00:00Z' }),
      mk('passpkg'),
    ]), [
      v({ name: 'concpkg', verdict: 'concern' }),
      v({ name: 'passpkg', verdict: 'pass' }),
    ], null, { now: '2026-01-05T00:00:00Z' })
    expect(t.map(x => x.verdict)).toEqual(['pass', 'none', 'concern', 'flag', 'flag'])
    expect(t.slice(3).map(x => x.name)).toEqual(['flagpkg', 'flag2'])
  })
})

describe('issueBody', () => {
  it('human concern under a newer ai pass is shown as a standing brake, not silent', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass',
      humanVerdict: v({ verdict: 'concern', source: 'human', reason: 'brake' }),
    })
    expect(body).toContain('在押刹车')
    expect(body).toContain('人工判词：**concern**')
  })
  it('no human verdict → no human line; body is deterministic', () => {
    const t = { name: 'pkg', version: '1.0.0', verdict: 'pass' as const, verification: 'verified' }
    expect(issueBody(t)).toBe(issueBody(t))
    expect(issueBody(t)).not.toContain('人工判词')
  })
  it('ai pass on a red-flagged hold is called out as ignored — human-only release', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', redFlags: 2 })
    expect(body).toContain('只能人工放行')
    expect(body).toContain('红旗 2 项')
  })
  it('clean ai pass states the veto-window semantics + maturity phase', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', maturity: 'pending-announce' })
    expect(body).toContain('待日报公告')
    const b2 = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', maturity: 'announced' })
    expect(b2).toContain('待放行闸')
  })
  it('concern where LLM itself judged pass is called out as flag-blocked, not ai concern', () => {
    const body = issueBody({
      name: 'p', version: '1', verdict: 'concern',
      reason: '机械红旗待人工（AI 草稿，LLM 判 pass）：扫描均为预期行为 sec:x',
    })
    expect(body).toContain('AI 判词本体为 pass')
    expect(body).toContain('verdict:pass')
    const real = issueBody({ name: 'p', version: '1', verdict: 'concern', reason: 'AI 判 concern：可疑' })
    expect(real).not.toContain('AI 判词本体为 pass')
  })
  it('issueBody renders manifest description + pending-update diff link (npm + github)', () => {
    const npm = issueBody({
      name: 'pkg', version: '2.0.0', verdict: 'concern',
      description: 'lints things', prevRef: { kind: 'version', value: '1.0.0' },
      src: { kind: 'npm', id: 'pkg' },
    })
    expect(npm).toContain('清单自述：「lints things」')
    expect(npm).toContain('https://app.unpkg.com/pkg@1.0.0/files')
    expect(npm).toContain('https://app.unpkg.com/pkg@2.0.0/files')
    expect(npm).toContain('npm diff --diff=pkg@1.0.0 --diff=pkg@2.0.0')
    expect(npm).not.toContain('diff.intrinsic.com')
    const gh = issueBody({
      name: 'o/r', version: 'def5678', verdict: 'concern',
      prevRef: { kind: 'sha', value: 'abc1234' },
      src: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'abc1234' },
    })
    expect(gh).toContain('github.com/o/r/compare/abc1234...def5678')
    const noUpdate = issueBody({ name: 'p', version: '1', verdict: 'pass' })
    expect(noUpdate).not.toContain('清单自述')
    expect(noUpdate).not.toContain('更新内容')
  })
  it('ai pass on a flagged/unscanned slot never promises 按班放行 in the maturity line', () => {
    const flagged = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', redFlags: 2, maturity: 'announced' })
    expect(flagged).toContain('放行闸被旗标/未扫描锁定')
    expect(flagged).not.toContain('按班放行')
    const blind = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', unscanned: true, maturity: 'announced' })
    expect(blind).toContain('放行闸被旗标/未扫描锁定')
    expect(blind).not.toContain('按班放行')
  })
  it('announced pass blocked by verify/sha names the real gate + next step — never 按班放行', () => {
    const failed = issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'failed', maturity: 'announced' })
    expect(failed).toContain('装测未过')
    expect(failed).toContain('/retest')
    expect(failed).not.toContain('按班放行')
    const blind = issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'unverified', maturity: 'announced' })
    expect(blind).toContain('但还没验')
    expect(blind).not.toContain('按班放行')
    const drift = issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'verified',
      verdictSha: 'sha-a', integrity: 'sha-b', maturity: 'announced' })
    expect(drift).toContain('re-tag')
    expect(drift).not.toContain('按班放行')
    // pending-announce carries the same blockers — the phase, not just the gate
    const early = issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'failed', maturity: 'pending-announce' })
    expect(early).toContain('已裁决·待日报公告')
    expect(early).toContain('装测未过')
    // all-clear announced keeps the original promise
    expect(issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'verified', maturity: 'announced' }))
      .toContain('按班放行')
  })
  it('maturing pass with a blocker names the OPEN objection window — not 待日报公告', () => {
    // 'maturing' = already announced in the LATEST digest — collapsing it into
    // the pending-announce phase would claim the verdict isn't public yet
    const body = issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'unverified', maturity: 'maturing' })
    expect(body).toContain('异议窗开放')
    expect(body).toContain('但还没验')
    expect(body).not.toContain('待日报公告')
  })
  it('flag reason is markdown-escaped like every other external string', () => {
    const body = issueBody({ name: 'p', version: '1', verdict: 'flag', reason: 'sec:x [click](https://evil.example) <b>' })
    expect(body).toContain('\\[click\\]')
    expect(body).not.toContain('[click](https://evil.example)')
    expect(body).toContain('&lt;b&gt;')
  })
  it('phone decision labels match the target kind — flag/none are not "覆盖 AI concern"', () => {
    const flag = issueBody({ name: 'p', version: '1', verdict: 'flag', reason: 'sec:x' })
    expect(flag).toContain('确认身份信号无风险')
    expect(flag).toContain('回 pending 下架')
    expect(flag).not.toContain('覆盖 AI concern')
    const none = issueBody({ name: 'p', version: '1', verdict: 'none' })
    expect(none).toContain('无 AI 判词')
    expect(none).not.toContain('覆盖 AI concern')
    const pass = issueBody({ name: 'p', version: '1', verdict: 'pass' })
    // a pass issue has no concern to override — the label text must say so
    // honestly instead of claiming the human "覆盖 AI concern" (audit #8)
    expect(pass).not.toContain('覆盖 AI concern')
    expect(pass).toContain('与 AI 判定一致')
    const con = issueBody({ name: 'p', version: '1', verdict: 'concern' })
    expect(con).toContain('覆盖 AI concern')
  })
  it('stuck verdict:* label produces a warning block', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass' }, { stuckLabel: 'verdict:pass' })
    expect(body).toContain('未写盘')
    expect(body).toContain('verdict:pass')
  })
  it('repo/pagesBase opts render data + detail links', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'flag', reason: 'sec:x', slug: 'o/p', sitePage: true },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    expect(body).toContain('github.com/o/r/blob/catalog')
    expect(body).toContain('https://o.github.io/r/p/o/p.html')
    expect(body).toContain('已上架')
  })
  it('aged none (versioned) explains backlog; repo-only none explains AI never runs', () => {
    expect(issueBody({ name: 'p', version: '1.0.0', verdict: 'none' })).toContain('诊断已停摆')
    expect(issueBody({ name: 'o/r', version: null, verdict: 'none' })).toContain('AI 不审')
  })
  it('ai concern body states the block; flag without reason falls back to sec:*', () => {
    expect(issueBody({ name: 'p', version: '1.0.0', verdict: 'concern' })).toContain('已拦截放行')
    expect(issueBody({ name: 'p', version: '1.0.0', verdict: 'flag' })).toContain('sec:*')
  })
  it('findings-only still renders the scan line; heldAt shows without publishedAt', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', findings: 3, heldAt: '2026-01-05T00:00:00Z' })
    expect(body).toContain('静态扫描')
    expect(body).toContain('在押自：2026-01-05')
    expect(body).not.toContain('npm 发布于')
  })
  it('no repo opt → plain catalog-branch pointer; repo without pagesBase → no detail link', () => {
    expect(issueBody({ name: 'p', version: '1.0.0', verdict: 'pass' }))
      .toContain('catalog 分支 `index.json`')
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', slug: 'o/p' }, { repo: 'o/r' })
    expect(body).toContain('catalog/index.json')
    expect(body).not.toContain('详情页')
  })
  it('AI/human reason text is markdown-escaped — links, code spans and fake headings stay inert', () => {
    const body = issueBody({
      name: 'p', version: '1.0.0', verdict: 'pass',
      reason: 'see [click](https://evil.example) `x`\n### fake\n<tag>',
      humanVerdict: v({ verdict: 'concern', source: 'human', reason: '[x](https://e) `c`' }),
    })
    expect(body).not.toContain('[click](https://evil.example)')
    expect(body).toContain('\\[click\\]')
    expect(body).not.toContain('\n### fake')
    expect(body).toContain('&lt;tag&gt;')
    expect(body).toContain('\\[x\\]')
  })
  it('verification status renders AGENTS Chinese wording, not bare enums', () => {
    expect(issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'verified' })).toContain('已实测可装可用')
    expect(issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'skipped' })).toContain('有高危信号没跑')
    expect(issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'failed' })).toContain('装不上或加载失败')
    expect(issueBody({ name: 'p', version: '1', verdict: 'pass', verification: 'unverified' })).toContain('还没验')
  })
  it('AI verdict model/L0.5 metadata never reaches the issue body — publishing the judge invites targeted evasion', () => {
    const t = docketTargets(idx([e()]), [v({ model: 'Ornith-1.5-35B-x', l05: { model: 'Galvanize-2', score: 0.71 } })])
    const body = issueBody(t[0]!)
    expect(body).not.toContain('AI 审计')
    expect(body).not.toContain('Ornith')
    expect(body).not.toContain('Galvanize')
    expect(body).not.toContain('0.71')
  })
  it('verdict sha vs slot integrity mismatch warns the release gate will refuse', () => {
    const drift = issueBody({ name: 'p', version: '1', verdict: 'pass', verdictSha: 'sha-new', integrity: 'sha-old' })
    expect(drift).toContain('完整性指纹不一致')
    const same = issueBody({ name: 'p', version: '1', verdict: 'pass', verdictSha: 's', integrity: 's' })
    expect(same).not.toContain('完整性指纹不一致')
    const noSha = issueBody({ name: 'p', version: '1', verdict: 'pass', integrity: 's' })
    expect(noSha).not.toContain('完整性指纹不一致')
  })
  it('scan preview lists the first findings inline (bounded excerpt)', () => {
    const body = issueBody({ name: 'p', version: '1', verdict: 'pass', scanPreview: ['sec:x [y](https://e)', 'f1'] })
    expect(body).toContain('扫描摘录')
    expect(body).toContain('sec:x \\[y\\]')
    expect(body).toContain('f1')
  })
  it('scan preview excludes signals already shown in 红旗清单 — no signal prints twice', () => {
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: ['f:a.js', 'credential-read:a.js'], redFlags: ['credential-read:a.js'] },
    })]), [v()])
    // the finding escalated to a flag renders in 红旗清单, not the excerpt
    expect(t[0]!.scanPreview).toEqual(['f:a.js'])
    expect(t[0]!.redFlagList).toEqual(['credential-read:a.js'])
  })
  it('详情页 link only for site-visible entries — pending targets 404 by design', () => {
    // pending entry → no site page exists → link suppressed, excerpt points at index.json
    const pending = docketTargets(idx([e({ capabilities: { scannedAt: 't', findings: ['f:a.js'], redFlags: [] } })]), [v()])
    const body = issueBody(pending[0]!, { repo: 'o/r', pagesBase: 'https://pages' })
    expect(body).not.toContain('详情页：https://pages/')
    expect(body).toContain('完整清单见index.json')
    // approved entry's held slot → the entry renders → link emitted
    const held = docketTargets(idx([e({ approval: 'approved',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' } })]), [v({ version: '2.0.0', verdict: 'concern' })])
    const body2 = issueBody(held[0]!, { repo: 'o/r', pagesBase: 'https://pages' })
    expect(body2).toContain('详情页：https://pages/p/o/pkg.html')
  })
  it('mechanical-flag reason tail stripped once — annotation kept, list rendered in 红旗清单', () => {
    const flagged = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: ['f1'], redFlags: ['credential-read:a.js', 'credential-read:b.js'] },
    })]), [v({ verdict: 'concern',
      reason: '机械红旗待人工：credential-read:a.js; credential-read:b.js',
      reasonEn: 'red-flagged — pending human review (LLM draft failed): credential-read:a.js; credential-read:b.js' })])
    const body = issueBody(flagged[0]!, { repo: 'o/r' })
    // reason keeps the annotation, drops the enumeration
    expect(body).toContain('机械红旗待人工')
    expect(body).toContain('(LLM draft failed)')
    // flag list appears exactly once — in 红旗清单, not inside the reasons
    expect(body).toContain('红旗清单（2 条）')
    expect((body.match(/credential-read:a\.js/g) ?? []).length).toBe(1)
    expect((body.match(/credential-read:b\.js/g) ?? []).length).toBe(1)
  })
  it('红旗清单 attaches "为什么报警+查什么" explainers per flag', () => {
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [], redFlags: [
        'prepare-script:package.json — L63: "prepare": "npm run build"',
        'sec:repo-moved-since-release:63915cf91cd1',
        'unknown-rule:x.js — L1: y',
      ] },
    })]), [v({ verdict: 'concern' })])
    const body = issueBody(t[0]!)
    expect(body).toContain('↳ "prepare" 在 git/tarball 安装时自动执行')
    expect(body).toContain('↳ 仓库 HEAD 在上架钉版后移动')
    // unknown ids render raw, no explainer line — never invent a gloss
    // (the path still linkifies into the rendered file view)
    expect(body).toContain('unknown-rule:[x.js](https://app.unpkg.com/pkg@1.0.0/files/x.js)')
    expect((body.match(/↳/g) ?? []).length).toBe(2)
  })
  it('红旗清单 renders the flag-context AI pre-read when a context line exists', () => {
    const flag = 'credential-read:lib/x.js — L3: read("id_rsa")'
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [], redFlags: [flag] },
    })]), [v({ verdict: 'concern' })])
    const key = `${t[0]!.name.toLowerCase()}\0${t[0]!.version ?? ''}\0${flag}`
    const flagContexts = new Map([[key, {
      name: t[0]!.name, version: t[0]!.version, flag, rule: 'credential-read',
      path: 'lib/x.js', line: 3, at: '2026-01-01T00:00:00Z',
      ai: { verdict: 'pass' as const, reasonZh: 'SSH 工具读本机 key', reasonEn: 'local use' },
    }]])
    const body = issueBody(t[0]!, { flagContexts })
    expect(body).toContain('↳ AI 初筛：倾向良性——SSH 工具读本机 key')
    // miss → explainer still renders, pre-read line absent
    const bare = issueBody(t[0]!, { flagContexts: new Map() })
    expect(bare).not.toContain('AI 初筛：倾向良性')
    expect(bare).toContain('credential-read')
  })
  it('dead pre-read key renders an explicit 不可用 marker — never silently bare', () => {
    const flag = 'credential-read:lib/ssh.js — L3: readKey("~/.ssh/id_rsa")'
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [], redFlags: [flag] },
    })]), [v({ verdict: 'concern' })])
    const key = `${t[0]!.name.toLowerCase()}\0${t[0]!.version ?? ''}\0${flag}`
    const flagContexts = new Map([[key, {
      name: t[0]!.name, version: t[0]!.version, flag, rule: 'credential-read',
      path: 'lib/ssh.js', line: 3, at: '2026-01-01T00:00:00Z',
      ai: null, aiNote: 'context-fetch-failed',
    }]])
    const body = issueBody(t[0]!, { flagContexts, deadCtx: new Set([key]) })
    expect(body).toContain('↳ AI 初筛不可用——多次判定失败')
    // alive-but-uncovered keys keep the bare row (gate defers creation anyway)
    const pending = issueBody(t[0]!, { flagContexts, deadCtx: new Set() })
    expect(pending).not.toContain('AI 初筛不可用')
  })
  it('scan-excerpt rows carry the same 3-state pre-read as flag rows', () => {
    const F = 'network-call:src/x.js — L9: fetch("https://a.b")'
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [F], redFlags: [] },
    })]), [v({ verdict: 'concern' })])
    expect(t[0]!.scanPreview).toContain(F)
    const key = `${t[0]!.name.toLowerCase()}\0${t[0]!.version ?? ''}\0${F}`
    const mk = (ai: FlagContext['ai'], aiNote?: string): FlagContext => ({
      name: t[0]!.name, version: t[0]!.version, flag: F, rule: 'network-call',
      path: 'src/x.js', line: 9, at: '2026-01-01T00:00:00Z', ai, ...(aiNote ? { aiNote } : {}),
    })
    const judged = issueBody(t[0]!, { flagContexts: new Map([[key, mk({ verdict: 'pass' as const, reasonZh: '本地回环探测', reasonEn: 'x' })]]) })
    expect(judged).toContain('↳ AI 初筛：倾向良性——本地回环探测')
    const dead = issueBody(t[0]!, { flagContexts: new Map([[key, mk(null, 'context-fetch-failed')]]), deadCtx: new Set([key]) })
    expect(dead).toContain('↳ AI 初筛不可用——多次判定失败')
    // a finding inside the preread set but still pending stays bare (the
    // gate defers issue creation) — the overflow marker is only for keys
    // the queue will never reach
    const pending = issueBody(t[0]!, { flagContexts: new Map(), deadCtx: new Set() })
    expect(pending).not.toContain('AI 初筛')
  })
  it('excerpt rows past the preread cap get the overflow marker', () => {
    const findings = Array.from({ length: 16 }, (_, i) => `network-call:src/f${i}.js — L${i + 1}: fetch("https://a.b/${i}")`)
    const t = docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings, redFlags: [] },
    })]), [v({ verdict: 'concern' })])
    const body = issueBody(t[0]!, { flagContexts: new Map(), deadCtx: new Set() })
    expect(body).toContain('↳ 超出 AI 预读上限')
  })
  it('风险文件 rows aggregate per-finding pre-reads — any concern wins', () => {
    const F_NET = 'network-call:src/index.js — L10: fetch("https://evil.example")'
    const F_CP = 'child-process:src/index.js — L20: execSync(cmd)'
    const F_DOC = 'network-call:README.md — L30: curl example'
    const t = docketTargets(idx([e({ capabilities: { scannedAt: 't',
      findings: [F_NET, F_CP, F_DOC, 'network-call:src/net.js — L5: http.get(u)'],
      redFlags: [] } })]), [v({ verdict: 'concern' })])[0]!
    const k = (flag: string) => `${t.name.toLowerCase()}\0${t.version ?? ''}\0${flag}`
    const ctx = (flag: string, ai: { verdict: 'pass' | 'concern'; reasonZh: string; reasonEn: string }) =>
      ({ name: t.name, version: t.version, flag, rule: 'x', path: 'p', line: 1, at: 't', ai })
    const flagContexts = new Map([
      [k(F_NET), ctx(F_NET, { verdict: 'concern', reasonZh: '外发可疑', reasonEn: '' })],
      [k(F_CP), ctx(F_CP, { verdict: 'pass', reasonZh: '调本机工具', reasonEn: '' })],
      [k(F_DOC), ctx(F_DOC, { verdict: 'pass', reasonZh: '文档示例', reasonEn: '' })],
      // docs-example finding has no pre-read yet — partial coverage path
    ])
    const body = issueBody(t, { flagContexts })
    // src/index.js: one concern + one pass → concern renders (never silently green)
    expect(body).toContain('↳ AI 初筛：⚠️ 疑似异常——外发可疑')
    // README row: 1/1 judged pass → 全部倾向良性
    expect(body).toContain('↳ AI 初筛：全部倾向良性——文档示例')
    // no fabricated line for rows with zero pre-reads
    const netRow = body.split('\n').find(l => l.includes('src/net.js'))!
    expect(body.split('\n')[body.split('\n').indexOf(netRow) + 1]).not.toContain('AI 初筛')
  })
  it('flag verdict headline carries the flag explainer', () => {
    const t = docketTargets(idx([e()]), [])
    const body = issueBody({ ...t[0]!, verdict: 'flag', reason: 'sec:repo-recreated' })
    expect(body).toContain('发生了什么：仓库被删除重建')
  })
  it('stripFlagTail never touches real prose or LLM-draft payloads', () => {
    // an LLM-draft reason ends in prose, not type:path pairs — must survive intact
    const t = docketTargets(idx([e()]), [v({ verdict: 'concern',
      reason: '机械红旗待人工（AI 草稿，LLM 判 concern）：代码存在可疑网络外联行为' })])
    const body = issueBody(t[0]!)
    expect(body).toContain('代码存在可疑网络外联行为')
  })
})

describe('docket main', () => {
  it('creates ONE aggregate issue for repo-only pendings + closes decided ones', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ latestVersion: null })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{ number: 9, title: '[review] stale/x' }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    expect(create).toBeTruthy()
    expect(create!.join(' ')).toContain('[review] (repo-only backlog)')
    expect(create!.join(' ')).toContain('`pkg`')
    // 'none' verdicts carry no ai: label — the body itself says "AI 不审"
    expect(create!.join(' ')).not.toContain('ai:')
    expect(calls.some(c => c.includes('close') && c.includes('9'))).toBe(true)
  })

  it('re-syncs a stale ai:* label and body when the verdict flipped (K-2)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk2-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v({ verdict: 'concern' })) + '\n')
    const calls: string[][] = []
    const ghFn = async (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 7, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }],
        body: '## 审核单 pkg@1.0.0\n- 当前 AI 判定：**pass** — stale',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label ai:pass')
    expect(edits).toContain('--add-label ai:concern')
    expect(edits).toContain('--body')
    expect(edits).toContain('当前 AI 判定：**concern**')
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('a wanted issue stripped of review:pending is re-labeled — title-keyed sync (K-5)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    // pre-compute the wanted body so only the label drifts — same opts main()
    // derives from GH_REPO
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 0, scannedAt: 't', src: { kind: 'npm', id: 'pkg' },
        description: 'a pkg' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 3, title: '[review] pkg@1.0.0',
        labels: [{ name: 'ai:pass' }],   // review:pending stripped by hand
        body: wantBody,
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--add-label review:pending')
    expect(edits).not.toContain('--body')
  })

  it('flagged slot + AI pass → review:human on create AND on update-sync', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3h-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => { calls.push(args); return args.includes('list') ? '[]' : '' }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))!.join(' ')
    expect(create).toContain('--label review:pending')
    expect(create).toContain('--label review:human')
  })

  it('review:human follows the flag lock — added while held, removed once cleared', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      // held side: flagged entry, existing issue lacks the label → add
      let dir = mkdtempSync(join(tmpdir(), 'dk3i-'))
      let idxPath = join(dir, 'index.json'); let vPath = join(dir, 'v.jsonl')
      writeFileSync(idxPath, JSON.stringify(idx([e({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })])))
      writeFileSync(vPath, JSON.stringify(v()) + '\n')
      const wantBody = issueBody(
        { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
          slug: 'o/pkg', findings: 0, redFlags: 1, redFlagList: ['sec:x'] },
        { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
      const calls: string[][] = []
      const ghFn = (args: string[]) => {
        calls.push(args)
        if (args.includes('list')) return JSON.stringify([{
          number: 3, title: '[review] pkg@1.0.0',
          labels: [{ name: 'review:pending' }, { name: 'ai:pass' }], body: wantBody,
        }])
        return ''
      }
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
      const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
      expect(edits).toContain('--add-label review:human')

      // cleared side: rescan dropped the flag, stale label must go
      dir = mkdtempSync(join(tmpdir(), 'dk3j-'))
      idxPath = join(dir, 'index.json'); vPath = join(dir, 'v.jsonl')
      writeFileSync(idxPath, JSON.stringify(idx([e()])))
      writeFileSync(vPath, JSON.stringify(v()) + '\n')
      const wantBody2 = issueBody(
        { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
          slug: 'o/pkg', findings: 0, redFlags: 0, scannedAt: 't', src: { kind: 'npm', id: 'pkg' } },
        { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
      const calls2: string[][] = []
      const ghFn2 = (args: string[]) => {
        calls2.push(args)
        if (args.includes('list')) return JSON.stringify([{
          number: 3, title: '[review] pkg@1.0.0',
          labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'review:human' }],
          body: wantBody2,
        }])
        return ''
      }
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn2)
      const edits2 = calls2.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
      expect(edits2).toContain('--remove-label review:human')
    } finally { process.env.GH_REPO = saved }
  })

  it('flagged slot + flagsReviewed pass → NO review:human (the pass holds release authority)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3k-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v({ flagsReviewed: true })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => { calls.push(args); return args.includes('list') ? '[]' : '' }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))!.join(' ')
    expect(create).toContain('--label review:pending')
    expect(create).not.toContain('--label review:human')
    // the body must not claim "只能人工放行" — the flag-reviewed pass releases
    const bodyArg = calls.find(c => c.includes('create'))!.join('\n')
    expect(bodyArg).toContain('已复核红旗')
    expect(bodyArg).not.toContain('只能人工放行')
  })

  it('flagsReviewed pass + stale review:human label → label removed on sync', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3l-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v({ flagsReviewed: true })) + '\n')
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 1, redFlagList: ['sec:x'], flagsReviewed: true },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 3, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'review:human' }],
        body: wantBody,
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label review:human')
  })

  it('a wanted issue still carrying review:decided gets it stripped — pending+decided never coexist', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3b-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 0, scannedAt: 't', src: { kind: 'npm', id: 'pkg' },
        description: 'a pkg' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 3, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'review:decided' }],
        body: wantBody,
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label review:decided')
    expect(edits).not.toContain('--body')
  })

  it('auto-close swaps review:pending → review:decided and names the reason', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk4-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'approved' })])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 5, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }], body: 'x',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label review:pending')
    expect(edits).toContain('--add-label review:decided')
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('已放行'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('5'))).toBe(true)
  })

  it('close comments name the reason per case: superseded / tombstoned / decided', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk7-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    // pkg@1.0.0 still wanted (ai pass) → the NEWEST same-name issue (#12)
    // is adopted + retitled in place; the older same-name duplicate (#8)
    // closes as superseded. gone/ghost isn't in the index → tombstoned.
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 8, title: '[review] pkg@0.9.0', labels: [], body: 'x' },
        { number: 9, title: '[review] gone/ghost@9.9.9', labels: [], body: 'x' },
        // unparseable title body → titleTarget null → same tombstone bucket
        { number: 10, title: '[review]', labels: [], body: 'x' },
        // already carries review:decided and no pending → no label edit needed
        { number: 11, title: '[review] gone/ghost2', labels: [{ name: 'review:decided' }], body: 'x' },
        // newest same-name issue → adopted by pkg@1.0.0 and retitled, not closed
        { number: 12, title: '[review] pkg@0.8.0', labels: [{ name: 'review:pending' }], body: 'x' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    const summary = join(dir, 'summary.md')
    const savedSummary = process.env.GITHUB_STEP_SUMMARY
    process.env.GITHUB_STEP_SUMMARY = summary
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      // assigning undefined would leak the literal string 'undefined' into
      // later tests' env — delete restores the unset state
      if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
      else process.env.GITHUB_STEP_SUMMARY = savedSummary
    }
    const comments = calls.filter(c => c.includes('comment')).map(c => c.join(' ')).join('\n')
    expect(comments).toContain('评审目标已变更')
    expect(comments).toContain('已不在 catalog 索引中')
    // #11 already decided: no label edit wasted on it
    expect(calls.some(c => c[1] === 'edit' && c[4] === '11')).toBe(false)
    // #12 adopted by the wanted pkg@1.0.0 target — retitled in place, never
    // closed/recreated: the same issue number carries forward (K-drift)
    const edits12 = calls.filter(c => c[1] === 'edit' && c[4] === '12').map(c => c.join(' ')).join('\n')
    expect(edits12).toContain('--title [review] pkg@1.0.0')
    expect(calls.some(c => c.includes('close') && c[4] === '12')).toBe(false)
    expect(calls.some(c => c.includes('create'))).toBe(false)
    const { readFileSync } = await import('node:fs')
    const sm = readFileSync(summary, 'utf8')
    expect(sm).toContain('review-docket')
    expect(sm).toContain('关闭 4')
    expect(sm).toContain('新开 0')
    expect(sm).toContain('更新 1')
  })

  it('version-drift adoption never steals an issue whose title is still wanted — two-slot name keeps one ticket each', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk8-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    // approved+flagged entry with an update in flight → TWO wanted targets
    // under one name: flag@1.0.0 and concern@2.0.0 (concern outranks flag as
    // the name's canonical). The open pkg@1.0.0 issue is the FLAG slot's own
    // ticket — the concern target must create its own, not retitle it away.
    writeFileSync(idxPath, JSON.stringify(idx([e({
      approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:demo-flag'], flaggedAt: '2026-06-01T00:00:00Z' },
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })])))
    writeFileSync(vPath, JSON.stringify(v({ version: '2.0.0', verdict: 'concern' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 20, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'flag issue' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.some(c => c.includes('create') && c.join(' ').includes('[review] pkg@2.0.0'))).toBe(true)
    expect(calls.filter(c => c[1] === 'edit' && c[4] === '20').map(c => c.join(' ')).join('\n')).not.toContain('--title')
    expect(calls.some(c => c.includes('close'))).toBe(false)
  })

  it('listing at the cap warns loudly instead of truncating silently', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk8-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const full = Array.from({ length: 4000 }, (_, i) => ({ number: i, title: `noise/${i}`, labels: [], body: '' }))
    const ghFn = (args: string[]) => args.includes('list') ? JSON.stringify(full) : ''
    const warned: string[] = []
    const orig = console.warn
    console.warn = (...a: unknown[]) => { warned.push(a.join(' ')) }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    const summary = join(dir, 'summary.md')
    const savedSummary = process.env.GITHUB_STEP_SUMMARY
    process.env.GITHUB_STEP_SUMMARY = summary
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
      else process.env.GITHUB_STEP_SUMMARY = savedSummary
      console.warn = orig
    }
    expect(warned.join('\n')).toContain('hit limit')
    // the cap warning must also land in STEP_SUMMARY — console.warn scrolls
    // away, the summary is what the maintainer actually reads after a run
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(summary, 'utf8')).toContain('触顶')
  })

  it('duplicate same-title issues: newest survives, older ones close as 重复审核单', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk5-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      // gh issue list returns NEWEST-first — feed it in real API order so
      // the canonical pick can't silently depend on array position
      if (args.includes('list')) return JSON.stringify([
        { number: 2, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'new' },
        { number: 1, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'old' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.some(c => c.includes('close') && c.includes('1'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('2'))).toBe(false)
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('重复审核单'))).toBe(true)
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('a wanted issue with a stuck verdict label gets the warning baked into the body edit', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk6-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 0, scannedAt: 't', src: { kind: 'npm', id: 'pkg' },
        description: 'a pkg' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 4, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'verdict:pass' }],
        body: wantBody,   // everything else in sync — only the stuck label differs
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--body')
    expect(edits).toContain('未写盘')
    // ai:* is already correct — no label churn, only the body edit
    expect(edits).not.toContain('--add-label ai:')
  })

  it('missing required args rejects with usage instead of reading argv[0]', async () => {
    const { main } = await import('../pipeline/docket.ts')
    await expect(main(['x', 'y'], () => '')).rejects.toThrow('usage:')
  })

  it('a decided-but-still-pending entry closes its issue as 已决议', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk9-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))   // still pending…
    writeFileSync(vPath, JSON.stringify(v({ source: 'human' })) + '\n')   // …but ruled
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 6, title: '[review] pkg@1.0.0', labels: [], body: 'x' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('verdict 已决议'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('6'))).toBe(true)
  })

  it('--digest-state path is honored: announced verdicts render announced maturity', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk10-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const dPath = join(dir, 'd.json')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    const ver = v()
    writeFileSync(vPath, JSON.stringify(ver) + '\n')
    writeFileSync(dPath, JSON.stringify({
      lastDigestAt: '2026-01-02T00:00:00Z',
      announced: [`${ver.name}\0${ver.version}\0${ver.at}`],
      day: '2026-01-02', dayAnnounced: [],
    }))
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return '[]'
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--digest-state', dPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    expect(create).toBeTruthy()
    expect(create!.join(' ')).toContain('已公告·待放行闸')
  })

  it('--dry prints actions without touching issues', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk11-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 5, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'stale' },
        { number: 7, title: '[review] gone/x@1.0.0', labels: [], body: 'x' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--dry'], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.filter(c => c.includes('list')).length).toBe(1)
    expect(calls.some(c => c.includes('create') || c.includes('edit')
      || c.includes('close') || c.includes('comment'))).toBe(false)
  })

  it('an issue whose ai:* label no longer matches (flag target now) gets it stripped', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk12-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 4, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }], body: 'old',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label ai:pass')
    expect(edits).not.toContain('--add-label ai:')
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('EVERY stale ai:* label is stripped in one edit — multi-label drift converges', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk13-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    // flag target → wantAi=null; the issue carries TWO ai:* labels — the old
    // find()-first logic peeled one per tick and never converged
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 4, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'ai:concern' }],
        body: 'old',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label ai:pass')
    expect(edits).toContain('--remove-label ai:concern')
    expect(edits).not.toContain('--add-label ai:')
  })

  it('flag/concern issues get DOCKET_ASSIGNEE assignment; pass/none stay quiet', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk14-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([
      e({ name: 'flagpkg', slug: 'o/flagpkg', approval: 'approved',
        capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } }),
      e({ name: 'passpkg', slug: 'o/passpkg' }),
    ])))
    writeFileSync(vPath, JSON.stringify(v({ name: 'passpkg' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return '[]'
      if (args.includes('create')) return 'https://github.com/o/r/issues/42'
      return ''
    }
    const saved = process.env.GH_REPO
    const savedA = process.env.DOCKET_ASSIGNEE
    process.env.GH_REPO = 'o/r'
    process.env.DOCKET_ASSIGNEE = 'maint1,maint2'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedA === undefined) delete process.env.DOCKET_ASSIGNEE
      else process.env.DOCKET_ASSIGNEE = savedA
    }
    const assigns = calls.filter(c => c.join(' ').includes('--add-assignee'))
    // exactly ONE assign — the flag issue; the pass issue is an objection
    // window, not an ask, so it stays quiet (AGENTS: 常态安静)
    expect(assigns.length).toBe(1)
    expect(assigns[0]!.join(' ')).toContain('maint1,maint2')
    expect(assigns[0]!.join(' ')).toContain('42')
  })

  it('a rejected assignee never fails the sync — notification is best-effort', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk15-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return '[]'
      if (args.includes('create')) return 'https://github.com/o/r/issues/42'
      if (args.join(' ').includes('--add-assignee')) throw new Error('assign failed: not a collaborator')
      return ''
    }
    const saved = process.env.GH_REPO
    const savedA = process.env.DOCKET_ASSIGNEE
    process.env.GH_REPO = 'o/r'
    process.env.DOCKET_ASSIGNEE = 'ghost-user'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedA === undefined) delete process.env.DOCKET_ASSIGNEE
      else process.env.DOCKET_ASSIGNEE = savedA
    }
    expect(calls.some(c => c.includes('create'))).toBe(true)
  })

  it('versioned none past NONE_ISSUE_CAP → ONE (unreviewed backlog) issue; stale per-entry issues close as 并入', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk16-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const aged = (n: string) => e({ name: n, slug: `o/${n}`, firstSeenAt: '2020-01-01T00:00:00Z' })
    writeFileSync(idxPath, JSON.stringify(idx(Array.from({ length: 11 }, (_, i) => aged(`p${i}`)))))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        // p0's old per-entry issue — now carried as an aggregate row → merged
        { number: 31, title: '[review] p0@1.0.0', labels: [{ name: 'review:pending' }], body: 'old' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const creates = calls.filter(c => c.includes('create'))
    expect(creates).toHaveLength(1)
    expect(creates[0]!.join(' ')).toContain('[review] (unreviewed backlog)')
    expect(creates[0]!.join(' ')).toContain('`p0@1.0.0`')
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('并入未评审积压总单'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('31'))).toBe(true)
  })

  it('closing a decided issue strips stale verdict:* labels too', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk17-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v({ source: 'human' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 6, title: '[review] pkg@1.0.0',
          labels: [{ name: 'review:pending' }, { name: 'verdict:pass' }, { name: 'verdict:blocked' }],
          body: 'x' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit') && c.includes('6')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label verdict:pass')
    expect(edits).toContain('--remove-label verdict:blocked')
    expect(edits).toContain('--add-label review:decided')
  })

  it('--dry marks the step summary as a rehearsal, not real actions', async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk18-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const summary = join(dir, 'summary.md')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const ghFn = (args: string[]) => args.includes('list') ? '[]' : ''
    const saved = process.env.GH_REPO
    const savedSummary = process.env.GITHUB_STEP_SUMMARY
    process.env.GH_REPO = 'o/r'
    process.env.GITHUB_STEP_SUMMARY = summary
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--dry'], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
      else process.env.GITHUB_STEP_SUMMARY = savedSummary
    }
    expect(readFileSync(summary, 'utf8')).toContain('预演')
  })
})

describe('docket audit — round 3 regressions', () => {
  it('package-level human verdict (name@*) postdates flaggedAt → flag retired; predating it does not', () => {
    const flagged = (at: string) => e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:name-reused'], flaggedAt: at } })
    // slot key is pkg\0 1.0.0 — the pkg@* verdict lives on the null key;
    // before the package-key check it could never retire the flag
    expect(docketTargets(idx([flagged('2020-01-01T00:00:00Z')]),
      [v({ source: 'human', version: null, verdict: 'concern' })])).toEqual([])
    // pre-signal package verdict judges the bytes, not the flag → stays
    expect(docketTargets(idx([flagged('2027-01-01T00:00:00Z')]),
      [v({ source: 'human', version: null })])).toHaveLength(1)
    // slot verdict still works exactly as before
    expect(docketTargets(idx([flagged('2020-01-01T00:00:00Z')]),
      [v({ source: 'human' })])).toEqual([])
  })
  it('flag target carries the pre-signal human verdict as CONTEXT, not a decision', () => {
    const flagged = e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'], flaggedAt: '2027-01-01T00:00:00Z' } })
    const hv = v({ source: 'human' })
    const t = docketTargets(idx([flagged]), [hv])[0]!
    expect(t.verdict).toBe('flag')
    expect(t.humanVerdict).toBeTruthy()
    expect(t.flaggedAt).toBe('2027-01-01T00:00:00Z')
    const body = issueBody(t)
    expect(body).toContain('此前人工裁决')
    expect(body).toContain('早于信号')
    expect(body).not.toContain('最新人工判词')   // generic line would read as decided
  })
  it('close reason is honest when the target left the queue with NO verdict (version moved / clock reset)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkr-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    // candidate is 2.0.0 with a FRESH scan clock → young → no wanted target.
    // The open issue is for 1.0.0 — its key has never been judged, so the
    // close comment must not point at a verdict that doesn't exist
    writeFileSync(idxPath, JSON.stringify(idx([e({ latestVersion: '2.0.0',
      capabilities: { scannedAt: '2999-01-01T00:00:00Z', findings: [], redFlags: [] } })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list'))
        return JSON.stringify([{ number: 9, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }] }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const comment = calls.find(c => c.includes('comment'))?.join(' ') ?? ''
    expect(comment).toContain('离开队列')
    expect(comment).not.toContain('verdict 已决议')
    expect(calls.some(c => c.includes('close'))).toBe(true)
  })
  it('a verdict actually on the key still closes with the decided reason', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkr2-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    // human verdict on 1.0.0 → target resolved → the stale open issue closes
    // with the REAL '已决议' pointer
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v({ source: 'human' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list'))
        return JSON.stringify([{ number: 9, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }] }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const comment = calls.find(c => c.includes('comment'))?.join(' ') ?? ''
    expect(comment).toContain('verdict 已决议')
  })
  it('open issue with body:null (REST empty body) → bodyDrift, no TypeError', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dknb-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list'))
        return JSON.stringify([{ number: 5, title: '[review] pkg@1.0.0',
          labels: [{ name: 'review:pending' }, { name: 'ai:pass' }], body: null }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      // body:null used to hit (ex.body).trim() → TypeError → op failure every tick
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edit = calls.find(c => c.includes('edit') && c.includes('5'))
    expect(edit?.join(' ')).toContain('--body')
  })
  it('paused unreviewed aggregate IS an ask — gets the DOCKET_ASSIGNEE push', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkpa-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(join(dir, 'diagnose.paused'), '')
    // one aged no-verdict candidate → paused folds it into the aggregate
    writeFileSync(idxPath, JSON.stringify(idx([e({ firstSeenAt: '2020-01-01T00:00:00Z' })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return '[]'
      if (args.includes('create')) return 'https://github.com/o/r/issues/42\n'
      return ''
    }
    const saved = process.env.GH_REPO
    const savedA = process.env.DOCKET_ASSIGNEE
    process.env.GH_REPO = 'o/r'
    process.env.DOCKET_ASSIGNEE = 'maint'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedA === undefined) delete process.env.DOCKET_ASSIGNEE
      else process.env.DOCKET_ASSIGNEE = savedA
    }
    expect(calls.find(c => c.includes('create'))?.join(' ')).toContain('(unreviewed backlog)')
    const assign = calls.find(c => c.join(' ').includes('--add-assignee'))
    expect(assign?.join(' ')).toContain('maint')
  })
  it('retried close does not re-post the auto-close comment (idempotent under partial failure)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkic-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list'))
        return JSON.stringify([{ number: 7, title: '[review] gone@1.0.0', labels: [] }])
      // the close-note jq scans every comment for the prefix — 'true' means
      // a previous tick already posted it (then the close call itself
      // failed); re-posting is noise
      if (args.includes('view')) return 'true'
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.some(c => c.includes('comment'))).toBe(false)
    expect(calls.some(c => c.includes('close'))).toBe(true)
  })
  it('no drift but a missing notification assignee still gets one best-effort write', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkma-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'], flaggedAt: '2020-01-01T00:00:00Z' } })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, '')
    // identical labels AND body → zero drift; only the assignee gap remains
    const target = docketTargets(idx([flagged]), [], null)[0]!
    const wantBody = issueBody(target, { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 5, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }], body: wantBody, assignees: [] }])
      return ''
    }
    const saved = process.env.GH_REPO
    const savedA = process.env.DOCKET_ASSIGNEE
    process.env.GH_REPO = 'o/r'
    process.env.DOCKET_ASSIGNEE = 'maint'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally {
      process.env.GH_REPO = saved
      if (savedA === undefined) delete process.env.DOCKET_ASSIGNEE
      else process.env.DOCKET_ASSIGNEE = savedA
    }
    const edit = calls.find(c => c.join(' ').includes('--add-assignee'))
    expect(edit?.join(' ')).toContain('5')
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })
  it('a failing write op is collected, siblings still run, and the job goes red', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkof-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e(), e({ name: 'pkg2' })])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n' + JSON.stringify(v({ name: 'pkg2', verdict: 'concern' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return '[]'
      if (args.includes('create') && args.join(' ').includes('pkg@1.0.0'))
        throw new Error('gh exploded')
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await expect(main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn))
        .rejects.toThrow('write op')
    } finally { process.env.GH_REPO = saved }
    // the pkg2 create was attempted despite its sibling exploding
    expect(calls.some(c => c.includes('create') && c.join(' ').includes('pkg2@1.0.0'))).toBe(true)
  })
  it('recycled name: a pass predating the tombstone governs NOTHING (docket + diagnose align with release)', async () => {
    const { unreviewedTargets } = await import('../pipeline/ai/diagnose.ts')
    const tomb = [{ slug: 'o/pkg', name: 'pkg', disappearedAt: '2026-01-10T00:00:00Z', reason: 'npm-404' as const }]
    const recycled = e({ approval: 'pending', firstSeenAt: '2026-02-01T00:00:00Z' })
    const withTomb = { ...idx([recycled]), removed: tomb }
    const stalePass = v({ at: '2026-01-01T00:00:00Z' })       // judged the OLD object
    const freshPass = v({ at: '2026-02-02T00:00:00Z' })       // judged THIS object
    // docket: the stale pass is not a decision — the entry falls back to the
    // aged 'none' standing-issue path instead of reading as decided
    const noneT = docketTargets(withTomb, [stalePass], null, { now: '2026-02-06T00:00:00Z' })
    expect(noneT[0]?.verdict).toBe('none')
    expect(docketTargets(withTomb, [freshPass])[0]?.verdict).toBe('pass')
    // diagnose: the stale pass must not suppress re-review either — without
    // the epoch gate here the recycled entry is pending forever, invisible
    expect(unreviewedTargets(withTomb, [stalePass])).toHaveLength(1)
    expect(unreviewedTargets(withTomb, [freshPass])).toHaveLength(0)
    // concern is exempt — recycled names inherit distrust
    const staleConcern = v({ at: '2026-01-01T00:00:00Z', verdict: 'concern' })
    expect(unreviewedTargets(withTomb, [staleConcern])).toHaveLength(0)
  })
})

describe('main — repo-moved flag compare evidence', () => {
  it('fetches compare for flagDelta targets and renders 变化详情 + AI 初筛', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-cmp-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const aPath = join(dir, 'assess.jsonl')
    const flagged = e({
      name: 'o/plugin', slug: 'o/plugin', approval: 'approved', latestVersion: null,
      source: { kind: 'github', id: 'o/plugin', repo: 'o/plugin', version: 'newsha999888777' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:newsha999888777'], flaggedAt: '2026-11-15T00:00:00Z' },
    })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v({ name: 'o/plugin', version: null, source: 'human', sha: 'oldsha111222333', at: '2026-11-14T00:00:00Z' })) + '\n')
    writeFileSync(aPath, JSON.stringify({
      name: 'o/plugin', flag: 'sec:repo-moved-since-release:newsha999888777', repo: 'o/plugin',
      oldSha: 'oldsha111222333', newSha: 'newsha999888777', at: '2026-11-16T00:00:00Z',
      aheadBy: 2, filesChanged: 1, commitsTotal: 2, additions: 5, deletions: 1,
      commits: [{ sha: 'abc', msg: 'bump version' }],
      files: [{ path: 'README.md', status: 'modified', add: 5, del: 1, risky: false }],
      riskyFiles: [], trivial: true, truncated: false,
      ai: { verdict: 'pass', reasonZh: '仅文档更新', reasonEn: 'docs only' },
    }) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([])
      if (args[0] === 'api' && args[1]?.includes('/compare/')) return JSON.stringify({
        ahead_by: 2, total_commits: 2,
        commits: [{ sha: 'abc123456789', commit: { message: 'bump version to 1.1.0' } }],
        files: [{ filename: 'README.md', status: 'modified', additions: 5, deletions: 1, patch: '@@ docs' }],
      })
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--assessments', aPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    expect(create).toBeTruthy()
    const body = create![create!.indexOf('--body') + 1]!
    expect(body).toContain('### 🔍 这次变了什么')
    // delta block renders from the STORED assessment — 'bump version' is
    // its commit msg; the live compare mock ('bump version to 1.1.0')
    // must never be consulted when an assessment exists
    expect(body).toContain('bump version')
    expect(calls.some(c => c[0] === 'api' && c[1]?.includes('/compare/'))).toBe(false)
    expect(body).toContain('/compare/oldsha111222333...newsha999888777/files')
    expect(body).toContain('### 🤖 AI 初筛')
    expect(body).toContain('仅文档更新')
    expect(body).toContain('advisory')
  })
  it('no stored assessment → delta block falls back to a live compare fetch', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-cmp-live-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({
      name: 'o/plugin', slug: 'o/plugin', approval: 'approved', latestVersion: null,
      source: { kind: 'github', id: 'o/plugin', repo: 'o/plugin', version: 'newsha999888777' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:newsha999888777'], flaggedAt: '2026-11-15T00:00:00Z' },
    })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v({ name: 'o/plugin', version: null, source: 'human', sha: 'oldsha111222333', at: '2026-11-14T00:00:00Z' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([])
      if (args[0] === 'api' && args[1]?.includes('/compare/')) return JSON.stringify({
        ahead_by: 2, total_commits: 2,
        commits: [{ sha: 'abc123456789', commit: { message: 'bump version to 1.1.0' } }],
        files: [{ filename: 'README.md', status: 'modified', additions: 5, deletions: 1, patch: '@@ docs' }],
      })
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    const body = create![create!.indexOf('--body') + 1]!
    expect(calls.some(c => c[0] === 'api' && c[1]?.includes('/compare/'))).toBe(true)
    expect(body).toContain('bump version to 1.1.0')
  })
  it('compare fetch failure degrades to manual link; corrupt assessments warn not fail', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-cmp2-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const aPath = join(dir, 'assess.jsonl')
    const flagged = e({
      name: 'o/plugin', slug: 'o/plugin', approval: 'approved', latestVersion: null,
      source: { kind: 'github', id: 'o/plugin', repo: 'o/plugin', version: 'newsha999888777' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:newsha999888777'], flaggedAt: '2026-11-15T00:00:00Z' },
    })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, JSON.stringify(v({ name: 'o/plugin', version: null, source: 'human', sha: 'oldsha111222333', at: '2026-11-14T00:00:00Z' })) + '\n')
    writeFileSync(aPath, '{"corrupt"\nnot json\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([])
      if (args[0] === 'api') throw new Error('api down')
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--assessments', aPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    const body = create![create!.indexOf('--body') + 1]!
    expect(body).toContain('对比取数失败')
    expect(body).toContain('oldsha111222333...newsha999888777')
    expect(body).not.toContain('AI 初筛')
  })
})

describe('issue evidence enrichment', () => {
  const findingsEntry = () => e({
    capabilities: {
      scannedAt: '2026-01-01T00:00:00Z',
      findings: [
        'network-call:src/index.js — L10: fetch("https://evil.example")',
        'child-process:src/index.js — L20: execSync(cmd)',
        'network-call:src/net.js — L5: http.get(u)',
        'network-call:README.md — L30: curl example',
        'docs-example:docs/guide.md — L1: fetch demo',
      ],
      redFlags: [],
    },
    verification: { status: 'failed', logExcerpt: 'npm ERR! code E404\n404 Not Found', runUrl: 'https://example.com/run/1' },
    metrics: { stars: 42, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
    publishedAt: '2025-12-01T00:00:00Z',
  })
  it('docketTargets rolls findings up per file and carries source/verify/stars', () => {
    const t = docketTargets(idx([findingsEntry()]), [v({ verdict: 'concern' })])[0]!
    expect(t.hotFiles!.map(f => f.path)).toEqual(['src/index.js', 'docs/guide.md', 'README.md', 'src/net.js'])
    expect(t.hotFiles![0]).toMatchObject({ n: 2, doc: false })
    expect(t.hotFiles![0]!.rules).toContain('network-call')
    expect(t.hotFiles![0]!.rules).toContain('child-process')
    expect(t.hotFiles![2]!.doc).toBe(true)          // README.md → doc-ish
    expect(t.docFindings).toBe(2)                    // README.md + docs/guide.md
    expect(t.src).toMatchObject({ kind: 'npm', id: 'pkg' })
    expect(t.verifyLog).toContain('E404')
    expect(t.verifyRunUrl).toBe('https://example.com/run/1')
    expect(t.stars).toBe(42)
  })
  it('scanPreview sorts code-path findings before doc-path ones', () => {
    const t = docketTargets(idx([findingsEntry()]), [v({ verdict: 'concern' })])[0]!
    // README/docs hits are context, not behavior — they must not bury the
    // real code signals under alphabetical order (#6256 excerpt showed
    // CHANGELOG/docs first and hid the live spawn hit below the fold)
    const paths = t.scanPreview!.map(s => s.split(':')[1]?.split(' ')[0] ?? '')
    const docIdx = paths.findIndex(p => /\.(md|txt|rst)$/i.test(p) || /(^|\/)docs?\//.test(p))
    expect(paths.slice(0, docIdx === -1 ? paths.length : docIdx)
      .every(p => !/\.(md|txt|rst)$/i.test(p) && !/(^|\/)docs?\//.test(p))).toBe(true)
    expect(t.scanPreview![0]).toContain('src/index.js')
  })
  it('flag-listed findings are excluded from hotFiles (they render in 红旗清单)', () => {
    const ent = findingsEntry()
    ent.capabilities.redFlags = ['network-call:src/net.js — L5: http.get(u)']
    const t = docketTargets(idx([ent]), [v({ verdict: 'concern' })])[0]!
    expect(t.hotFiles!.find(f => f.path === 'src/net.js')).toBeUndefined()
  })
  it('issueBody renders package links, hot-file source links, verify log', () => {
    const t = docketTargets(idx([findingsEntry()]), [v({ verdict: 'concern' })])[0]!
    const body = issueBody(t)
    expect(body).toContain('[npm 包页](https://www.npmjs.com/package/pkg)')
    expect(body).toContain('发布于 2025-12-01')
    expect(body).toContain('★42')
    expect(body).toContain('风险文件 TOP')
    expect(body).toContain('代码 2 / 文档类 2')
    // npm source → app.unpkg.com rendered file view at the judged version
    expect(body).toContain('https://app.unpkg.com/pkg@1.0.0/files/src/index.js')
    expect(body).toContain('📄')
    expect(body).toContain('装测日志摘要')
    expect(body).toContain('404 Not Found')
    expect(body).toContain('[本次装测完整日志](https://example.com/run/1)')
  })
  it('github source links blob at verdictSha; no src → plain paths', () => {
    const gh = e({
      name: 'o/r', slug: 'o/r', latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'deadbeef1234' },
      capabilities: { scannedAt: 't', findings: ['network-call:a/b.js — L1: fetch(x)'], redFlags: [] },
      verification: { status: 'unverified' },
    })
    const t = docketTargets(idx([gh]), [v({ name: 'o/r', version: null, verdict: 'concern', sha: 'cafebabe5678' })])[0]!
    const body = issueBody(t)
    expect(body).toContain('[GitHub 仓库](https://github.com/o/r)')
    // first finding line anchors the blob link and labels the path :L<n>
    expect(body).toContain('https://github.com/o/r/blob/cafebabe5678/a/b.js#L1')
    expect(body).toContain('`a/b.js:L1`')
    // unverified + no log → no 装测日志摘要 section
    expect(body).not.toContain('装测日志摘要')
    const bare = issueBody({ name: 'p', version: '1', verdict: 'concern', hotFiles: [{ path: 'x.js', rules: 'r', n: 1, doc: false }] })
    expect(bare).toContain('`x.js`')
    expect(bare).not.toContain('unpkg.com')
  })
  it('npm tarball `package/` prefix is stripped from unpkg links', () => {
    // npm packs wrap every file under package/; unpkg serves the stripped
    // tree — /pkg@v/package/index.ts 404s while /pkg@v/index.ts resolves
    const ent = findingsEntry()
    ent.capabilities.findings = ['network-call:package/index.ts — L223: fetch(u)']
    const t = docketTargets(idx([ent]), [v({ verdict: 'concern' })])[0]!
    const body = issueBody(t)
    expect(body).toContain('https://app.unpkg.com/pkg@1.0.0/files/index.ts')
    expect(body).not.toContain('unpkg.com/pkg@1.0.0/files/package/index.ts')
    expect(body).toContain('`package/index.ts:L223`')
  })
  it('失败速读 unwraps message/cause and explains the signature', () => {
    const ent = findingsEntry()
    ent.verification = {
      status: 'failed', level: 'load',
      logExcerpt: '--- errors ---\ntimestamp=t level=ERROR run=x message="failed to watch directory" error="EACCES"\ntimestamp=t level=WARN run=x message="failed to load plugin" target=pkg@1.0.0 cause="Cause([Fail(PluginModule.LoadError: Plugin m"\n--- stream tail ---\nwatcher stopped',
      runUrl: 'https://example.com/run/1',
    }
    const body = issueBody(docketTargets(idx([ent]), [v({ verdict: 'concern' })])[0]!)
    // watcher EACCES noise must not be picked as the failure line — the
    // plugin's own LoadError is the evidence
    expect(body).toContain('失败速读：插件模块无法被宿主加载')
    expect(body).toContain('failed to load plugin')
    expect(body).toContain('PluginModule.LoadError')
    // structured fields unwrap — raw timestamp/run boilerplate is gone
    expect(body).toContain('- failed to load plugin')
    expect(body).not.toContain('timestamp=t')
  })
})

// ————— concern:* class labels — searchable buckets under ai:concern —————
describe('concern-class labels', () => {
  const runMain = async (verdicts: AiVerdict[], issues: object[] = [],
    opts: { entry?: PluginEntry; assignee?: string } = {}) => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dcl-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([opts.entry ?? e()])))
    writeFileSync(vPath, verdicts.map(x => JSON.stringify(x)).join('\n') + '\n')
    const calls: string[][] = []
    const ghFn = async (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify(issues)
      return ''
    }
    const saved = process.env.GH_REPO
    const savedA = process.env.DOCKET_ASSIGNEE
    process.env.GH_REPO = 'o/r'
    if (opts.assignee) process.env.DOCKET_ASSIGNEE = opts.assignee
    try { await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn) }
    finally {
      process.env.GH_REPO = saved
      if (savedA === undefined) delete process.env.DOCKET_ASSIGNEE
      else process.env.DOCKET_ASSIGNEE = savedA
    }
    return calls
  }
  const concernV = (reason: string) => v({ verdict: 'concern', reason })

  it('机械装测失败不再开单——进 docs/reports/verify-fail.md 日报', async () => {
    const calls = await runMain([concernV('装测失败（verify load 级）：serve reports the plugin failed to load')])
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toBe('')
  })
  it('存量 concern:verify issue 关单并入日报', async () => {
    const calls = await runMain([concernV('装测失败（verify load 级）：x')], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'ai:concern' }, { name: 'concern:verify' }],
      body: 'x',
    }])
    const close = calls.filter(c => c.includes('close')).map(c => c.join(' ')).join('\n')
    const comment = calls.filter(c => c.includes('comment')).map(c => c.join(' ')).join('\n')
    expect(close).toContain('issue close -R o/r 9')
    expect(comment).toContain('装测日报')
  })
  it('ai:pass + verify:failed 不再开单——进装测日报', async () => {
    const calls = await runMain([v({ verdict: 'pass' })], [], {
      entry: e({ verification: { status: 'failed' } }),
    })
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toBe('')
  })
  it('存量 ai:pass+failed issue 关单并入日报', async () => {
    const calls = await runMain([v({ verdict: 'pass' })], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'ai:pass' }],
      body: 'x',
    }], { entry: e({ verification: { status: 'failed' } }) })
    const close = calls.filter(c => c.includes('close')).map(c => c.join(' ')).join('\n')
    const comment = calls.filter(c => c.includes('comment')).map(c => c.join(' ')).join('\n')
    expect(close).toContain('issue close -R o/r 9')
    expect(comment).toContain('装测日报')
  })
  it('create: L0.5 命中 → concern:l05', async () => {
    const calls = await runMain([concernV('L0.5 命中注入信号（score 0.9 ≥ 0.662，块 x）；LLM 判 concern：y')])
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label concern:l05')
  })
  it('create: 机械红旗 → concern:flags', async () => {
    const calls = await runMain([concernV('机械红旗待人工（AI 草稿，LLM 判 concern）：x')])
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label concern:flags')
  })
  it('create: generic LLM concern → concern:llm', async () => {
    const calls = await runMain([concernV('该包 postinstall 自动执行未签名二进制')])
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label concern:llm')
  })
  it('create: flag-kind target → concern:flags', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dcl-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const flagged = e({ approval: 'approved', publishedAt: '2026-01-01T00:00:00Z',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-recreated'] } })
    writeFileSync(idxPath, JSON.stringify(idx([flagged])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = async (args: string[]) => { calls.push(args); return args.includes('list') ? '[]' : '' }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try { await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn) }
    finally { process.env.GH_REPO = saved }
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label concern:flags')
  })
  it('drift: stale concern:verify → concern:llm when the governing reason changes', async () => {
    const calls = await runMain([concernV('LLM 判 concern：重写用户配置')], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'ai:concern' }, { name: 'concern:verify' }],
      body: 'x',
    }])
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label concern:verify')
    expect(edits).toContain('--add-label concern:llm')
  })
  it('drift: concern → pass strips every concern:* label', async () => {
    const calls = await runMain([v()], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'ai:concern' }, { name: 'concern:verify' }],
      body: 'x',
    }])
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label concern:verify')
    expect(edits).toContain('--add-label ai:pass')
  })
  it('concern without a reason still classifies → concern:llm', async () => {
    const calls = await runMain([v({ verdict: 'concern' })])
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label concern:llm')
  })
  it('drift: issue already carrying the right concern:* needs no label edits', async () => {
    const calls = await runMain([concernV('LLM 判 concern：重写用户配置')], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'ai:concern' }, { name: 'concern:llm' }],
      body: 'x',
    }])
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).not.toContain('--remove-label concern:')
    expect(edits).not.toContain('--add-label concern:')
  })
  it('unscanned slot + ai pass → review:human (no AI authority on a slot that was never scanned)', async () => {
    const calls = await runMain([v()], [], {
      entry: e({ capabilities: { scannedAt: null, findings: [], redFlags: [] } }) })
    const create = calls.filter(c => c.includes('create')).map(c => c.join(' ')).join('\n')
    expect(create).toContain('--label review:human')
  })
  it('urgent issue missing its notification assignee gets a ping even with zero drift', async () => {
    const flagged = e({ approval: 'approved', publishedAt: '2026-01-01T00:00:00Z',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    const t = docketTargets(idx([flagged]), [])[0]!
    const wantBody = issueBody(t, { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls = await runMain([], [{
      number: 9, title: '[review] pkg@1.0.0',
      labels: [{ name: 'review:pending' }, { name: 'concern:flags' }],
      body: wantBody, assignees: [],
    }], { entry: flagged, assignee: 'maint1' })
    const assigns = calls.filter(c => c.join(' ').includes('--add-assignee'))
    expect(assigns.length).toBe(1)
    expect(assigns[0]!.join(' ')).toContain('maint1')
    expect(assigns[0]!.join(' ')).toContain('9')
  })
  it('same-title duplicates keep the newest number even listed ascending', async () => {
    const calls = await runMain([v()], [
      { number: 3, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'x' },
      { number: 9, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'x' },
    ])
    // #9 is canonical — #3 is the duplicate that gets closed
    expect(calls.some(c => c.includes('close') && c.includes('3'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('9'))).toBe(false)
  })
})

describe('pre-read completeness gate — no half-baked review issues', () => {
  const FLAG = 'network-call:lib/x.js — L3: fetch(u)'
  const ctx = (at: string, ai: object | null = { verdict: 'pass', reasonZh: 'r', reasonEn: 'r' }, aiNote?: string) =>
    JSON.stringify({ name: 'pkg', version: '1.0.0', flag: FLAG, rule: 'network-call', path: 'lib/x.js', line: 3, at, ai, ...(aiNote ? { aiNote } : {}) })
  const OTHER = (at: string) =>
    JSON.stringify({ name: 'other', version: '1', flag: 'x:p — L1: y', rule: 'x', path: 'p', line: 1, at, ai: { verdict: 'pass', reasonZh: '', reasonEn: '' } })

  const mkRun = () => {
    const calls: string[][] = []
    return {
      calls,
      ghFn: (a: string[]) => { calls.push(a); return a.includes('list') ? '[]' : '' },
    }
  }
  const boot = async () => {
    const { mkdtempSync, writeFileSync, appendFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dkg-'))
    const idxPath = join(dir, 'i.json'), vPath = join(dir, 'v.jsonl'), ctxPath = join(dir, 'c.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])))
    writeFileSync(vPath, JSON.stringify(v({ verdict: 'concern' })) + '\n')
    const run = (ghFn: (a: string[]) => string) =>
      main(['x', 'y', '--index', idxPath, '--verdicts', vPath, '--contexts', ctxPath], ghFn)
    return { ctxPath, run, writeFileSync, appendFileSync }
  }

  it('defers create until flag keys are covered; judged → creates', async () => {
    const f = await boot()
    f.writeFileSync(f.ctxPath, OTHER(new Date().toISOString()) + '\n')   // alive pipeline, our flag uncovered
    const keep = process.env.GH_REPO; process.env.GH_REPO = 'o/r'
    try {
      const r1 = mkRun(); await f.run(r1.ghFn)
      expect(r1.calls.some(c => c.includes('create'))).toBe(false)
      f.appendFileSync(f.ctxPath, ctx(new Date().toISOString()) + '\n')
      const r2 = mkRun(); await f.run(r2.ghFn)
      expect(r2.calls.some(c => c.includes('create'))).toBe(true)
    } finally { keep === undefined ? delete process.env.GH_REPO : process.env.GH_REPO = keep }
  })

  it('dead keys count as covered; stale contexts file opens anyway (fail-visible)', async () => {
    const f = await boot()
    // 5× fetch-failed = retries exhausted — waiting can't help, open now
    f.writeFileSync(f.ctxPath, Array.from({ length: 5 }, () =>
      ctx(new Date().toISOString(), null, 'context-fetch-failed')).join('\n') + '\n')
    const keep = process.env.GH_REPO; process.env.GH_REPO = 'o/r'
    try {
      const r1 = mkRun(); await f.run(r1.ghFn)
      expect(r1.calls.some(c => c.includes('create'))).toBe(true)
      // stale file: daemon dead >3h — a live review must not be hidden by a dead pre-reader
      f.writeFileSync(f.ctxPath, OTHER('2020-01-01T00:00:00Z') + '\n')
      const r2 = mkRun(); await f.run(r2.ghFn)
      expect(r2.calls.some(c => c.includes('create'))).toBe(true)
    } finally { keep === undefined ? delete process.env.GH_REPO : process.env.GH_REPO = keep }
  })
})
