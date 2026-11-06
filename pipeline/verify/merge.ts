/** Merge verify-shard results into index.json entries (DEV §2 verification field).
 *  Version-aware (DEV §4): a result routes to the slot whose version it measured —
 *  pendingUpdate.verification when the held version was tested, the entry's own
 *  verification when the displayed version was. Results for versions neither
 *  slot holds are stale (npm moved on) and are dropped. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CatalogIndex, type PluginEntry } from '../../src/schema.ts'
import { OPENCODE_VERSION } from '../publish/merge.ts'
import type { VerifyResult } from './verify.ts'

/** Shard-artifact boundary check — results files are JSON.parse'd, but nothing
 *  upstream guarantees their shape. A malformed `status` would land verbatim
 *  in index.json and hard-fail every downstream CatalogIndex.parse (site
 *  build, the next plan run). Validate at the boundary and drop the bad rows. */
export const VerifyResultFile = z.object({
  name: z.string().max(300),
  version: z.string().max(120).optional(),
  /** SRI (npm) or commit sha (github) of the bytes actually exercised — the
   *  drift anchor compared against the slot's pinned integrity below. */
  integrity: z.string().max(200).optional(),
  status: z.enum(['verified', 'failed']),
  level: z.enum(['install', 'load', 'interactive', 'render', 'structure']),
  opencodeVersion: z.string().max(60),
  // NaN would make every freshness-guard compare below false — a tampered
  // row with a garbage timestamp could clobber fresh evidence. Drop it here.
  verifiedAt: z.string().max(60).refine(s => Number.isFinite(Date.parse(s)), 'unparseable'),
  // index schema clamps at 2048 — an over-long excerpt would survive to the
  // final CatalogIndex.parse and hard-fail the WHOLE merge (every valid row
  // in the batch dies with it). Bound here so the poisoned row drops alone.
  logExcerpt: z.string().max(2048).optional(),
  // shard threw around the package check — infrastructure signal, dropped below
  harness: z.boolean().optional(),
})

/** The content identity a slot pins: the held/displayed tarball SRI for npm
 *  entries, the scanned commit sha for github-kind. A slot may legitimately
 *  carry no anchor (legacy holds, missing source.version) — the drift check
 *  then degrades to a no-op rather than inventing an anchor. */
function slotAnchor(p: PluginEntry, slot: 'pu' | 'display'): string | null | undefined {
  if (slot === 'pu') return p.pendingUpdate?.integrity
  return p.integrity ?? (p.source.kind === 'github' ? p.source.version : null)
}

/** Untrusted excerpt bound for index.json: strip ANSI/OSC escapes + C0/C1
 *  controls (mirrors plugins/market/src/catalog.ts's sanitize — the client
 *  cleans at render, but the data plane shouldn't carry dirty bytes at all:
 *  an artifact could embed fake terminal sequences into the audit trail). */
const stripControls = (s: string): string =>
  s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')          // OSC … BEL/ST
    .replace(/\x1b[@-Z\\-_]|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')   // ESC + CSI
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')            // remaining C0/C1

function toVerification(r: VerifyResult, runUrl?: string, prev?: PluginEntry['verification']): PluginEntry['verification'] {
  const excerpt = r.logExcerpt ? stripControls(r.logExcerpt).slice(0, 2048) : ''
  return {
    status: r.status,
    level: r.level,
    opencodeVersion: r.opencodeVersion,
    verifiedAt: r.verifiedAt,
    ...(r.integrity ? { integrity: r.integrity } : {}),
    ...(runUrl ? { runUrl } : {}),
    ...(excerpt ? { logExcerpt: excerpt } : {}),
    // consecutive-failure counter — plan lets a recent failure back into the
    // queue while retries < 3 (V-3). Cleared whenever the status isn't failed.
    // Legacy failed records predate the field: `?? 1` used to count the first
    // observed retry as attempt #2, silently shortening the retry budget —
    // absent means zero prior retries, so the first counted failure is #1.
    ...(r.status === 'failed'
      ? { retries: prev?.status === 'failed' ? (prev.retries ?? 0) + 1 : 1 }
      : {}),
  }
}

// honest-label invariant — the same rule mergeEntries' skipIfFlagged applies
// on the catalog path: a slot that gained redFlags between plan and merge
// must not display 'verified' (the flags may describe bytes the run never
// measured). 'failed' keeps its real outcome — it IS a measurement.
// Evidence survives the downgrade: verifiedAt/runUrl/integrity/opencodeVersion
// stay so the detail page keeps the audit trail of what WAS measured.
const skipIfFlagged = (v: PluginEntry['verification'], flagged: boolean): PluginEntry['verification'] =>
  flagged && v.status === 'verified'
    ? { ...v, status: 'skipped', level: v.level ?? 'install' }
    : v

export function mergeResults(index: CatalogIndex, results: VerifyResult[], runUrl?: string): CatalogIndex {
  const byName = new Map<string, VerifyResult[]>()
  const seen = new Set<string>()
  for (const r of results) {
    // harness:true rows are infrastructure failures the shard flagged — the
    // package was never measured. Dropping (not writing 'failed') keeps the
    // slot honest: unverified stays queued, a prior verdict stays standing.
    if (r.harness) continue
    // The prev-run sweep can surface the SAME measurement twice (a cancelled
    // merge's artifact landing in the next run's results). Identity =
    // name + measured version + verifiedAt: identical rows carry identical
    // evidence, so a replay applies zero extra effect — in particular a
    // duplicate 'failed' must not burn a second retry of the budget.
    const key = `${r.name}\0${r.version ?? ''}\0${r.verifiedAt}`
    if (seen.has(key)) continue
    seen.add(key)
    byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  }
  const drifted: string[] = []
  const plugins = index.plugins.map(p => {
    const rs = byName.get(p.name)
    if (!rs?.length) return p
    let out = p
    for (const r of rs) {
      const driftCheck = (anchor: string | null | undefined): VerifyResult => {
        // measured bytes ≠ pinned bytes → the run answered a different question
        // than the slot asked (registry re-tag between scan and verify). A
        // 'verified' on unreviewed bytes must not stand; 'failed' already
        // fails closed. Mark the drift as a failed install with the evidence —
        // diagnose's verify-failed concern path then surfaces it for a human
        // instead of silently re-testing whatever the tag serves tomorrow.
        if (!r.integrity || !anchor || r.integrity === anchor) return r
        drifted.push(`${r.name}${r.version ? `@${r.version}` : ''}`)
        return { ...r, status: 'failed', level: 'install',
          logExcerpt: `measured bytes differ from the pinned anchor — the version was re-tagged ` +
            `(tested ${r.integrity.slice(0, 64)}, pinned ${anchor.slice(0, 64)}); ` +
            `the next catalog scan re-pins the slot before retest` }
      }
      // freshness guard: leftover-artifact replay (a cancelled merge's
      // results swept into the next run) must not clobber evidence recorded
      // AT or AFTER the measurement. >= is deliberate — a replayed row
      // carries the very verifiedAt it already wrote; letting it apply
      // again would burn one retry of the failure budget for zero new
      // evidence (and re-count once per swept replay).
      const fresher = (prev: PluginEntry['verification'] | undefined): boolean =>
        !!(prev?.verifiedAt && r.verifiedAt && Date.parse(prev.verifiedAt) >= Date.parse(r.verifiedAt))
      if (r.version && p.pendingUpdate?.version === r.version) {
        const pu = out.pendingUpdate!
        if (!fresher(pu.verification))
          out = { ...out, pendingUpdate: { ...pu, verification: skipIfFlagged(
            toVerification(driftCheck(pu.integrity), runUrl, pu.verification),
            pu.capabilities.redFlags.length > 0) } }
      } else if (r.version ? r.version === out.latestVersion : !out.pendingUpdate) {
        // versioned display match — or a legacy version-less result, which
        // is only unambiguous when NO hold exists (with a pendingUpdate it
        // can't say which version it measured → drop rather than risk
        // writing the held slot's verdict onto the displayed one)
        if (!fresher(out.verification))
          out = { ...out, verification: skipIfFlagged(
            toVerification(driftCheck(slotAnchor(out, 'display')), runUrl, out.verification),
            out.capabilities.redFlags.length > 0) }
      }
      // version matches neither slot → stale result (npm moved on mid-flight), drop
    }
    return out
  })
  if (drifted.length) console.warn(`verify drift (measured ≠ pinned): ${drifted.join(', ')}`)
  return { ...index, plugins: reuseVerified(plugins) }
}

/** For every non-verified slot, adopt a sibling slot's verified result when
 *  their content anchors are byte-identical (same SRI / same commit) —
 *  re-tag rollbacks and held-bump↔display twins share one measurement
 *  instead of burning a second shard pass. The donor must itself be
 *  current-host verified: stale-host or drifted evidence can't vouch for
 *  anything. Skipped/unverified/failed recipients all qualify — "does
 *  THIS blob install?" has one answer. */
function reuseVerified(plugins: PluginEntry[]): PluginEntry[] {
  return plugins.map(p => {
    const donors: PluginEntry['verification'][] = [p.verification, p.pendingUpdate?.verification]
      .filter((v): v is NonNullable<typeof v> =>
        v?.status === 'verified' && !!v.integrity && v.opencodeVersion === OPENCODE_VERSION)
    if (!donors.length) return p
    const adopt = (anchor: string | null | undefined, ver: PluginEntry['verification'])
      : PluginEntry['verification'] => {
      if (!anchor || ver.status === 'verified') return ver
      const donor = donors.find(d => d.integrity === anchor)
      return donor ? { ...donor } : ver
    }
    const display = adopt(slotAnchor(p, 'display'), p.verification)
    const pu = p.pendingUpdate
      ? adopt(p.pendingUpdate.integrity, p.pendingUpdate.verification)
      : undefined
    if (display === p.verification && (!p.pendingUpdate || pu === p.pendingUpdate.verification)) return p
    return {
      ...p,
      verification: display,
      ...(p.pendingUpdate ? { pendingUpdate: { ...p.pendingUpdate, verification: pu! } } : {}),
    }
  })
}

/* v8 ignore next 11 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [indexPath, resultsDir, outPath] = process.argv.slice(2)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(indexPath!, 'utf8')))
  const results: VerifyResult[] = []
  let dropped = 0
  // an absent dir is a legitimately empty shard set (all targets flagged,
  // every shard timed out pre-flush) — merge zero rows, not a crash
  const files = existsSync(resultsDir!) ? readdirSync(resultsDir!) : []
  for (const f of files.filter(f => f.startsWith('results-'))) {
    // one corrupt shard artifact (truncated upload, non-JSON stray file) must
    // not take the WHOLE merge down — skip the file, keep the valid shards
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(resultsDir!, f), 'utf8'))
    } catch (e) {
      console.warn(`${f}: unreadable JSON — skipped (${String((e as Error).message).slice(0, 120)})`)
      dropped++
      continue
    }
    if (!Array.isArray(raw)) { console.warn(`${f}: not a result array — skipped`); dropped++; continue }
    for (const r of raw) {
      const p = VerifyResultFile.safeParse(r)
      if (p.success) results.push(p.data as VerifyResult)
      else { console.warn(`${f}: malformed result dropped (${JSON.stringify(r).slice(0, 120)})`); dropped++ }
    }
  }
  // re-parse the merge output — a bad result must not produce an index the
  // next CatalogIndex.parse (site build, plan) rejects wholesale
  const merged = CatalogIndex.parse(mergeResults(index, results, process.env.RUN_URL))
  writeFileSync(outPath!, JSON.stringify(merged, null, 2))
  const harnessDropped = results.filter(r => r.harness).length
  console.log(`merged ${results.length - harnessDropped} verify results` +
    `${dropped ? ` (${dropped} malformed dropped)` : ''}` +
    `${harnessDropped ? ` (${harnessDropped} harness errors dropped — infrastructure, not package verdicts)` : ''}`)
}
