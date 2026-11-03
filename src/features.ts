/** Plugin-part detection at index generation — which entrypoints a package
 *  ships. Primary source: package.json `exports` subpath keys (zero download).
 *  Fallback: scanned tarball file paths. Every admitted package gets at least
 *  'server' — the main/exports entry IS the server part by definition. */

export type PluginFeature = 'server' | 'tui' | 'gui' | 'rpc'

export function detectFeatures(exports: unknown, findings: readonly string[]): PluginFeature[] {
  const parts = new Set<PluginFeature>()
  if (exports && typeof exports === 'object') {
    for (const k of Object.keys(exports as Record<string, unknown>)) {
      if (/server/.test(k)) parts.add('server')
      if (/tui/.test(k)) parts.add('tui')
      if (/gui/.test(k)) parts.add('gui')
      if (/rpc/.test(k)) parts.add('rpc')
    }
  }
  for (const f of findings) {
    const p = f.split(':').slice(1).join(':')
    if (/server|cli\./.test(p)) parts.add('server')
    if (/tui/.test(p)) parts.add('tui')
    if (/gui/.test(p)) parts.add('gui')
    if (/rpc/.test(p)) parts.add('rpc')
  }
  parts.add('server')
  return [...parts]
}
