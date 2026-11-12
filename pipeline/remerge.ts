/** Re-merge a generated index against a fresher remote index (publish retry path, WF-2).
 *  Treats `ours` as the fresh scan output and `remote` as the merge base, so remote's
 *  verification/identity/removed state is preserved instead of overwritten.
 *  Usage: npx tsx pipeline/remerge.ts <ours.json> <remote.json> > merged.json */
import { readFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { CAT_NAMES, catId } from '../src/categories.ts'
import { mergeEntries, OPENCODE_VERSION } from './publish/merge.ts'
import { RULESET_VERSION } from './scan/rules.ts'
import { isMain } from './main-guard.ts'

/** Same id normalization + whitelist buildIndex applies (I-3): remote's
 *  categories dict and entry.category values may predate the english-id
 *  convention — and only CAT_NAMES ids may live in the dict, so
 *  author-declared strings can't mint global categories. */
const normCats = (rec: CatalogIndex['categories']): CatalogIndex['categories'] =>
  Object.fromEntries(Object.entries(rec).flatMap(([k]) => {
    const id = catId(k)
    return CAT_NAMES[id] ? [[id, CAT_NAMES[id]!] as const] : []
  }))

export function remerge(ours: CatalogIndex, remote: CatalogIndex | null): CatalogIndex {
  if (!remote) return ours
  // remote-side removals our snapshot predates must win: catalog-withdraw
  // (or any catalog-branch tombstone) landing between generate's fetch and
  // this publish would otherwise be resurrected — ours.plugins is mapped
  // wholesale while remote.removed only unions in, so a withdrawn pending
  // entry could republish and even auto-release on a standing mature pass.
  // A tombstone evicts a live entry only when it postdates the entry's
  // identity epoch (firstSeenAt): natural gone-check tombstones filtered
  // out of ours.removed by a rediscovery are OLDER than the fresh
  // firstSeenAt and must not kill the rediscovered entry.
  const remoteTombs = new Map(remote.removed.map(r => [r.name.toLowerCase(), r]))
  const plugins = mergeEntries(ours.plugins, remote, OPENCODE_VERSION, RULESET_VERSION)
    .filter(e => {
      const t = remoteTombs.get(e.name.toLowerCase())
      return !(t && Date.parse(t.disappearedAt) > Date.parse(e.firstSeenAt))
    })
  for (const e of plugins) e.category = (e.category ?? []).map(catId).filter(id => CAT_NAMES[id] !== undefined)
  const categories: CatalogIndex['categories'] = { ...normCats(remote.categories), ...normCats(ours.categories) }
  for (const e of plugins) for (const id of e.category ?? []) categories[id] ??= CAT_NAMES[id]!
  return {
    ...ours,
    generatedAt: new Date().toISOString(),
    categories,
    removed: [...ours.removed, ...remote.removed.filter(r => !ours.removed.some(o => o.slug === r.slug))],
    plugins,
  }
}

/* v8 ignore next 10 */
if (isMain(import.meta.url)) {
  const ours = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
  let remote: CatalogIndex | null = null
  try {
    remote = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[3]!, 'utf8')))
  } catch { /* remote unreadable → keep ours wholesale */ }
  process.stdout.write(JSON.stringify(remerge(ours, remote), null, 2))
}
