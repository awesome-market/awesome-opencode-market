/** Submission progress visibility: for every submission issue that still has a
 *  live seed, keep ONE pinned status comment on the issue showing where the
 *  submission is in the pipeline. Edited in place each catalog run — authors
 *  no longer have to guess from scattered bot comments.
 *
 *  Usage: GH_TOKEN=… GH_REPO=owner/repo npx tsx pipeline/submission-status.ts <index.json> <submissions.txt>
 *  Without GH_TOKEN/GH_REPO it only prints the computed rows (dry run / tests).
 *
 *  Phases (author-facing, plain language — AGENTS.md):
 *    queued   — seed ingested, no catalog entry yet (waiting for the next run,
 *               or silently filtered by an admission gate)
 *    review   — entry exists but approval=pending (awaiting AI/human verdict
 *               and digest maturity)
 *    published— visible in the catalog (issue is being closed by notify)
 *  Terminal seeds (notified/dead) and issues without seeds are skipped — the
 *  review report / notify / dead-close comments already cover them. */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CatalogIndex } from '../src/schema.ts'

export interface StatusRow {
  issue: number
  key: string
  phase: 'queued' | 'review' | 'published'
  phaseLabel: string
  detail: string
}

const MARKER = '<!-- submission-status -->'

export function submissionStatuses(
  index: CatalogIndex,
  lines: string[],
): StatusRow[] {
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  // one row per issue — the newest seed line wins (same-issue replace keeps
  // this true going forward; last-match also covers legacy duplicate rows)
  const perIssue = new Map<number, { key: string; name?: string; repo?: string }>()
  for (const l of lines) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; dead?: boolean }
      if (!s.issue || s.notified || s.dead) continue
      const key = s.name ?? s.repo
      if (!key) continue
      perIssue.set(s.issue, { key, ...(s.name ? { name: s.name } : {}), ...(s.repo ? { repo: s.repo } : {}) })
    } catch { /* skip unreadable */ }
  }
  const rows: StatusRow[] = []
  for (const [issue, s] of perIssue) {
    const e = s.name ? byName.get(s.name)
      : s.repo ? index.plugins.find(p =>
          p.source.repo?.toLowerCase() === s.repo!.toLowerCase() ||
          p.name.toLowerCase() === s.repo!.toLowerCase())
      : undefined
    if (e && e.approval !== 'pending') {
      rows.push({
        issue, key: s.key, phase: 'published',
        phaseLabel: '已上架',
        detail: `**${s.key}** 已进入插件目录并对所有用户可见。`,
      })
    } else if (e) {
      rows.push({
        issue, key: s.key, phase: 'review',
        phaseLabel: '评审中',
        detail: `**${s.key}** 已进入目录收录流程，当前处于待审状态——等待评审结论与公示期。通过后自动上架，本 issue 会收到通知。`,
      })
    } else {
      rows.push({
        issue, key: s.key, phase: 'queued',
        phaseLabel: '排队中',
        detail: `**${s.key}** 已通过机器初审并进入收录队列，等待下一次目录构建处理。若较长时间停留在此阶段，可能被收录规则拦截——届时会在本 issue 说明原因。`,
      })
    }
  }
  return rows.sort((a, b) => a.issue - b.issue)
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', env: process.env })
}

/** Upsert the pinned status comment on one issue. Returns true on success. */
export function upsertStatusComment(repo: string, row: StatusRow, runId: string): boolean {
  const body = `${MARKER}\n**投稿进度**：${row.phaseLabel}\n\n${row.detail}\n\n_状态由目录流水线定期刷新（run ${runId}）_`
  try {
    // --paginate + jq filter finds OUR marker comment across all pages; the
    // first id wins (there should only ever be one)
    const ids = gh(['api', '--paginate', `repos/${repo}/issues/${row.issue}/comments?per_page=100`,
      '--jq', '.[] | select(.body | contains("<!-- submission-status -->")) | .id']).trim().split('\n').filter(Boolean)
    if (ids.length) {
      gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${ids[0]}`, '-f', `body=${body}`])
    } else {
      gh(['api', '-X', 'POST', `repos/${repo}/issues/${row.issue}/comments`, '-f', `body=${body}`])
    }
    return true
  } catch (e) {
    console.error(`status comment failed for issue #${row.issue}:`, e instanceof Error ? e.message : e)
    return false
  }
}

export function main(argv: string[] = process.argv): void {
  const index = CatalogIndex.parse(JSON.parse(readFileSync(argv[2]!, 'utf8')))
  const path = argv[3]!
  const lines = readFileSync(path, 'utf8').split('\n')
  const rows = submissionStatuses(index, lines)
  const repo = process.env.GH_REPO
  const runId = process.env.GITHUB_RUN_ID ?? 'local'
  if (!repo || !process.env.GH_TOKEN) {
    for (const r of rows) console.log(JSON.stringify(r))
    return
  }
  for (const r of rows) upsertStatusComment(repo, r, runId)
}

/* v8 ignore next 3 -- CLI entry guard, only reachable via `node submission-status.ts` */
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
