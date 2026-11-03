/** Re-merge a generated index against a fresher remote index (publish retry path, WF-2).
 *  Treats `ours` as the fresh scan output and `remote` as the merge base, so remote's
 *  verification/identity/removed state is preserved instead of overwritten.
 *  Usage: npx tsx pipeline/remerge.ts <ours.json> <remote.json> > merged.json */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { mergeEntries, OPENCODE_VERSION } from './publish/merge.ts'
import { RULESET_VERSION } from './scan/rules.ts'

export function remerge(ours: CatalogIndex, remote: CatalogIndex | null): CatalogIndex {
  if (!remote) return ours
  const plugins = mergeEntries(ours.plugins, remote, OPENCODE_VERSION, RULESET_VERSION)
  return {
    ...ours,
    generatedAt: new Date().toISOString(),
    categories: { ...remote.categories, ...ours.categories },
    removed: [...ours.removed, ...remote.removed.filter(r => !ours.removed.some(o => o.slug === r.slug))],
    plugins,
  }
}

/* v8 ignore next 10 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const ours = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
  let remote: CatalogIndex | null = null
  try {
    remote = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[3]!, 'utf8')))
  } catch { /* remote unreadable → keep ours wholesale */ }
  process.stdout.write(JSON.stringify(remerge(ours, remote), null, 2))
}
