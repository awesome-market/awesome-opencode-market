/** Submission progress visibility: for every submission issue that still has a
 *  live seed, keep ONE pinned status comment on the issue showing where the
 *  submission is in the pipeline. Edited in place each catalog run — authors
 *  no longer have to guess from scattered bot comments.
 *
 *  Usage: GH_TOKEN=… GH_REPO=owner/repo npx tsx pipeline/submission-status.ts <index.json> <submissions.txt> [verdicts.jsonl]
 *  Without GH_TOKEN/GH_REPO it only prints the computed rows (dry run / tests).
 *
 *  Phases (author-facing, plain language — AGENTS.md):
 *    queued   — seed ingested, no catalog entry yet (waiting for the next run)
 *    review   — entry exists but approval=pending (awaiting AI/human verdict
 *               and digest maturity); an AI concern on the target annotates
 *               the detail (flagged, awaiting maintainer confirmation)
 *    blocked  — a HUMAN concern verdict covers the submitted package (slot
 *               or package-level brake): the issue is told the submission is
 *               stopped + how to appeal, instead of showing "评审中" for
 *               weeks while a decided brake stands
 *    rejected — the admission gate refused the package; the detail says why
 *               and what to do next (run.ts → seed-outcome.ts stamps the code)
 *  Terminal seeds (notified/dead) and issues without seeds are skipped — the
 *  review report / notify / dead-close comments already cover them. A landed
 *  seed is always notified by the same run, so no 'published' phase exists
 *  here — the notify comment IS the published signal. */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CatalogIndex, type AiVerdict, type PluginEntry } from '../src/schema.ts'
import { latestVerdicts, latestHumanVerdicts, effectiveVerdict, vkey, atCmp, loadVerdicts } from './verdicts.ts'

export interface StatusRow {
  issue: number
  key: string
  phase: 'queued' | 'review' | 'blocked' | 'rejected'
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
  'repo-fetch-error': 'GitHub 暂时不可达（网络错误或限流），收录端没能取到仓库信息——下一轮目录构建会自动重试，无需操作。',
  'no-opencode-evidence': '仓库缺少 opencode 专属信号（`.opencode/` 目录、`opencode.json` 或 `opencode-*` topic）。补齐后回复本 issue 重新审查。',
  'invalid-repo': '仓库地址格式不正确——需要 `owner/repo` 形式（如 `alice/my-plugin`）。修正后回复本 issue 重新审查。',
}

/** One-line bounded reason for the status comment — reviewer text rendered
 *  into an issue the SUBMITTER reads; keep it single-line and short. */
const clip = (s: string, max = 200) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** Which verdict currently governs the submitted package — mirrors
 *  applyMatureVerdicts' verdictFor (package brake overrides a slot unless a
 *  NEWER human pass exists on that exact slot key). Returns the winning
 *  concern verdict, or null when nothing blocks the package. */
export function concernOn(
  name: string, version: string | null,
  latest: Map<string, AiVerdict>, human: Map<string, AiVerdict>,
): AiVerdict | null {
  const brakeH = version === null ? undefined : human.get(vkey(name, null))
  const brake = brakeH?.verdict === 'concern' ? brakeH : undefined
  let v = effectiveVerdict(latest.get(vkey(name, version)), human)
  if (brake) {
    const slotHuman = human.get(vkey(name, version))
    if (!(slotHuman?.verdict === 'pass' && atCmp(slotHuman.at, brake.at) > 0)) v = brake
  }
  return v?.verdict === 'concern' ? v : null
}

/** Candidate version a verdict would land on for this entry — same rule as
 *  docketTargets/unreviewedTargets (held slot, else pending display slot). */
const candidateOf = (e: PluginEntry): string | null =>
  e.pendingUpdate ? e.pendingUpdate.version : e.approval === 'pending' ? e.latestVersion : null

export function submissionStatuses(
  index: CatalogIndex,
  lines: string[],
  verdicts: AiVerdict[] = [],
): StatusRow[] {
  // name keys are canonical lowercase — legacy seed rows can carry typed
  // casing ('My-Pkg') while catalog entries always land lowercase; verdict
  // keys likewise lowercase (run.ts/diagnose write lowercase names)
  const byName = new Map(index.plugins.map(e => [e.name.toLowerCase(), e]))
  const latest = latestVerdicts(verdicts)
  const human = latestHumanVerdicts(verdicts)
  // one row per issue — the newest seed line wins (same-issue replace keeps
  // this true going forward; last-match also covers legacy duplicate rows)
  const perIssue = new Map<number, { key: string; name?: string; repo?: string; rejected?: string; version?: string }>()
  for (const l of lines) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; dead?: boolean; rejected?: string; version?: string }
      if (!s.issue || s.notified || s.dead) continue
      const key = s.name ?? s.repo
      if (!key) continue
      perIssue.set(s.issue, {
        key,
        ...(s.name ? { name: s.name } : {}),
        ...(s.repo ? { repo: s.repo } : {}),
        ...(s.rejected ? { rejected: s.rejected } : {}),
        ...(s.version ? { version: s.version } : {}),
      })
    } catch { /* skip unreadable */ }
  }
  const rows: StatusRow[] = []
  for (const [issue, s] of perIssue) {
    // name first, repo fallback — a name+repo seed whose npm side never
    // landed can still resolve to a github-kind entry via source.repo
    const e = (s.name ? byName.get(s.name.toLowerCase()) : undefined)
      ?? (s.repo ? index.plugins.find(p =>
          p.source.repo?.toLowerCase() === s.repo!.toLowerCase() ||
          p.name.toLowerCase() === s.repo!.toLowerCase())
        : undefined)
    if (e && e.approval !== 'pending') {
      continue   // landed — markNotified in the same run already notified+closed
    }
    // a concern verdict can land through ANY channel (submit verdict job,
    // [concern] form, [review] labels) — the seed's issue should say the
    // submission is stopped rather than read "评审中" while a decided brake
    // stands. For queued seeds the ghost keys (name@null brake / reviewed
    // version) are checked too — the brake applies the moment the entry lands.
    const name = (s.name ?? s.repo)?.toLowerCase()
    const ver = e ? candidateOf(e) : (s.repo ? null : (s.version ?? null))
    const c = name ? concernOn(name, ver, latest, human) : null
    if (c?.source === 'human') {
      rows.push({
        issue, key: s.key, phase: 'blocked',
        phaseLabel: '已被拦截',
        detail: `**${s.key}** 被 maintainer 标记为 concern——该版本不会上架。${c.reason ? `理由：${clip(c.reason)}。` : ''}如认为是误判或已修复，请在本 issue 说明，maintainer 会复核。`,
      })
    } else if (e) {
      rows.push({
        issue, key: s.key, phase: 'review',
        phaseLabel: '评审中',
        detail: `**${s.key}** 已进入目录收录流程，当前处于待审状态——${c ? `评审已标记 concern（${c.reason ? clip(c.reason) : '未附理由'}），等待 maintainer 复核；如认为误判可在本 issue 说明。` : '等待评审结论与公示期。通过后自动上架，本 issue 会收到通知。'}`,
      })
    } else if (s.rejected) {
      rows.push({
        issue, key: s.key, phase: 'rejected',
        phaseLabel: '未通过收录规则',
        detail: `**${s.key}** 未通过目录收录规则：${REJECT_REASONS[s.rejected] ?? `原因代码 \`${s.rejected}\`——修复后回复本 issue 重新审查。`}`,
      })
    } else {
      rows.push({
        issue, key: s.key, phase: c ? 'review' : 'queued',
        phaseLabel: c ? '评审中' : '排队中',
        detail: c
          ? `**${s.key}** 已通过机器初审并进入收录队列，但评审已标记 concern（${c.reason ? clip(c.reason) : '未附理由'}）——如维持拦截则不会上架；如认为误判可在本 issue 说明。`
          : `**${s.key}** 已通过机器初审并进入收录队列，等待下一次目录构建处理。若较长时间停留在此阶段，可能被收录规则拦截——届时会在本 issue 说明原因。`,
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
    // phase labels stay honest on the issue itself: 'submission:rejected' is
    // the catalog-side verdict (no review label exists for it). It also
    // re-arms the comment re-review gate — the 'approved' label would
    // otherwise silently drop the "回复本 issue 重新审查" path REJECT_REASONS
    // promises. Best-effort: the comment already carries the truth.
    try {
      if (row.phase === 'rejected') {
        gh(['issue', 'edit', String(row.issue), '-R', repo, '--add-label', 'submission:rejected'])
        gh(['issue', 'edit', String(row.issue), '-R', repo, '--remove-label', 'submission:approved'])
      } else {
        gh(['issue', 'edit', String(row.issue), '-R', repo, '--remove-label', 'submission:rejected'])
      }
    } catch { /* label drift self-heals on the next run */ }
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
  const rows = submissionStatuses(index, lines, argv[4] ? loadVerdicts(argv[4]) : [])
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
