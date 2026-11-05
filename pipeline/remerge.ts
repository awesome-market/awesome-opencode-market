/** Re-merge a generated index against a fresher remote index (publish retry path, WF-2).
 *  Treats `ours` as the fresh scan output and `remote` as the merge base, so remote's
 *  verification/identity/removed state is preserved instead of overwritten.
 *  Usage: npx tsx pipeline/remerge.ts <ours.json> <remote.json> > merged.json */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { CAT_NAMES, catId } from '../src/categories.ts'
import { mergeEntries, OPENCODE_VERSION } from './publish/merge.ts'
import { RULESET_VERSION } from './scan/rules.ts'

/** Same id normalization buildIndex applies (I-3): remote's categories dict
 *  and entry.category values may predate the english-id convention — without
 *  this, the retry path re-publishes legacy zh keys forever. */
const normCats = (rec: CatalogIndex['categories']): CatalogIndex['categories'] =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => { const id = catId(k); return [id, CAT_NAMES[id] ?? v] }))

export function remerge(ours: CatalogIndex, remote: CatalogIndex | null): CatalogIndex {
  if (!remote) return ours
  const plugins = mergeEntries(ours.plugins, remote, OPENCODE_VERSION, RULESET_VERSION)
  for (const e of plugins) e.category = (e.category ?? []).map(catId)
  const categories: CatalogIndex['categories'] = { ...normCats(remote.categories), ...normCats(ours.categories) }
  for (const e of plugins) for (const id of e.category ?? []) categories[id] ??= CAT_NAMES[id] ?? { en: id }
  return {
    ...ours,
    generatedAt: new Date().toISOString(),
    categories,
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
