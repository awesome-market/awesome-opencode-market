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

// ---- plugin-module shape -----------------------------------------------
// module.ts's load contract: the server entry must default-export
// `{ id: string, effect|setup: function }` (Schema.Union, "Plugin must
// export a default definition with an id and an effect or setup function").
// Real packages spell it several ways — literal object, `Plugin.define()`,
// `Rpc.define()`, method shorthand, computed ids, CJS `module.exports` —
// and TUI/RPC entries carry their own keys (`{id, tui}`, `{id, methods}`).
// Detection is deliberately permissive: a false positive only means "keep
// the candidate" (verify stays the real gate), a false negative would
// reject a working plugin. The veto fires only when NO file in the whole
// tarball looks plugin-shaped.
const PLUGIN_SDK = /@opencode\/plugin|Plugin\.define\s*\(|Rpc\.define\s*\(|definePlugin\s*\(/
const DEFAULT_EXPORT = /\bexport\s+default\b|\bexport\s*\{[^}]*\bdefault\b|\bmodule\.exports\s*=|\bexports\.default\s*=/
// `{ id: "…", …setup|effect|tui|methods… }` — the definition object itself,
// id-first as every observed plugin spells it; catches split definitions
// (`export const plugin = {...}` re-exported as default) that carry no
// default-export marker in the defining file. Ids are single/double-quoted
// only — template-literal ids (`id: \`chatcmpl-…\``) are API-response
// shapes (OpenAI-compatible servers), not plugin ids.
const PLUGIN_DEF_OBJ = /\{\s*id\s*:\s*['"][^'"]{1,120}['"]\s*,[^}]{0,3000}?\b(?:setup|effect|tui|methods)\b/
const ID_ANY = /\bid\s*:/
const SURFACE_KEY = /(?:^|[{,]\s*)(?:async\s+)?(?:setup|effect|tui|methods)\s*(?=[(:}\],])/

/** True when a text file could be an opencode plugin definition module —
 *  SDK usage, or a default-exported object carrying a plugin id plus a
 *  surface key. Used by the tarball scan to veto 'plugin' parts whose
 *  entry point resolves to non-plugin code (CLI tools, API servers). */
export function looksLikePluginModule(text: string): boolean {
  if (PLUGIN_SDK.test(text)) return true
  if (PLUGIN_DEF_OBJ.test(text)) return true
  // fallback for defs whose id isn't the first key ({name, id, setup}) or is
  // computed ({id: pkg.name, …}) — needs the export marker AND a surface key
  // AND some id field; a bare `{id: "…"}` config object is not plugin-shaped
  return DEFAULT_EXPORT.test(text) && SURFACE_KEY.test(text) && ID_ANY.test(text)
}
