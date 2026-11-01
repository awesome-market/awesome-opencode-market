/** Merge verify-shard results into index.json entries (DEV §2 verification field). */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogIndex } from '../../src/schema.ts'
import type { VerifyResult } from './verify.ts'

export function mergeResults(index: CatalogIndex, results: VerifyResult[], runUrl?: string): CatalogIndex {
  const byName = new Map(results.map(r => [r.name, r]))
  return {
    ...index,
    plugins: index.plugins.map(p => {
      const r = byName.get(p.name)
      if (!r) return p
      return {
        ...p,
        verification: {
          status: r.status,
          level: r.level,
          opencodeVersion: r.opencodeVersion,
          verifiedAt: r.verifiedAt,
          ...(runUrl ? { runUrl } : {}),
          ...(r.logExcerpt ? { logExcerpt: r.logExcerpt } : {}),
        },
      }
    }),
  }
}

/* v8 ignore next 11 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [indexPath, resultsDir, outPath] = process.argv.slice(2)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(indexPath!, 'utf8')))
  const results: VerifyResult[] = readdirSync(resultsDir!)
    .filter(f => f.startsWith('results-'))
    .flatMap(f => JSON.parse(readFileSync(join(resultsDir!, f), 'utf8')) as VerifyResult[])
  const merged = mergeResults(index, results, process.env.RUN_URL)
  writeFileSync(outPath!, JSON.stringify(merged, null, 2))
  console.log(`merged ${results.length} verify results`)
}
