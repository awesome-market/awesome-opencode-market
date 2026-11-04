/** One-shot backfill: populate identity fields (createdAt/maintainers/repoId) for
 *  existing index entries written before SEC-1 fields existed (SEC-4).
 *  Usage: npx tsx pipeline/backfill.ts index.json > index.backfilled.json */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { fetchPackument, withTimeout } from './fetch/npm.ts'
import { fetchRepoMeta } from './fetch/github.ts'

export async function backfill(index: CatalogIndex, opts: { ghToken?: string | undefined; fetchFn?: typeof fetch | undefined } = {}): Promise<CatalogIndex> {
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const out = structuredClone(index)
  const BATCH = 10
  const queue = out.plugins.filter(e =>
    e.createdAt === null || e.maintainers.length === 0 || (e.source.repo && !e.source.repoId))
  console.error(`backfill: ${queue.length}/${out.plugins.length} entries need identity fields`)
  for (let i = 0; i < queue.length; i += BATCH) {
    await Promise.all(queue.slice(i, i + BATCH).map(async e => {
      try {
        const { pk } = await fetchPackument(e.name, { fetchFn: f })
        if (pk) {
          e.createdAt ??= pk.createdAt
          e.modifiedAt ??= pk.modifiedAt
          if (!e.maintainers.length) e.maintainers = pk.maintainers
        }
        if (e.source.repo && !e.source.repoId) {
          const { meta } = await fetchRepoMeta(e.source.repo, { token: opts.ghToken, fetchFn: f })
          if (meta?.id) e.source = { ...e.source, repoId: meta.id }
        }
      } catch (err) {
        console.error(`  backfill failed ${e.name}: ${(err as Error).message}`)
      }
    }))
    console.error(`  ${Math.min(i + BATCH, queue.length)}/${queue.length}`)
  }
  return CatalogIndex.parse(out)
}

/* v8 ignore next 7 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const idx = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
  const out = await backfill(idx, { ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN })
  process.stdout.write(JSON.stringify(out, null, 2))
}
