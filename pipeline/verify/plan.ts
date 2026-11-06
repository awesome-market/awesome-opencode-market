/** Verify shard planner (was inline `node -e` in verify.yml — extracted for
 *  tests). Emits {name,version,features} targets pinned to the version under
 *  review: pendingUpdate for held bumps, latestVersion otherwise (DEV §4 —
 *  verify measures the version users will actually install). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogIndex, type AiVerdict, type PluginEntry } from '../../src/schema.ts'
import { candidateHeldAt } from '../ai/diagnose.ts'
import { OPENCODE_VERSION } from '../publish/merge.ts'
import { loadVerdicts, latestVerdicts, latestHumanVerdicts, slotVerdict, tombEpochs, candidateSlot } from '../verdicts.ts'
import type { VerifyTarget } from './verify.ts'

/** The version a verify run should exercise, and the metadata describing it. */
export function verifyTargetOf(e: PluginEntry): { version: string | null; git?: { repo: string; sha?: string }; unverified: boolean; flagged: boolean; features: string[]; hostStale: boolean; verification: PluginEntry['verification'] } {
  // a pending entry's candidate is the ENTRY itself — a leftover
  // pendingUpdate is the B3 inverted state (dropped by the R-9 cleanup);
  // verifying the stale hold's version would measure bytes not under review
  const slot = candidateSlot(e)
  const version = slot ? slot.version : e.latestVersion
  const verification = slot ? slot.verification : e.verification
  const caps = slot ? slot.capabilities : e.capabilities
  const features = slot?.features ?? e.features ?? []
  return {
    version,
    // github-kind target: `plugin add owner/repo#<sha>` pins the REVIEWED
    // commit (source.version = the tree sha the pipeline scanned) — verifying
    // HEAD would measure bytes the scan never saw, and the result carries no
    // integrity anchor for merge's drift check to hold it to. source.repo is
    // the canonical-cased fullName; id is the entry-name fallback. A github
    // entry WITHOUT source.version (pre-anchor legacy rows — run.ts's reuse
    // gate backfills them) has no pinned bytes to measure: emit no target at
    // all rather than certify an unanchored HEAD install as 'verified'.
    ...(e.source.kind === 'github' && e.source.version
      ? { git: { repo: e.source.repo ?? e.source.id, sha: e.source.version } }
      : {}),
    unverified: verification.status === 'unverified',
    flagged: caps.redFlags.length > 0,
    features,
    // a verified result binds the host it ran on: a different (or absent —
    // predating the field) opencodeVersion means the displayed claim was
    // never exercised on the current runtime and re-enters the queue.
    // 'unknown' (the shard's own version probe failed) is NOT stale —
    // unknown ≠ different; treating it as stale re-queued the slot forever.
    // level 'structure' is excluded: that check inspects tarball bytes only —
    // it never ran the host, so host version drift can't invalidate it (it
    // would otherwise jump the staleHost priority tier for free minutes).
    hostStale: verification.status === 'verified'
      && verification.level !== 'structure'
      && verification.opencodeVersion !== 'unknown'
      && verification.opencodeVersion !== OPENCODE_VERSION,
    verification,
  }
}

// V-3 bounded-retry predicate lives in verify/retryable.ts — diagnose
// imports the same semantics there (importing them here would cycle
// plan → diagnose → plan). Re-exported so run.ts/tests keep working.
export { retryable, MAX_FAILED_ATTEMPTS } from './retryable.ts'
import { retryable } from './retryable.ts'

/** Shared queue membership (planTargets + digest backlog §④): an unflagged
 *  slot with an installable payload that is unverified, a retryable recent
 *  failure, host-stale, or a cleared 'skipped' — and not already condemned by
 *  a verdict. Keeping one predicate stops the digest from under-reporting the
 *  queue the worker sees. */
export function verifyQueued(
  e: PluginEntry, _now = new Date(),
  latest?: Map<string, AiVerdict>, latestHuman?: Map<string, AiVerdict>,
  tomb?: Map<string, string>,
): boolean {
  const t = verifyTargetOf(e)
  // an npm slot needs a version to pin; a github-kind slot needs a repo spec.
  // Anything else has no installable address to point the runner at.
  if (!t.version && !t.git) return false
  // a github slot without the pinned commit (source.version) has NO reviewed
  // bytes to measure — the runner would install whatever HEAD serves and a
  // 'verified' would endorse unscanned code (nothing anchors the drift check
  // either). It stays unverified until the slot re-pins.
  if (t.git && (!t.git.repo || !t.git.sha)) return false
  if (t.flagged) return false
  // entries with no verifiable payload are never queued — the predicate must
  // match planTargets' parts filter or the digest §④ backlog over-counts
  const parts = verifyPartsOf(e)
  if (!parts.includes('plugin') && !parts.includes('skill')) return false
  // a standing concern (slot-keyed or package brake) already judged these
  // bytes — re-verifying re-measures a condemned verdict. The verdict moving
  // re-enters the slot naturally; only --retest bypasses.
  if (latest && slotVerdict(latest, latestHuman ?? new Map(), e.name, t.version, tomb)?.verdict === 'concern') return false
  const ver = t.verification
  // 'skipped' only exists because red flags vetoed a run — flags gone means
  // the skip reason no longer describes the slot, so it re-queues for an
  // honest measurement instead of displaying a stale "没跑" forever. Host-
  // stale (a verified result bound to an old runtime) likewise re-measures.
  return t.unverified || ver?.status === 'skipped' || retryable(ver) || t.hostStale
}

/** The installable parts a verify run must prove, normalized from `contains`.
 *  Legacy entries predate the field — plugin-shaped unless the submission
 *  declared itself a skill (type 'skill' + no parts), whose payload is
 *  SKILL.md rather than a loadable plugin artifact.
 *  With a hold in place the CANDIDATE's parts live on pendingUpdate.contains
 *  (entry.contains is pinned to the displayed release); holds predating that
 *  field still carry candidate parts on the entry itself. */
export function verifyPartsOf(e: PluginEntry): NonNullable<PluginEntry['contains']> {
  // an explicit contains field — including [] — is authoritative: []
  // means "no installable payload" and must NOT fall back to type-inferred
  // parts (skill-only npm packages would re-enter the plugin verify chain)
  // Mirror verifyTargetOf's slot rule (candidateSlot): on a PENDING entry the
  // candidate is the entry itself — a leftover pendingUpdate is the B3
  // inverted state (dropped by the R-9 cleanup) whose parts describe bytes
  // not under review.
  const slot = candidateSlot(e)
  const c = slot?.contains ?? e.contains
  return c !== undefined ? c : [e.type === 'skill' ? 'skill' : 'plugin']
}

/** Slots whose recorded verify ran on a different host version — the bounded
 *  re-verification backlog. Same filters as the queue (installable parts,
 *  unflagged, versioned) but orthogonal membership: these are 'verified'
 *  results invalidated by an opencode upgrade. */
export function hostStaleVerify(e: PluginEntry): boolean {
  const t = verifyTargetOf(e)
  if ((!t.version && !t.git) || t.flagged || !t.hostStale) return false
  const parts = verifyPartsOf(e)
  return parts.includes('plugin') || parts.includes('skill')
}

export function planTargets(index: CatalogIndex, cap = 48, retest = false, now = new Date(),
  latest?: Map<string, AiVerdict>, latestHuman?: Map<string, AiVerdict>): VerifyTarget[] {
  const subs: VerifyTarget[] = []
  const staleHost: VerifyTarget[] = []
  const rest: VerifyTarget[] = []
  // epoch map for the queue's verdict-condemned check — a pre-tombstone pass
  // must not dissolve a live package brake here either (brakeFor/slotVerdict)
  const tomb = tombEpochs(index.removed)
  // FIFO by candidate hold age (same clock diagnose consumes) — index order
  // is name-asc, so without this a deep backlog starves alphabetically-late
  // packages forever while early ones hog every run's cap
  const ordered = [...index.plugins]
    .sort((a, b) => (candidateHeldAt(a) || 0) - (candidateHeldAt(b) || 0))
  for (const p of ordered) {
    const t = verifyTargetOf(p)
    // retest (manual `targets` dispatch) may re-run failed/verified versions;
    // recent failed slots also re-enter automatically while retries < 3 (V-3).
    // Flagged stays excluded in every mode: red-flagged code never executes here.
    if ((!t.version && !t.git) || t.flagged || (t.git && (!t.git.repo || !t.git.sha))) continue
    // host-version drift, cleared-flag skips, and retryable failures all fold
    // into the one queue predicate — verdict-condemned slots drop out inside
    // it unless a manual --retest asks for them back
    if (!retest && !verifyQueued(p, now, latest, latestHuman, tomb)) continue
    const parts = verifyPartsOf(p)
    // no plugin artifact AND no skill payload — nothing exists to honestly
    // verify (mcp/command/agent entries have no structure check yet)
    if (!parts.includes('plugin') && !parts.includes('skill')) continue
    const target: VerifyTarget = {
      name: p.name,
      ...(t.version ? { version: t.version } : {}),
      ...(t.git ? { git: t.git } : {}),
      ...(t.features.length ? { features: t.features } : {}),
      parts,
    }
    // submission-originated entries verify first — a human asked for them.
    // Host-stale re-verification outranks the normal queue: those entries
    // are DISPLAYED as verified on a runtime the claim was never exercised
    // on. Within each tier the pre-sort above keeps oldest-held first.
    ;(p.discoveredVia?.includes('submission') ? subs : t.hostStale ? staleHost : rest).push(target)
  }
  return [...subs, ...staleHost, ...rest].slice(0, cap)
}

/** Greedy weight-balanced sharding: each target lands on the currently
 *  lightest shard. Sequential slicing clustered the submission-priority tier
 *  (and any run of feature-heavy targets) into the first shards, so a heavy
 *  shard could hit the 35min timeout while others sat idle. `weight` lets the
 *  caller charge feature-routed targets their real minutes; ties and empty
 *  items break to the lowest index — deterministic for a given input. */
export function shard<T>(items: T[], size: number, weight: (t: T) => number = () => 1): T[][] {
  if (!items.length) return []
  const n = Math.max(1, Math.ceil(items.length / size))
  const out: { t: T[]; w: number }[] = Array.from({ length: n }, () => ({ t: [], w: 0 }))
  for (const it of items) {
    let best = 0
    for (let i = 1; i < n; i++) if (out[i]!.w < out[best]!.w) best = i
    out[best]!.t.push(it)
    out[best]!.w += weight(it)
  }
  return out.filter(b => b.t.length).map(b => b.t)
}

/** Shard weighting — charge the EXTRA STAGES a target routes to: tui (~10s
 *  settle) and gui (~90s jsdom eval) each cost real minutes; server/rpc ride
 *  free on the plugin check; dual plugin+skill pays for BOTH payloads. */
export const targetWeight = (t: VerifyTarget): number =>
  1 + (t.features?.filter(f => f === 'tui' || f === 'gui').length ?? 0)
    + (t.parts?.includes('plugin') && t.parts?.includes('skill') ? 1 : 0)

/* v8 ignore next 20 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [indexPath, outDir, verdictsPath] = process.argv.slice(2)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(indexPath!, 'utf8')))
  // a negative/zero cap would slice(0,-N) — verify nearly the whole queue
  // instead of none; only a positive integer is an operator cap
  const capNum = Number(process.env.VERIFY_CAP)
  const cap = Number.isFinite(capNum) && capNum > 0 ? Math.floor(capNum) : 48
  // optional verdict feed — a condemned slot isn't worth a shard measuring it.
  // Absent (local runs) the queue just doesn't apply the verdict filter.
  const verdicts = verdictsPath ? loadVerdicts(verdictsPath) : []
  const latest = verdicts.length ? latestVerdicts(verdicts) : undefined
  const latestHuman = verdicts.length ? latestHumanVerdicts(verdicts) : undefined
  const targets = planTargets(index, cap, process.argv.includes('--retest'), new Date(), latest, latestHuman)
  // 12/shard with 2 intra-shard lanes ≈ the old 8×serial wall-clock (~30min
  // worst case): each lane still only carries ~6 targets. Feature-staged
  // targets cost real minutes — targetWeight keeps shards balanced on time.
  const shards = shard(targets, 12, targetWeight)
  mkdirSync(outDir!, { recursive: true })
  shards.forEach((s, i) => writeFileSync(join(outDir!, `shard-${i}.json`), JSON.stringify(s)))
  // matrix list goes to a file, not stdout-position — a future log line can't
  // silently corrupt the workflow's shard list (was `tail -1` scraping)
  writeFileSync(join(outDir!, 'plan-matrix.json'), JSON.stringify(shards.map((_, i) => i)))
  console.log(`plan: ${targets.length} targets, ${shards.length} shards`)
  console.log(JSON.stringify(shards.map((_, i) => i)))
}
