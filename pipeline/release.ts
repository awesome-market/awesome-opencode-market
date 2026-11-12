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
import { isMain } from './main-guard.ts'

/* v8 ignore next 24 */
if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2)
  const explain = argv.includes('--explain')
  const nameAt = argv.indexOf('--name')
  // the --name VALUE lives at nameAt+1 — filter by position, not by string
  // equality: `a !== nameFilter` also deleted a positional path that happened
  // to equal the package name ('--name index.json' ate the index arg)
  const nameFilter = nameAt > -1 && nameAt + 1 < argv.length ? argv[nameAt + 1] : undefined
  // guard nameAt>-1: nameAt=-1 makes nameAt+1=0, which would eat argv[0]
  const args = argv.filter((a, i) =>
    a !== '--explain' && a !== '--name' && (nameAt === -1 || i !== nameAt + 1))
  // usage guard like every sibling CLI: a bare run (or a flag swallowing a
  // positional, e.g. `--name` with no value) used to die inside
  // readFileSync(undefined) with a bare TypeError — and args[1] missing
  // silently degraded to "no verdicts", writing a normalized-but-wrong index
  if (args.length < 2) {
    console.error('usage: release.ts <index.json> <verdicts.jsonl> [digest-state.json] [--explain [--name <pkg>]]')
    process.exit(2)
  }
  const index = CatalogIndex.parse(JSON.parse(readFileSync(args[0]!, 'utf8')))
  const verdicts = loadVerdicts(args[1])
  const digest = loadDigestState(args[2])
  const r = applyMatureVerdicts(index, verdicts, digest)
  process.stdout.write(JSON.stringify(r.index, null, 2))
  console.error(`release: released [${r.releases.join(', ') || 'none'}]; held [${r.held.join(', ') || 'none'}]`)
  if (explain) {
    for (const e of index.plugins) {
      if (nameFilter && e.name !== nameFilter) continue
      for (const s of explainEntry(e, verdicts, digest, index.removed)) {
        if (s.outcome === 'none' && !nameFilter) continue
        console.error(`  ${e.name}@${s.version ?? 'null'} [${s.slot}] ${s.outcome}` +
          ` — verdict=${s.verdict ?? '-'} src=${s.source ?? '-'} announced=${s.announced}` +
          ` verify=${s.verification}${s.stickyHuman ? ' sticky-human' : ''} — ${s.why}`)
      }
    }
  }
}
