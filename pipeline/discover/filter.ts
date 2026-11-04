/** Admission + exclusion rules (DEV §4.5). Keyword alone never admits — evidence required downstream. */

export interface AdmissionInput {
  name: string
  repoUrl: string | null
  archived?: boolean
  fork?: boolean
  hasOwnCommits?: boolean   // for forks; undefined = unknown (treated as pass at this stage)
  description?: string
}

export interface AdmissionDecision {
  admit: boolean
  reasons: string[]          // why excluded (or why admitted, for audit)
}

/** Stage-1 cheap filters — no network. Evidence-based admission happens after fetch. */
export function preAdmit(i: AdmissionInput): AdmissionDecision {
  const reasons: string[] = []
  if (i.archived) reasons.push('archived')
  if (i.fork && i.hasOwnCommits === false) reasons.push('fork-no-own-commits')
  return { admit: reasons.length === 0, reasons }
}

/** Template-spam heuristic: same owner + >5 near-identical names (magpie-community pattern, DEV §4.5). */
export function looksLikeTemplateSpam(names: string[]): boolean {
  if (names.length < 6) return false
  const stems = names.map(n => n.replace(/[-_\d]/g, '').toLowerCase())
  const dominant = new Map<string, number>()
  for (const s of stems) dominant.set(s.slice(0, 6), (dominant.get(s.slice(0, 6)) ?? 0) + 1)
  return Math.max(...dominant.values()) >= 6
}

/** Evidence check post-fetch: does the package actually look like an opencode artifact? */
export function hasPluginEvidence(pkg: {
  keywords?: string[]
  main?: string | undefined
  exports?: unknown
  readme?: string | undefined
}): { ok: boolean; via: string[] } {
  const via: string[] = []
  const kw = (pkg.keywords ?? []).map(k => k.toLowerCase())
  if (kw.some(k => k.includes('opencode'))) via.push('keyword')
  if (pkg.main || pkg.exports) via.push('entry')
  if (pkg.readme && /opencode/i.test(pkg.readme) && /opencode\.json|"plugin"|plugin add/i.test(pkg.readme))
    via.push('readme-install')
  // evidence gate (DEV §4.5): an opencode-SPECIFIC signal is required —
  // 'entry' alone means any npm package with a main/exports, which is just
  // "a package exists", not "a plugin exists". keyword alone isn't enough
  // either (unrelated package squatting on the keyword).
  const opencodeSpecific = via.includes('keyword') || via.includes('readme-install')
  const artifact = via.includes('entry') || via.includes('readme-install')
  return { ok: opencodeSpecific && artifact, via }
}
