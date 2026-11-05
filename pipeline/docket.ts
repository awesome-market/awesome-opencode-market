/** review-docket — keeps one open [review] issue per pending decision so the
 *  maintainer can rule from a phone: open issue → Labels → tap verdict:pass /
 *  verdict:concern → concern.yml writes the human verdict back.
 *
 *  A target needs a review issue when its LATEST verdict is ai-sourced
 *  (pass awaiting maturity, or concern awaiting possible override). Human
 *  verdicts are decisions already → excluded → issue auto-closes.
 *
 *  Usage: tsx pipeline/docket.ts --index index.json --verdicts ai-verdicts.jsonl
 *    [--dry]        (gh cli + GH_TOKEN env; GH_REPO=owner/repo) */
import { readFileSync } from 'node:fs'
import { exit, env } from 'node:process'
import { execFileSync } from 'node:child_process'
import { CatalogIndex, AiVerdict } from '../src/schema.ts'
import { vkey, latestVerdicts, latestHumanVerdicts, loadVerdicts } from './verdicts.ts'

export interface DocketTarget {
  name: string
  version: string | null
  /** 'none' = repo-only pending — AI never reviews version-less entries, so the
   *  standing review issue is the ONLY human channel for them */
  verdict: 'pass' | 'concern' | 'none'
  reason?: string
  reasonEn?: string
  verification?: string
  /** latest human verdict on this key, when one exists — the issue body must
   *  show a standing human brake (R-4) instead of implying the AI verdict is
   *  the only word on the table */
  humanVerdict?: AiVerdict
}

export const issueTitle = (t: Pick<DocketTarget, 'name' | 'version'>) =>
  `[review] ${t.name}${t.version ? `@${t.version}` : ''}`

/** Pending targets whose latest verdict came from AI — i.e. awaiting human eyes. */
export function docketTargets(index: CatalogIndex, verdicts: AiVerdict[]): DocketTarget[] {
  const latest = latestVerdicts(verdicts)
  const human = latestHumanVerdicts(verdicts)
  const out: DocketTarget[] = []
  for (const e of index.plugins) {
    const ver = e.pendingUpdate ? e.pendingUpdate.version
      : e.approval === 'pending' ? e.latestVersion : null
    if (!ver) {
      // repo-only pending (latestVersion null): unreviewedTargets requires a
      // version, so AI never writes a verdict — without a standing issue the
      // entry sits invisible+pending forever. Keep one open until any verdict
      // (human, by construction) lands on name\0.
      if (e.approval === 'pending' && e.latestVersion === null && !latest.has(vkey(e.name, null))) {
        out.push({
          name: e.name, version: null, verdict: 'none',
          ...(e.verification?.status ? { verification: e.verification.status } : {}),
        })
        continue
      }
      if (e.latestVersion !== null) continue
    }
    const rec = latest.get(vkey(e.name, ver))
    if (rec?.source !== 'ai') continue
    const hv = human.get(vkey(e.name, ver))
    out.push({
      name: e.name, version: ver, verdict: rec.verdict,
      ...(rec.reason ? { reason: rec.reason } : {}),
      ...(rec.reasonEn ? { reasonEn: rec.reasonEn } : {}),
      ...(e.pendingUpdate?.verification?.status ?? e.verification?.status
        ? { verification: e.pendingUpdate?.verification?.status ?? e.verification!.status } : {}),
      ...(hv ? { humanVerdict: hv } : {}),
    })
  }
  return out
}

const gh = (args: string[]) =>
  execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN } })

/** Deterministic body (no timestamps) — the sync loop regenerates it for open
 *  issues and only edits when it actually differs, so verify-status changes
 *  and verdict flips propagate instead of leaving creation-time text stale. */
export function issueBody(t: DocketTarget): string {
  const hv = t.humanVerdict
  const humanLine = hv
    ? `- 最新人工判词：**${hv.verdict}**${hv.reason ? ` — ${hv.reason}` : ''}` +
      (hv.verdict === 'concern' && t.verdict === 'pass'
        ? '（在押刹车——AI 新判 pass 不会自动放行，本单为复审）'
        : '')
    : ''
  return [
    `## 审核单 ${t.name}${t.version ? `@${t.version}` : ''}`, '',
    t.verdict === 'none'
      ? '- 当前 AI 判定：**无**（repo-only 条目无可装 npm 包，AI 不审——只能人工裁决）'
      : `- 当前 AI 判定：**${t.verdict}**${t.reason ? ` — ${t.reason}` : ''}`,
    t.reasonEn ? `  - ${t.reasonEn}` : '',
    humanLine,
    t.verification ? `- 验证状态：${t.verification}` : '- 验证状态：unverified',
    `- 数据：catalog 分支 \`index.json\` / \`ai-verdicts.jsonl\``, '',
    '### 📱 手机裁决（点选，零打字）',
    '本 issue → **Labels** → 勾选其一：',
    '- `verdict:pass` — 人工放行（覆盖 AI concern）',
    '- `verdict:concern` — 人工拦截（锁死该版本）',
    '',
    '打标签后 verdict job 自动写回 `ai-verdicts.jsonl` 并关闭本单。也可评论 `/approve` 或 `/concern 理由`。',
  ].filter(l => l !== '').join('\n')
}

export async function main(
  args: string[] = process.argv,
  ghFn: typeof gh = gh,
): Promise<void> {
  const arg = (k: string) => args[args.indexOf(k) + 1]
  const [idxPath, verdictsPath] = ['--index', '--verdicts'].map(arg)
  const dry = args.includes('--dry')
  const repo = env.GH_REPO
  if (!idxPath || !verdictsPath || !repo)
    exit('usage: --index <p> --verdicts <p> [--dry]   (GH_REPO=owner/repo required)')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  const verdicts = loadVerdicts(verdictsPath)
  const targets = docketTargets(index, verdicts)
  const wanted = new Map(targets.map(t => [issueTitle(t), t]))

  // title-prefix filter, not label filter: an issue whose review:pending
  // label was stripped by hand still converges (K-5)
  const open = (JSON.parse(ghFn(['issue', 'list', '-R', repo,
    '--state', 'open', '--json', 'number,title,labels,body', '--limit', '500'])) as
    { number: number; title: string; labels?: { name: string }[]; body?: string }[])
    .filter(i => i.title.startsWith('[review]'))
  const openByTitle = new Map(open.map(i => [i.title, i]))

  for (const [title, t] of wanted) {
    const body = issueBody(t)
    const ex = openByTitle.get(title)
    if (!ex) {
      console.log(`[docket] create ${title}`)
      if (!dry) {
        ghFn(['issue', 'create', '-R', repo, '--title', title,
          '--label', 'review:pending', ...(t.verdict === 'none' ? [] : ['--label', `ai:${t.verdict}`]), '--body', body])
      }
      continue
    }
    // drift-sync (K-2): the ai:* label and the body must track the CURRENT
    // verdict — a flip (ai:pass → ai:concern, or a verify landing) must not
    // leave creation-time text asking the maintainer to act on stale info
    const curLabels = new Set((ex.labels ?? []).map(l => l.name))
    const curAi = [...curLabels].find(l => l.startsWith('ai:')) ?? null
    const wantAi = t.verdict === 'none' ? null : `ai:${t.verdict}`
    const labelArgs: string[] = []
    if (curAi !== wantAi) {
      if (curAi) labelArgs.push('--remove-label', curAi)
      if (wantAi) labelArgs.push('--add-label', wantAi)
    }
    if (!curLabels.has('review:pending')) labelArgs.push('--add-label', 'review:pending')
    const bodyDrift = ex.body !== undefined && ex.body.trim() !== body.trim()
    if (labelArgs.length || bodyDrift) {
      console.log(`[docket] update #${ex.number} ${title}${curAi !== wantAi ? ` (${curAi ?? 'no-ai-label'} → ${wantAi ?? 'none'})` : ''}${bodyDrift ? ' (body drift)' : ''}`)
      if (!dry) {
        if (labelArgs.length) ghFn(['issue', 'edit', '-R', repo, String(ex.number), ...labelArgs])
        if (bodyDrift) ghFn(['issue', 'edit', '-R', repo, String(ex.number), '--body', body])
      }
    }
  }

  for (const i of open) {
    if (wanted.has(i.title)) continue
    console.log(`[docket] close #${i.number} ${i.title} (已决议/已放行)`)
    if (!dry) {
      ghFn(['issue', 'comment', '-R', repo, String(i.number),
        '--body', '该版本的审核单已自动关闭：verdict 已决议或版本已放行（见 catalog 分支 ai-verdicts.jsonl）。'])
      ghFn(['issue', 'close', '-R', repo, String(i.number)])
    }
  }
  console.log(`[docket] ${wanted.size} open-decision targets, ${open.length} review issues open`)
}

/* v8 ignore next 4 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(x => { console.error(x); exit(1) })
}
