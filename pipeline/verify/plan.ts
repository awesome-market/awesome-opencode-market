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

export function planTargets(index: CatalogIndex, cap = 48, retest = false): VerifyTarget[] {
  const todo: VerifyTarget[] = []
  for (const p of index.plugins) {
    const t = verifyTargetOf(p)
    // retest (manual `targets` dispatch) may re-run failed/verified versions —
    // a failed slot is otherwise terminal with no retry path. Flagged stays
    // excluded in every mode: red-flagged code never executes here.
    if (!t.version || t.flagged || (!t.unverified && !retest)) continue
    todo.push({ name: p.name, version: t.version, ...(t.features.length ? { features: t.features } : {}) })
    if (todo.length >= cap) break
  }
  return todo
}

export function shard<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/* v8 ignore next 13 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [indexPath, outDir] = process.argv.slice(2)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(indexPath!, 'utf8')))
  const targets = planTargets(index, 48, process.argv.includes('--retest'))
  const shards = shard(targets, 12)
  mkdirSync(outDir!, { recursive: true })
  shards.forEach((s, i) => writeFileSync(join(outDir!, `shard-${i}.json`), JSON.stringify(s)))
  console.log(`plan: ${targets.length} targets, ${shards.length} shards`)
  console.log(JSON.stringify(shards.map((_, i) => i)))
}
