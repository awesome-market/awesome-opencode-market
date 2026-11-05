/** Verify shard planner (was inline `node -e` in verify.yml — extracted for
 *  tests). Emits {name,version,features} targets pinned to the version under
 *  review: pendingUpdate for held bumps, latestVersion otherwise (DEV §4 —
 *  verify measures the version users will actually install). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogIndex, type PluginEntry } from '../../src/schema.ts'
import type { VerifyTarget } from './verify.ts'

/** The version a verify run should exercise, and the metadata describing it. */
export function verifyTargetOf(e: PluginEntry): { version: string | null; unverified: boolean; flagged: boolean; features: string[] } {
  const slot = e.pendingUpdate ?? null
  const version = slot ? slot.version : e.latestVersion
  const verification = slot ? slot.verification : e.verification
  const caps = slot ? slot.capabilities : e.capabilities
  const features = slot?.features ?? e.features ?? []
  return {
    version,
    unverified: verification.status === 'unverified',
    flagged: caps.redFlags.length > 0,
    features,
  }
}

/** A failed slot gets bounded automatic retries (V-3): recent failure (within
 *  7d) + fewer than 3 recorded attempts re-enters the queue. Beyond that the
 *  version is genuinely dead — the only remaining path is manual --retest. */
export const FAILED_RETRY_WINDOW_MS = 7 * 86_400_000
export const MAX_FAILED_ATTEMPTS = 3

export function retryable(v: PluginEntry['verification'] | undefined, now: Date): boolean {
  if (v?.status !== 'failed' || (v.retries ?? 0) >= MAX_FAILED_ATTEMPTS) return false
  const at = Date.parse(v.verifiedAt ?? '')
  return Number.isFinite(at) && now.getTime() - at < FAILED_RETRY_WINDOW_MS
}

/** Shared queue membership (planTargets + digest backlog §④): a versioned,
 *  unflagged slot that is unverified or a retryable recent failure. Keeping one
 *  predicate stops the digest from under-reporting the queue the worker sees. */
export function verifyQueued(e: PluginEntry, now = new Date()): boolean {
  const t = verifyTargetOf(e)
  if (!t.version || t.flagged) return false
  const ver = e.pendingUpdate ? e.pendingUpdate.verification : e.verification
  return t.unverified || retryable(ver, now)
}

/** The installable parts a verify run must prove, normalized from `contains`.
 *  Legacy entries predate the field — plugin-shaped unless the submission
 *  declared itself a skill (type 'skill' + no parts), whose payload is
 *  SKILL.md rather than a loadable plugin artifact. */
export function verifyPartsOf(e: PluginEntry): NonNullable<PluginEntry['contains']> {
  return e.contains?.length ? e.contains : [e.type === 'skill' ? 'skill' : 'plugin']
}

export function planTargets(index: CatalogIndex, cap = 48, retest = false, now = new Date()): VerifyTarget[] {
  const subs: VerifyTarget[] = []
  const rest: VerifyTarget[] = []
  for (const p of index.plugins) {
    const t = verifyTargetOf(p)
    // retest (manual `targets` dispatch) may re-run failed/verified versions;
    // recent failed slots also re-enter automatically while retries < 3 (V-3).
    // Flagged stays excluded in every mode: red-flagged code never executes here.
    if (!t.version || t.flagged || (!retest && !verifyQueued(p, now))) continue
    const parts = verifyPartsOf(p)
    // no plugin artifact AND no skill payload — nothing exists to honestly
    // verify (mcp/command/agent entries have no structure check yet)
    if (!parts.includes('plugin') && !parts.includes('skill')) continue
    const target: VerifyTarget = {
      name: p.name, version: t.version,
      ...(t.features.length ? { features: t.features } : {}),
      parts,
    }
    // submission-originated entries verify first — a human asked for them.
    // index.plugins is name-asc, so each tier stays alphabetical; backlog
    // drains over as many runs as the cap requires.
    ;(p.discoveredVia?.includes('submission') ? subs : rest).push(target)
  }
  return [...subs, ...rest].slice(0, cap)
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

/* v8 ignore next 16 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [indexPath, outDir] = process.argv.slice(2)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(indexPath!, 'utf8')))
  const cap = Number(process.env.VERIFY_CAP) || 48
  const targets = planTargets(index, cap, process.argv.includes('--retest'))
  // 8/shard: post-V-4 worst case ≈ 8 × ~3.7min ≈ 30min — fits the 35min job
  // timeout with margin (the old 12/shard math predates the widened windows).
  // Feature-routed targets cost extra stages — charge them so shards balance
  // by minutes, not headcount.
  const shards = shard(targets, 8, t => 1 + (t.features?.length ?? 0))
  mkdirSync(outDir!, { recursive: true })
  shards.forEach((s, i) => writeFileSync(join(outDir!, `shard-${i}.json`), JSON.stringify(s)))
  // matrix list goes to a file, not stdout-position — a future log line can't
  // silently corrupt the workflow's shard list (was `tail -1` scraping)
  writeFileSync(join(outDir!, 'plan-matrix.json'), JSON.stringify(shards.map((_, i) => i)))
  console.log(`plan: ${targets.length} targets, ${shards.length} shards`)
  console.log(JSON.stringify(shards.map((_, i) => i)))
}
