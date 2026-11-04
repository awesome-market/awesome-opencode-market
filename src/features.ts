/** Plugin-part detection at index generation, mirroring opencode's official
 *  entrypoint resolution in `@opencode/plugin/host` Host.resolve():
 *    server ← `./server` export, else the root entry (`.`/`main`/`index.*`)
 *    tui    ← `./tui` subpath
 *    rpc    ← `./rpc` subpath, counting ONLY when a server entry also resolves
 *    gui    ← `./gui-experimental` (or gui-experimental.cjs/.js at root without
 *              an exports map), and only when the bundle ends .cjs/.js
 *  Without `exports`, conventional root filenames resolve the same subpaths.
 *  No unconditional 'server' — GUI-only and TUI-only packages legitimately
 *  ship none (module.ts: "nothing to run here; its id is its package name"). */

export type PluginFeature = 'server' | 'tui' | 'gui' | 'rpc'

export function detectFeatures(pkg: {
  exports?: unknown
  main?: string | null
  files?: readonly string[]   // tarball paths (package/-prefixed ok)
}): PluginFeature[] {
  // node treats a string exports as { ".": <string> } — it is the root entry
  const ex = typeof pkg.exports === 'string'
    ? { '.': pkg.exports }
    : pkg.exports && typeof pkg.exports === 'object'
      ? pkg.exports as Record<string, unknown>
      : undefined
  const roots = new Set((pkg.files ?? []).map(f => f.replace(/^package\//, '')))
  // node resolution for `pkg/<sub>`: <sub>.{js,cjs,mjs} or <sub>/index.{js,cjs,mjs}
  const at = (sub: string) =>
    roots.has(`${sub}.js`) || roots.has(`${sub}.cjs`) || roots.has(`${sub}.mjs`)
    || roots.has(`${sub}/index.js`) || roots.has(`${sub}/index.cjs`) || roots.has(`${sub}/index.mjs`)
  const has = (sub: string) => ex ? `./${sub}` in ex : at(sub)

  const server = ex
    ? ('./server' in ex || '.' in ex || !!pkg.main)
    : (at('server') || !!pkg.main || roots.has('index.js') || roots.has('index.cjs') || roots.has('index.mjs'))
  // the app evaluates gui bundles as CJS text — resolve leaf targets, keep .cjs/.js
  const gui = ex
    ? leafs(ex['./gui-experimental']).some(p => /\.c?js$/.test(p))
    : (roots.has('gui-experimental.cjs') || roots.has('gui-experimental.js'))

  const parts: PluginFeature[] = []
  if (server) parts.push('server')
  if (has('tui')) parts.push('tui')
  if (has('rpc') && server) parts.push('rpc')
  if (gui) parts.push('gui')
  return parts
}

/** Export-map leaf targets — a value may be a string or nested conditions. */
const leafs = (v: unknown): string[] =>
  typeof v === 'string' ? [v]
  : Array.isArray(v) ? v.flatMap(leafs)
  : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).flatMap(leafs)
  : []
