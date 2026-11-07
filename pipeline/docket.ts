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
 *      version, so the standing issue is the only surface; a human verdict
 *      on the displayed key retires it ONLY if it postdates the flag's
 *      first-observed stamp (flaggedAt) — a verdict older than the signal
 *      decided the bytes, not the repojack (R-14 follow-up)
 *    - 'none' repo-only pendings — AI never reviews version-less entries
 *      (aggregate standing issue: per-entry issues at 500+ scale are
 *      tracker spam)
 *    - 'none' versioned holds that out-aged the diagnose queue — review
 *      backlog or a stalled launchd; surfaced per-issue while small, but
 *      beyond NONE_ISSUE_CAP (or whenever diagnose.paused declares the
 *      local queue stopped) they fold into ONE (unreviewed backlog)
 *      aggregate — a stalled queue must be visible, not a flood
 *
 *  Human verdicts are decisions already → excluded → issue auto-closes.
 *
 *  Usage: tsx pipeline/docket.ts --index index.json --verdicts ai-verdicts.jsonl
 *    [--digest-state digest-state.json] [--dry]
 *    (gh cli + GH_TOKEN env; GH_REPO=owner/repo) */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exit, env } from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CatalogIndex, AiVerdict, DigestState } from '../src/schema.ts'
import type { PluginEntry } from '../src/schema.ts'
import { vkey, akey, atCmp, candidateVer, candidateSlot, latestVerdicts, latestHumanVerdicts, loadVerdicts, loadDigestState, brakeFor, tombEpochs, epochGoverning } from './verdicts.ts'
import { titleTarget } from './human-verdict.ts'
import { candidateHeldAt } from './ai/diagnose.ts'
import { isMain } from './main-guard.ts'

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
   *  '已公告·待放行闸' vs 'maturing' (in the LATEST digest — the objection
   *  window is still open; maturity arrives with the next render) so the
   *  maintainer sees WHY a pass isn't live yet */
  maturity?: 'announced' | 'maturing' | 'pending-announce'
  /** evidence surface for the phone decision — detail-page link, scan
   *  counters, hold age, publish date */
  slug?: string
  findings?: number
  redFlags?: number
  /** the slot was never scanned — same human-only posture as red flags */
  unscanned?: boolean
  heldAt?: string
  publishedAt?: string | undefined
  /** verdict line's pinned tarball sha vs the slot's live integrity anchor —
   *  a same-version re-tag means the judgment no longer covers the bytes
   *  that would ship (applyMatureVerdicts' shaOk gate refuses the release) */
  verdictSha?: string
  integrity?: string | null
  /** flag targets only: when the current sec-flag set was FIRST observed —
   *  the body pairs it with a pre-signal human verdict so the maintainer
   *  sees "the bytes were judged, the signal arrived later" explicitly */
  flaggedAt?: string
  /** AI audit trail for the reviewer — judging model + L0.5 classifier score */
  model?: string
  l05Score?: number
  /** bounded scan excerpt (redFlags first) — the phone reviewer sees WHAT
   *  without opening the detail page */
  scanPreview?: string[]
  /** aggregate backlog — a per-entry standing issue per target floods the
   *  tracker (hundreds of rows and growing); the aggregate carries the queue
   *  in ONE issue whose body regenerates. Versioned 'none' rows carry
   *  version+verification; repo-only rows are name-only. redFlags/findings
   *  counts let the maintainer triage risky rows first (a red-flagged repo
   *  must not read identical to a clean one). */
  backlog?: {
    name: string
    version?: string | null
    heldAt?: string
    unscanned?: boolean
    redFlags?: number
    findings?: number
    verification?: string
  }[]
}

/** Reserved names for aggregate standing issues — parentheses can't collide
 *  with npm names or owner/repo ids, and titleTarget's /^\(.*\)$/ guard makes
 *  them un-targetable so comments on the aggregate route per-line instead. */
export const REPO_BACKLOG = '(repo-only backlog)'
/** Same sentinel for versioned held slots with NO verdict — the diagnose
 *  queue is behind or the local job is stopped; at scale these aggregate
 *  into one standing issue instead of flooding the tracker. */
export const NONE_BACKLOG = '(unreviewed backlog)'
/** Below this count a versioned 'none' target still earns its own issue —
 *  a handful of aged holds is individually actionable (full evidence
 *  surface); past the cap per-version issues are spam, not signal. */
export const NONE_ISSUE_CAP = 8

export const issueTitle = (t: Pick<DocketTarget, 'name' | 'version'>) =>
  `[review] ${t.name}${t.version ? `@${t.version}` : ''}`

/** How long a versioned hold may sit verdict-less before it gets a standing
 *  issue — aligned with diagnose's 48h degraded-review window so entries the
 *  AI queue merely defers don't immediately spam the human one. */
export const NO_VERDICT_AGE_MS = 48 * 3600e3

/** The candidate-version clock's STRING form, mirroring candidateHeldAt's
 *  source order (pendingUpdate.heldAt → candidate capabilities.scannedAt →
 *  firstSeenAt): returns the first stamp that actually parses. firstSeenAt
 *  alone undercounts a pending entry re-scanned after a version bump — the
 *  scan stamp IS the candidate's birth, and the 48h window below must measure
 *  the same clock diagnose's degraded-review window does. */
function heldStamp(e: PluginEntry): string | undefined {
  // candidateSlot, not raw pendingUpdate: on a pending entry a leftover
  // hold is the B3 inverted state — its heldAt/scannedAt describe dead
  // bytes, not the candidate whose 48h clock this stamp feeds
  const slot = candidateSlot(e)
  const caps = slot?.capabilities ?? e.capabilities
  for (const s of [slot?.heldAt, caps.scannedAt, e.firstSeenAt])
    if (s && Number.isFinite(Date.parse(s))) return s
  // every stamp unparseable → omit the line entirely: rendering a garbage
  // date is worse than no date (aging still fails visible via candidateHeldAt)
  return undefined
}

/** Pending targets that need a human surface: latest verdict came from AI,
 *  a live entry carries identity sec flags, or no verdict exists past the
 *  age threshold. */
export function docketTargets(
  index: CatalogIndex,
  verdicts: AiVerdict[],
  digest?: DigestState | null,
  opts: { now?: string; paused?: boolean } = {},
): DocketTarget[] {
  const now = Date.parse(opts.now ?? new Date().toISOString())
  const latest = latestVerdicts(verdicts)
  const human = latestHumanVerdicts(verdicts)
  // stale-identity epoch (same gate as applyMatureVerdicts): a 'pass'
  // predating the name's latest tombstone judged a different object — it
  // must not count as a decision here either, or a recycled entry never
  // resurfaces (no release AND no review surface)
  const tomb = tombEpochs(index.removed)
  const announced = new Set(digest?.announced ?? [])
  const dayAnnounced = new Set(digest?.dayAnnounced ?? [])
  const out: DocketTarget[] = []
  const repoOnly: NonNullable<DocketTarget['backlog']> = []
  type SlotMeta = Omit<DocketTarget, 'name' | 'version' | 'verdict'>
  /** aged verdict-less holds — per-issue vs aggregate decided after the loop */
  const noneVer: DocketTarget[] = []
  /** Package-level human brake — applyMatureVerdicts' verdictFor overrides
   *  EVERY slot of the package with a human concern on name@null until a
   *  newer human pass lands on that slot key. Mirrored here via the SHARED
   *  release-gate predicate (brakeFor) so a braked package doesn't spawn
   *  per-version issues whose release the gate will never grant — the
   *  brake itself is the standing decision. (version=null keys are
   *  github-kind SLOTS, not package brakes — brakeFor skips them.) */
  const pkgBrake = (name: string, ver: string): AiVerdict | undefined =>
    brakeFor(human, name, ver, tomb)
  for (const e of index.plugins) {
    // slot = what the issue is about: the candidate slot when held (the
    // pendingUpdate on a displayed entry), else the entry itself —
    // candidateSlot keeps the B3 inverted state (pending + leftover hold)
    // reading the ENTRY's own fields, matching the `ver` key below
    const slot = candidateSlot(e) ?? e
    const held = heldStamp(e)
    const preview = [...slot.capabilities.redFlags.slice(0, 2), ...slot.capabilities.findings.slice(0, 2)]
    const meta: SlotMeta = {
      findings: slot.capabilities.findings.length,
      redFlags: slot.capabilities.redFlags.length,
      // 没扫到 ≠ 安全: a null scannedAt means the scanner never ran — the
      // reviewer must decide blind, same human-only posture as red flags
      ...(slot.capabilities.scannedAt === null ? { unscanned: true } : {}),
      verification: slot.verification.status,
      ...(e.slug ? { slug: e.slug } : {}),
      ...(held ? { heldAt: held } : {}),
      ...(slot.publishedAt ? { publishedAt: slot.publishedAt } : {}),
      ...(slot.integrity ? { integrity: slot.integrity } : {}),
      ...(preview.length ? { scanPreview: preview.map(s => s.slice(0, 160)) } : {}),
    }
    // flag target: identity-level sec:* redFlags on the DISPLAYED slot of a
    // live entry. Held entries already have a review channel (the held
    // version); a displayed version never gets one — the AI doesn't re-review
    // it and the held filter doesn't see it. A human verdict on the displayed
    // key retires the flag ONLY when it postdates the flag's first-observed
    // stamp (flaggedAt): a repojack/integrity-drift signal can arrive long
    // after a human passed the bytes, and the older verdict can't count as a
    // decision about a signal that didn't exist yet. Missing flaggedAt = the
    // flag predates the field or was never stamped → treat as fresh (surface).
    if (e.approval !== 'pending') {
      const flags = e.capabilities.redFlags.filter(f => f.startsWith('sec:'))
      const hv = human.get(vkey(e.name, e.latestVersion))
      // a PACKAGE-level human verdict (name\0null — `pkg@*` concern/pass) also
      // retires the flag: it is a ruling on the whole entry, and a maintainer
      // answering with pkg@* must not leave an immortal review issue behind.
      // For github-kind latestVersion is null so this is the same lookup as
      // the slot key above — only npm entries gain a second key here.
      const hvPkg = e.latestVersion === null ? hv : human.get(vkey(e.name, null))
      const flag = e.capabilities.flaggedAt
      const postdates = (v: AiVerdict | undefined) =>
        v !== undefined && flag !== undefined && atCmp(v.at, flag) > 0
      const decided = postdates(hv) || postdates(hvPkg)
      if (flags.length && !decided) {
        const prior = hv ?? hvPkg
        out.push({
          name: e.name, version: e.latestVersion, verdict: 'flag',
          reason: flags.join(' '),
          verification: e.verification.status,
          findings: e.capabilities.findings.length,
          redFlags: e.capabilities.redFlags.length,
          ...(e.capabilities.scannedAt === null ? { unscanned: true } : {}),
          ...(e.slug ? { slug: e.slug } : {}),
          ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
          // a pre-signal verdict is CONTEXT, not a decision — the body
          // states the ordering so it can't read as "already reviewed"
          ...(prior ? { humanVerdict: prior } : {}),
          ...(flag ? { flaggedAt: flag } : {}),
        })
      }
    }
    const ver = candidateVer(e) ?? null
    if (!ver) {
      // repo-only pending (latestVersion null): unreviewedTargets requires a
      // version, so AI never writes a verdict — without a surface the entry
      // sits invisible+pending forever. A PER-ENTRY issue was the old design;
      // at real scale (500+ repo-only pendings) that is tracker spam the
      // maintainer can't act on anyway — aggregate into ONE standing issue
      // whose body lists the queue; entries drop out as human verdicts land.
      // !latestVersion (not === null): a malformed '' pending would
      // otherwise fall through BOTH branches — no versioned target AND
      // no backlog row — invisible forever. Empty reads as version-less.
      if (e.approval === 'pending' && !e.latestVersion
          && !epochGoverning(latest.get(vkey(e.name, null)), e.name, tomb)) {
        repoOnly.push({
          name: e.name,
          ...(held ? { heldAt: held } : {}),
          ...(meta.unscanned ? { unscanned: true } : {}),
          ...(meta.redFlags ? { redFlags: meta.redFlags } : {}),
          ...(meta.findings ? { findings: meta.findings } : {}),
        })
      }
      continue
    }
    // 包级人工 concern = 覆盖所有槽位的 standing decision——该版本没有独立
    // 的"未决"状态可呈现（与同键人工裁决同等终局语义）；槽位上更新的人工
    // pass 已按 verdictFor 规则解除了刹车，不在此列
    if (pkgBrake(e.name, ver)) continue
    const rec = epochGoverning(latest.get(vkey(e.name, ver)), e.name, tomb)
    if (!rec) {
      // no verdict AT ALL on a held version: the diagnose queue is behind or
      // dead (launchd pause). Young holds stay AI's job; aged ones get the
      // same standing-issue channel as repo-only so they can't go invisible.
      // candidateHeldAt — the SAME clock diagnose's 48h degraded window and
      // digest §② use (pendingUpdate.heldAt → candidate scannedAt →
      // firstSeenAt): firstSeenAt alone would flag a freshly-bumped pending
      // entry as instantly overdue. Unparseable stamps → NaN → treated as
      // AGED, not invisible — a corrupt clock must surface a human issue,
      // never silently suppress one (fail-visible, matching diagnose).
      const heldMs = candidateHeldAt(e)
      if (!Number.isFinite(heldMs) || now - heldMs >= NO_VERDICT_AGE_MS) {
        noneVer.push({ name: e.name, version: ver, verdict: 'none', ...meta })
      }
      continue
    }
    if (rec.source !== 'ai') continue
    const hv = epochGoverning(human.get(vkey(e.name, ver)), e.name, tomb)
    out.push({
      name: e.name, version: ver, verdict: rec.verdict,
      ...(rec.reason ? { reason: rec.reason } : {}),
      ...(rec.reasonEn ? { reasonEn: rec.reasonEn } : {}),
      ...(hv ? { humanVerdict: hv } : {}),
      ...(rec.sha ? { verdictSha: rec.sha } : {}),
      ...(rec.model ? { model: rec.model } : {}),
      ...(rec.l05 ? { l05Score: rec.l05.score } : {}),
      maturity: !announced.has(akey(rec)) ? 'pending-announce'
        : dayAnnounced.has(akey(rec)) ? 'maturing' : 'announced',
      ...meta,
    })
  }
  // Creation order = severity so the freshest issues on the phone are the
  // ones needing real action: pass (veto window) → none (waiting) →
  // concern (blocked, decide) → flag (live entry, identity signal). Ties:
  // oldest-held first, matching diagnose FIFO.
  // Versioned 'none' targets aggregate the same way repo-only does — while
  // the local diagnose job is stopped (diagnose.paused) EVERY aged hold is
  // queue overflow, not an actionable one-off: one standing issue the
  // maintainer can work through beats N identical "AI is behind" pages.
  // Below the cap the per-version issue stays — it carries the full
  // evidence surface (scan preview, sha drift) the aggregate must summarize.
  // Per-line verdicts still route: `/concern name@ver` resolves name+version
  // explicitly against the aggregate's own key.
  if (opts.paused || noneVer.length > NONE_ISSUE_CAP) {
    if (noneVer.length) {
      const rows = noneVer
        .sort((a, b) => Date.parse(a.heldAt ?? '') - Date.parse(b.heldAt ?? ''))
        .map(t => ({
          name: t.name, version: t.version,
          ...(t.heldAt ? { heldAt: t.heldAt } : {}),
          ...(t.unscanned ? { unscanned: true } : {}),
          ...(t.redFlags ? { redFlags: t.redFlags } : {}),
          ...(t.findings ? { findings: t.findings } : {}),
          ...(t.verification ? { verification: t.verification } : {}),
        }))
      out.push({ name: NONE_BACKLOG, version: null, verdict: 'none', backlog: rows })
    }
  } else {
    out.push(...noneVer)
  }
  if (repoOnly.length) {
    repoOnly.sort((a, b) => Date.parse(a.heldAt ?? '') - Date.parse(b.heldAt ?? ''))
    out.push({ name: REPO_BACKLOG, version: null, verdict: 'none', backlog: repoOnly })
  }
  const rank = { pass: 0, none: 1, concern: 2, flag: 3 } as const
  const heldKey = (t: DocketTarget) => Date.parse(t.heldAt ?? '') || 0
  out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || heldKey(a) - heldKey(b))
  return out
}

const execFileP = promisify(execFile)

/* v8 ignore next 8 -- the real gh CLI is never invoked under unit tests */
const gh = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileP('gh', args, {
    encoding: 'utf8',
    // `issue list --json body` × a full queue is multi-MB — the 1MB default
    // would crash the sync permanently once the backlog outgrows it
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN },
  })
  return stdout
}

/** gh may be sync (tests) or async (real execFile) — await unwraps both. */
type GhFn = (args: string[]) => string | Promise<string>

interface OpenIssue {
  number: number
  title: string
  labels?: { name: string }[]
  body?: string
  assignees?: { login: string }[]
}

export interface IssueBodyOpts {
  repo?: string | null
  pagesBase?: string | null
  /** a decision label (verdict:pass/concern) is stuck on the issue but no
   *  human verdict landed in the jsonl — the write-back job failed; the
   *  label event won't re-fire, so say so on the body instead of letting
   *  the issue look decided */
  stuckLabel?: string | null
  /** diagnose.paused exists on the catalog branch — the AI queue is off on
   *  purpose; say so instead of implying a broken pipeline */
  paused?: boolean
}

/** AGENTS.md 检验规则 — 裸枚举不是用户语言：verified→已实测可装可用 etc. */
const VERI_ZH: Record<string, string> = {
  verified: '已实测可装可用', failed: '装不上或加载失败',
  skipped: '有高危信号没跑', unverified: '还没验',
}

/** Deterministic body (no timestamps) — the sync loop regenerates it for open
 *  issues and only edits when it actually differs, so verify-status changes,
 *  verdict flips, maturity transitions and stuck-label states propagate
 *  instead of leaving creation-time text stale. */
export function issueBody(t: DocketTarget, opts: IssueBodyOpts = {}): string {
  const L: string[] = [`## 审核单 ${t.name}${t.version ? `@${t.version}` : ''}`, '']
  // reason/scan text is model- or plugin-influenced content rendered into
  // the maintainer's highest-trust surface — escape markdown/HTML the same
  // way digest.ts does (links, code spans, fake headings all stay inert),
  // collapse whitespace, bound length (prompt-injection / formatting defense)
  const clean = (s: string, max = 300) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\[\]])/g, '\\$1')
    .replace(/\s+/g, ' ').trim().slice(0, max)
  if (t.backlog) {
    const versioned = t.backlog.some(r => r.version != null)
    if (versioned) {
      // aggregate unreviewed-hold standing issue — the diagnose queue is
      // behind or the local job is stopped; per-version issues at this
      // scale are tracker spam the maintainer can't act on anyway. Rows
      // carry the same scan counters a per-entry issue would (没扫到 ≠ 安全:
      // an unscanned/red-flagged row must not look identical to a clean one).
      L.push('- 本单是 **未评审积压总单**：下列版本在押超 48h 且无任何裁决——AI 评审排队过久' +
        (opts.paused ? '，且本地诊断已**声明暂停**（catalog 分支 `diagnose.paused`）' : '或诊断已停摆') +
        '。判词落地后该版本自动移出本单并立单版审核单。', '')
      L.push(`待裁决 ${t.backlog.length} 条（在押久者优先）：`)
      const SHOW = 60
      for (const r of t.backlog.slice(0, SHOW)) {
        const marks = [
          r.unscanned ? '⚠️ 未跑过静态扫描（不等于安全）' : null,
          (r.redFlags ?? 0) > 0 ? `⚠️ 红旗 ${r.redFlags}` : null,
          (r.findings ?? 0) > 0 ? `findings ${r.findings}` : null,
          r.verification ? (VERI_ZH[r.verification] ?? r.verification) : null,
        ].filter(Boolean).join(' / ')
        L.push(`- \`${r.name}@${r.version}\`${marks ? `（${marks}）` : ''}${r.heldAt ? ` — 在押自 ${r.heldAt.slice(0, 10)}` : ''}`)
      }
      if (t.backlog.length > SHOW) L.push(`- …另 ${t.backlog.length - SHOW} 条见 index.json`)
      L.push('',
        '### 裁决方式',
        '逐条评论：`/approve 包名@版本` 放行，`/concern 包名@版本 理由` 拦截（写回 `ai-verdicts.jsonl`，该版本即移出本单）。',
        opts.paused
          ? '本地诊断已声明暂停——恢复：删除 catalog 分支 `diagnose.paused`（`bin/ai-diagnose.sh resume`）。本单自身不适用 verdict 标签；积压清空时自动关闭。'
          : '若队列长期不动，检查本地 launchd `ai-diagnose` 是否停摆；声明暂停可推 `diagnose.paused` 到 catalog 分支（`bin/ai-diagnose.sh pause`）。本单自身不适用 verdict 标签；积压清空时自动关闭。')
      if (opts.repo) {
        L.push('', `- 数据：[index.json](https://github.com/${opts.repo}/blob/catalog/index.json) / [最新日报](https://github.com/${opts.repo}/tree/catalog/digest)`)
      } else {
        L.push('', '- 数据：catalog 分支 `index.json` / `digest/`')
      }
      // a verdict:* label on a sentinel issue can NEVER land — [review] (
      // titles resolve no target by design — so the usual "re-apply" advice
      // is wrong here; say the label is inert and name the real channel
      if (opts.stuckLabel) {
        L.push('',
          `> ⚠️ 本单已贴 \`${opts.stuckLabel}\`——聚合总单不适用 verdict 标签（哨兵目标无法解析，标签永不会写盘）——请摘除该标签；逐条裁决请按上方指引评论。`)
      }
      return L.join('\n')
    }
    // aggregate repo-only standing issue — per-entry issues at this scale are
    // tracker spam; the body regenerates every sync so the list stays live
    L.push('- 本单是 **repo-only 在押积压总单**：下列条目没有可装 npm 包（latestVersion 为空），AI 不审——只能逐条人工裁决。', '')
    L.push(`待裁决 ${t.backlog.length} 条（在押久者优先）：`)
    const SHOW = 40
    for (const r of t.backlog.slice(0, SHOW)) {
      const marks = [
        r.unscanned ? '⚠️ 未跑过静态扫描（不等于安全）' : null,
        (r.redFlags ?? 0) > 0 ? `⚠️ 红旗 ${r.redFlags}` : null,
        (r.findings ?? 0) > 0 ? `findings ${r.findings}` : null,
        r.verification ? (VERI_ZH[r.verification] ?? r.verification) : null,
      ].filter(Boolean).join(' / ')
      L.push(`- \`${versioned ? `${r.name}@${r.version ?? '?'}` : r.name}\`${marks ? `（${marks}）` : ''}${r.heldAt ? ` — 在押自 ${r.heldAt.slice(0, 10)}` : ''}`)
    }
    if (t.backlog.length > SHOW) L.push(`- …另 ${t.backlog.length - SHOW} 条见 index.json`)
    L.push('',
      '### 裁决方式',
      versioned
        ? '逐条评论：`/approve 条目名@版本` 放行，`/concern 条目名@版本 理由` 拦截（写回 `ai-verdicts.jsonl`，该条目即移出本单）。'
        : '逐条评论：`/approve 条目名` 放行，`/concern 条目名 理由` 拦截（写回 `ai-verdicts.jsonl`，该条目即移出本单）。',
      '本单自身**不适用** verdict 标签——标签只作用于单版本审核单；本单在积压清空时自动关闭。')
    if (opts.repo) {
      L.push('', `- 数据：[index.json](https://github.com/${opts.repo}/blob/catalog/index.json) / [最新日报](https://github.com/${opts.repo}/tree/catalog/digest)`)
    } else {
      L.push('', '- 数据：catalog 分支 `index.json` / `digest/`')
    }
    // same inert-label surface as the versioned aggregate — a sentinel
    // title resolves no target, so the label can never land
    if (opts.stuckLabel) {
      L.push('',
        `> ⚠️ 本单已贴 \`${opts.stuckLabel}\`——聚合总单不适用 verdict 标签（哨兵目标无法解析，标签永不会写盘）——请摘除该标签；逐条裁决请按上方指引评论。`)
    }
    return L.join('\n')
  }
  if (t.verdict === 'none') {
    L.push(t.version === null
      ? '- 当前 AI 判定：**无**（repo-only 条目无可装 npm 包，AI 不审——只能人工裁决）'
      : '- 当前 AI 判定：**无**（评审积压或诊断已停摆——可人工先行裁决，或等 AI 判词；判词落地后本单自动更新）')
  } else if (t.verdict === 'flag') {
    L.push(`- 当前状态：**已上架**条目命中身份级信号：\`${clean(t.reason ?? 'sec:*')}\``, '',
      '  AI 不复审已上架版本——人工 `verdict:concern` 即刻刹车（条目回 pending），人工 `verdict:pass` 确认放行。')
    // with flaggedAt set, a shown verdict provably predates the flag (a
    // postdating one would have decided it) — evidence about the bytes,
    // not this signal; render the ordering explicitly, or admit it's
    // unknowable when the stamp is missing, so it can't read as decided
    if (t.humanVerdict) {
      L.push(`- 此前人工裁决：**${t.humanVerdict.verdict}**（${(t.humanVerdict.at ?? '').slice(0, 10)}${t.humanVerdict.reason ? ` — ${clean(t.humanVerdict.reason)}` : ''}）——` +
        (t.flaggedAt
          ? `信号首次观察 ${t.flaggedAt.slice(0, 10)}，裁决早于信号——判的是字节，不是该信号`
          : '信号首次观察时点无记录（flaggedAt 缺失）——无法确认该判词是否覆盖此信号，需就该信号再判一次'))
    }
  } else {
    L.push(`- 当前 AI 判定：**${t.verdict}**${t.reason ? ` — ${clean(t.reason)}` : ''}`)
    if (t.reasonEn) L.push(`  - ${clean(t.reasonEn)}`)
    if (t.model || t.l05Score !== undefined) {
      L.push(`- AI 审计：${t.model ?? '模型未记录'}${t.l05Score !== undefined ? ` · L0.5 ${t.l05Score.toFixed(2)}` : ''}`)
    }
    if (t.verdict === 'pass' && (t.redFlags ?? 0) > 0) {
      // a standing human pass COVERS the flag exemption (§7 humanPassCovers):
      // the gate releases under that authority — "只能人工放行" would tell the
      // maintainer to act on a slot that already resolves itself
      L.push(t.humanVerdict?.verdict === 'pass'
        ? `- ⚠️ 静态扫描红旗 ${t.redFlags} 项——人工 pass 已就此槽位判过：AI 对旗标槽无放行权，但人工判词覆盖豁免，按成熟相位放行`
        : `- ⚠️ 静态扫描红旗 ${t.redFlags} 项：AI pass 已被忽略规则拦截——本版本**只能人工放行**（勾 \`verdict:pass\`）或维持拦截（勾 \`verdict:concern\`）`)
    } else if (t.verdict === 'pass' && t.unscanned) {
      L.push(t.humanVerdict?.verdict === 'pass'
        ? '- ⚠️ 本版本**从未跑过静态扫描**——没扫到不等于安全：AI 对未扫描槽无放行权，但人工 pass 已判，覆盖豁免按成熟相位放行'
        : '- ⚠️ 本版本**从未跑过静态扫描**（扫描失败或超限）——没扫到不等于安全：AI pass 已被忽略规则拦截，**只能人工放行**（勾 `verdict:pass`）或维持拦截（勾 `verdict:concern`）')
    } else if (t.verdict === 'concern') {
      L.push('- AI concern 已拦截放行——无人翻案则该版本保持 held；人工 pass 可放行，人工 concern 锁死。')
    }
  }
  const vs = t.verification ?? 'unverified'
  if (t.verdict === 'pass' && t.humanVerdict?.verdict !== 'concern' && t.maturity) {
    // an announced AI pass that can NEVER release must not promise "按班放行"
    // — the gate refuses flagged/unscanned slots outright, failed/unverified
    // slots until verify converges, and sha-mismatched judgments until drift
    // re-review (same honesty rule as digest's phase tag). Report the FIRST
    // blocker in gate order and always name the next action.
    const shaMismatch = t.verdictSha !== undefined && t.integrity != null && t.verdictSha !== t.integrity
    // the flag/unscanned lock only binds while no human pass covers the key —
    // a covered slot releases under the human's authority on the normal phase
    const blocker =
      ((t.redFlags ?? 0) > 0 || t.unscanned) && t.humanVerdict?.verdict !== 'pass'
        ? '但放行闸被旗标/未扫描锁定：AI 对该槽位无放行权，只能人工 verdict:pass 放行'
      : vs === 'failed' ? '但装测未过——放行闸不会按此裁决生效：修复后评论 `/retest` 重验，或人工改判'
      : vs === 'unverified' ? '但还没验——装测通过前放行闸不会放行（等 verify 班或人工 verdict:pass）'
      : shaMismatch ? '但裁决字节与现槽位不符（疑似 re-tag）——等 drift 复审或人工重判'
      : null
    // three-way like the clear path: 'maturing' was announced in the LATEST
    // digest (objection window open) — collapsing it into 待日报公告 would
    // claim the verdict isn't public yet when it already is
    const phase = t.maturity === 'announced' ? '已公告·待放行闸'
      : t.maturity === 'maturing' ? '已进最新日报公示·异议窗开放'
      : '已裁决·待日报公告'
    L.push(`- 成熟相位：${blocker
      ? `${phase}——${blocker}`
      : t.maturity === 'announced'
        ? '已公告·待放行闸——无人操作时按班放行（本单为异议窗口）'
        : t.maturity === 'maturing'
          ? '已进最新日报公示——异议窗开放中，下期日报后按班放行'
          : '已裁决·待日报公告——公示后才进入放行闸（本单为异议窗口）'}`)
  }
  // flag targets render their own pre-signal context line above — the
  // generic "最新人工判词" phrasing would read as decided there
  if (t.humanVerdict && t.verdict !== 'flag') {
    L.push(`- 最新人工判词：**${t.humanVerdict.verdict}**${t.humanVerdict.reason ? ` — ${clean(t.humanVerdict.reason)}` : ''}` +
      (t.humanVerdict.verdict === 'concern' && t.verdict === 'pass'
        ? '（在押刹车——AI 新判 pass 不会自动放行，本单为复审）' : ''))
  }
  L.push(`- 验证状态：${VERI_ZH[vs] ?? vs}${VERI_ZH[vs] ? `（${vs}）` : ''}`)
  if (t.unscanned) {
    L.push('- 静态扫描：**未运行**（findings/redFlags 为空是缺数据，不是无发现）')
  } else if ((t.redFlags ?? 0) > 0 || (t.findings ?? 0) > 0) {
    L.push(`- 静态扫描：redFlags ${t.redFlags ?? 0} / findings ${t.findings ?? 0}`)
  }
  if (t.scanPreview?.length) {
    L.push('- 扫描摘录（前几条，完整清单见详情页）：')
    for (const s of t.scanPreview) L.push(`  - ${clean(s, 160)}`)
  }
  if (t.verdictSha && t.integrity && t.verdictSha !== t.integrity) {
    L.push('- ⚠️ 裁决钉的字节与当前槽位完整性指纹不一致——疑似同版本换包（re-tag）：放行闸会拒绝按此裁决生效，等 drift 复审或人工重判')
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
  const phoneLabels =
    t.verdict === 'flag' ? [
      '- `verdict:pass` — 确认身份信号无风险（条目保持上架）',
      '- `verdict:concern` — 人工刹车（条目立即回 pending 下架）',
    ] : t.verdict === 'none' ? [
      '- `verdict:pass` — 人工放行（无 AI 判词，直接进入公告/放行链）',
      '- `verdict:concern` — 人工拦截（锁死该版本）',
    ] : t.verdict === 'pass' ? [
      '- `verdict:pass` — 人工放行（与 AI 判定一致，即刻进入公告/放行链）',
      '- `verdict:concern` — 人工拦截（推翻 AI pass，锁死该版本）',
    ] : [
      '- `verdict:pass` — 人工放行（覆盖 AI concern）',
      '- `verdict:concern` — 人工拦截（锁死该版本）',
    ]
  L.push('',
    '### 📱 手机裁决（点选，零打字）',
    '本 issue → **Labels** → 勾选其一：',
    ...phoneLabels,
    '',
    '打标签后 verdict job 自动写回 `ai-verdicts.jsonl` 并关闭本单。也可评论 `/approve` 或 `/concern 理由`。')
  return L.join('\n')
}

export async function main(
  args: string[] = process.argv,
  ghFn: GhFn = gh,
): Promise<void> {
  const arg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined }
  const [idxPath, verdictsPath, digestPath] = ['--index', '--verdicts', '--digest-state'].map(arg)
  const dry = args.includes('--dry')
  const repo = env.GH_REPO
  if (!idxPath || !verdictsPath || !repo)
    throw new Error('usage: --index <p> --verdicts <p> [--digest-state <p>] [--dry]   (GH_REPO=owner/repo required)')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  // exists-but-corrupt ≠ empty: the workflow's git-layer probe covers
  // "exists but git show fails"; a file that fetches fine yet holds ZERO
  // parseable lines is corrupt input — syncing against it strips every
  // ai:* label, rewrites every body to 'none', and regresses announced
  // passes a full maturity phase (the same churn the defer guard exists
  // to prevent, one layer down). index.json already fails closed via
  // JSON.parse/schema — the aux files get the same gate here. A missing
  // file at THIS layer is operator error (the workflow touches the
  // absent-on-branch case into existence) — fail fast either way.
  const sink = { bad: 0 }
  const verdicts = loadVerdicts(verdictsPath, sink)
  // loadVerdicts swallows read failures into [] — probe directly so an
  // exists-but-unreadable file can't masquerade as empty either
  const verdictsRaw = (() => { try { return readFileSync(verdictsPath, 'utf8') } catch { return null } })()
  if (verdictsRaw === null || (sink.bad > 0 && verdicts.length === 0))
    throw new Error(`[docket] verdicts file ${verdictsPath} ${verdictsRaw === null ? 'is missing/unreadable' : `contains only malformed lines (${sink.bad})`} — refusing to sync against a corrupt/empty verdict log`)
  const digest = loadDigestState(digestPath)
  const digestRaw = (() => { try { return digestPath ? readFileSync(digestPath, 'utf8') : null } catch { return null } })()
  if (digestPath && !digest && (digestRaw === null || digestRaw.trim()))
    throw new Error(`[docket] digest-state ${digestPath} ${digestRaw === null ? 'is missing/unreadable' : 'is malformed'} — refusing to regress announced maturity to empty`)
  // closeReason needs the raw maps too — claiming "verdict 已决议" without
  // checking the key is how a version-bumped/clock-reset issue used to close
  // with a pointer to a judgment that never existed
  const latestV = latestVerdicts(verdicts)
  const humanV = latestHumanVerdicts(verdicts)
  const tomb = tombEpochs(index.removed)
  // diagnose.paused on the catalog branch = the local AI queue is stopped on
  // PURPOSE (declared by bin/ai-diagnose.sh pause) — every aged 'none' hold
  // then aggregates into the standing issue instead of spamming per-version
  // ones, and the body says "declared pause" rather than "looks dead"
  const paused = existsSync(join(dirname(idxPath), 'diagnose.paused'))
  const targets = docketTargets(index, verdicts, digest, { paused })
  const wanted = new Map(targets.map(t => [issueTitle(t), t]))
  // first-write-wins: targets arrive severity-sorted, so the surviving per-name
  // entry is the most urgent pending surface (a flag target must not shadow
  // the held-version issue when naming "what's current" in close reasons)
  const wantedByName = new Map<string, DocketTarget>()
  for (const t of targets) if (!wantedByName.has(t.name)) wantedByName.set(t.name, t)
  const pagesBase = env.MARKET_PAGES_URL
    ?? `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`

  // flag/concern issues are decisions waiting on a human — assign them so
  // GitHub pushes a notification (the phone-decision loop's missing link).
  // pass/none stay quiet: they're objection windows, not asks. Configured
  // via the DOCKET_ASSIGNEE repo variable (comma-separated logins); unset =
  // feature off. Assignment is best-effort — a rejected assignee must never
  // fail the verdict sync itself.
  const assignees = (env.DOCKET_ASSIGNEE ?? '').split(',').map(s => s.trim()).filter(Boolean)
  // the paused aggregate is the ONE 'none' that is an ask, not a window:
  // the AI queue is declared stopped, so every row inside needs a human —
  // exactly what the assignee push exists for
  const urgent = (t: DocketTarget) =>
    t.verdict === 'flag' || t.verdict === 'concern' || (paused && t.name === NONE_BACKLOG)
  const assignBestEffort = async (issue: string | number, only?: string[]) => {
    if (!assignees.length) return
    const want = only ?? assignees
    if (!want.length) return
    try {
      await ghFn(['issue', 'edit', '-R', repo, String(issue), '--add-assignee', want.join(',')])
      console.log(`[docket] assigned #${issue} → ${want.join(',')}`)
    } catch (err) {
      console.warn(`[docket] assignee write failed for #${issue} (non-fatal):`, err)
    }
  }

  // Enumerate open issues with REST pagination (strongly consistent — the
  // search API is eventually-consistent and could double-create within an
  // index-lag window). title-prefix filter, not label filter: an issue whose
  // review:pending label was stripped by hand still converges (K-5). The cap
  // covers EVERY open issue, not just review ones — warn loudly at the bound
  // so truncation is visible instead of silently dropping tails.
  const LIST_LIMIT = 4000
  const listed = (JSON.parse(await ghFn(['issue', 'list', '-R', repo,
    '--state', 'open', '--json', 'number,title,labels,body,assignees',
    '--limit', String(LIST_LIMIT)])) as OpenIssue[])
  const listCapped = listed.length >= LIST_LIMIT
  if (listCapped) {
    console.warn(`[docket] open-issue listing hit limit ${LIST_LIMIT} — issues past the bound are not synced this tick`)
  }
  const open = listed.filter(i => i.title.startsWith('[review]'))
  const openByTitle = new Map<string, OpenIssue[]>()
  for (const i of open) {
    const l = openByTitle.get(i.title)
    if (l) l.push(i); else openByTitle.set(i.title, [i])
  }
  // canonical = NEWEST issue per title — issue numbers are monotonic, so
  // max(number) is the deterministic pick and doesn't depend on the API's
  // sort order (gh lists newest-first today; relying on array position was
  // how the "keep newest" comment drifted from behavior). Older same-title
  // duplicates get closed below instead of pinning the queue forever.
  const canonical = new Map<string, OpenIssue>()
  for (const [title, l] of openByTitle)
    canonical.set(title, l.reduce((a, b) => (b.number > a.number ? b : a)))

  const created: string[] = []
  const updated: string[] = []
  const closed: string[] = []
  interface Op { kind: 'create' | 'update' | 'close'; title: string; run: () => Promise<unknown> | unknown }
  const ops: Op[] = []

  for (const [title, t] of wanted) {
    const ex = canonical.get(title)
    if (!ex) {
      console.log(`[docket] create ${title}`)
      const args = ['issue', 'create', '-R', repo, '--title', title,
        '--label', 'review:pending', ...(t.verdict === 'pass' || t.verdict === 'concern' ? ['--label', `ai:${t.verdict}`] : []),
        '--body', issueBody(t, { repo, pagesBase, paused })]
      if (dry) { created.push(title); continue }
      ops.push({ kind: 'create', title, run: async () => {
        const url = String(await ghFn(args))
        created.push(title)
        // gh issue create prints the issue URL — parse the number back for
        // the best-effort assignee pass (a mock/empty stdout just skips it)
        const num = url.match(/(\d+)\s*$/)?.[1]
        if (urgent(t) && num) await assignBestEffort(num)
      } })
      continue
    }
    // drift-sync (K-2): the ai:* label and the body must track the CURRENT
    // verdict — a flip (ai:pass → ai:concern, or a verify landing) must not
    // leave creation-time text asking the maintainer to act on stale info.
    // EVERY stale ai:* label goes, not just the first match — multi-label
    // drift otherwise never converges. A stuck verdict:pass/concern label
    // (applied but never written to the jsonl — write-back job failed) is
    // folded into the body too: the label event can't re-fire.
    const curLabels = new Set((ex.labels ?? []).map(l => l.name))
    const wantAi = t.verdict === 'pass' || t.verdict === 'concern' ? `ai:${t.verdict}` : null
    const staleAi = [...curLabels].filter(l => l.startsWith('ai:') && l !== wantAi)
    const missingAi = wantAi && !curLabels.has(wantAi) ? wantAi : null
    const stuck = [...curLabels].find(l => l === 'verdict:pass' || l === 'verdict:concern') ?? null
    const body = issueBody(t, { repo, pagesBase, stuckLabel: stuck, paused })
    // REST returns body:null for empty bodies — ?? '' keeps .trim() safe and
    // an empty existing body correctly reads as drift against a non-empty one
    const bodyDrift = (ex.body ?? '').trim() !== body.trim()
    const edit = ['issue', 'edit', '-R', repo, String(ex.number)]
    for (const l of staleAi) edit.push('--remove-label', l)
    if (missingAi) edit.push('--add-label', missingAi)
    if (!curLabels.has('review:pending')) edit.push('--add-label', 'review:pending')
    // a wanted issue must not keep the terminal decided label — a reopened
    // or hand-labeled issue would otherwise carry pending+decided at once
    // (the close path converges to decided; the update path mirrors it)
    if (curLabels.has('review:decided')) edit.push('--remove-label', 'review:decided')
    if (bodyDrift) edit.push('--body', body)
    if (edit.length > 5) {
      console.log(`[docket] update #${ex.number} ${title}${staleAi.length || missingAi ? ` (ai → ${wantAi ?? 'none'})` : ''}${bodyDrift ? ' (body drift)' : ''}${stuck ? ` (stuck ${stuck})` : ''}`)
      if (dry) { updated.push(title); continue }
      const curAssignees = new Set((ex.assignees ?? []).map(a => a.login))
      ops.push({ kind: 'update', title, run: async () => {
        await ghFn(edit)
        updated.push(title)
        if (urgent(t)) {
          const missing = assignees.filter(a => !curAssignees.has(a))
          if (missing.length) await assignBestEffort(ex.number, missing)
        }
      } })
    } else if (urgent(t) && assignees.length) {
      // no drift but the notification assignee is missing — still worth one
      // best-effort write so an old issue picks up the ping
      const missing = assignees.filter(a => !(ex.assignees ?? []).some(x => x.login === a))
      if (missing.length && !dry) {
        ops.push({ kind: 'update', title, run: async () => {
          await assignBestEffort(ex.number, missing)
          updated.push(title)
        } })
      }
    }
  }

  const byName = new Map(index.plugins.map(e => [e.name, e]))
  // slots folded into the unreviewed aggregate this tick — an individual
  // 'none' issue closing because its target joined the standing issue must
  // say so, not claim a verdict happened (name\0ver keys: same package may
  // re-enter the queue at a newer version, where it is NOT the same row)
  const aggregated = new Set(
    (wanted.get(issueTitle({ name: NONE_BACKLOG, version: null }))?.backlog ?? [])
      .map(r => `${r.name}\0${r.version ?? ''}`),
  )
  /** why an open [review] issue is out of the wanted set — the close comment
   *  must say WHICH, since "tombstoned" and "released" read very differently */
  const closeReason = (i: OpenIssue): string => {
    if (i.title === issueTitle({ name: REPO_BACKLOG, version: null })) return 'repo-only 积压已清空'
    if (i.title === issueTitle({ name: NONE_BACKLOG, version: null })) return '未评审积压已清空（回落逐条单规模或全部获判）'
    const t = titleTarget(i.title)
    // the aggregate check precedes same-name: a row inside the standing
    // issue is the precise reason, "target changed" only when it isn't one
    if (t && aggregated.has(`${t.name}\0${t.ver}`)) return '并入未评审积压总单'
    const e = t ? byName.get(t.name) : undefined
    if (!t || !e) return '该版本/条目已不在 catalog 索引中'
    // "verdict 已决议" must be TRUE — read the ISSUE's own key, so a
    // candidate-key move (npm bump, ruleset rescan refreshing the hold
    // clock) that dropped the target with zero verdicts never gets a
    // pointer to a judgment that doesn't exist. epoch gate matches
    // docketTargets: a stale pre-tombstone pass is not a decision about
    // this incarnation — same honest "left the queue" reason
    const decided = !!(epochGoverning(latestV.get(vkey(t.name, t.ver || null)), t.name, tomb)
      || brakeFor(humanV, t.name, t.ver || null, tomb))
    if (decided) {
      // the one shape where '已放行' is the precise reason: a stale issue
      // whose version RELEASED (approved, flags gone). When the displayed
      // slot still carries sec:* flags this was a flag issue the verdict
      // retired — '已放行' would describe a release that didn't happen this
      // tick (the degraded-apply window leaves the entry approved+flagged
      // while the verdict already rules it)
      if (!(e.approval === 'pending' || e.pendingUpdate)
          && !e.capabilities.redFlags.some(f => f.startsWith('sec:')))
        return '该版本已放行'
      return 'verdict 已决议（见 catalog 分支 ai-verdicts.jsonl）'
    }
    const still = wantedByName.get(t.name)
    if (still) return `评审目标已变更（当前：${issueTitle(still)}）`
    // per-entry issue superseded by an aggregate — say so instead of the
    // generic verdicted reason (the entry is still pending!). `!latestVersion`
    // mirrors docketTargets' repo-only test: a malformed '' reads as
    // version-less there, so it must read as version-less here too
    if (e.approval === 'pending' && !e.latestVersion) return '并入 repo-only 积压总单'
    if (!(e.approval === 'pending' || e.pendingUpdate)) return '该版本已放行'
    return '评审目标已离开队列（版本位移或在押时钟重置），该版本尚无裁决——如需先行人工裁决请在本单评论'
  }

  for (const i of open) {
    if (wanted.has(i.title) && canonical.get(i.title) === i) continue
    const why = wanted.has(i.title) ? '重复审核单（同目标已有在办单）' : closeReason(i)
    console.log(`[docket] close #${i.number} ${i.title} (${why})`)
    if (dry) { closed.push(i.title); continue }
    // per-issue ordering preserved inside one op: labels → comment → close
    ops.push({ kind: 'close', title: i.title, run: async () => {
      // converge to the same terminal label the concern.yml ack sets —
      // otherwise closed issues keep `review:pending` forever and label
      // filters see a false queue. verdict:* labels (incl. verdict:blocked)
      // are also stale the moment the issue closes — the jsonl is the audit
      // truth; a closed issue must not keep a "decision pending" signal.
      const cur = new Set((i.labels ?? []).map(l => l.name))
      const largs: string[] = []
      if (cur.has('review:pending')) largs.push('--remove-label', 'review:pending')
      if (!cur.has('review:decided')) largs.push('--add-label', 'review:decided')
      for (const l of cur) if (l.startsWith('verdict:')) largs.push('--remove-label', l)
      if (largs.length) await ghFn(['issue', 'edit', '-R', repo, String(i.number), ...largs])
      // idempotent under retry: a close that died mid-op last tick (labels
      // and comment posted, close call failed) reruns the whole op — without
      // peeking at the latest comment the same note re-posts every retry
      const last = String(await ghFn(['issue', 'view', '-R', repo, String(i.number),
        '--json', 'comments', '--jq', '.comments[-1].body // ""'])).trim()
      if (!last.startsWith('该版本的审核单已自动关闭')) {
        await ghFn(['issue', 'comment', '-R', repo, String(i.number),
          '--body', `该版本的审核单已自动关闭：${why}。`])
      }
      await ghFn(['issue', 'close', '-R', repo, String(i.number)])
      closed.push(i.title)
    } })
  }

  // bounded concurrency: serial gh calls made large backlogs brush the 10min
  // timeout; 6-wide stays far under GitHub's secondary rate limits while the
  // job-level review-docket group still serializes whole runs. A failed op
  // doesn't cancel siblings — independent issues still converge this tick —
  // but failures are collected and thrown AFTER the summary so the alert job
  // still sees a red run (no silent partial sync).
  const GH_POOL = 6
  const failures: string[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(GH_POOL, ops.length) }, async () => {
    while (cursor < ops.length) {
      const op = ops[cursor++]!
      try { await op.run() } catch (err) {
        failures.push(`${op.kind} ${op.title}`)
        console.error(`[docket] ${op.kind} failed: ${op.title}`, err)
      }
    }
  }))

  console.log(`[docket] ${wanted.size} open-decision targets, ${open.length} review issues open` +
    (failures.length ? `, ${failures.length} write failure(s)` : ''))
  const summary = env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, [
      '## review-docket', '',
      ...(dry ? ['- **dry-run 预演**——下列动作均未实际执行', ''] : []),
      `- 待决目标 ${wanted.size} / 在办单 ${open.length}`,
      `- 新开 ${created.length} / 更新 ${updated.length} / 关闭 ${closed.length}`,
      ...(listCapped ? [`- ⚠️ open issue 列表触顶 ${LIST_LIMIT}——超出部分本轮未同步，下一轮续收敛`] : []),
      ...(failures.length ? [`- ⚠️ 写操作失败 ${failures.length}：${failures.join('; ')}`] : []),
      '', ...(created.length ? [`新开：${created.join(', ')}`, ''] : []),
    ].join('\n'))
  }
  if (failures.length) throw new Error(`[docket] ${failures.length} write op(s) failed — ${failures.join('; ')}`)
}

/* v8 ignore next 4 */
if (isMain(import.meta.url)) {
  main().catch(x => { console.error(x); exit(1) })
}
