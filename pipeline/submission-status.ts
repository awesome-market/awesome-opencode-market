/** Submission progress visibility: for every submission issue that still has a
 *  live seed, keep ONE pinned status comment on the issue showing where the
 *  submission is in the pipeline. Edited in place each catalog run — authors
 *  no longer have to guess from scattered bot comments.
 *
 *  Usage: GH_TOKEN=… GH_REPO=owner/repo npx tsx pipeline/submission-status.ts <index.json> <submissions.txt> [verdicts.jsonl]
 *  Without GH_TOKEN/GH_REPO it only prints the computed rows (dry run / tests).
 *
 *  Phases (author-facing, plain language — AGENTS.md):
 *    queued   — seed ingested, no catalog entry yet (waiting for the next run,
 *               or silently filtered by an admission gate)
 *    review   — entry exists but approval=pending (awaiting AI/human verdict
 *               and digest maturity); an AI concern on the target annotates
 *               the detail (flagged, awaiting maintainer confirmation)
 *    blocked  — a HUMAN concern verdict covers the submitted package (slot
 *               or package-level brake): the issue is told the submission is
 *               stopped + how to appeal, instead of showing "评审中" for
 *               weeks while a decided brake stands
 *    published— visible in the catalog (issue is being closed by notify)
 *  Terminal seeds (notified/dead) and issues without seeds are skipped — the
 *  review report / notify / dead-close comments already cover them. */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CatalogIndex, type AiVerdict, type PluginEntry } from '../src/schema.ts'
import { latestVerdicts, latestHumanVerdicts, effectiveVerdict, vkey, atCmp, loadVerdicts } from './verdicts.ts'

export interface StatusRow {
  issue: number
  key: string
  phase: 'queued' | 'review' | 'blocked' | 'published'
  phaseLabel: string
  detail: string
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

const MARKER = '<!-- submission-status -->'

export function submissionStatuses(
  index: CatalogIndex,
  lines: string[],
  verdicts: AiVerdict[] = [],
): StatusRow[] {
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  const latest = latestVerdicts(verdicts)
  const human = latestHumanVerdicts(verdicts)
  // one row per issue — the newest seed line wins (same-issue replace keeps
  // this true going forward; last-match also covers legacy duplicate rows)
  const perIssue = new Map<number, { key: string; name?: string; repo?: string; version?: string }>()
  for (const l of lines) {
    const t = l.trim()
    if (!t.startsWith('{')) continue
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; dead?: boolean; version?: string }
      if (!s.issue || s.notified || s.dead) continue
      const key = s.name ?? s.repo
      if (!key) continue
      perIssue.set(s.issue, { key, ...(s.name ? { name: s.name } : {}), ...(s.repo ? { repo: s.repo } : {}), ...(s.version ? { version: s.version } : {}) })
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
      continue
    }
    // a concern verdict can land through ANY channel (submit verdict job,
    // [concern] form, [review] labels) — the seed's issue should say the
    // submission is stopped rather than read "评审中" while a decided brake
    // stands. For queued seeds the ghost keys (name@null brake / reviewed
    // version) are checked too — the brake applies the moment the entry lands.
    const name = s.name ?? s.repo
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
