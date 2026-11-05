/** Merge verify-shard results into index.json entries (DEV §2 verification field).
 *  Version-aware (DEV §4): a result routes to the slot whose version it measured —
 *  pendingUpdate.verification when the held version was tested, the entry's own
 *  verification when the displayed version was. Results for versions neither
 *  slot holds are stale (npm moved on) and are dropped. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CatalogIndex, type PluginEntry } from '../../src/schema.ts'
import type { VerifyResult } from './verify.ts'

/** Shard-artifact boundary check — results files are JSON.parse'd, but nothing
 *  upstream guarantees their shape. A malformed `status` would land verbatim
 *  in index.json and hard-fail every downstream CatalogIndex.parse (site
 *  build, the next plan run). Validate at the boundary and drop the bad rows. */
export const VerifyResultFile = z.object({
  name: z.string(),
  version: z.string().optional(),
  status: z.enum(['verified', 'failed']),
  level: z.enum(['install', 'load', 'interactive', 'render', 'structure']),
  opencodeVersion: z.string(),
  verifiedAt: z.string(),
  logExcerpt: z.string().optional(),
})

function toVerification(r: VerifyResult, runUrl?: string, prev?: PluginEntry['verification']): PluginEntry['verification'] {
  return {
    status: r.status,
    level: r.level,
    opencodeVersion: r.opencodeVersion,
    verifiedAt: r.verifiedAt,
    ...(runUrl ? { runUrl } : {}),
    ...(r.logExcerpt ? { logExcerpt: r.logExcerpt } : {}),
    // consecutive-failure counter — plan lets a recent failure back into the
    // queue while retries < 3 (V-3). Cleared whenever the status isn't failed.
    ...(r.status === 'failed'
      ? { retries: prev?.status === 'failed' ? (prev.retries ?? 1) + 1 : 1 }
      : {}),
  }
}

export function mergeResults(index: CatalogIndex, results: VerifyResult[], runUrl?: string): CatalogIndex {
  const byName = new Map<string, VerifyResult[]>()
  for (const r of results) byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  return {
    ...index,
    plugins: index.plugins.map(p => {
      const rs = byName.get(p.name)
      if (!rs?.length) return p
      let out = p
      for (const r of rs) {
        if (r.version && p.pendingUpdate?.version === r.version) {
          out = { ...out, pendingUpdate: { ...out.pendingUpdate!, verification: toVerification(r, runUrl, out.pendingUpdate!.verification) } }
        } else if (!r.version || r.version === out.latestVersion) {
          // legacy version-less results and exact display-version matches
          out = { ...out, verification: toVerification(r, runUrl, out.verification) }
        }
        // version matches neither slot → stale result (npm moved on mid-flight), drop
      }
      return out
    }),
  }
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
    const raw: unknown = JSON.parse(readFileSync(join(resultsDir!, f), 'utf8'))
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
  console.log(`merged ${results.length} verify results${dropped ? ` (${dropped} malformed dropped)` : ''}`)
}
