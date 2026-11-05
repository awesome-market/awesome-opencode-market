/** AI verdict consumption (AI-DIAGNOSIS §4/§10): load catalog-branch
 *  ai-verdicts.jsonl and apply mature verdicts to the OLD index at the start
 *  of a catalog run — BEFORE discovery comparison, so a high-frequency
 *  package's reviewed-but-unreleased version gets a deterministic release
 *  window instead of being starved by the next version bump. */
import { readFileSync } from 'node:fs'
import { AiVerdict, DigestState, type CatalogIndex, type PluginEntry, type PendingUpdate } from '../src/schema.ts'

export function loadVerdicts(path?: string, sink?: { bad: number }): AiVerdict[] {
  if (!path) return []
  try {
    let bad = 0
    const out = readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      .flatMap(l => {
        try {
          const v = AiVerdict.parse(JSON.parse(l))
          // normalize NON-Z `at` (offset stamps like '+08:00') at the read
          // boundary: `z.iso.datetime()` accepts them, and every downstream
          // compare is lexicographic (akey membership, at<=now) — an offset
          // instant akeys differently from the same instant in Z and would
          // announce twice. Z-form strings stay VERBATIM: `at` is the line's
          // identity — rewriting '...:00Z' to '...:00.000Z' changes akey and
          // invalidates every digest-state entry recorded under the original
          // spelling (Bug-4).
          if (!v.at.endsWith('Z')) v.at = new Date(v.at).toISOString()
          return [v]
        } catch { bad++; return [] }
      })
    // append-only audit log: a corrupt line (truncated write, merge artifact)
    // must not silently vanish — count it so ops can notice. `sink.bad` lets
    // a caller surface the count in its own output (digest header); without
    // it the only trace is this warn line in a CI log nobody reads.
    if (bad) console.warn(`[verdicts] dropped ${bad} malformed line(s) from ${path}`)
    if (sink) sink.bad = bad
    return out
  } catch { return [] }
}

/** Full digest-state.json — null on missing/unreadable (fail-closed: every
 *  pass verdict stays frozen until the first digest exists). */
export function loadDigestState(path?: string): DigestState | null {
  if (!path) return null
  try {
    return DigestState.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch { return null }
}

export function loadLastDigestAt(path?: string): string | null {
  return loadDigestState(path)?.lastDigestAt ?? null
}

/** verdict lookup key — NUL separator (a '@' join collides with scoped names
 *  like @kyan-plugins/x@1.0 and silently broke diagnose's seen-check: every
 *  entry always looked unreviewed → re-reviewed every tick) */
export const vkey = (name: string, version: string | null | undefined) => `${name}\0${version ?? ''}`

/** `at` ordering must be chronological, not lexicographic — ISO strings with
 *  non-Z offsets ('+08:00') misorder under string compare. Numeric parse wins;
 *  string tiebreak keeps same-ms appends deterministic (later line wins). */
export const atCmp = (a: string, b: string) => {
  const d = Date.parse(a) - Date.parse(b)
  return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0
}

/** announcement key — identifies a verdict LINE, not just the target: a new
 *  judgment on the same name@version must be announced again before it can
 *  mature. Stored in DigestState.announced. */
export const akey = (v: Pick<AiVerdict, 'name' | 'version' | 'at'>) => `${vkey(v.name, v.version)}\0${v.at}`

/** Test/tooling helper: build the DigestState a digest render would write for
 *  `verdicts` at anchor `lastDigestAt` — all of them announced on an EARLIER
 *  day (dayAnnounced empty) so they satisfy the maturity rule, not merely
 *  the announcement rule. Pass `dayAnnounced` overrides via spread for
 *  same-day-window tests. */
export function digestStateOf(lastDigestAt: string, verdicts: AiVerdict[], dayAnnounced: string[] = []): DigestState {
  return { lastDigestAt, announced: verdicts.map(akey), day: lastDigestAt.slice(0, 10), dayAnnounced }
}

/** Newest verdict per name@version — the file is append-only, `at` wins. */
export function latestVerdicts(verdicts: AiVerdict[]): Map<string, AiVerdict> {
  const m = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    const k = vkey(v.name, v.version)
    const cur = m.get(k)
    if (!cur || atCmp(v.at, cur.at) >= 0) m.set(k, v)
  }
  return m
}

/** Latest HUMAN verdict per key — the brake layer under latestVerdicts.
 *  Shared by applyMatureVerdicts (R-4 stickiness) and display surfaces
 *  (docket/digest) that need to show "a human brake stands" context. */
export function latestHumanVerdicts(verdicts: AiVerdict[]): Map<string, AiVerdict> {
  const m = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    if (v.source !== 'human') continue
    const k = vkey(v.name, v.version)
    const cur = m.get(k)
    if (!cur || atCmp(v.at, cur.at) >= 0) m.set(k, v)
  }
  return m
}

/** R-4: an ai 'pass' can never outrank a human 'concern' on the same key —
 *  only a newer HUMAN verdict lifts a human brake. An ai 'concern' may still
 *  override a human 'pass' (conservative direction stays open). */
export function effectiveVerdict(v: AiVerdict | undefined, human: Map<string, AiVerdict>): AiVerdict | undefined {
  const h = v ? human.get(vkey(v.name, v.version)) : undefined
  return v?.verdict === 'pass' && v.source === 'ai' && h?.verdict === 'concern' ? h : v
}

/** Package-level human brake — a 'concern' on name\0null brakes EVERY slot of
 *  the package ("this package", not "this version"). Returns the brake LINE
 *  when it applies to (name, version), else undefined. A newer human 'pass'
 *  on the exact slot key lifts it for that slot only; a newer human verdict
 *  on name\0null flips the map entry and dissolves it entirely. Human-only
 *  by construction: AI never writes the null key for npm packages, and
 *  version===null slots (github-kind) own the null key themselves — it is
 *  their slot verdict, not a package brake.
 *
 *  THE shared predicate: applyMatureVerdicts (release gate), explainEntry,
 *  docketTargets, unreviewedTargets and the digest phase/brake marks must
 *  never drift apart — a surface that misses the brake shows a release the
 *  gate can never grant (and diagnose would burn LLM tokens on a verdict
 *  the brake overrides forever). */
export function pkgBrakeFor(
  name: string, version: string | null, latestHuman: Map<string, AiVerdict>,
): AiVerdict | undefined {
  if (version === null) return undefined
  const h = latestHuman.get(vkey(name, null))
  if (h?.verdict !== 'concern') return undefined
  const slotHuman = latestHuman.get(vkey(name, version))
  if (slotHuman?.verdict === 'pass' && atCmp(slotHuman.at, h.at) > 0) return undefined
  return h
}

/** Release gate (AI-DIAGNOSIS §10): the target version's own verification must
 *  have run. 'verified' = install/load passed. 'skipped' = deliberately not
 *  run (red-flag short-circuit, or no-install-concept kinds like github entries)
 *  — an AI pass on a flagged entry is already intercepted below, so a skipped
 *  entry can only release via a human pass: an informed, audited decision.
 *  'unverified'/'failed' = never releasable — a verify outage freezes releases
 *  rather than letting anything through (fail-closed). */
const RELEASABLE = new Set(['verified', 'skipped'])

export interface VerdictApplyResult {
  index: CatalogIndex
  /** "name@version" promoted to display by this application */
  releases: string[]
  /** "name@version" concern-annotated (or braked back to pending) */
  held: string[]
}

/** Apply mature verdicts to an index. Semantics per AI-DIAGNOSIS §10:
 *  - `pass` matures only when its exact verdict LINE appears in
 *    `digest.announced` — set membership, not a timestamp check
 *  - `concern` applies immediately (conservative direction needs no window)
 *  - `source:ai` pass landing on a red-flagged entry is ignored (defense in
 *    depth — the model never reaches flagged content with a release);
 *    `source:human` pass is allowed (stamped by our writers, audited)
 *  - concern on the DISPLAYED version → approval back to pending (human brake;
 *    the AI only audits pending targets, so this can only be a human verdict)
 *  - human stickiness: `latest` ranks by `at` alone, so an ai 'pass' stamped
 *    after a human 'concern' (skewed writer clock, or just a later re-review)
 *    would otherwise outrank the brake and release over it. Only a newer
 *    HUMAN verdict lifts a human concern; an ai 'concern' may still override
 *    a human 'pass' — the conservative direction stays open. */
export function applyMatureVerdicts(
  index: CatalogIndex,
  verdicts: AiVerdict[],
  digest: DigestState | null,
): VerdictApplyResult {
  const latest = latestVerdicts(verdicts)
  const releases: string[] = []
  const held: string[] = []
  if (latest.size === 0) return { index, releases, held }
  const latestHuman = latestHumanVerdicts(verdicts)
  const effective = (v: AiVerdict | undefined): AiVerdict | undefined => effectiveVerdict(v, latestHuman)
  // Maturity = the verdict LINE was announced in a digest — membership, not a
  // timestamp comparison. A verdict pushed late with an old `at` can never
  // slip under the anchor; it must appear in a future digest first.
  // Objection window (R-6 upgrade): the line must have appeared in a digest
  // BEFORE the current one — dayAnnounced holds the latest render's fresh
  // announcements, so announce→release can never collapse to the ~6h
  // announce→next-catalog minimum. The window is announce→next digest
  // (~24h) + catalog lag; a dead digest freezes maturity too (dayAnnounced
  // only clears on the next successful render — fail-closed, watchdog's
  // digest-state leg fires at 36h).
  const announced = new Set(digest?.announced ?? [])
  const dayAnnounced = new Set(digest?.dayAnnounced ?? [])
  const mature = (v: AiVerdict) => announced.has(akey(v)) && !dayAnnounced.has(akey(v))
  const concernOf = (v: AiVerdict) => v.reason ?? 'concern'
  // sha pins the REVIEWED bytes: a same-version registry re-tag after the
  // verdict was written means the judgment no longer describes what would
  // ship — the release gate refuses rather than certify new bytes. Missing
  // sha (github-kind, legacy verdicts) or missing slot integrity (legacy
  // holds) can't be compared → allowed; run.ts's anchorIntegrity drift flag
  // is the scheduled backstop for those.
  const shaOk = (v: AiVerdict, integrity: string | null | undefined) =>
    !v.sha || !integrity || v.sha === integrity
  // package-level brake: a HUMAN verdict on name@null brakes every slot of
  // the package — version-less concern means "this package", not "this
  // version" (previously a dead key for npm entries: it matched no slot and
  // silently did nothing). Lifting needs a newer human verdict on the exact
  // slot key, or a newer human verdict on name@null itself — which flips
  // latestHuman back to non-concern and dissolves the brake. Shared
  // predicate: pkgBrakeFor.
  const verdictFor = (name: string, version: string | null): AiVerdict | undefined =>
    pkgBrakeFor(name, version, latestHuman) ?? effective(latest.get(vkey(name, version)))

  const plugins = index.plugins.map(entry => {
    let e = entry
    // 1. held-version slot — pendingUpdate releases only via its own keyed verdict
    if (e.pendingUpdate) {
      const pu = e.pendingUpdate
      const v = verdictFor(e.name, pu.version)
      if (v?.verdict === 'concern') {
        const reason = concernOf(v)
        if (pu.reason !== reason) {
          e = { ...e, pendingUpdate: { ...pu, reason } }
          held.push(`${e.name}@${pu.version}`)
        }
      } else if (v && mature(v)
        // 没扫到 ≠ 安全: an AI pass may not release a slot the scanner never
        // ran on (scannedAt null) — same treatment as red flags. Human pass
        // stays an informed-decision escape hatch.
        && !(v.source === 'ai' && (pu.capabilities.redFlags.length > 0 || pu.capabilities.scannedAt === null))
        // only pu.integrity describes the CANDIDATE's bytes — e.integrity
        // pins the displayed version and would false-block every legacy
        // hold (pre-pu.integrity) whose verdict carries a sha
        && shaOk(v, pu.integrity)
        && RELEASABLE.has(pu.verification.status)) {
        e = {
          ...e,
          approval: 'approved',
          approvalReason: undefined,
          latestVersion: pu.version,
          // pu.publishedAt null means the CANDIDATE has no publish stamp —
          // falling back to e.publishedAt would display the OLD version's
          // date on the new release; null is the honest value
          publishedAt: pu.publishedAt ?? null,
          capabilities: pu.capabilities,
          verification: pu.verification,
          // legacy holds predate pu.features — promoting the displayed
          // version's features would misroute verify for the new release;
          // absent features verify as feature-less (same as a fresh entry
          // with no detected features)
          features: pu.features ?? [],
          // promote the HELD version's parts — e.contains still describes the
          // previously displayed release while the hold was in place
          contains: pu.contains ?? e.contains,
          // the released version's own SRI — e.integrity pins the DISPLAYED
          // tarball while held; leaving it would pin the new version's bytes
          // against the old tarball's hash (site skill-build skips, client
          // install fails integrity). Legacy holds lack the field → falls
          // back to the old SRI and heals at the next metrics refresh
          integrity: pu.integrity ?? e.integrity,
          source: { ...e.source, version: pu.version },
          pendingUpdate: undefined,
        }
        releases.push(`${e.name}@${pu.version}`)
      }
    }
    // 2. displayed-version slot — pending entries approve here; displayed
    //    entries get pulled back to pending by a human concern
    const v = verdictFor(e.name, e.latestVersion)
    // a package-level human pass (name@null) just dissolved a brake — with
    // no slot verdict to drive the reset the stale concern reason would
    // linger on a pending entry; clear it to the neutral awaiting state
    const pkgPass = !v && latestHuman.get(vkey(e.name, null))?.verdict === 'pass'
    if (v) {
      if (e.approval === 'pending' || e.approval === 'legacy') {
        if (v.verdict === 'concern') {
          const reason = concernOf(v)
          if (e.approval === 'legacy') {
            // legacy entries are displayed-but-unreviewed: a concern on the
            // shown version brakes them into the normal pending flow
            e = { ...e, approval: 'pending', approvalReason: reason }
            held.push(`${e.name}@${e.latestVersion ?? 'null'}`)
          } else if (e.approvalReason !== reason) {
            e = { ...e, approvalReason: reason }
            held.push(`${e.name}@${e.latestVersion ?? 'null'}`)
          }
        } else {
          // a newer pass superseded the concern that set approvalReason —
          // the entry is awaiting maturity/re-verification now, not held by
          // that stale rationale
          if (e.approvalReason && e.approvalReason !== 'awaiting-review')
            e = { ...e, approvalReason: 'awaiting-review' }
          if (mature(v)
            && !(v.source === 'ai' && (e.capabilities.redFlags.length > 0 || e.capabilities.scannedAt === null))
            && shaOk(v, e.integrity)
            && RELEASABLE.has(e.verification.status)) {
            e = { ...e, approval: 'approved', approvalReason: undefined }
            releases.push(`${e.name}@${e.latestVersion ?? 'null'}`)
          }
        }
      } else if (v.verdict === 'concern') {
        e = { ...e, approval: 'pending', approvalReason: concernOf(v) }
        held.push(`${e.name}@${e.latestVersion ?? 'null'}`)
      }
    } else if (pkgPass && (e.approval === 'pending' || e.approval === 'legacy')
        && e.approvalReason && e.approvalReason !== 'awaiting-review') {
      e = { ...e, approvalReason: 'awaiting-review' }
    }
    // R-9 at the source: a pending entry's latestVersion IS the candidate —
    // a leftover pendingUpdate is always a stale shadow (brake on the shown
    // version, superseded hold). mergeEntries drops it at publish-merge;
    // doing it here keeps indexes written by release.ts valid too.
    if (e.approval === 'pending' && e.pendingUpdate)
      e = { ...e, pendingUpdate: undefined }
    return e
  })
  return { index: { ...index, plugins }, releases, held }
}

export interface SlotExplain {
  slot: 'displayed' | 'pendingUpdate'
  version: string | null
  verdict: 'pass' | 'concern' | null
  source: 'ai' | 'human' | null
  /** the winning line's `at` — what an announced/dedupe check keys on */
  at: string | null
  /** exact verdict line ∈ digest.announced — the maturity predicate */
  announced: boolean
  /** ai 'pass' outranked by a human 'concern' on the same key (R-4) */
  stickyHuman: boolean
  /** ai 'pass' landing on a red-flagged slot — ignored by the gate */
  aiBlockedByFlags: boolean
  /** ai 'pass' landing on a never-scanned slot — ignored by the gate (没扫到≠安全) */
  aiBlockedByNoScan: boolean
  verification: string
  outcome: 'release' | 'brake' | 'concern' | 'wait' | 'none'
  why: string
}

/** Decision-chain explainer for ops: per held/displayed slot, which verdict
 *  won, whether it is announced, and why it did (or did not) apply — the same
 *  gates applyMatureVerdicts evaluates, decomposed for `release.ts --explain`
 *  instead of a bare releases/held count. */
export function explainEntry(
  e: Pick<PluginEntry, 'name' | 'latestVersion' | 'approval' | 'capabilities' | 'verification' | 'integrity'>
    & { pendingUpdate?: Pick<PendingUpdate, 'version' | 'capabilities' | 'verification' | 'integrity'> | undefined },
  verdicts: AiVerdict[],
  digest: DigestState | null,
): SlotExplain[] {
  const latest = latestVerdicts(verdicts)
  const latestHuman = latestHumanVerdicts(verdicts)
  const announced = new Set(digest?.announced ?? [])
  const dayAnnounced = new Set(digest?.dayAnnounced ?? [])
  const verdictFor = (version: string | null): { v: AiVerdict | undefined; packageBrake: boolean } => {
    // shared predicate: a human concern on name@null overrides every slot
    // unless a newer human pass exists on that slot key (version===null is
    // the slot's own key, not a package override — pkgBrakeFor skips it)
    const brake = pkgBrakeFor(e.name, version, latestHuman)
    if (brake) return { v: brake, packageBrake: true }
    return { v: effectiveVerdict(latest.get(vkey(e.name, version)), latestHuman), packageBrake: false }
  }
  const slotOf = (
    slot: SlotExplain['slot'], version: string | null,
    redFlags: number, unscanned: boolean, verification: string,
    integrity?: string | null,
  ): SlotExplain => {
    const { v, packageBrake } = verdictFor(version)
    const raw = latest.get(vkey(e.name, version))
    const base = {
      slot, version,
      verdict: v?.verdict ?? null,
      source: v?.source ?? null,
      at: v?.at ?? null,
      announced: v ? announced.has(akey(v)) : false,
      stickyHuman: raw !== undefined && raw !== v && !packageBrake,
      aiBlockedByFlags: v?.verdict === 'pass' && v.source === 'ai' && redFlags > 0,
      aiBlockedByNoScan: v?.verdict === 'pass' && v.source === 'ai' && unscanned,
      verification,
    }
    if (!v) return { ...base, outcome: 'none', why: '无裁决 — 等评审' }
    const pre = packageBrake ? '包级刹车（version=null human concern）→ ' : ''
    if (v.verdict === 'concern') {
      const braking = slot === 'displayed' && e.approval !== 'pending' && e.approval !== 'legacy'
      return { ...base, outcome: braking ? 'brake' : 'concern',
        why: `${pre}${braking ? 'concern 命中展示版 → 回 pending（刹车）' : `concern → 保持 hold（${v.reason ?? ''}）`}` }
    }
    // pass on an ALREADY-LIVE display slot is a no-op verdict: nothing is
    // being asked to mature, so "未成熟" would be misleading — it released
    // long ago (that's why the slot is displayed)
    if (slot === 'displayed' && e.approval !== 'pending' && e.approval !== 'legacy')
      return { ...base, outcome: 'release', why: '展示版已上架（pass 无需再生效）' }
    // pass: run the release gates in order and report the first blocker.
    // Structural impossibilities (flags/no-scan — AI can never release this
    // slot regardless of timing) outrank the temporal gates or the report
    // would promise a release "soon" that no wait can produce.
    if (!base.announced) return { ...base, outcome: 'wait', why: `${pre}pass 未成熟 — verdict 行未进 digest 公示` }
    if (base.aiBlockedByFlags) return { ...base, outcome: 'wait', why: `${pre}ai pass 落在 redFlag 槽位 — 被忽略` }
    if (base.aiBlockedByNoScan) return { ...base, outcome: 'wait', why: `${pre}ai pass 落在未扫描槽位 — 没扫到 ≠ 安全，被忽略` }
    // announced in the LATEST digest — the objection window is still open:
    // maturity needs the line to survive one more render (dayAnnounced
    // membership), same gate applyMatureVerdicts applies
    if (dayAnnounced.has(akey(v!))) return { ...base, outcome: 'wait', why: `${pre}pass 已进最新日报 — 异议窗开放中，下期日报后成熟` }
    if (v.sha && integrity && v.sha !== integrity)
      return { ...base, outcome: 'wait', why: `${pre}verdict 钉的字节（${v.sha.slice(0, 20)}…）与槽位 integrity 不符 — 疑似同版本换包，等 drift 复审` }
    if (!RELEASABLE.has(verification)) return { ...base, outcome: 'wait', why: `${pre}verification=${verification} 不可放行` }
    return { ...base, outcome: 'release', why: `${pre}pass 成熟 + 可放行 → 生效` }
  }
  const out: SlotExplain[] = []
  if (e.pendingUpdate) {
    out.push(slotOf('pendingUpdate', e.pendingUpdate.version,
      e.pendingUpdate.capabilities.redFlags.length, e.pendingUpdate.capabilities.scannedAt === null,
      e.pendingUpdate.verification.status, e.pendingUpdate.integrity))
  }
  out.push(slotOf('displayed', e.latestVersion, e.capabilities.redFlags.length,
    e.capabilities.scannedAt === null, e.verification.status, e.integrity))
  return out
}
