/** Apply mature verdicts to an index file standalone — the same function
 *  run.ts applies at generate time, factored so concern.yml can make a human
 *  verdict effective in minutes instead of at the next scheduled catalog
 *  generate (up to ~16h later). Idempotent: the next catalog run re-derives
 *  the same state from the same inputs.
 *  Usage: npx tsx pipeline/release.ts <index.json> <verdicts.jsonl> [digest-state.json] [--explain [--name <pkg>]]
 *  --explain: per-slot verdict decision chain to stderr (which verdict won,
 *  whether announced, which gate blocked release) — ops answer for "why is
 *  X still held" without reading the jsonl. --name narrows it to one entry
 *  (a full-index explain dumps every held slot's chain). */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { loadVerdicts, loadDigestState, applyMatureVerdicts, explainEntry } from './verdicts.ts'

/* v8 ignore next 24 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const explain = process.argv.includes('--explain')
  const nameAt = process.argv.indexOf('--name')
  const nameFilter = nameAt > -1 ? process.argv[nameAt + 1] : undefined
  const args = process.argv.slice(2).filter(a => a !== '--explain' && a !== '--name' && a !== nameFilter)
  const index = CatalogIndex.parse(JSON.parse(readFileSync(args[0]!, 'utf8')))
  const verdicts = loadVerdicts(args[1])
  const digest = loadDigestState(args[2])
  const r = applyMatureVerdicts(index, verdicts, digest)
  process.stdout.write(JSON.stringify(r.index, null, 2))
  console.error(`release: released [${r.releases.join(', ') || 'none'}]; held [${r.held.join(', ') || 'none'}]`)
  if (explain) {
    for (const e of index.plugins) {
      if (nameFilter && e.name !== nameFilter) continue
      for (const s of explainEntry(e, verdicts, digest)) {
        if (s.outcome === 'none' && !nameFilter) continue
        console.error(`  ${e.name}@${s.version ?? 'null'} [${s.slot}] ${s.outcome}` +
          ` — verdict=${s.verdict ?? '-'} src=${s.source ?? '-'} announced=${s.announced}` +
          ` verify=${s.verification}${s.stickyHuman ? ' sticky-human' : ''} — ${s.why}`)
      }
    }
  }
}
