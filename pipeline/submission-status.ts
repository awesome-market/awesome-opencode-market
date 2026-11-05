/** Submission progress visibility: for every submission issue that still has a
 *  live seed, keep ONE pinned status comment on the issue showing where the
 *  submission is in the pipeline. Edited in place each catalog run — authors
 *  no longer have to guess from scattered bot comments.
 *
 *  Usage: GH_TOKEN=… GH_REPO=owner/repo npx tsx pipeline/submission-status.ts <index.json> <submissions.txt>
 *  Without GH_TOKEN/GH_REPO it only prints the computed rows (dry run / tests).
 *
 *  Phases (author-facing, plain language — AGENTS.md):
 *    queued   — seed ingested, no catalog entry yet (waiting for the next run)
 *    review   — entry exists but approval=pending (awaiting AI/human verdict
 *               and digest maturity)
 *    rejected — the admission gate refused the package; the detail says why
 *               and what to do next (run.ts → seed-outcome.ts stamps the code)
 *  Terminal seeds (notified/dead) and issues without seeds are skipped — the
 *  review report / notify / dead-close comments already cover them. A landed
 *  seed is always notified by the same run, so no 'published' phase exists
 *  here — the notify comment IS the published signal. */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CatalogIndex } from '../src/schema.ts'

export interface StatusRow {
  issue: number
  key: string
  phase: 'queued' | 'review' | 'rejected'
  phaseLabel: string
  detail: string
}

const MARKER = '<!-- submission-status -->'

/** run.ts seed-outcome codes → 发生了啥→为啥→咋办 (AGENTS.md error contract) */
export const REJECT_REASONS: Record<string, string> = {
  'pkg-not-found': 'npm 上找不到这个包——包名可能拼写有误，或包尚未发布/已被下架。确认包名后回复本 issue 即可重新审查。',
  'fetch-error': 'npm registry 暂时不可用，收录端没能取到包信息——下一轮目录构建会自动重试，无需操作。',
  'no-plugin-evidence': '包内缺少 opencode 插件信号（keywords、main 入口或 README 安装说明都未命中收录规则）。修好 package.json 后回复本 issue 重新审查。',
  'blocklisted': '该包在收录黑名单中，目录不会收录。如认为误封请联系 maintainer。',
  'template-spam': '同一 owner 下的投稿批量模板痕迹过重，被反垃圾规则拦截。如为误伤请联系 maintainer。',
  'archived-or-fork': '仓库已归档或为 fork——目录只收录仍在维护的主仓库。',
  'archived': '仓库已归档——目录只收录仍在维护的仓库。',
  'repo-not-found': 'GitHub 仓库不存在或不可访问（404）。确认仓库地址后回复本 issue 重新审查。',
  'no-opencode-evidence': '仓库缺少 opencode 专属信号（`.opencode/` 目录、`opencode.json` 或 `opencode-*` topic）。补齐后回复本 issue 重新审查。',
}

export function submissionStatuses(
  index: CatalogIndex,
  lines: string[],
): StatusRow[] {
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  // one row per issue — the newest seed line wins (same-issue replace keeps
  // this true going forward; last-match also covers legacy duplicate rows)
  const perIssue = new Map<number, { key: string; name?: string; repo?: string; rejected?: string }>()
  for (const l of lines) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; dead?: boolean; rejected?: string }
      if (!s.issue || s.notified || s.dead) continue
      const key = s.name ?? s.repo
      if (!key) continue
      perIssue.set(s.issue, {
        key,
        ...(s.name ? { name: s.name } : {}),
        ...(s.repo ? { repo: s.repo } : {}),
        ...(s.rejected ? { rejected: s.rejected } : {}),
      })
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
      continue   // landed — markNotified in the same run already notified+closed
    } else if (e) {
      rows.push({
        issue, key: s.key, phase: 'review',
        phaseLabel: '评审中',
        detail: `**${s.key}** 已进入目录收录流程，当前处于待审状态——等待评审结论与公示期。通过后自动上架，本 issue 会收到通知。`,
      })
    } else if (s.rejected) {
      rows.push({
        issue, key: s.key, phase: 'rejected',
        phaseLabel: '未通过收录规则',
        detail: `**${s.key}** 未通过目录收录规则：${REJECT_REASONS[s.rejected] ?? `原因代码 \`${s.rejected}\`——修复后回复本 issue 重新审查。`}`,
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
