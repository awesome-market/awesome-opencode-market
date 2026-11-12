/** Stamps run.ts's per-seed rejection codes onto submissions.txt rows so the
 *  issue status comment can explain why a submission isn't queueing (the
 *  "届时会在本 issue 说明原因" promise).
 *
 *  - outcomes[key] present → row.rejected = code (this run rejected it)
 *  - entry exists in index → row.rejected cleared (admitted, or covered by
 *    an npm twin entry whose source.repo matches a repo-seed)
 *  - neither               → stamp left as-is; a decisive run heals it
 *
 *  Usage: npx tsx pipeline/seed-outcome.ts <index.json> <submissions.txt> <outcomes.json>
 *  Rewrites submissions.txt in place. A missing/unparseable outcomes file
 *  means "no rejections this run" — never fail the publish loop on it. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { isMain } from './main-guard.ts'

export interface SeedOutcomeIndex {
  plugins: { name: string; source?: { repo?: string | undefined } | undefined }[]
}

export function applySeedOutcomes(
  lines: string[],
  outcomes: Record<string, string>,
  index: SeedOutcomeIndex,
): string[] {
  const landed = new Set<string>()
  for (const p of index.plugins) {
    landed.add(p.name.toLowerCase())
    const r = p.source?.repo?.toLowerCase()
    if (r) landed.add(r)
  }
  return lines.map(l => {
    const t = l.trim()
    if (!t.startsWith('{')) return l
    let s: Record<string, unknown>
    try { s = JSON.parse(t) } catch { return l }
    const key = typeof s.name === 'string' ? s.name : typeof s.repo === 'string' ? s.repo : null
    if (!key) return l
    const k = key.toLowerCase()
    const code = outcomes[k]
    if (code) {
      if (s.rejected === code) return l
      s.rejected = code
      return JSON.stringify(s)
    }
    // landing via the repo twin counts too — notify-published and the status
    // comment both fall back to source.repo / repo-named entries for a
    // name+repo seed; a rejected stamp that outlives the landing is stale
    const repoK = typeof s.repo === 'string' ? s.repo.toLowerCase() : null
    if ((landed.has(k) || (repoK !== null && landed.has(repoK))) && 'rejected' in s) {
      delete s.rejected
      return JSON.stringify(s)
    }
    return l
  })
}

export function main(argv: string[] = process.argv): void {
  const [indexPath, seedPath, outcomesPath] = argv.slice(2)
  if (!indexPath || !seedPath) {
    console.error('usage: seed-outcome.ts <index.json> <submissions.txt> <outcomes.json>')
    process.exit(1)
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as SeedOutcomeIndex
  let outcomes: Record<string, string> = {}
  if (outcomesPath && existsSync(outcomesPath)) {
    try {
      const raw = JSON.parse(readFileSync(outcomesPath, 'utf8')) as Record<string, unknown>
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) outcomes[k.toLowerCase()] = v
    } catch (e) {
      console.warn(`seed-outcome: unparseable outcomes file — treating as empty (${e instanceof Error ? e.message : e})`)
    }
  }
  const lines = readFileSync(seedPath, 'utf8').split('\n')
  writeFileSync(seedPath, applySeedOutcomes(lines, outcomes, index).join('\n'))
}

/* v8 ignore next 3 -- CLI entry guard */
if (isMain(import.meta.url)) {
  main()
}
