/** Pure spec/inventory helpers shared by gui.ts and tui.tsx.
 *  Extracted for L2 unit tests — no fs/network, inject data. */

/** Strip a trailing @version only when the @ isn't at index 0.
 *  '@scope/name' must NOT be stripped (leading @ is the scope). Git specs
 *  normalize to owner/repo so a pinned `repo#sha`, a `github:` shorthand and
 *  a github URL all resolve to the same catalog name — dedupe/uninstall/
 *  installed-matching then compare one identity, not three spellings. */
export const cleanSpec = (s: string): string => {
  const noVer = s.replace(/^((?:@[^/]+\/)?[^@]+)@.*$/, '$1')
  // git-shaped specs normalize to owner/repo; everything else keeps the
  // npm form untouched — a `.git`-suffixed npm NAME ('foo.git@1.0') must
  // not collapse into 'foo'
  if (!/(#|^github:|^git\+https|^https:\/\/github\.com\/|^git@github\.com:)/i.test(noVer)) return noVer
  return noVer
    .replace(/^github:/i, '')
    .replace(/^(?:git\+)?https:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/#.*$/, '')
}

/** Replace every spec resolving to the same name with a single exact spec —
 *  the pinned form survives (update flow: dedupe old specs down to the
 *  approved pinned spec). */
export function dedupeToSpec(list: readonly string[], spec: string): string[] {
  return [...list.filter(s => cleanSpec(s) !== cleanSpec(spec)), spec]
}

/** Remove every spec resolving to the plugin — by clean spec, raw name, or plugin id. */
export function removeSpec(list: readonly string[], name: string, idByName: Record<string, string> = {}): string[] {
  const clean = cleanSpec(name)
  const keep = list.filter(s => {
    const c = cleanSpec(s)
    return c !== clean && s !== name && (idByName[c] ?? c) !== name
  })
  if (keep.length === list.length) throw new Error(`${name} not found in opencode.json plugins`)
  return keep
}

/** plugin.list items → features keyed by BOTH spec and plugin id. */
export function featuresMap(items: readonly { id?: string; source?: { type?: string; target?: string } ; features?: Record<string, true> }[]): Record<string, Record<string, true> | undefined> {
  const out: Record<string, Record<string, true> | undefined> = {}
  for (const p of items) {
    if (!p.features) continue
    if (p.source?.target) out[cleanSpec(p.source.target)] = p.features
    if (p.id) out[p.id] = p.features
  }
  return out
}

/** Installed specs with no catalog entry → extras cards (display name prefers plugin id). */
export function buildExtras(specByName: Record<string, string>, idByName: Record<string, string>, versions: Record<string, string>, idxNames: Set<string>): { name: string; version: string }[] {
  return Object.keys(specByName)
    .filter(k => !idxNames.has(k))
    .map(k => ({ name: idByName[k] ?? k, version: versions[k] ?? '' }))
}
