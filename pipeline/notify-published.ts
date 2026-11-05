/** Post-publish notification: mark submission seeds whose package actually
 *  landed in the freshly published index, and print their issue numbers so the
 *  workflow can comment+close them.
 *  Usage: npx tsx pipeline/notify-published.ts <index.json> <submissions.txt> > issues.txt
 *  Rewrites submissions.txt in place (notified:true on landed entries). */
import { readFileSync, writeFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'

export function markNotified(
  index: CatalogIndex,
  lines: string[],
  opts: { staleDays?: number; now?: number } = {},
): { lines: string[]; issues: number[]; stale: number[] } {
  // "已收录" = user-visible. A pending entry is in the index but not displayed —
  // notify only once it actually publishes (approved or legacy), AI-DIAGNOSIS §9.
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  const issues: number[] = []
  const stale: number[] = []
  const cutoff = (opts.now ?? Date.now()) - (opts.staleDays ?? 14) * 86400e3
  const out = lines.map(l => {
    const t = l.trim()
    if (!t.startsWith('{')) return l
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; at?: string; staleWarned?: boolean }
      // repo-only submissions carry `repo` not `name` — match either the entry
      // name (github-kind entries are named owner/repo) or source.repo, else
      // their issue never gets notified+closed
      const e = s.name ? byName.get(s.name)
        : s.repo ? index.plugins.find(p =>
            p.source.repo?.toLowerCase() === s.repo!.toLowerCase() ||
            p.name.toLowerCase() === s.repo!.toLowerCase())
        : undefined
      if ((s.name ?? s.repo) && s.issue && !s.notified && e && e.approval !== 'pending') {
        issues.push(s.issue)
        return JSON.stringify({ ...s, notified: true })
      }
      // approved long ago but still not visible — in queue or filtered out.
      // Warn once per seed (staleWarned); the issue stays open either way.
      if ((s.name ?? s.repo) && s.issue && !s.notified && !s.staleWarned
          && s.at && Date.parse(s.at) < cutoff
          && (!e || e.approval === 'pending')) {
        stale.push(s.issue)
        return JSON.stringify({ ...s, staleWarned: true })
      }
    } catch { /* keep unreadable lines verbatim */ }
    return l
  })
  return { lines: out, issues, stale }
}

export function main(argv: string[] = process.argv): void {
  const index = CatalogIndex.parse(JSON.parse(readFileSync(argv[2]!, 'utf8')))
  const path = argv[3]!
  const lines = readFileSync(path, 'utf8').split('\n')
  const { lines: out, issues, stale } = markNotified(index, lines)
  writeFileSync(path, out.join('\n'))
  for (const i of issues) console.log(i)
  // optional stale-out path — issues whose seed aged without landing
  if (argv[4]) writeFileSync(argv[4], stale.join('\n'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
