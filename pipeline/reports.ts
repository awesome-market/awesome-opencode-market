/** reports — daily/weekly/monthly/yearly marketplace stats → docs/reports/.
 *
 *  Data plane: reads index.json from the catalog branch (same fetch pattern
 *  as docket/digest). State+output live on the DEFAULT branch under
 *  docs/reports/ — state.json carries the last-seen version per plugin
 *  (upgrade detection) and the daily snapshot ring (weekly/monthly/yearly
 *  aggregation without re-deriving history).
 *
 *  Honesty rules: a day with zero new plugins says zero; downloads are the
 *  npm last-day point summed over npm-kind entries — github-only plugins
 *  contribute nothing and the report says so; firstSeenAt is discovery time,
 *  not publish time.
 *
 *  Usage: tsx pipeline/reports.ts --index i.json --state docs/reports/state.json
 *    --out docs/reports [--date YYYY-MM-DD] [--downloads-concurrency N] [--dry]
 *  Env: none required (npm downloads API is public). */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { exit } from 'node:process'
import { isMain } from './main-guard.ts'
import { CatalogIndex, AiVerdict, DigestState } from '../src/schema.ts'
import { readJsonCapped } from './fetch/npm.ts'
import { docketTargets, type DocketTarget } from './docket.ts'
import { loadVerdicts, loadDigestState } from './verdicts.ts'
import { installEnvProxy } from './net.ts'

export interface DailySnap {
  date: string               // UTC YYYY-MM-DD
  newPlugins: number
  upgrades: number
  total: number
  /** approval=='pending' — entries still awaiting a review decision */
  pendingReview: number
  /** deprecated:true — marked taken-down/deprecated in the catalog */
  deprecated: number
  /** AI-pass targets inside the announce/maturity window (docket 'pass'
   *  verdicts) — null when verdicts/digest inputs weren't provided */
  awaitingRelease: number | null
  byType: Record<(typeof TYPES)[number], number>   // server|tui|gui|rpc (multi-feature plugins count in each)
  npmDownloads: number | null      // null = fetch failed — never render as 0
}
export interface ReportState {
  versions: Record<string, string>  // name → last-seen version (upgrade diff)
  seeded: boolean                  // first run baselines versions without counting upgrades
  dailies: DailySnap[]             // ascending, ring-capped
}

export const RING_DAYS = 400   // >13 months — yearly report always has data
const TYPES = ['server', 'tui', 'gui', 'rpc'] as const

export function emptyState(): ReportState { return { versions: {}, seeded: false, dailies: [] } }
export function loadState(path: string): ReportState {
  if (!existsSync(path)) return emptyState()
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as ReportState
    return { versions: s.versions ?? {}, seeded: !!s.seeded, dailies: Array.isArray(s.dailies) ? s.dailies : [] }
  } catch { return emptyState() }   // corrupt state → re-baseline, never crash the report
}

const dayOf = (iso: string | null | undefined): string => (iso ?? '').slice(0, 10)
const verOf = (e: CatalogIndex['plugins'][number]): string =>
  e.latestVersion ?? (e.source?.kind === 'github' ? e.source.version ?? '' : '')

/** compute today's snapshot. `prevVersions` is the state map BEFORE this
 *  run; newEntries/upgrades are derived inside. downloadsFn injectable —
 *  tests never hit the network. */
export async function computeDaily(
  idx: CatalogIndex, date: string, prev: ReportState,
  downloadsFn?: (names: string[]) => Promise<number | null>,
  review?: { verdicts: AiVerdict[]; digest: DigestState | null },
): Promise<{ snap: DailySnap; state: ReportState }> {
  const byType = Object.fromEntries(TYPES.map(t => [t, 0])) as Record<(typeof TYPES)[number], number>
  const versions: Record<string, string> = {}
  let fresh = 0, upgraded = 0, pendingReview = 0, deprecated = 0
  const npmNames: string[] = []
  for (const e of idx.plugins) {
    const v = verOf(e)
    versions[e.name] = v
    if (!prev.seeded) { /* baseline run — no upgrade counting */ }
    else {
      const old = prev.versions[e.name]
      if (old !== undefined && old !== v) upgraded++
    }
    if (dayOf(e.firstSeenAt) === date) fresh++
    if (e.approval === 'pending') pendingReview++
    if (e.deprecated) deprecated++
    for (const f of e.features ?? []) if (f in byType) byType[f] = (byType[f] ?? 0) + 1
    if (e.source?.kind === 'npm') npmNames.push(e.source.id)
  }
  const dl = downloadsFn ? await downloadsFn(npmNames) : null
  // 公示中待上架 = docket 'pass' targets: AI passed, still inside announce/
  // maturity gates. Needs verdicts+digest — absent inputs render '—', never 0.
  const awaitingRelease = review
    ? docketTargets(idx, review.verdicts, review.digest).filter(t => t.verdict === 'pass').length
    : null
  const snap: DailySnap = {
    date, newPlugins: fresh, upgrades: prev.seeded ? upgraded : 0,
    total: idx.plugins.length, pendingReview, deprecated, awaitingRelease,
    byType, npmDownloads: dl,
  }
  const dailies = [...prev.dailies.filter(d => d.date !== date), snap]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-RING_DAYS)
  return { snap, state: { versions, seeded: true, dailies } }
}

/** sum npm last-day downloads over package names — bounded concurrency,
 *  returns null if EVERY fetch failed (partial failures still sum what's
 *  known; the report labels the figure 约值). */
export async function fetchNpmDownloads(names: string[], concurrency = 12): Promise<number | null> {
  if (!names.length) return 0
  let sum = 0, ok = 0, fail = 0
  const queue = [...names]
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const n = queue.shift()
      if (n === undefined) return
      try {
        const res = await fetch(`https://api.npmjs.org/downloads/point/last-day/${encodeURIComponent(n)}`, {
          headers: { accept: 'application/json', 'user-agent': 'opencode-market-reports' },
          signal: AbortSignal.timeout(20_000),
        })
        if (!res.ok) { fail++; continue }
        const body = await readJsonCapped<{ downloads?: unknown } | null>(res, 64 * 1024)
        const d = body?.downloads
        if (typeof d === 'number' && Number.isFinite(d)) { sum += d; ok++ } else fail++
      } catch { fail++ }
    }
  }))
  return ok === 0 ? null : sum
}

const fmt = (n: number | null): string => n === null ? '获取失败' : n.toLocaleString('en-US')
/** filtered open-issue list for a review-queue label — the number in the
 *  report IS the issue count surface, so it links to exactly that list */
const issueQ = (repo: string, label: string): string =>
  `https://github.com/${repo}/issues?q=is%3Aissue+is%3Aopen+label%3A${encodeURIComponent(label)}`
const siteBase = (repo: string): string => `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`
/** stat number as a link when a repo is known, plain otherwise */
const stat = (n: number | null, href: string | undefined, na = '—'): string =>
  n === null ? na : href ? `[${fmt(n)}](${href})` : fmt(n)

const row = (d: DailySnap): string =>
  `| ${d.date} | ${d.newPlugins} | ${d.upgrades} | ${fmt(d.total)} | ${fmt(d.byType.server)} | ${fmt(d.byType.tui)} | ${fmt(d.byType.gui)} | ${fmt(d.byType.rpc)} | ${fmt(d.npmDownloads)} |`
const HDR = '| 日期 | 新增 | 升级 | 总数 | server | tui | gui | rpc | npm 日下载 |\n|---|---|---|---|---|---|---|---|---|'

function table(rows: DailySnap[]): string {
  return rows.length ? `${HDR}\n${rows.map(row).join('\n')}` : '_暂无数据_'
}

/** 审核队列快照 — point-in-time counts, each linked to its open-issue list.
 *  awaitingRelease needs verdicts+digest inputs; absent → '—' not 0. */
function queueBlock(s: DailySnap, repo: string | undefined): string {
  const q = (label: string) => repo ? issueQ(repo, label) : undefined
  const site = repo ? siteBase(repo) : undefined
  return `## 审核队列（期末快照）
- [等待审核](${q('review:pending') ?? '#'})：${stat(s.pendingReview, q('review:pending'))} 个 pending 条目
- [公示中待上架](${q('ai:pass') ?? '#'})：${stat(s.awaitingRelease, q('ai:pass'))} 个 AI pass 在公示/成熟窗内
- [人工拦截单](${q('verdict:concern') ?? '#'})：见 issue 列表
- [下架/弃用](${site ?? '#'})：${stat(s.deprecated, site)} 个 deprecated 条目（npm 上游标记——catalog 事实，见站点列表）
`
}

export function dailyBody(snap: DailySnap, state: ReportState, repo?: string): string {
  const week = state.dailies.filter(d => d.date >= shiftDate(snap.date, -6) && d.date <= snap.date)
  const tot = state.dailies.length
    ? { fresh: state.dailies.reduce((s, d) => s + d.newPlugins, 0), up: state.dailies.reduce((s, d) => s + d.upgrades, 0) }
    : { fresh: 0, up: 0 }
  const site = repo ? siteBase(repo) : undefined
  return `# 插件市场日报 — ${snap.date}

## 今日
- 新增插件：${stat(snap.newPlugins, site)}
- 版本升级：${stat(snap.upgrades, site)}
- 插件总数：${stat(snap.total, site)}
- npm 昨日下载合计：**${fmt(snap.npmDownloads)}**${snap.npmDownloads === null ? '（全部拉取失败——不等于 0）' : ''}

${queueBlock(snap, repo)}
## 功能分类（一个插件可属多类）
| server | tui | gui | rpc |
|---|---|---|---|
| ${snap.byType.server} | ${snap.byType.tui} | ${snap.byType.gui} | ${snap.byType.rpc} |

## 近 7 天
${table(week)}

## 累计（自 ${state.dailies[0]?.date ?? snap.date} 起 ${state.dailies.length} 天）
- 新增合计：${tot.fresh} · 升级合计：${tot.up}

> 数据源：catalog 分支 index.json + npm downloads last-day API。firstSeenAt 为发现时间；github 插件无版本号概念，升级按 install pin 变化计。新增/升级/总数/下架为 catalog 事实，链接到站点目录；审核队列数字链接到对应 label 的 open issue 列表。
`
}

export function monthlyBody(month: string, state: ReportState, repo?: string): string {
  const days = state.dailies.filter(d => d.date.startsWith(month))
  const last = days[days.length - 1]
  return `# 插件市场月报 — ${month}

- 覆盖天数：${days.length}${days.length ? `（${days[0]!.date} → ${days[days.length - 1]!.date}）` : ''}
- 期末总数：**${last ? fmt(last.total) : '—'}**
- 本月新增合计：**${days.reduce((s, d) => s + d.newPlugins, 0)}**
- 本月升级合计：**${days.reduce((s, d) => s + d.upgrades, 0)}**
- npm 日下载（期间累计）：**${fmt(days.reduce((s, d) => s + (d.npmDownloads ?? 0), 0))}**${days.some(d => d.npmDownloads === null) ? '（含获取失败日，合计为下限）' : ''}

${last ? queueBlock(last, repo) : ''}
## 逐日
${table(days)}
`
}

export function yearlyBody(year: string, state: ReportState, repo?: string): string {
  const days = state.dailies.filter(d => d.date.startsWith(year))
  const last = days[days.length - 1]
  return `# 插件市场年报 — ${year}

- 覆盖天数：${days.length}
- 期末总数：**${last ? fmt(last.total) : '—'}**
- 全年新增合计：**${days.reduce((s, d) => s + d.newPlugins, 0)}**
- 全年升级合计：**${days.reduce((s, d) => s + d.upgrades, 0)}**
- npm 日下载（期间累计）：**${fmt(days.reduce((s, d) => s + (d.npmDownloads ?? 0), 0))}**${days.some(d => d.npmDownloads === null) ? '（含获取失败日，合计为下限）' : ''}

${last ? queueBlock(last, repo) : ''}
## 逐日
${table(days)}
`
}

/* ---- verify-fail daily (concern:verify 的落点) ----
 * Mechanical 装测失败 verdicts used to mint one [review] issue each — 500+
 * measurement echoes drowning the human queue. They now live here instead:
 * a rolling markdown in docs/reports/ plus one standing issue summarizing it.
 * Population = the same targets docket would have issued on: governing
 * concern verdicts whose reason starts 装测失败. */

export interface VerifyFailRow {
  name: string
  version: string | null
  stage: string      // load|install|render|structure|… parsed from the reason
  summary: string    // reason tail after the stage header
}

/** ai:pass + verify:failed — the verdict is fine but the bytes don't
 *  install, so the entry can never release. Same机械 dead state as the
 *  concern verdicts above: docket no longer issues on these, they live
 *  here as a second population until re-verify or an upstream fix. */
export interface DeadPassRow { name: string; version: string | null }
export function deadPassRows(targets: DocketTarget[]): DeadPassRow[] {
  return targets
    .filter(t => t.verdict === 'pass' && t.verification === 'failed')
    .map(t => ({ name: t.name, version: t.version ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 装测失败（verify load 级）：<说明> — the parenthesized stage is the only
 *  stable structure in a free-text reason; unparseable rows bucket 'other' */
const VF_STAGE = /装测失败（verify (\S+) 级）：([\s\S]*)/
export function verifyFailRows(targets: DocketTarget[]): VerifyFailRow[] {
  return targets
    .filter(t => t.verdict === 'concern' && (t.reason ?? '').startsWith('装测失败'))
    .map(t => {
      const m = VF_STAGE.exec(t.reason ?? '')
      return {
        name: t.name, version: t.version ?? null,
        stage: m?.[1] ?? 'other',
        summary: (m?.[2] ?? t.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      }
    })
    .sort((a, b) => a.stage.localeCompare(b.stage) || a.name.localeCompare(b.name))
}

export function verifyFailBody(rows: VerifyFailRow[], date: string, repo?: string, deadPass: DeadPassRow[] = []): string {
  const byStage = new Map<string, number>()
  for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1)
  const stageLine = [...byStage.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `**${s}** ${n}`).join(' · ') || '无'
  const tableRows = rows.map(r =>
    `| ${r.name} | ${r.version ?? '—'} | ${r.stage} | ${r.summary.replace(/\|/g, '\\|')} |`).join('\n')
  const dpRows = deadPass.map(r => `| ${r.name} | ${r.version ?? '—'} |`).join('\n')
  return `# 装测失败日报 — ${date}

> 机械装测测量结果，**不是安全判定**：verify 管线实测"装不上/加载失败"的条目。
> 这些条目不再逐条开 issue——翻案靠重测转 verified 或人工 verdict；条目离开本表即翻案成功。

## 汇总
- 当前装测失败条目：**${rows.length}**
- 按阶段：${stageLine}
- AI 判过但装不上：**${deadPass.length}**（判词有效、字节装不上——同样等重测/上游修复翻案，见第二表）

## 明细
| 包 | 版本 | 阶段 | 原因摘要 |
|---|---|---|---|
${tableRows || '| _暂无_ | | | |'}

## AI 判过但装不上
| 包 | 版本 |
|---|---|
${dpRows || '| _暂无_ | |'}

> 数据源：catalog 分支 index.json + ai-verdicts.jsonl（governing concern 判词 reason 以 装测失败 开头的目标；另含 ai:pass + verify:failed 目标）。
${repo ? `> 对应历史 issue：closed issues label:concern:verify / label:ai:pass → https://github.com/${repo}/issues?q=is%3Aissue+label%3Aconcern%3Averify` : ''}
`
}

/** standing-issue body — the summary half of verifyFailBody, kept under the
 *  issue-size comfort bound; the full table lives in the markdown file */
export function verifyFailIssueBody(rows: VerifyFailRow[], date: string, repo?: string, deadPass: DeadPassRow[] = []): string {
  const byStage = new Map<string, number>()
  for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1)
  const stageLine = [...byStage.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `**${s}** ${n}`).join(' · ') || '无'
  const top = rows.slice(0, 20).map(r => `- \`${r.name}\`${r.version ? `@${r.version}` : ''} — ${r.stage}: ${r.summary.slice(0, 80)}`).join('\n')
  const doc = repo ? `https://github.com/${repo}/blob/main/docs/reports/verify-fail.md` : undefined
  return `机械装测测量结果日报（${date} 更新）——逐条 issue 已停用，全表见 ${doc ?? 'docs/reports/verify-fail.md'}

**当前 ${rows.length} 个装测失败条目** · ${stageLine}
**${deadPass.length} 个 AI 判过但装不上**（判词有效、字节装不上——不再逐条开单，翻案靠重测/上游修复）

这些条目是 verify 实测"装不上/加载失败"的测量回声，不是安全判定：重测翻 verified 或人工 verdict 后自动离开日报。历史 issue 见 label:concern:verify（已关闭）。

${rows.length > 20 ? `### 样本（前 20，全表见日报文件）\n${top}` : `### 全表\n${top || '_暂无_'}`}
`
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function main(
  args: string[] = process.argv,
  deps: { downloadsFn?: (names: string[]) => Promise<number | null> } = {},
): Promise<void> {
  installEnvProxy()
  const die = (m: string): never => { console.error(m); exit(1) }
  const arg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined }
  const usage = 'usage: --index <p> --state <p> --out <dir> [--date YYYY-MM-DD] [--dry]'
  const idxPath = arg('--index') ?? die(usage)
  const statePath = arg('--state') ?? die(usage)
  const outDir = arg('--out') ?? die(usage)
  const verdictsPath = arg('--verdicts')
  const digestPath = arg('--digest-state')
  const repo = arg('--repo') ?? process.env.GH_REPO ?? undefined
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10)
  const dry = args.includes('--dry')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date must be YYYY-MM-DD')

  const idx = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  const prev = loadState(statePath)
  // verdicts/digest are OPTIONAL: without them awaitingRelease renders '—'.
  // An explicitly-passed but unreadable file is operator error → fail fast
  // rather than silently degrade the queue stat to unknown.
  let review: { verdicts: AiVerdict[]; digest: DigestState | null } | undefined
  if (verdictsPath) {
    const sink = { bad: 0 }
    const verdicts = loadVerdicts(verdictsPath, sink)
    if (sink.bad > 0 && verdicts.length === 0) die(`verdicts ${verdictsPath} has only malformed lines`)
    review = { verdicts, digest: loadDigestState(digestPath) }
  }
  const dl = deps.downloadsFn ?? ((names: string[]) => fetchNpmDownloads(names))
  const { snap, state } = await computeDaily(idx, date, prev, dl, review)

  // 装测失败日报 — same verdict-driven population as docket's old per-issue
  // mechanical concerns; without verdict inputs the report says 0 rather than
  // guessing from verification.status (failed-but-unjudged is not the queue)
  const vfTargets = review ? docketTargets(idx, review.verdicts, review.digest) : []
  const vfRows = review ? verifyFailRows(vfTargets) : []
  const dpRows = review ? deadPassRows(vfTargets) : []

  const writes: [string, string][] = [
    [join(outDir, 'daily', `${date}.md`), dailyBody(snap, state, repo)],
    [join(outDir, 'verify-fail.md'), verifyFailBody(vfRows, date, repo, dpRows)],
    [join(outDir, 'verify-fail-issue.md'), verifyFailIssueBody(vfRows, date, repo, dpRows)],
    // weekly view = trailing 7d already inside daily body; month/year files
    // are (re)generated whenever their period is touched so a backfill run
    // repairs them too
    [join(outDir, 'monthly', `${date.slice(0, 7)}.md`), monthlyBody(date.slice(0, 7), state, repo)],
    [join(outDir, 'yearly', `${date.slice(0, 4)}.md`), yearlyBody(date.slice(0, 4), state, repo)],
    [statePath, JSON.stringify(state, null, 2) + '\n'],
  ]
  if (dry) { for (const [p, c] of writes) console.log(`--- ${p}\n${c.slice(0, 400)}…`); return }
  for (const [p, c] of writes) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c) }
  console.log(`[reports] ${date}: +${snap.newPlugins} new, ${snap.upgrades} upgrades, total ${snap.total}, npm-dl ${fmt(snap.npmDownloads)}`)
}

/* v8 ignore next 3 */
if (isMain(import.meta.url)) {
  main().catch(x => { console.error(x); exit(1) })
}
