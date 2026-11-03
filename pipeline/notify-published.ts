/** Post-publish notification: mark submission seeds whose package actually
 *  landed in the freshly published index, and print their issue numbers so the
 *  workflow can comment+close them.
 *  Usage: npx tsx pipeline/notify-published.ts <index.json> <submissions.txt> > issues.txt
 *  Rewrites submissions.txt in place (notified:true on landed entries). */
import { readFileSync, writeFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'

export function markNotified(index: CatalogIndex, lines: string[]): { lines: string[]; issues: number[] } {
  // "已收录" = user-visible. A pending entry is in the index but not displayed —
  // notify only once it actually publishes (approved or legacy), AI-DIAGNOSIS §9.
  const byName = new Map(index.plugins.map(e => [e.name, e]))
  const issues: number[] = []
  const out = lines.map(l => {
    const t = l.trim()
    if (!t.startsWith('{')) return l
    try {
      const s = JSON.parse(t) as { name?: string; issue?: number; notified?: boolean }
      const e = s.name ? byName.get(s.name) : undefined
      if (s.name && s.issue && !s.notified && e && e.approval !== 'pending') {
        issues.push(s.issue)
        return JSON.stringify({ ...s, notified: true })
      }
    } catch { /* keep unreadable lines verbatim */ }
    return l
  })
  return { lines: out, issues }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
  const path = process.argv[3]!
  const lines = readFileSync(path, 'utf8').split('\n')
  const { lines: out, issues } = markNotified(index, lines)
  writeFileSync(path, out.join('\n'))
  for (const i of issues) console.log(i)
}
