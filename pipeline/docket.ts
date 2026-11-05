/** review-docket — keeps one open [review] issue per pending decision so the
 *  maintainer can rule from a phone: open issue → Labels → tap verdict:pass /
 *  verdict:concern → concern.yml writes the human verdict back.
 *
 *  Targets (four kinds):
 *    - held version whose LATEST verdict is ai-sourced — pass awaiting the
 *      announce+release window, or concern awaiting possible override.
 *      `maturity` (from digest-state.announced) tells the maintainer which
 *      gate the pass is sitting at (D-W)
 *    - 'flag': a LIVE (non-pending) entry whose displayed slot carries
 *      identity-level sec:* redFlags — AI never re-reviews a displayed
 *      version, so the standing issue is the only surface; any human verdict
 *      on the displayed key retires it (R-14)
 *    - 'none' repo-only pendings — AI never reviews version-less entries
 *    - 'none' versioned holds that out-aged the diagnose queue — review
 *      backlog or a stalled launchd; surfaced instead of staying invisible
 *
 *  Human verdicts are decisions already → excluded → issue auto-closes.
 *
 *  Usage: tsx pipeline/docket.ts --index index.json --verdicts ai-verdicts.jsonl
 *    [--digest-state digest-state.json] [--dry]
 *    (gh cli + GH_TOKEN env; GH_REPO=owner/repo) */
import { appendFileSync, readFileSync } from 'node:fs'
import { exit, env } from 'node:process'
import { execFileSync } from 'node:child_process'
import { CatalogIndex, AiVerdict, DigestState } from '../src/schema.ts'
import { vkey, akey, latestVerdicts, latestHumanVerdicts, loadVerdicts, loadDigestState } from './verdicts.ts'
import { titleTarget } from './human-verdict.ts'

export interface DocketTarget {
  name: string
  version: string | null
  /** 'flag' = identity-level sec redFlags on the displayed slot of a live
   *  entry (the only review surface for repojack-class signals);
   *  'none' = no verdict yet — repo-only pending or a hold that out-aged
   *  the diagnose queue */
  verdict: 'pass' | 'concern' | 'none' | 'flag'
  reason?: string
  reasonEn?: string
  verification?: string
  /** latest human verdict on this key, when one exists — the issue body must
   *  show a standing human brake (R-4) instead of implying the AI verdict is
   *  the only word on the table */
  humanVerdict?: AiVerdict
  /** digest-announce phase for ai verdicts — '已裁决·待日报公告' vs
   *  '已公告·待放行闸' so the maintainer sees WHY a pass isn't live yet */
  maturity?: 'announced' | 'pending-announce'
  /** evidence surface for the phone decision — detail-page link, scan
   *  counters, hold age, publish date */
  slug?: string
  findings?: number
  redFlags?: number
  /** the slot was never scanned — same human-only posture as red flags */
  unscanned?: boolean
  heldAt?: string
  publishedAt?: string | undefined
  /** aggregate repo-only backlog — a per-entry standing issue per
   *  version-less pending floods the tracker (400+ rows and growing); the
   *  aggregate carries the queue in ONE issue whose body regenerates */
  backlog?: { name: string; heldAt?: string; unscanned?: boolean }[]
}

/** Reserved name for the aggregate repo-only standing issue — parentheses
 *  can't collide with npm names or owner/repo ids. */
export const REPO_BACKLOG = '(repo-only backlog)'

export const issueTitle = (t: Pick<DocketTarget, 'name' | 'version'>) =>
  `[review] ${t.name}${t.version ? `@${t.version}` : ''}`

/** How long a versioned hold may sit verdict-less before it gets a standing
 *  issue — aligned with diagnose's 48h degraded-review window so entries the
 *  AI queue merely defers don't immediately spam the human one. */
export const NO_VERDICT_AGE_MS = 48 * 3600e3

/** Pending targets that need a human surface: latest verdict came from AI,
 *  a live entry carries identity sec flags, or no verdict exists past the
 *  age threshold. */
export function docketTargets(
  index: CatalogIndex,
  verdicts: AiVerdict[],
  digest?: DigestState | null,
  opts: { now?: string } = {},
): DocketTarget[] {
  const now = Date.parse(opts.now ?? new Date().toISOString())
  const latest = latestVerdicts(verdicts)
  const human = latestHumanVerdicts(verdicts)
  const announced = new Set(digest?.announced ?? [])
  const out: DocketTarget[] = []
  const repoOnly: NonNullable<DocketTarget['backlog']> = []
  for (const e of index.plugins) {
    // slot = what the issue is about: the pendingUpdate when held, else the
    // entry itself. heldAt/publishedAt follow the candidate, not the entry.
    const slot = e.pendingUpdate ?? e
    const held = e.pendingUpdate ? e.pendingUpdate.heldAt : e.firstSeenAt
    const meta = {
      findings: slot.capabilities.findings.length,
      redFlags: slot.capabilities.redFlags.length,
      // 没扫到 ≠ 安全: a null scannedAt means the scanner never ran — the
      // reviewer must decide blind, same human-only posture as red flags
      ...(slot.capabilities.scannedAt === null ? { unscanned: true } : {}),
      verification: slot.verification.status,
      ...(e.slug ? { slug: e.slug } : {}),
      ...(held ? { heldAt: held } : {}),
      ...(slot.publishedAt ? { publishedAt: slot.publishedAt } : {}),
    }
    // flag target: identity-level sec:* redFlags on the DISPLAYED slot of a
    // live entry. Held entries already have a review channel (the held
    // version); a displayed version never gets one — the AI doesn't re-review
    // it and the held filter doesn't see it. Any human verdict on the
    // displayed key retires the flag (it's a decision by definition).
    if (e.approval !== 'pending') {
      const flags = e.capabilities.redFlags.filter(f => f.startsWith('sec:'))
      if (flags.length && !human.has(vkey(e.name, e.latestVersion))) {
        out.push({
          name: e.name, version: e.latestVersion, verdict: 'flag',
          reason: flags.join(' '),
          verification: e.verification.status,
          findings: e.capabilities.findings.length,
          redFlags: e.capabilities.redFlags.length,
          ...(e.slug ? { slug: e.slug } : {}),
          ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
        })
      }
    }
    const ver = e.pendingUpdate ? e.pendingUpdate.version
      : e.approval === 'pending' ? e.latestVersion : null
    if (!ver) {
      // repo-only pending (latestVersion null): unreviewedTargets requires a
      // version, so AI never writes a verdict — without a surface the entry
      // sits invisible+pending forever. A PER-ENTRY issue was the old design;
      // at real scale (500+ repo-only pendings) that is tracker spam the
      // maintainer can't act on anyway — aggregate into ONE standing issue
      // whose body lists the queue; entries drop out as human verdicts land.
      if (e.approval === 'pending' && e.latestVersion === null && !latest.has(vkey(e.name, null))) {
        repoOnly.push({ name: e.name, ...(held ? { heldAt: held } : {}), ...(meta.unscanned ? { unscanned: true } : {}) })
      }
      continue
    }
    const rec = latest.get(vkey(e.name, ver))
    if (!rec) {
      // no verdict AT ALL on a held version: the diagnose queue is behind or
      // dead (launchd pause). Young holds stay AI's job; aged ones get the
      // same standing-issue channel as repo-only so they can't go invisible.
      const held = Date.parse(e.pendingUpdate?.heldAt ?? e.firstSeenAt)
      if (Number.isFinite(held) && now - held >= NO_VERDICT_AGE_MS) {
        out.push({ name: e.name, version: ver, verdict: 'none', ...meta })
      }
      continue
    }
    if (rec.source !== 'ai') continue
    const hv = human.get(vkey(e.name, ver))
    out.push({
      name: e.name, version: ver, verdict: rec.verdict,
      ...(rec.reason ? { reason: rec.reason } : {}),
      ...(rec.reasonEn ? { reasonEn: rec.reasonEn } : {}),
      ...(hv ? { humanVerdict: hv } : {}),
      maturity: announced.has(akey(rec)) ? 'announced' : 'pending-announce',
      ...meta,
    })
  }
  // Creation order = severity so the freshest issues on the phone are the
  // ones needing real action: pass (veto window) → none (waiting) →
  // concern (blocked, decide) → flag (live entry, identity signal). Ties:
  // oldest-held first, matching diagnose FIFO.
  if (repoOnly.length) {
    repoOnly.sort((a, b) => Date.parse(a.heldAt ?? '') - Date.parse(b.heldAt ?? ''))
    out.push({ name: REPO_BACKLOG, version: null, verdict: 'none', backlog: repoOnly })
  }
  const rank = { pass: 0, none: 1, concern: 2, flag: 3 } as const
  const heldKey = (t: DocketTarget) => Date.parse(t.heldAt ?? '') || 0
  out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || heldKey(a) - heldKey(b))
  return out
}

/* v8 ignore next 8 -- the real gh CLI is never invoked under unit tests */
const gh = (args: string[]) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    // `issue list --json body` × a full queue is multi-MB — the 1MB default
    // would crash the sync permanently once the backlog outgrows it
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN },
  })

export interface IssueBodyOpts {
  repo?: string | null
  pagesBase?: string | null
  /** a decision label (verdict:pass/concern) is stuck on the issue but no
   *  human verdict landed in the jsonl — the write-back job failed; the
   *  label event won't re-fire, so say so on the body instead of letting
   *  the issue look decided */
  stuckLabel?: string | null
}

/** Deterministic body (no timestamps) — the sync loop regenerates it for open
 *  issues and only edits when it actually differs, so verify-status changes,
 *  verdict flips, maturity transitions and stuck-label states propagate
 *  instead of leaving creation-time text stale. */
export function issueBody(t: DocketTarget, opts: IssueBodyOpts = {}): string {
  const L: string[] = [`## 审核单 ${t.name}${t.version ? `@${t.version}` : ''}`, '']
  if (t.backlog) {
    // aggregate repo-only standing issue — per-entry issues at this scale are
    // tracker spam; the body regenerates every sync so the list stays live
    L.push('- 本单是 **repo-only 在押积压总单**：下列条目没有可装 npm 包（latestVersion 为空），AI 不审——只能逐条人工裁决。', '')
    L.push(`待裁决 ${t.backlog.length} 条（在押久者优先）：`)
    const SHOW = 40
    for (const r of t.backlog.slice(0, SHOW)) {
      L.push(`- \`${r.name}\`${r.unscanned ? '（⚠️ 未跑过静态扫描）' : ''}${r.heldAt ? ` — 在押自 ${r.heldAt.slice(0, 10)}` : ''}`)
    }
    if (t.backlog.length > SHOW) L.push(`- …另 ${t.backlog.length - SHOW} 条见 index.json`)
    L.push('',
      '### 裁决方式',
      '逐条评论：`/approve 条目名` 放行，`/concern 条目名 理由` 拦截（写回 `ai-verdicts.jsonl`，该条目即移出本单）。',
      '本单自身**不适用** verdict 标签——标签只作用于单版本审核单；本单在积压清空时自动关闭。')
    if (opts.repo) {
      L.push('', `- 数据：[index.json](https://github.com/${opts.repo}/blob/catalog/index.json) / [最新日报](https://github.com/${opts.repo}/tree/catalog/digest)`)
    } else {
      L.push('', '- 数据：catalog 分支 `index.json` / `digest/`')
    }
    return L.join('\n')
  }
  if (t.verdict === 'none') {
    L.push(t.version === null
      ? '- 当前 AI 判定：**无**（repo-only 条目无可装 npm 包，AI 不审——只能人工裁决）'
      : '- 当前 AI 判定：**无**（评审积压或诊断已停摆——可人工先行裁决，或等 AI 判词；判词落地后本单自动更新）')
  } else if (t.verdict === 'flag') {
    L.push(`- 当前状态：**已上架**条目命中身份级信号：\`${t.reason ?? 'sec:*'}\``, '',
      '  AI 不复审已上架版本——人工 `verdict:concern` 即刻刹车（条目回 pending），人工 `verdict:pass` 确认放行。')
  } else {
    // reason text flows from verify log excerpts / model output — plugin-
    // influenced content rendered into an issue body; flatten newlines and
    // bound the length so a crafted excerpt can't smuggle markdown sections
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300)
    L.push(`- 当前 AI 判定：**${t.verdict}**${t.reason ? ` — ${clean(t.reason)}` : ''}`)
    if (t.reasonEn) L.push(`  - ${clean(t.reasonEn)}`)
    if (t.verdict === 'pass' && (t.redFlags ?? 0) > 0) {
      L.push(`- ⚠️ 静态扫描红旗 ${t.redFlags} 项：AI pass 已被忽略规则拦截——本版本**只能人工放行**（勾 \`verdict:pass\`）或维持拦截（勾 \`verdict:concern\`）`)
    } else if (t.verdict === 'pass' && t.unscanned) {
      L.push('- ⚠️ 本版本**从未跑过静态扫描**（扫描失败或超限）——没扫到不等于安全：AI pass 已被忽略规则拦截，**只能人工放行**（勾 `verdict:pass`）或维持拦截（勾 `verdict:concern`）')
    } else if (t.verdict === 'concern') {
      L.push('- AI concern 已拦截放行——无人翻案则该版本保持 held；人工 pass 可放行，人工 concern 锁死。')
    }
  }
  if (t.verdict === 'pass' && t.humanVerdict?.verdict !== 'concern' && t.maturity) {
    // an announced AI pass on a flagged/never-scanned slot can NEVER release
    // — the "按班放行" wording would promise a gate that is structurally
    // locked (same honesty rule as digest's phase tag)
    const aiBlocked = (t.redFlags ?? 0) > 0 || t.unscanned
    L.push(`- 成熟相位：${aiBlocked
      ? '已公示——但放行闸被旗标/未扫描锁定：AI 对该槽位无放行权，只能人工 verdict:pass 放行'
      : t.maturity === 'announced'
        ? '已公告·待放行闸——无人操作时按班放行（本单为异议窗口）'
        : '已裁决·待日报公告——公示后才进入放行闸（本单为异议窗口）'}`)
  }
  if (t.humanVerdict) {
    L.push(`- 最新人工判词：**${t.humanVerdict.verdict}**${t.humanVerdict.reason ? ` — ${t.humanVerdict.reason}` : ''}` +
      (t.humanVerdict.verdict === 'concern' && t.verdict === 'pass'
        ? '（在押刹车——AI 新判 pass 不会自动放行，本单为复审）' : ''))
  }
  L.push(`- 验证状态：${t.verification ?? 'unverified'}`)
  if (t.unscanned) {
    L.push('- 静态扫描：**未运行**（findings/redFlags 为空是缺数据，不是无发现）')
  } else if ((t.redFlags ?? 0) > 0 || (t.findings ?? 0) > 0) {
    L.push(`- 静态扫描：redFlags ${t.redFlags ?? 0} / findings ${t.findings ?? 0}`)
  }
  if (t.heldAt) {
    L.push(`- 在押自：${t.heldAt.slice(0, 10)}${t.publishedAt ? `；npm 发布于 ${t.publishedAt.slice(0, 10)}` : ''}`)
  }
  if (opts.repo) {
    L.push(`- 数据：[index.json](https://github.com/${opts.repo}/blob/catalog/index.json) / [ai-verdicts.jsonl](https://github.com/${opts.repo}/blob/catalog/ai-verdicts.jsonl)`)
    // the digest is the complete announcement surface — review issues are
    // per-target views INTO it; without this link the objection window has
    // no readable entry point (G1)
    L.push(`- 预告面：[最新日报](https://github.com/${opts.repo}/tree/catalog/digest)（所有将放行版本在此公示）`)
    if (t.slug && opts.pagesBase) L.push(`- 详情页：${opts.pagesBase}/p/${t.slug}.html`)
  } else {
    L.push('- 数据：catalog 分支 `index.json` / `ai-verdicts.jsonl`')
  }
  if (opts.stuckLabel) {
    L.push('',
      `> ⚠️ 本单已贴 \`${opts.stuckLabel}\` 但裁决未写盘（写盘 job 可能失败）——标签事件不会重发：请摘除标签重贴，或评论 \`/approve\` / \`/concern 理由\`。`)
  }
  L.push('',
    '### 📱 手机裁决（点选，零打字）',
    '本 issue → **Labels** → 勾选其一：',
    '- `verdict:pass` — 人工放行（覆盖 AI concern）',
    '- `verdict:concern` — 人工拦截（锁死该版本）',
    '',
    '打标签后 verdict job 自动写回 `ai-verdicts.jsonl` 并关闭本单。也可评论 `/approve` 或 `/concern 理由`。')
  return L.join('\n')
}

interface OpenIssue {
  number: number
  title: string
  labels?: { name: string }[]
  body?: string
}

export async function main(
  args: string[] = process.argv,
  ghFn: typeof gh = gh,
): Promise<void> {
  const arg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined }
  const [idxPath, verdictsPath, digestPath] = ['--index', '--verdicts', '--digest-state'].map(arg)
  const dry = args.includes('--dry')
  const repo = env.GH_REPO
  if (!idxPath || !verdictsPath || !repo)
    throw new Error('usage: --index <p> --verdicts <p> [--digest-state <p>] [--dry]   (GH_REPO=owner/repo required)')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  const verdicts = loadVerdicts(verdictsPath)
  const digest = loadDigestState(digestPath)
  const targets = docketTargets(index, verdicts, digest)
  const wanted = new Map(targets.map(t => [issueTitle(t), t]))
  const wantedByName = new Map(targets.map(t => [t.name, t]))
  const pagesBase = env.MARKET_PAGES_URL
    ?? `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`

  // Enumerate open issues with REST pagination (strongly consistent — the
  // search API is eventually-consistent and could double-create within an
  // index-lag window). title-prefix filter, not label filter: an issue whose
  // review:pending label was stripped by hand still converges (K-5). The cap
  // covers EVERY open issue, not just review ones — warn loudly at the bound
  // so truncation is visible instead of silently dropping tails.
  const LIST_LIMIT = 4000
  const listed = (JSON.parse(ghFn(['issue', 'list', '-R', repo,
    '--state', 'open', '--json', 'number,title,labels,body', '--limit', String(LIST_LIMIT)])) as
    OpenIssue[])
  if (listed.length >= LIST_LIMIT) {
    console.warn(`[docket] open-issue listing hit limit ${LIST_LIMIT} — issues past the bound are not synced this tick`)
  }
  const open = listed.filter(i => i.title.startsWith('[review]'))
  const openByTitle = new Map<string, OpenIssue[]>()
  for (const i of open) {
    const l = openByTitle.get(i.title)
    if (l) l.push(i); else openByTitle.set(i.title, [i])
  }
  // canonical = newest issue per title; older same-title duplicates get
  // closed below instead of pinning the queue forever
  const canonical = new Map<string, OpenIssue>()
  for (const [title, l] of openByTitle) canonical.set(title, l[l.length - 1]!)

  const created: string[] = []
  const updated: string[] = []
  const closed: string[] = []

  for (const [title, t] of wanted) {
    const ex = canonical.get(title)
    if (!ex) {
      console.log(`[docket] create ${title}`)
      created.push(title)
      if (!dry) {
        ghFn(['issue', 'create', '-R', repo, '--title', title,
          '--label', 'review:pending', ...(t.verdict === 'pass' || t.verdict === 'concern' ? ['--label', `ai:${t.verdict}`] : []),
          '--body', issueBody(t, { repo, pagesBase })])
      }
      continue
    }
    // drift-sync (K-2): the ai:* label and the body must track the CURRENT
    // verdict — a flip (ai:pass → ai:concern, or a verify landing) must not
    // leave creation-time text asking the maintainer to act on stale info.
    // A stuck verdict:pass/concern label (applied but never written to the
    // jsonl — write-back job failed) is folded into the body too: the label
    // event can't re-fire, so the body is the only place that can say so.
    const curLabels = new Set((ex.labels ?? []).map(l => l.name))
    const curAi = [...curLabels].find(l => l.startsWith('ai:')) ?? null
    const wantAi = t.verdict === 'pass' || t.verdict === 'concern' ? `ai:${t.verdict}` : null
    const stuck = [...curLabels].find(l => l === 'verdict:pass' || l === 'verdict:concern') ?? null
    const body = issueBody(t, { repo, pagesBase, stuckLabel: stuck })
    const bodyDrift = ex.body !== undefined && ex.body.trim() !== body.trim()
    const edit = ['issue', 'edit', '-R', repo, String(ex.number)]
    if (curAi !== wantAi) {
      if (curAi) edit.push('--remove-label', curAi)
      if (wantAi) edit.push('--add-label', wantAi)
    }
    if (!curLabels.has('review:pending')) edit.push('--add-label', 'review:pending')
    if (bodyDrift) edit.push('--body', body)
    if (edit.length > 5) {
      console.log(`[docket] update #${ex.number} ${title}${curAi !== wantAi ? ` (${curAi ?? 'no-ai-label'} → ${wantAi ?? 'none'})` : ''}${bodyDrift ? ' (body drift)' : ''}${stuck ? ` (stuck ${stuck})` : ''}`)
      updated.push(title)
      if (!dry) ghFn(edit)
    }
  }

  const byName = new Map(index.plugins.map(e => [e.name, e]))
  /** why an open [review] issue is out of the wanted set — the close comment
   *  must say WHICH, since "tombstoned" and "released" read very differently */
  const closeReason = (i: OpenIssue): string => {
    if (i.title === issueTitle({ name: REPO_BACKLOG, version: null })) return 'repo-only 积压已清空'
    const t = titleTarget(i.title)
    const still = t && wantedByName.get(t.name)
    if (still) return `评审目标已变更（当前：${issueTitle(still)}）`
    const e = t ? byName.get(t.name) : undefined
    if (!e) return '该版本/条目已不在 catalog 索引中'
    // per-entry repo-only issue superseded by the aggregate — say so instead
    // of the generic verdicted reason (the entry is still pending!)
    if (e.approval === 'pending' && e.latestVersion === null) return '并入 repo-only 积压总单'
    if (!(e.approval === 'pending' || e.pendingUpdate)) return '该版本已放行'
    return 'verdict 已决议（见 catalog 分支 ai-verdicts.jsonl）'
  }

  for (const i of open) {
    if (wanted.has(i.title) && canonical.get(i.title) === i) continue
    const why = wanted.has(i.title) ? '重复审核单（同目标已有在办单）' : closeReason(i)
    console.log(`[docket] close #${i.number} ${i.title} (${why})`)
    closed.push(i.title)
    if (!dry) {
      // converge to the same terminal label the concern.yml ack sets —
      // otherwise closed issues keep `review:pending` forever and label
      // filters see a false queue
      const cur = new Set((i.labels ?? []).map(l => l.name))
      const largs: string[] = []
      if (cur.has('review:pending')) largs.push('--remove-label', 'review:pending')
      if (!cur.has('review:decided')) largs.push('--add-label', 'review:decided')
      if (largs.length) ghFn(['issue', 'edit', '-R', repo, String(i.number), ...largs])
      ghFn(['issue', 'comment', '-R', repo, String(i.number),
        '--body', `该版本的审核单已自动关闭：${why}。`])
      ghFn(['issue', 'close', '-R', repo, String(i.number)])
    }
  }
  console.log(`[docket] ${wanted.size} open-decision targets, ${open.length} review issues open`)
  const summary = env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, [
      '## review-docket', '',
      `- 待决目标 ${wanted.size} / 在办单 ${open.length}`,
      `- 新开 ${created.length} / 更新 ${updated.length} / 关闭 ${closed.length}`,
      '', ...(created.length ? [`新开：${created.join(', ')}`, ''] : []),
    ].join('\n'))
  }
}

/* v8 ignore next 4 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(x => { console.error(x); exit(1) })
}
