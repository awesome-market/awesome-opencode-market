/** Apply mature verdicts to an index file standalone — the same function
 *  run.ts applies at generate time, factored so concern.yml can make a human
 *  verdict effective in minutes instead of at the next scheduled catalog
 *  generate (up to ~16h later). Idempotent: the next catalog run re-derives
 *  the same state from the same inputs.
 *  Usage: npx tsx pipeline/release.ts <index.json> <verdicts.jsonl> [digest-state.json] */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { loadVerdicts, loadDigestState, applyMatureVerdicts } from './verdicts.ts'

/* v8 ignore next 8 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const index = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
  const r = applyMatureVerdicts(index, loadVerdicts(process.argv[3]), loadDigestState(process.argv[4]))
  process.stdout.write(JSON.stringify(r.index, null, 2))
  console.error(`release: released [${r.releases.join(', ') || 'none'}]; held [${r.held.join(', ') || 'none'}]`)
}
