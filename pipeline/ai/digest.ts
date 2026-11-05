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
import { loadVerdicts, loadDigestState, latestVerdicts, latestHumanVerdicts,
  effectiveVerdict, vkey, akey } from '../verdicts.ts'
import { verifyQueued } from '../verify/plan.ts'
import { unreviewedTargets, candidateHeldAt } from './diagnose.ts'

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
  // announced is bounded by the CURRENT latest verdict per key: a superseded
  // line can never win latestVerdicts again (`at` is monotonic), so its
  // announcement slot is dead weight — pruning it keeps digest-state small
  // instead of growing with every verdict ever written.
  const liveAkeys = new Set([...latestVerdicts(verdicts).values()].map(akey))
  const announced = [...new Set([...prevAnnounced, ...seen])].filter(k => liveAkeys.has(k))
  return { lastDigestAt: anchor, day, dayAnnounced, announced }
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
  // dedupe by akey — a verdict line pushed twice (a retry that appended the
  // same line) must not render two identical rows
  const seenAkey = new Set<string>()
  const fresh: AiVerdict[] = []
  for (const v of verdicts) {
    const k = akey(v)
    if (!todayFirst.has(k) || seenAkey.has(k)) continue
    seenAkey.add(k)
    fresh.push(v)
  }
  const passes = fresh.filter(v => v.verdict === 'pass')
  const concerns = fresh.filter(v => v.verdict === 'concern')

  // verdict lookups shared by the row marks below
  const latest = latestVerdicts(verdicts)
  const latestHuman = latestHumanVerdicts(verdicts)
  const eff = (v: AiVerdict | undefined) => effectiveVerdict(v, latestHuman)
  const inIndex = new Set(index.plugins.map(e => e.name))
  const willAnnounce = (v: AiVerdict) => prevAnnounced.has(akey(v)) || todayFirst.has(akey(v))

  // silently-invisible data: future-dated verdicts can never announce or
  // mature — surface them instead of letting them sit forever (clock skew
  // on a diagnose machine would otherwise look like "nothing to report").
  const future = verdicts.filter(v => v.at > nowIso).length

  // §② held — oldest first (matches diagnose's consumption order), with the
  // hold reason visible: "waiting for AI" and "AI concern → needs human" are
  // different actions and must not read the same. Shares unreviewedTargets'
  // clock: per-VERSION hold age, not entry age.
  const heldAt = (e: PluginEntry) => candidateHeldAt(e) || 0
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

  // review backlog (D-7): the diagnose consumption predicate itself —
  // unreviewedTargets, shared with the watchdog's PENDING count, so the
  // number shown equals what diagnose will actually pick up (includes the
  // 48h verify-wait deferral; a pending-but-unverifiable-for-now entry isn't
  // "review backlog"). A stalled local LLM shows up here long before the
  // 48h watchdog trips.
  const pendingReview = unreviewedTargets(index, latest, null, { now: nowIso })
  const dayAgo = now.getTime() - 86_400_000
  const freshDay = verdicts.filter(v => {
    const t = Date.parse(v.at)
    return Number.isFinite(t) && t > dayAgo && t <= now.getTime()
  }).length
  const oldestReview = pendingReview
    .map(e => candidateHeldAt(e))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map(t => new Date(t).toISOString())[0]

  // §⑥ live-entry trust alarms — identity-level sec:* redFlags on a VISIBLE
  // entry (repojack / name-reuse / version-rollback). §②'s held filter
  // misses them (approved + possibly no hold) and the AI never re-reviews
  // displayed versions — without this surface a repojack alarm would sit
  // silently in the detail view forever. Standing list: an entry stays
  // until a human verdict lands on the displayed key (the docket opens a
  // [review] issue for it, or a manual [concern] brakes it).
  const liveAlarms = index.plugins
    .map(e => ({ e, flags: e.capabilities.redFlags.filter(f => f.startsWith('sec:')) }))
    .filter(x => x.e.approval !== 'pending' && x.flags.length > 0)
    .sort((a, b) => Date.parse(a.e.firstSeenAt) - Date.parse(b.e.firstSeenAt))

  // why is this entry held — the phone reader must see which lever applies:
  // wait for verify, wait for review, or it's already decided and just
  // waiting out the maturity/release gates
  const phaseOf = (e: PluginEntry): string => {
    const ver = e.pendingUpdate?.version ?? (e.approval === 'pending' ? e.latestVersion : null)
    const vf = e.pendingUpdate?.verification ?? e.verification
    const rec = ver ? latest.get(vkey(e.name, ver)) : undefined
    if (rec && eff(rec)?.verdict === 'concern') return '已打标 concern'
    if (rec?.verdict === 'pass') return willAnnounce(rec) ? '已公告·待放行闸' : '已裁决·待日报公告'
    if (vf.status === 'unverified') return '待验证'
    if (vf.status === 'failed') return '验证失败'
    return '待评审'
  }

  // reason text is model/human output rendered into a committed markdown
  // file — escape link syntax so package-metadata-driven text can't inject
  // clickable markup (D-F); '|' for the tables
  const escMd = (s: string) => s.replace(/([\\[\]])/g, '\\$1')
  const escCell = (s: string) => escMd(s).replaceAll('|', '\\|')
  const reasonOf = (v: AiVerdict) => escCell(v.reason ?? '') + (v.reasonEn ? ` / ${escCell(v.reasonEn)}` : '')
  const repo = repoUrl()
  const reviewLink = (v: AiVerdict) => {
    const q = encodeURIComponent(`is:issue in:title "[review] ${v.name.replaceAll('"', '')}"`)
    return `[审核单](${repo}/issues?q=${q})`
  }
  // a pass announced today can already be superseded by a newer concern on
  // the same key (live example: human flip minutes later) — the line still
  // announces, but it will never release; say so instead of implying it will
  const brakeMark = (v: AiVerdict) =>
    v.verdict === 'pass' && eff(latest.get(vkey(v.name, v.version)))?.verdict === 'concern'
      ? ' ⛔已被更新的 concern 刹车' : ''
  const nameCell = (v: AiVerdict) =>
    `${escMd(v.name)}${inIndex.has(v.name) ? '' : ' ⚠️不在目录'}${brakeMark(v)}`
  const rows = (vs: AiVerdict[]) => vs.map(v =>
    `| ${nameCell(v)} | ${v.version ?? '—'} | ${v.source} | ${reasonOf(v)} | ${reviewLink(v)} |`).join('\n')
  const table = (vs: AiVerdict[]) =>
    `| 包 | 版本 | 来源 | 理由 | 审核 |\n|---|---|---|---|---|\n${rows(vs)}`
  const heldLine = (e: PluginEntry) => {
    const ver = e.pendingUpdate ? `v${e.pendingUpdate.version}` : e.latestVersion === null ? '(repo-only — AI 不审，需人工)' : '(未发布过)'
    const reason = e.pendingUpdate?.reason ?? e.approvalReason
    return `- \`${e.name}\` ${ver} · ${phaseOf(e)}${reason ? ` — ${oneLine(escMd(reason))}` : ''}`
  }
  // bounded list — a full backlog dump is unusable on a phone; oldest first
  const HELD_CAP = 50
  const heldList = held.length
    ? held.slice(0, HELD_CAP).map(heldLine).join('\n') +
      (held.length > HELD_CAP ? `\n- …还有 ${held.length - HELD_CAP} 条（最老优先截断；完整清单见 index.json）` : '')
    : '_空_'
  return `# marketplace digest ${day}

> 本日报是**唯一完整的上架预告面**：下列 pass verdict 在本日报发布后进入成熟期（digest-appearance 门）。
> "no findings" ≠ safe.
> 📱 手机操作：点行的「审核单」链接开 issue → **Labels** 勾 \`verdict:pass\` 或 \`verdict:concern\` 即可写回裁决，零打字。
> 行标说明：⛔已被更新的 concern 刹车 = 该行已公告但不会放行；⚠️不在目录 = 该 verdict 针对的条目当前不在 index（已下架或未入库），公告照发但无槽可落。
${future ? `> ⚠️ ${future} 条 verdict 时间戳在未来，本期未计入——检查 verdict 写入端时钟。\n` : ''}
## ① 今日新放行（pass verdicts — ${passes.length}）

${passes.length ? table(passes) : '_无_'}

## ② 审核队列积压（held — ${held.length}）

${heldList}

## ③ Concerns（${concerns.length}）

${concerns.length ? table(concerns) : '_无_'}

## ④ 验证积压（queue — ${queue.length}）

- 待验证 ${queue.length}（投稿优先 ${qSubs}）/ 近 7 天验证失败 ${recentFailed} / 最老等待 ${oldestWait ? oldestWait.slice(0, 10) : '—'}

## ⑤ 评审积压（pending review — ${pendingReview.length}）

- 待评审 ${pendingReview.length}（与 diagnose/watchdog 同口径，含 48h 验证等待递延）/ 近 24h 新判 ${freshDay} / 最老待审 ${oldestReview ? oldestReview.slice(0, 10) : '—'}

## ⑥ 已上架条目信任信号（identity-level sec flags — ${liveAlarms.length}）

${liveAlarms.length
    ? liveAlarms.slice(0, 30).map(x =>
        `- \`${escMd(x.e.name)}\` v${x.e.latestVersion ?? '—'} · ${x.flags.map(escMd).join('; ')} — 需人工裁决：审核单或 [concern] issue 落在展示版即刹车`)
      .join('\n') + (liveAlarms.length > 30 ? `\n- …还有 ${liveAlarms.length - 30} 条（完整清单见 index.json redFlags）` : '')
    : '_无_'}

---
generated ${now.toISOString()}（UTC 计日）
`
}

export async function main(args: string[] = process.argv): Promise<void> {
  const arg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined }
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
