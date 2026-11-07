/** audit #8 (审核单流 §8, 第 5 轮) — fresh independent pass found no
 *  production defect; the aggregate standing-issue body contract had thin
 *  coverage — the ONE surface whose wording directly implements the AGENTS
 *  product rules (没扫到 ≠ 安全; 报错必须给下一步):
 *
 *  1. row caps — 60 versioned / 40 repo-only with an honest "…另 N 条"
 *     tail: a giant backlog stays readable instead of an unbounded wall;
 *  2. honest marks — an unscanned backlog row must NOT look like a clean
 *     one (未跑过静态扫描 ≠ 安全), red-flagged rows carry 红旗 N,
 *     verification states use the AGENTS four-state Chinese wording;
 *  3. per-line verdict routing — versioned rows instruct
 *     `/approve|/concern 名@版本`, repo-only rows `名` (no @version);
 *  4. paused wording — the unreviewed aggregate says 声明暂停 (declared
 *     stop), not "looks dead";
 *  5. stuck verdict:* label on a sentinel issue names the REAL channel
 *     (per-line comments) instead of the usual label advice — labels on
 *     an un-targetable title can never land. */
import { describe, it, expect } from 'vitest'
import { issueBody, NONE_BACKLOG, REPO_BACKLOG, type DocketTarget } from '../pipeline/docket.ts'

const aggVer = (rows: NonNullable<DocketTarget['backlog']>): DocketTarget =>
  ({ name: NONE_BACKLOG, version: null, verdict: 'none', backlog: rows })
const aggRepo = (rows: NonNullable<DocketTarget['backlog']>): DocketTarget =>
  ({ name: REPO_BACKLOG, version: null, verdict: 'none', backlog: rows })

describe('§8 aggregate bodies — row caps + honest marks + per-line routing', () => {
  it('versioned backlog caps at 60 rows with an honest tail count', () => {
    const rows = Array.from({ length: 75 }, (_, i) => ({ name: `pkg${i}`, version: '1.0.0' }))
    const body = issueBody(aggVer(rows))
    expect(body).toContain('`pkg0@1.0.0`')
    expect(body).toContain('`pkg59@1.0.0`')
    expect(body).not.toContain('`pkg60@1.0.0`')
    expect(body).toContain('另 15 条见 index.json')
  })
  it('repo-only backlog caps at 40 rows with an honest tail count', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ name: `o/r${i}` }))
    const body = issueBody(aggRepo(rows))
    expect(body).toContain('`o/r39`')
    expect(body).not.toContain('`o/r40`')
    expect(body).toContain('另 10 条见 index.json')
  })
  it('unscanned/red-flagged/verification marks keep a row honest (没扫到 ≠ 安全)', () => {
    const body = issueBody(aggVer([
      { name: 'blind', version: '1.0.0', unscanned: true },
      { name: 'flagged', version: '2.0.0', redFlags: 3, findings: 5 },
      { name: 'tested', version: '3.0.0', verification: 'verified' },
      { name: 'dead', version: '4.0.0', verification: 'failed' },
    ]))
    expect(body).toContain('⚠️ 未跑过静态扫描（不等于安全）')
    expect(body).toContain('⚠️ 红旗 3')
    expect(body).toContain('findings 5')
    expect(body).toContain('已实测可装可用')
    expect(body).toContain('装不上或加载失败')
  })
  it('versioned rows route `/approve|/concern 名@版本`; repo-only rows route 名', () => {
    const ver = issueBody(aggVer([{ name: 'pkg', version: '1.0.0' }]))
    expect(ver).toContain('/approve 包名@版本')
    const repo = issueBody(aggRepo([{ name: 'o/r' }]))
    expect(repo).toContain('/approve 条目名`')
    expect(repo).not.toContain('/approve 条目名@版本`')
  })
  it('paused aggregate says 声明暂停 + resume instructions, not a stall', () => {
    const body = issueBody(aggVer([{ name: 'pkg', version: '1.0.0' }]), { paused: true })
    expect(body).toContain('声明暂停')
    expect(body).toContain('bin/ai-diagnose.sh resume')
    expect(body).not.toContain('或诊断已停摆')
  })
  it('unpaused aggregate keeps the queue-behind wording', () => {
    const body = issueBody(aggVer([{ name: 'pkg', version: '1.0.0' }]))
    expect(body).toContain('或诊断已停摆')
    expect(body).toContain('声明暂停可推')
  })
  it('a stuck verdict:* label on a sentinel issue names the real channel', () => {
    const body = issueBody(aggVer([{ name: 'pkg', version: '1.0.0' }]), { stuckLabel: 'verdict:pass' })
    expect(body).toContain('verdict:pass')
    expect(body).toContain('哨兵目标无法解析')
    expect(body).toContain('请摘除该标签')
    expect(body).toContain('逐条裁决请按上方指引评论')
    // and NOT the generic "label event can't re-fire" advice — that phrasing
    // is for per-version issues where the label CAN land on retry
    expect(body).not.toContain('标签事件不会重发')
  })
})
