/** Post-publish notification: mark submission seeds whose package actually
 *  landed in the freshly published index, and print their issue numbers so the
 *  workflow can comment+close them.
 *  Usage: npx tsx pipeline/notify-published.ts <index.json> <submissions.txt> [stale-out] [dead-out] > issues.txt
 *  Rewrites submissions.txt in place (notified:true on landed entries,
 *  staleWarned once at staleDays, dead:true past deadDays). */
import { readFileSync, writeFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'

export function markNotified(
  index: CatalogIndex,
  lines: string[],
  opts: { staleDays?: number; deadDays?: number; now?: number } = {},
): { lines: string[]; issues: number[]; stale: number[]; dead: number[] } {
  // "已收录" = user-visible. A pending entry is in the index but not displayed —
  // notify only once it actually publishes (approved or legacy), AI-DIAGNOSIS §9.
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  const issues = new Set<number>()
  const stale = new Set<number>()
  const dead = new Set<number>()
  const now = opts.now ?? Date.now()
  const staleCutoff = now - (opts.staleDays ?? 14) * 86400e3
  const deadCutoff = now - (opts.deadDays ?? 30) * 86400e3
  const out = lines.flatMap(l => {
    const t = l.trim()
    if (!t.startsWith('{')) return [l]
    try {
      const s = JSON.parse(t) as { name?: string; repo?: string; issue?: number; notified?: boolean; staleWarned?: boolean; dead?: boolean; at?: string }
      // notified is fully terminal — past a 90d grace window the row drops out
      // of the file entirely (the grace gives the workflow's comment+close
      // retries room to succeed on transient gh failures; after that, git
      // history is the audit and the file would otherwise grow forever)
      if (s.notified) {
        // missing/unparseable `at` can't prove the grace expired — keep
        const age = s.at ? now - Date.parse(s.at) : 0
        return age > 90 * 86400e3 ? [] : [l]
      }
      // repo-only submissions carry `repo` not `name` — match either the entry
      // name (github-kind entries are named owner/repo) or source.repo, else
      // their issue never gets notified+closed
      const e = s.name ? byName.get(s.name)
        : s.repo ? index.plugins.find(p =>
            p.source.repo?.toLowerCase() === s.repo!.toLowerCase() ||
            p.name.toLowerCase() === s.repo!.toLowerCase())
        : undefined
      const key = s.name ?? s.repo
      const unlanded = !e || e.approval === 'pending'
      // dead is terminal for scanning but a late landing still deserves the
      // one-shot comment — the issue is closed, not deaf: an entry that got in
      // anyway (another submission path, rediscovery) must not publish with
      // the submitter left thinking it failed
      if (s.dead) {
        if (key && s.issue && e && e.approval !== 'pending') {
          issues.add(s.issue)
          return [JSON.stringify({ ...s, notified: true })]
        }
        const age = s.at ? now - Date.parse(s.at) : 0
        return age > 90 * 86400e3 ? [] : [l]
      }
      if (key && s.issue && e && e.approval !== 'pending') {
        issues.add(s.issue)
        return [JSON.stringify({ ...s, notified: true })]
      }
      // dead = terminal: the seed aged past deadDays without ever becoming
      // visible (rejected by a downstream gate, stuck pending, or abandoned).
      // run.ts skips dead seeds so the package stops occupying scan budget;
      // the issue gets closed by the workflow — resubmission means a new issue.
      if (key && s.issue && !s.notified && s.at && Date.parse(s.at) < deadCutoff && unlanded) {
        dead.add(s.issue)
        return [JSON.stringify({ ...s, dead: true })]
      }
      // approved long ago but still not visible — in queue or filtered out.
      // Warn once per seed (staleWarned); the issue stays open either way.
      if (key && s.issue && !s.notified && !s.staleWarned
          && s.at && Date.parse(s.at) < staleCutoff && unlanded) {
        stale.add(s.issue)
        return [JSON.stringify({ ...s, staleWarned: true })]
      }
    } catch { /* keep unreadable lines verbatim */ }
    return [l]
  })
  return { lines: out, issues: [...issues], stale: [...stale], dead: [...dead] }
}

export function main(argv: string[] = process.argv): void {
  const index = CatalogIndex.parse(JSON.parse(readFileSync(argv[2]!, 'utf8')))
  const path = argv[3]!
  const lines = readFileSync(path, 'utf8').split('\n')
  const { lines: out, issues, stale, dead } = markNotified(index, lines)
  writeFileSync(path, out.join('\n'))
  for (const i of issues) console.log(i)
  // optional stale-out / dead-out paths
  if (argv[4]) writeFileSync(argv[4], stale.join('\n'))
  if (argv[5]) writeFileSync(argv[5], dead.join('\n'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
