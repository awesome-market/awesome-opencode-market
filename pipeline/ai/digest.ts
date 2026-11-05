/** publish-digest — daily advance-notice surface + digest-state.json.
 *
 *  The digest is the ONLY complete announcement surface: every pass verdict
 *  (ai AND human) must appear in a digest before it can mature — membership
 *  in DigestState.announced, NOT at ≤ lastDigestAt. A verdict pushed to the
 *  branch after a render but carrying an older `at` cannot mature unseen;
 *  it surfaces in the NEXT digest as newly-seen. Missing digest-state →
 *  announced = ∅ → all releases frozen (fail-closed bootstrap).
 *
 *  "Seen" is set-based, not time-based: a verdict counts once its line was
 *  in ai-verdicts.jsonl at render time with at ≤ now. Same-day re-renders
 *  stay cumulative via dayAnnounced, so a second run cannot erase the day's
 *  earlier announcements from the file.
 *
 *  Usage:
 *    tsx pipeline/ai/digest.ts --index index.json --verdicts ai-verdicts.jsonl \
 *      --state digest-state.json --out-dir . [--date YYYY-MM-DD] [--dry] */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { exit } from 'node:process'
import { join } from 'node:path'
import { CatalogIndex, AiVerdict, DigestState, type PluginEntry } from '../../src/schema.ts'
import { loadVerdicts, loadDigestState, latestVerdicts, vkey, akey } from '../verdicts.ts'
import { verifyQueued } from '../verify/plan.ts'

export interface DigestInput {
  index: CatalogIndex
  verdicts: AiVerdict[]
  /** previous digest-state.json (null = bootstrap: everything announces) */
  prev: DigestState | null
  now: Date
}

/** State transition for one render — kept separate from markdown so the
 *  maturity semantics are unit-testable without string matching. */
export function nextDigestState(verdicts: AiVerdict[], prev: DigestState | null, now: Date): DigestState {
  const day = now.toISOString().slice(0, 10)
  const nowIso = now.toISOString()
  const seen = new Set(verdicts.filter(v => v.at <= nowIso).map(akey))
  const prevAnnounced = new Set(prev?.announced ?? [])
  const firstSeen = [...seen].filter(k => !prevAnnounced.has(k))
  const dayAnnounced = [...new Set([...(prev?.day === day ? prev.dayAnnounced : []), ...firstSeen])]
  // Maturity anchor stays monotonic: max `at` over verdicts this render saw.
  const anchor = verdicts.reduce((m, v) => (v.at <= nowIso && v.at > m ? v.at : m), prev?.lastDigestAt ?? '') || nowIso
  return { lastDigestAt: anchor, day, dayAnnounced, announced: [...new Set([...prevAnnounced, ...seen])] }
}

/** Self-adapting review-link base (F7): env override, else the repo's own
 *  origin remote — a rename/transfer must not stale the phone workflow. */
function repoUrl(): string {
  const env = process.env.MARKET_REPO_URL
  if (env) return env.replace(/\/$/, '')
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim()
    return url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '')
  } catch {
    return 'https://github.com/terry2010/awesome-opencode-market'
  }
}

export function renderDigest({ index, verdicts, prev, now }: DigestInput): string {
  const day = now.toISOString().slice(0, 10)
  const nowIso = now.toISOString()

  // §①/§③ display set = verdict lines first announced TODAY: yesterday's
  // dayAnnounced (same-day cumulative) + lines never announced before.
  const prevAnnounced = new Set(prev?.announced ?? [])
  const todayFirst = new Set(prev?.day === day ? prev.dayAnnounced : [])
  for (const v of verdicts) {
    if (v.at <= nowIso && !prevAnnounced.has(akey(v))) todayFirst.add(akey(v))
  }
  const fresh = verdicts.filter(v => todayFirst.has(akey(v)))
  const passes = fresh.filter(v => v.verdict === 'pass')
  const concerns = fresh.filter(v => v.verdict === 'concern')

  // silently-invisible data: future-dated verdicts can never announce or
  // mature — surface them instead of letting them sit forever (clock skew
  // on a diagnose machine would otherwise look like "nothing to report").
  const future = verdicts.filter(v => v.at > nowIso).length

  // §② held — oldest first (matches diagnose's consumption order), with the
  // hold reason visible: "waiting for AI" and "AI concern → needs human" are
  // different actions and must not read the same.
  const heldAt = (e: PluginEntry) => Date.parse(e.pendingUpdate?.heldAt ?? e.firstSeenAt ?? '') || 0
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
  const held = index.plugins
    .filter(e => e.approval === 'pending' || e.pendingUpdate)
    .sort((a, b) => heldAt(a) - heldAt(b))

  // verify backlog (V-2): shares planTargets' queue predicate — the 96/day
  // drain shows the real number, retryable failures included.
  const queue = index.plugins.filter(e => verifyQueued(e, now))
  const qSubs = queue.filter(e => e.discoveredVia?.includes('submission')).length
  const weekAgo = now.getTime() - 7 * 86_400_000
  const verOf = (e: PluginEntry) => (e.pendingUpdate ? e.pendingUpdate.verification : e.verification)
  const recentFailed = index.plugins.filter(e => {
    const v = verOf(e)
    return v.status === 'failed' && Number.isFinite(Date.parse(v.verifiedAt ?? '')) && Date.parse(v.verifiedAt!) >= weekAgo
  }).length
  const oldestWait = queue
    .map(e => e.pendingUpdate?.heldAt ?? e.firstSeenAt)
    .filter((d): d is string => Number.isFinite(Date.parse(d ?? '')))
    .sort()[0]

  // review backlog (D-7): held versions with NO verdict yet — the diagnose
  // queue made visible. A stalled local LLM shows up here long before the
  // 48h watchdog trips. Mirrors unreviewedTargets' version predicate.
  const latest = latestVerdicts(verdicts)
  const pendingReview = index.plugins.filter(e => {
    const ver = e.pendingUpdate?.version ?? (e.approval === 'pending' ? e.latestVersion : null)
    return !!ver && !latest.has(vkey(e.name, ver))
  })
  const dayAgo = now.getTime() - 86_400_000
  const freshDay = verdicts.filter(v => {
    const t = Date.parse(v.at)
    return Number.isFinite(t) && t > dayAgo && t <= now.getTime()
  }).length
  const oldestReview = pendingReview
    .map(e => e.pendingUpdate?.heldAt ?? e.firstSeenAt)
    .filter((d): d is string => Number.isFinite(Date.parse(d ?? '')))
    .sort()[0]

  const escCell = (s: string) => s.replaceAll('|', '\\|')
  const reasonOf = (v: AiVerdict) => escCell(v.reason ?? '') + (v.reasonEn ? ` / ${escCell(v.reasonEn)}` : '')
  const repo = repoUrl()
  const reviewLink = (v: AiVerdict) => {
    const q = encodeURIComponent(`is:issue in:title "[review] ${v.name.replaceAll('"', '')}"`)
    return `[审核单](${repo}/issues?q=${q})`
  }
  const rows = (vs: AiVerdict[]) => vs.map(v =>
    `| ${v.name} | ${v.version ?? '—'} | ${v.source} | ${reasonOf(v)} | ${reviewLink(v)} |`).join('\n')
  const table = (vs: AiVerdict[]) =>
    `| 包 | 版本 | 来源 | 理由 | 审核 |\n|---|---|---|---|---|\n${rows(vs)}`
  const heldLine = (e: PluginEntry) => {
    const ver = e.pendingUpdate ? `v${e.pendingUpdate.version}` : e.latestVersion === null ? '(repo-only — AI 不审，需人工)' : '(未发布过)'
    const reason = e.pendingUpdate?.reason ?? e.approvalReason
    return `- \`${e.name}\` ${ver}${reason ? ` — ${oneLine(reason)}` : ''}`
  }
  return `# marketplace digest ${day}

> 本日报是**唯一完整的上架预告面**：下列 pass verdict 在本日报发布后进入成熟期（digest-appearance 门）。
> "no findings" ≠ safe.
> 📱 手机操作：点行的「审核单」链接开 issue → **Labels** 勾 \`verdict:pass\` 或 \`verdict:concern\` 即可写回裁决，零打字。
${future ? `> ⚠️ ${future} 条 verdict 时间戳在未来，本期未计入——检查 verdict 写入端时钟。\n` : ''}
## ① 今日新放行（pass verdicts — ${passes.length}）

${passes.length ? table(passes) : '_无_'}

## ② 审核队列积压（held — ${held.length}）

${held.length ? held.map(heldLine).join('\n') : '_空_'}

## ③ Concerns（${concerns.length}）

${concerns.length ? table(concerns) : '_无_'}

## ④ 验证积压（queue — ${queue.length}）

- 待验证 ${queue.length}（投稿优先 ${qSubs}）/ 近 7 天验证失败 ${recentFailed} / 最老等待 ${oldestWait ? oldestWait.slice(0, 10) : '—'}

## ⑤ 评审积压（pending review — ${pendingReview.length}）

- 待评审 ${pendingReview.length} / 近 24h 新判 ${freshDay} / 最老待审 ${oldestReview ? oldestReview.slice(0, 10) : '—'}

---
generated ${now.toISOString()}（UTC 计日）
`
}

export async function main(args: string[] = process.argv): Promise<void> {
  const arg = (k: string) => args[args.indexOf(k) + 1]
  const [idxPath, verdictsPath, statePath, outDir] = ['--index', '--verdicts', '--state', '--out-dir'].map(arg)
  const dry = args.includes('--dry')
  const now = args.includes('--date') ? new Date(`${arg('--date')}T21:00:00Z`) : new Date()
  if (!idxPath || !verdictsPath || !statePath || !outDir)
    exit('usage: --index <p> --verdicts <p> --state <p> --out-dir <d> [--date YYYY-MM-DD] [--dry]')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  // tolerant parse — one malformed line must not kill the whole daily digest
  // (the digest is the maturity anchor; a crash freezes every pass verdict)
  const verdicts = loadVerdicts(verdictsPath)
  const prev = loadDigestState(statePath)

  const md = renderDigest({ index, verdicts, prev, now })
  const day = now.toISOString().slice(0, 10)
  const digestPath = join(outDir, 'digest', `${day}.md`)
  const next = nextDigestState(verdicts, prev, now)
  if (dry) {
    console.log(md)
    console.log(`[digest] lastDigestAt ${prev?.lastDigestAt ?? '∅'} → ${next.lastDigestAt}; announced ${prev?.announced.length ?? 0} → ${next.announced.length}`)
    return
  }
  mkdirSync(join(outDir, 'digest'), { recursive: true })
  writeFileSync(digestPath, md)
  writeFileSync(statePath, JSON.stringify(next, null, 2))
  console.log(`[digest] wrote ${digestPath}; lastDigestAt=${next.lastDigestAt}; announced=${next.announced.length}`)
}

/* v8 ignore next 4 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(x => { console.error(x); exit(1) })
}
