/** Index merge: new entries layered over old index — unchanged packages keep prior scan/verify results (incremental cache carrier, DEV §1). */
import type { CatalogIndex, PluginEntry } from '../../src/schema.ts'
import { CatalogIndex as CatalogIndexSchema } from '../../src/schema.ts'

/** Cache key for verification freshness: name@version + host version (DEV §4). */
export function cacheKey(e: Pick<PluginEntry, 'name' | 'latestVersion'>, opencodeVersion: string): string {
  return `${e.name}@${e.latestVersion ?? '?'}+${opencodeVersion}`
}

export function mergeEntries(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
  opencodeVersion: string,
): PluginEntry[] {
  const oldByKey = new Map<string, PluginEntry>()
  if (old) for (const e of old.plugins) oldByKey.set(cacheKey(e, opencodeVersion), e)
  return fresh.map(e => {
    const prev = oldByKey.get(cacheKey(e, opencodeVersion))
    if (!prev) return e
    return {
      ...e,
      firstSeenAt: prev.firstSeenAt,
      capabilities: prev.capabilities,       // keep prior scan result when package unchanged
      verification: prev.verification,       // keep prior verification when unchanged
      aliases: [...new Set([...prev.aliases, ...e.aliases])],
      discoveredVia: [...new Set([...prev.discoveredVia, ...e.discoveredVia])] as PluginEntry['discoveredVia'],
    }
  })
}

/** Corruption gate (dsh-market build-site.mjs pattern + >20% drop alarm, DEV §1). */
export function corruptionGate(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
): { ok: boolean; reason: string | null; dropPct: number } {
  if (fresh.length === 0) return { ok: false, reason: 'empty index — refusing to publish', dropPct: 100 }
  if (!old || old.plugins.length === 0) return { ok: true, reason: null, dropPct: 0 }
  const dropPct = (1 - fresh.length / old.plugins.length) * 100
  if (dropPct > 20) return { ok: false, reason: `entry count dropped ${dropPct.toFixed(1)}% — needs human confirmation`, dropPct }
  return { ok: true, reason: null, dropPct }
}

export function buildIndex(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
  opts: { opencodeVersion: string; now?: string },
): { index: CatalogIndex; gate: ReturnType<typeof corruptionGate> } {
  const merged = mergeEntries(fresh, old, opts.opencodeVersion)
  const gate = corruptionGate(merged, old)
  const index = CatalogIndexSchema.parse({
    version: '1',
    generatedAt: opts.now ?? new Date().toISOString(),
    categories: old?.categories ?? {},
    plugins: merged.sort((a, b) => a.slug.localeCompare(b.slug)),
  })
  return { index, gate }
}
