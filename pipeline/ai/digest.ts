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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { exit } from 'node:process'
import { join } from 'node:path'
import { CatalogIndex, AiVerdict, DigestState, type PluginEntry } from '../../src/schema.ts'
import { loadVerdicts, loadDigestState, latestVerdicts, latestHumanVerdicts,
  effectiveVerdict, slotVerdict, packageBrake, brakeFor, vkey, akey, atCmp,
  tombEpochs, epochGoverning, humanPassCovers, candidateSlot } from '../verdicts.ts'
import { verifyQueued, hostStaleVerify } from '../verify/plan.ts'
import { unreviewedTargets, candidateHeldAt } from './diagnose.ts'
import { isMain } from '../main-guard.ts'

export interface DigestInput {
  index: CatalogIndex
  verdicts: AiVerdict[]
  /** previous digest-state.json (null = bootstrap: only verdicts inside
   *  BOOTSTRAP_WINDOW announce — see below) */
  prev: DigestState | null
  now: Date
  /** catalog-branch diagnose.paused — the local AI queue is stopped on
   *  PURPOSE; surfaces say "declared pause", not "looks dead" */
  paused?: boolean
  /** catalog-branch diagnose-health.json — the local worker's self-reported
   *  l05/omlx state. Only meaningful while `at` is fresh (<48h): a stale
   *  stamp means the worker is dead, which §⑤'s verdict-heartbeat already
   *  covers. Degraded-but-alive is the gap this closes. */
  health?: { at?: string | undefined; l05?: string | undefined; omlx?: string | undefined } | null
  /** malformed jsonl lines dropped at load (loadVerdicts sink) — surfaced in
   *  the header so a truncated/merge-artifact line is visible to the reader,
   *  not only in a CI warn log nobody watches */
  badLines?: number
}

/** Bootstrap guard (G3): the FIRST digest ever rendered (prev=null, no
 *  digest/*.md history — state loss with history already hard-fails in main)
 *  must not announce the entire verdict backlog at once. Every announced
 *  pass matures at the next applyMatureVerdicts — months of accumulated
 *  verdicts would all release within ~6h of one render, collapsing the
 *  objection window the digest exists to provide. Restricting bootstrap to
 *  verdicts younger than this window stages the backlog: old candidates
 *  announce normally from the SECOND digest on, giving the whole set a
 *  full ~24h of rendered visibility before it can mature. */
export const BOOTSTRAP_WINDOW_MS = 14 * 86_400_000
/** Bootstrap also covers a state that never announced anything AND carries
 *  no real anchor — the shape of a hand-restored minimal digest-state. A
 *  real render ALWAYS writes lastDigestAt (falls back to nowIso even on an
 *  empty verdicts file), so a legitimately drained steady state (announced
 *  emptied by liveAkeys pruning) does NOT re-enter the window and an
 *  all-withheld first render isn't deadlocked: its anchor is real, so the
 *  second render exits bootstrap and the backlog announces. */
const isBootstrap = (prev: DigestState | null) =>
  prev === null || (prev.announced.length === 0 && prev.lastDigestAt === '')
const bootstrapCutoff = (prev: DigestState | null, now: Date) =>
  isBootstrap(prev) ? now.getTime() - BOOTSTRAP_WINDOW_MS : -Infinity

/** The vkeys applyMatureVerdicts can ever query for a PASS release:
 *  every pendingUpdate slot + the displayed slot of pending entries. A pass
 *  on any other key (an approved display slot, a superseded hold) can never
 *  be asked to mature — announcing it is noise, not signal. */
function heldSlotKeys(index: CatalogIndex): Set<string> {
  const s = new Set<string>()
  for (const e of index.plugins) {
    // candidateSlot, not raw pendingUpdate: on a pending entry a leftover
    // hold is the B3 inverted state — its key describes bytes nobody is
    // reviewing, so announcing it would pin a dead akey and render phantom
    // rows for a slot applyMatureVerdicts will never query
    const slot = candidateSlot(e)
    if (slot) s.add(vkey(e.name, slot.version))
    // 'legacy' slots can mature too — applyMatureVerdicts releases passes on
    // pending AND legacy displayed versions; omitting 'legacy' here made a
    // pass on a legacy display slot un-announceable → un-maturable forever
    // (the release branch was unreachable and the verdict never rendered)
    if (e.approval === 'pending' || e.approval === 'legacy') s.add(vkey(e.name, e.latestVersion))
  }
  return s
}

/** Which LIVE verdict lines belong in a digest (Bug-1 + bounded `announced`):
 *  — a line on a held slot (it can actually mature there);
 *  — any line for a name absent from index (ghost verdict — announced ⚠️);
 *  — any 'concern' line (brakes/judgments stay visible on every slot).
 *  A 'pass' on an already-approved displayed slot is never rendered nor kept
 *  in `announced`: nothing can mature off it and dropping it cannot resurrect
 *  — if its key ever becomes a slot again the line re-announces once. */
function announcementCandidates(verdicts: AiVerdict[], index?: CatalogIndex): AiVerdict[] {
  const live = [...latestVerdicts(verdicts).values()]
  if (!index) return live
  const slots = heldSlotKeys(index)
  const inIndex = new Set(index.plugins.map(e => e.name.toLowerCase()))
  // stale-identity epoch: a 'pass' predating the name's last tombstone
  // judged a different object — announcing it would promise a maturity the
  // release gate refuses (epochGoverning), and pin its dead akey in
  // announced forever. Concerns stay: distrust survives name recycling.
  const tomb = tombEpochs(index.removed)
  return live.filter(v =>
    epochGoverning(v, v.name, tomb)
    && (slots.has(vkey(v.name, v.version)) || !inIndex.has(v.name.toLowerCase()) || v.verdict === 'concern'))
}

/** State transition for one render — kept separate from markdown so the
 *  maturity semantics are unit-testable without string matching. */
export function nextDigestState(verdicts: AiVerdict[], prev: DigestState | null, now: Date, index?: CatalogIndex): DigestState {
  const day = now.toISOString().slice(0, 10)
  const nowIso = now.toISOString()
  // Only the LATEST line per key can ever be the effective verdict, and only
  // candidate lines are announce-able — a superseded line's akey must never
  // (re-)enter announced: pruned once, it would look "never announced" and
  // phantom-announce in every later digest (Bug-1). Bootstrap (prev=null)
  // additionally windows `seen` — see BOOTSTRAP_WINDOW_MS.
  const cutoff = bootstrapCutoff(prev, now)
  // `at` comparisons go through Date.parse — loadVerdicts normalizes to ISO-Z
  // but these exported fns also take caller-built verdicts; a non-Z offset
  // ('+08:00') would misorder/misfilter under raw string compare
  const notAfterNow = (v: AiVerdict) => Date.parse(v.at) <= now.getTime()
  const seen = new Set(announcementCandidates(verdicts, index)
    .filter(v => notAfterNow(v) && Date.parse(v.at) >= cutoff).map(akey))
  const prevAnnounced = new Set(prev?.announced ?? [])
  const firstSeen = [...seen].filter(k => !prevAnnounced.has(k))
  const dayAnnounced = [...new Set([...(prev?.day === day ? prev.dayAnnounced : []), ...firstSeen])]
  // Maturity anchor stays monotonic: max `at` over verdicts this render saw.
  const anchor = verdicts.reduce((m, v) => {
    const t = Date.parse(v.at)
    return t <= now.getTime() && t > (Date.parse(m) || -Infinity) ? v.at : m
  }, prev?.lastDigestAt ?? '') || nowIso
  // announced is bounded by the CURRENT latest verdict per key: a superseded
  // line can never win latestVerdicts again (`at` is monotonic), so its
  // announcement slot is dead weight — pruning it keeps digest-state small
  // instead of growing with every verdict ever written. Non-candidate keys
  // drop out too — a mature pass on a slot that no longer needs it (released
  // display, retired hold) is dead weight the same way.
  const liveAkeys = new Set(announcementCandidates(verdicts, index).map(akey))
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
    // org prod — the canonical issue plane; a fork fallback would render
    // review links that resolve to an empty issue search (G5)
    return 'https://github.com/awesome-market/awesome-opencode-market'
  }
}

export function renderDigest({ index, verdicts, prev, now, paused = false, health = null, badLines = 0 }: DigestInput): string {
  const day = now.toISOString().slice(0, 10)
  const nowIso = now.toISOString()

  // §①/§③ display set = verdict lines first announced TODAY: yesterday's
  // dayAnnounced (same-day cumulative — keeps lines superseded since the
  // morning render in today's file as history) + candidate lines never
  // announced before. Non-candidate lines (superseded, or pass on a slot
  // that needs no maturity) never enter — no phantom re-announcements.
  const candidates = announcementCandidates(verdicts, index)
  const prevAnnounced = new Set(prev?.announced ?? [])
  const todayFirst = new Set(prev?.day === day ? prev.dayAnnounced : [])
  const cutoff = bootstrapCutoff(prev, now)
  // Date.parse, not lexical compare — caller-built verdicts can carry non-Z
  // offsets that misorder under string compare (same rule as nextDigestState)
  const notAfterNow = (v: AiVerdict) => Date.parse(v.at) <= now.getTime()
  for (const v of candidates) {
    if (notAfterNow(v) && Date.parse(v.at) >= cutoff && !prevAnnounced.has(akey(v))) todayFirst.add(akey(v))
  }
  // bootstrap withheld count — candidates old enough to be excluded by the
  // window; surfaced in the header so the staged announce is visible, not
  // silent (they announce normally from the next digest on)
  const withheld = isBootstrap(prev)
    ? candidates.filter(v => notAfterNow(v) && Date.parse(v.at) < cutoff).length
    : 0
  // dedupe by akey — a verdict line pushed twice (a retry that appended the
  // same line) must not render two identical rows. LAST occurrence wins:
  // amendAt reuses the prior human line's `at` on a reason-only correction,
  // so the amended line shares the akey — first-wins would keep rendering
  // the superseded reason the maintainer just corrected.
  const freshMap = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    const k = akey(v)
    if (todayFirst.has(k)) freshMap.set(k, v)
  }
  const fresh = [...freshMap.values()]
  const passes = fresh.filter(v => v.verdict === 'pass')
  const concerns = fresh.filter(v => v.verdict === 'concern')

  // verdict lookups shared by the row marks below
  const latest = latestVerdicts(verdicts)
  const latestHuman = latestHumanVerdicts(verdicts)
  const tomb = tombEpochs(index.removed)
  const eff = (v: AiVerdict | undefined) => effectiveVerdict(v, latestHuman)
  const inIndex = new Set(index.plugins.map(e => e.name.toLowerCase()))

  // §③ 已解除 rows — a concern LINE the reader actually saw (its akey sits
  // in prevAnnounced) whose key's effective verdict is now a NEWER pass.
  // Without these rows a resolved concern just vanishes from §③ — the
  // reader can't tell "fixed" from "we stopped reporting it". effectiveVerdict
  // keeps R-4: an AI pass never lifts a human concern, so no false '已解除'.
  const latestConcern = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    if (v.verdict !== 'concern') continue
    const cur = latestConcern.get(akey(v))
    if (!cur || atCmp(v.at, cur.at) > 0) latestConcern.set(akey(v), v)
  }
  const resolved = [...prevAnnounced]
    .map(k => latestConcern.get(k))
    .filter((v): v is AiVerdict => v !== undefined)
    .filter(c => {
      const l = latest.get(vkey(c.name, c.version))
      return l !== undefined && eff(l)?.verdict === 'pass' && atCmp(l.at, c.at) > 0
    })
  const willAnnounce = (v: AiVerdict) => prevAnnounced.has(akey(v)) || todayFirst.has(akey(v))

  // silently-invisible data: future-dated verdicts can never announce or
  // mature — surface them instead of letting them sit forever (clock skew
  // on a diagnose machine would otherwise look like "nothing to report").
  // count future-stamped lines off the RAW verdict list — a line excluded
  // from latestVerdicts by the future-grace guard is silently inert, which
  // is exactly when this warning matters most
  const future = verdicts.filter(v => !notAfterNow(v)).length

  // 上期公告·已生效 — passes the LAST render announced whose slot is now
  // displayed: the objection window's readers see their own decision land.
  // prev.dayAnnounced is the last render's day-set (cumulative that day);
  // released = entry approved AND showing that version (superseded-since
  // releases aren't claimed).
  const prevDayAnnounced = new Set(prev?.dayAnnounced ?? [])
  const landed = verdicts.filter(v => {
    if (v.verdict !== 'pass' || !prevDayAnnounced.has(akey(v))) return false
    const e = index.plugins.find(p => p.name.toLowerCase() === v.name.toLowerCase())
    return e !== undefined && e.approval !== 'pending' && e.approval !== 'legacy'
      && e.latestVersion === v.version
  })

  // §② held — oldest first (matches diagnose's consumption order), with the
  // hold reason visible: "waiting for AI" and "AI concern → needs human" are
  // different actions and must not read the same. Shares unreviewedTargets'
  // clock: per-VERSION hold age, not entry age.
  const heldAt = (e: PluginEntry) => candidateHeldAt(e) || 0
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
  const held = index.plugins
    .filter(e => e.approval === 'pending' || e.pendingUpdate)
    .sort((a, b) => heldAt(a) - heldAt(b))

  // verify backlog (V-2): shares planTargets' queue predicate — the real
  // number, retryable failures and cleared-flag re-entries included, minus
  // slots a verdict already condemned (they're judged, not awaiting a run).
  const queue = index.plugins.filter(e => verifyQueued(e, now, latest, latestHuman, tomb))
  // drain estimate at the 2×daily scheduled cadence (VERIFY_CAP targets each)
  // — turns the raw count into "how long until this clears" for ops
  const drainDays = queue.length ? Math.ceil(queue.length / (Number(process.env.VERIFY_CAP) || 48) / 2) : 0
  const qSubs = queue.filter(e => e.discoveredVia?.includes('submission')).length
  // host-version drift backlog (P1-6): verified results recorded under a
  // different opencodeVersion re-enter the verify queue ahead of normal work
  const hostStale = index.plugins.filter(e => hostStaleVerify(e)).length
  const weekAgo = now.getTime() - 7 * 86_400_000
  const verOf = (e: PluginEntry) => candidateSlot(e)?.verification ?? e.verification
  const recentFailed = index.plugins.filter(e => {
    const v = verOf(e)
    return v.status === 'failed' && Number.isFinite(Date.parse(v.verifiedAt ?? '')) && Date.parse(v.verifiedAt!) >= weekAgo
  }).length
  // same hold clock §②/§⑤/planTargets use (candidateHeldAt) — one queue,
  // one "oldest" definition; firstSeenAt alone undercounts verify-rescans
  const oldestWait = queue
    .map(candidateHeldAt)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map(t => new Date(t).toISOString())[0]

  // review backlog (D-7): the diagnose consumption predicate itself —
  // unreviewedTargets, shared with the watchdog's PENDING count, so the
  // number shown equals what diagnose will actually pick up (includes the
  // 48h verify-wait deferral; a pending-but-unverifiable-for-now entry isn't
  // "review backlog"). A stalled local LLM shows up here long before the
  // 48h watchdog trips.
  const pendingReview = unreviewedTargets(index, verdicts, null, { now: nowIso })
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
  // 最新 AI 裁决时间 —— pendingReview 计数可以稳定不动掩盖停摆(候选全被
  // twin/verify 短路消化时照样写行),但"多久没出 AI 判词"骗不了人。这是
  // 本地诊断 worker 的被动心跳:文件新鲜度不行(人工裁决/compact 也写同一
  // 文件),最新 source:ai 行的 at 才是 diagnose 自己的脚印。
  const latestAiAt = verdicts
    .filter(v => v.source === 'ai')
    .map(v => Date.parse(v.at))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)

  // worker self-report (catalog diagnose-health.json, published by
  // bin/ai-diagnose.sh on state transitions): verdict commits prove a run
  // happened but can't express "alive with a degraded channel" — l05 dead
  // still emits verdicts, omlx down still writes mechanical fallbacks.
  // Only a FRESH stamp (<48h) counts: stale = dead worker, already covered
  // by the verdict-heartbeat marker above.
  const healthAt = health?.at ? Date.parse(health.at) : NaN
  const healthFresh = Number.isFinite(healthAt) && now.getTime() - healthAt < 48 * 3_600_000
  const degraded: string[] = []
  if (healthFresh && !paused) {
    if (health?.l05 === 'failed' || health?.l05 === 'untrusted') degraded.push(`L0.5=${health.l05}`)
    if (health?.omlx === 'down' || health?.omlx === 'died-mid-run') degraded.push(`omlx=${health.omlx}`)
  }
  const healthNote = degraded.length
    ? ` / ⚠️ 本机诊断降级运行中（${degraded.join('、')}）——裁决仍在产出但通道受损，检查本机 L0.5 模型缓存与 omlx 服务`
    : ''

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
    const ver = candidateSlot(e)?.version ?? e.latestVersion
    const vf = candidateSlot(e)?.verification ?? e.verification
    // mirror the release gate's shared slot semantics (slotVerdict): a
    // package-level human brake governs every VERSIONED slot — the slot's
    // own verify/verdict state is moot while the brake stands. (version=null
    // = github-kind slot whose null key is the slot's own verdict, never a
    // package brake.)
    // epoch gate matches the release gate (epochGoverning): a pass predating
    // this name's last tombstone judged a different object — rendering it as
    // '已公告·待放行闸' would promise a release that structurally can't happen
    const governing = epochGoverning(slotVerdict(latest, latestHuman, e.name, ver, tomb), e.name, tomb)
    if (ver !== null && governing && governing === packageBrake(latestHuman, e.name))
      return '包级刹车·需人工解除'
    // ver === null (repo-only/github-kind): the null key IS a real slot key
    // — a human verdict there can mature and release, so look it up instead
    // of falling through to '待评审'
    const rec = ver === undefined ? undefined : epochGoverning(latest.get(vkey(e.name, ver)), e.name, tomb)
    if (rec && eff(rec)?.verdict === 'concern') return '已打标 concern'
    // failed outranks the pass phases: a mature pass whose slot then failed
    // verification can NEVER release (release gate excludes failed) — showing
    // '待放行闸' would promise a release that's structurally impossible until
    // the slot re-verifies. '验证失败' is the honest terminal-looking phase.
    if (vf.status === 'failed') return '验证失败'
    // mirror applyMatureVerdicts' AI gates: an announced AI pass on a flagged
    // or never-scanned slot can NEVER auto-release — '待放行闸' would promise
    // a release that structurally won't happen without a human verdict.
    // Except when a standing human pass covers the same key: that IS the
    // human verdict, and the live ai line rides its authority to release.
    const caps = candidateSlot(e)?.capabilities ?? e.capabilities
    if (rec?.verdict === 'pass' && rec.source === 'ai' && ver !== undefined
        && !humanPassCovers(latestHuman, e.name, ver, tomb)
        && (caps.redFlags.length > 0 || caps.scannedAt === null))
      return 'AI pass 被旗标/未扫描拦截·需人工'
    if (rec?.verdict === 'pass') {
      // gate order: maturity is checked before RELEASABLE — an unannounced
      // pass can't release regardless of verification, so the announcement
      // phase is the honest first blocker
      if (!willAnnounce(rec)) return '已裁决·待日报公告'
      // announced pass on an unverified slot: the release gate hard-blocks
      // unverified (RELEASABLE = verified|skipped) — '待放行闸' would promise
      // a release that structurally can't happen until verify lands. Same
      // blocker order the docket body documents (旗标/未扫描 → 装测未过 →
      // 还没验 → 字节不符 → 才到公告相位).
      if (vf.status === 'unverified') return '待验证'
      return '已公告·待放行闸'
    }
    if (vf.status === 'unverified') return '待验证'
    // repo-only slots are never in the AI review queue — '待评审' would imply
    // the diagnose worker picks them up; only a human verdict moves them
    if (ver === null) return '需人工评审（AI 不审 repo-only）'
    return '待评审'
  }

  // reason text is model/human output rendered into a committed markdown
  // file — escape link syntax AND raw HTML so package-metadata-driven text
  // can't inject clickable markup (D-F); '|' for the tables. Entities for
  // <>& — backslash-escaped `<` still parses as raw HTML in some renderers.
  const escMd = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\[\]])/g, '\\$1')
  // cells must stay one line — a multi-line verdict reason would break the
  // markdown table row (writers normalize already; this is the belt)
  const escCell = (s: string) => escMd(s.replace(/\s*\n\s*/g, ' ')).replaceAll('|', '\\|')
  const reasonOf = (v: AiVerdict) => escCell(v.reason ?? '') + (v.reasonEn ? ` / ${escCell(v.reasonEn)}` : '')
  const repo = repoUrl()
  const reviewLink = (v: AiVerdict) => {
    const q = encodeURIComponent(`is:issue in:title "[review] ${v.name.replaceAll('"', '')}"`)
    return `[审核单](${repo}/issues?q=${q})`
  }
  // a pass announced today can already be superseded by a newer concern on
  // the same key (live example: human flip minutes later) — the line still
  // announces, but it will never release; say so instead of implying it will.
  // A package-level brake (name@null human concern) blocks the same way even
  // though it lives on a different key — same predicate as the release gate.
  const brakeMark = (v: AiVerdict) => {
    if (v.verdict !== 'pass') return ''
    if (brakeFor(latestHuman, v.name, v.version, tomb)) return ' ⛔已被包级 concern 刹车'
    return eff(latest.get(vkey(v.name, v.version)))?.verdict === 'concern'
      ? ' ⛔已被更新的 concern 刹车' : ''
  }
  // §③ counterpart: a concern whose effective verdict is now a pass is
  // RESOLVED — marks both fresh rows (same-day flip) and the historical
  // `resolved` rows above.
  const resolveMark = (v: AiVerdict) =>
    v.verdict === 'concern' && eff(latest.get(vkey(v.name, v.version)))?.verdict === 'pass'
      ? ' ✅已被更新的 pass 解除' : ''
  const nameCell = (v: AiVerdict) =>
    `${escMd(v.name)}${inIndex.has(v.name.toLowerCase()) ? '' : ' ⚠️不在目录'}${brakeMark(v)}${resolveMark(v)}`
  // version===null rows: a human verdict on a name that HAS versioned slots
  // is the package brake ("this package"); on repo-only/ghost names the null
  // key is just the slot itself — tell them apart or '—' reads ambiguous
  const byName = new Map(index.plugins.map(e => [e.name.toLowerCase(), e]))
  const versionCell = (v: AiVerdict) => {
    if (v.version !== null) return v.version
    const e = byName.get(v.name.toLowerCase())
    return e?.pendingUpdate || e?.latestVersion != null ? '—（包级）' : '—'
  }
  const rows = (vs: AiVerdict[]) => vs.map(v =>
    `| ${nameCell(v)} | ${versionCell(v)} | ${v.source} | ${reasonOf(v)} | ${reviewLink(v)} |`).join('\n')
  const table = (vs: AiVerdict[]) =>
    `| 包 | 版本 | 来源 | 理由 | 审核 |\n|---|---|---|---|---|\n${rows(vs)}`
  const heldLine = (e: PluginEntry) => {
    // pending npm entries DO have a candidate version (latestVersion) — show
    // it so the row maps to its §①/§③ verdict lines; only repo-only stays
    // version-less
    const slot = candidateSlot(e)
    const ver = slot ? `v${slot.version}`
      : e.latestVersion === null ? '(repo-only — AI 不审，需人工)'
      : `v${e.latestVersion}（未上架）`
    // 'awaiting-review' is the DEFAULT pending reason — rendering it adds
    // noise, not signal; real reasons (concern text) stay visible
    const reason = slot?.reason ?? e.approvalReason
    const reasonTxt = reason && reason !== 'awaiting-review' ? ` — ${oneLine(escMd(reason))}` : ''
    const heldMs = heldAt(e)
    const heldTxt = heldMs ? ` · 在押自 ${new Date(heldMs).toISOString().slice(0, 10)}` : ''
    return `- \`${e.name}\` ${ver} · ${phaseOf(e)}${heldTxt}${reasonTxt}`
  }
  // first 50 inline (phone-readable); the REST of the backlog stays human-
  // readable in a collapsed block — "见 index.json" is a dead end for the
  // raw-JSON machine plane (G3)
  const HELD_CAP = 50
  const heldList = held.length
    ? held.slice(0, HELD_CAP).map(heldLine).join('\n') +
      (held.length > HELD_CAP
        ? `\n\n<details><summary>…其余 ${held.length - HELD_CAP} 条（最老优先，点开看全量）</summary>\n\n` +
          held.slice(HELD_CAP).map(heldLine).join('\n') + '\n\n</details>'
        : '')
    : '_空_'
  // 本周期下架面 — npm-404/作者撤回/过滤出目录的 tombstone。下架是安全
  // 事件（恶意包被撤、repo 消失），不只库存变动；近 24h 窗口与 freshDay
  // 同口径。无下架时整段不渲染（常态安静）。
  const removedDay = index.removed
    .filter(r => Date.parse(r.disappearedAt) > dayAgo)

  return `# marketplace digest ${day}

> 本日报是**唯一完整的上架预告面**：下列 pass verdict 在本日报发布后进入成熟期（digest-appearance 门）。
> "no findings" ≠ safe.
> 📱 手机操作：点行的「审核单」链接开 issue → **Labels** 勾 \`verdict:pass\` 或 \`verdict:concern\` 即可写回裁决，零打字。
> 行标说明：⛔已被（包级/更新的）concern 刹车 = 该行已公告但不会放行；✅已被更新的 pass 解除 = concern 已被翻案；⚠️不在目录 = 该 verdict 针对的条目当前不在 index（已下架或未入库），公告照发但无槽可落。
${future ? `> ⚠️ ${future} 条 verdict 时间戳在未来，本期未计入——检查 verdict 写入端时钟。\n` : ''}${withheld ? `> ⚠️ 首次公告（bootstrap）：${withheld} 条早于 ${BOOTSTRAP_WINDOW_MS / 86_400_000} 天的历史裁决本期暂不公告——避免存量一次性成熟跳过异议窗口；下一期日报起恢复正常公告。\n` : ''}${badLines ? `> ⚠️ ${badLines} 行 verdict 无法解析已跳过——检查 ai-verdicts.jsonl（截断写入/合并冲突残留）。\n` : ''}
## ① 今日新放行（pass verdicts — ${passes.length}）

${passes.length ? table(passes) : '_无_'}${landed.length ? `\n\n上期公告·已生效 ${landed.length}：${landed.map(v => `\`${escMd(v.name)}\`@${v.version ?? '∅'}`).join('、')}` : ''}

## ② 审核队列积压（held — ${held.length}）

${heldList}

## ③ Concerns（${concerns.length}${resolved.length ? ` ·已解除 ${resolved.length}` : ''}）

${concerns.length || resolved.length ? table([...concerns, ...resolved]) : '_无_'}

## ④ 验证积压（queue — ${queue.length}）

- 待验证 ${queue.length}（投稿优先 ${qSubs}）/ 近 7 天验证失败 ${recentFailed} / 最老等待 ${oldestWait ? oldestWait.slice(0, 10) : '—'}${hostStale ? ` / 宿主版本漂移待重验 ${hostStale}` : ''}${drainDays ? ` / 按当前节奏约 ${drainDays} 天排空` : ''}

## ⑤ 评审积压（pending review — ${pendingReview.length}）

- 待评审 ${pendingReview.length}（与 diagnose/watchdog 同口径，含 48h 验证等待递延）/ 近 24h 新判 ${freshDay} / 最老待审 ${oldestReview ? oldestReview.slice(0, 10) : '—'} / 最新 AI 裁决 ${latestAiAt ? new Date(latestAiAt).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—'}${paused ? ' ⏸️ 本地诊断已声明暂停（catalog 分支 `diagnose.paused`，恢复：`bin/ai-diagnose.sh resume`）' : pendingReview.length > 0 && latestAiAt > 0 && now.getTime() - latestAiAt > 48 * 3_600_000 ? ' ⚠️ 超 48h 未出新判词——本机 ai-diagnose 疑似停摆' : ''}${healthNote}

## ⑥ 已上架条目信任信号（identity-level sec flags — ${liveAlarms.length}）

${liveAlarms.length
    ? liveAlarms.slice(0, 30).map(x =>
        `- \`${escMd(x.e.name)}\` ${x.e.latestVersion ? `v${x.e.latestVersion}` : '—'} · ${x.flags.map(escMd).join('; ')} — 需人工裁决：审核单或 [concern] issue 落在展示版即刹车`)
      .join('\n') + (liveAlarms.length > 30 ? `\n- …还有 ${liveAlarms.length - 30} 条（完整清单见 index.json redFlags）` : '')
    : '_无_'}
${removedDay.length ? `
## ⑦ 近 24h 下架（${removedDay.length}）

${removedDay.map(r => `- \`${escMd(r.name)}\` — ${r.reason}`).join('\n')}
` : ''}
---
generated ${now.toISOString()}（UTC 计日）
`
}

export async function main(args: string[] = process.argv): Promise<void> {
  const arg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined }
  const usage = 'usage: --index <p> --verdicts <p> --state <p> --out-dir <d> [--date YYYY-MM-DD] [--dry]'
  // process.exit(string) throws ERR_INVALID_ARG_TYPE at runtime — the usage
  // text never printed (same class fixed in diagnose.ts)
  const die = (m: string): never => { console.error(m); exit(1) }
  // `?? die(...)`: die returns never, so the result type is string — a plain
  // `if (!x) die()` does not narrow these bindings (same as diagnose.ts)
  const idxPath = arg('--index') ?? die(usage)
  const verdictsPath = arg('--verdicts') ?? die(usage)
  const statePath = arg('--state') ?? die(usage)
  const outDir = arg('--out-dir') ?? die(usage)
  const dry = args.includes('--dry')
  // an unparseable --date makes every toISOString() downstream throw a bare
  // RangeError — validate the backfill shape up front
  const dateArg = arg('--date')
  if (dateArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg))
    die(`${usage} — --date must be YYYY-MM-DD, got '${dateArg}'`)
  const now = dateArg !== undefined ? new Date(`${dateArg}T21:00:00Z`) : new Date()

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  // tolerant parse — one malformed line must not kill the whole daily digest
  // (the digest is the maturity anchor; a crash freezes every pass verdict);
  // the drop count rides into the header so the skip is visible, not log-only
  const sink = { bad: 0 }
  const verdicts = loadVerdicts(verdictsPath, sink)
  const prev = loadDigestState(statePath)
  // diagnose.paused = the local AI queue is declared stopped — say so in §⑤
  // instead of letting the backlog read like an undiagnosed stall
  const paused = existsSync(join(outDir, 'diagnose.paused'))
  // worker self-report — absent on catalogs published before the health
  // leg existed; a corrupt file must not kill the digest (it's advisory)
  let health: DigestInput['health'] = null
  try {
    const h = JSON.parse(readFileSync(join(outDir, 'diagnose-health.json'), 'utf8')) as Record<string, unknown>
    health = { at: typeof h.at === 'string' ? h.at : undefined, l05: typeof h.l05 === 'string' ? h.l05 : undefined, omlx: typeof h.omlx === 'string' ? h.omlx : undefined }
  } catch { /* no stamp yet — fine */ }

  // state LOSS ≠ bootstrap: prev=null with digests already published means
  // digest-state.json vanished or went corrupt. Rendering on would announce
  // every live verdict at once — the whole backlog skipping its objection
  // window in one shot (fail-open). Refuse loudly instead; the watchdog's
  // alert job opens a pipeline-alert issue on this failure (Bug-2).
  if (prev === null) {
    let hasHistory = false
    try { hasHistory = readdirSync(join(outDir, 'digest')).some(f => f.endsWith('.md')) } catch { /* no dir */ }
    // throw (not exit): the main().catch wrapper prints and exits 1 the same
    // way, but the failure stays assertable in tests
    if (hasHistory)
      throw new Error(`digest-state.json missing/corrupt but digest/*.md exists — refusing to re-announce everything. Restore digest-state.json (or rebuild it from ai-verdicts.jsonl) and rerun.`)
  }

  const md = renderDigest({ index, verdicts, prev, now, paused, health, badLines: sink.bad })
  const day = now.toISOString().slice(0, 10)
  const digestPath = join(outDir, 'digest', `${day}.md`)
  const next = nextDigestState(verdicts, prev, now, index)
  if (dry) {
    console.log(md)
    console.log(`[digest] lastDigestAt ${prev?.lastDigestAt ?? '∅'} → ${next.lastDigestAt}; announced ${prev?.announced.length ?? 0} → ${next.announced.length}`)
    return
  }
  mkdirSync(join(outDir, 'digest'), { recursive: true })
  // tmp+rename for BOTH artifacts: a crash mid-write must not leave a torn
  // file for the workflow to `git add` and push — a truncated
  // digest-state.json makes the NEXT render refuse via the state-loss guard
  // (frozen until manual restore), a torn md is a corrupted public document.
  // Tmp files live in outDir's ROOT: `git add digest/` globs the directory
  // and would happily stage a stray inside it (same-dir rename stays atomic).
  const mdTmp = join(outDir, `.digest-${day}.tmp`)
  writeFileSync(mdTmp, md)
  renameSync(mdTmp, digestPath)
  // --date = backfill a missed day's DOCUMENT only. Writing state with a
  // backdated `now` would stamp day/dayAnnounced as that day and wedge the
  // same-day accumulation semantics; the skipped announcements re-enter
  // normally at the next real render (they were never in announced).
  if (args.includes('--date')) {
    console.log(`[digest] backfilled ${digestPath} — digest-state.json left untouched (next real render advances the anchor)`)
    return
  }
  const stateTmp = `${statePath}.tmp`
  writeFileSync(stateTmp, JSON.stringify(next, null, 2))
  renameSync(stateTmp, statePath)
  console.log(`[digest] wrote ${digestPath}; lastDigestAt=${next.lastDigestAt}; announced=${next.announced.length}`)
}

/* v8 ignore next 4 */
if (isMain(import.meta.url)) {
  main().catch(x => { console.error(x); exit(1) })
}
