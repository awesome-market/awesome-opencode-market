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
  for (const s of stems) dominant.set(s, (dominant.get(s) ?? 0) + 1)
  return Math.max(...dominant.values()) >= 6
}

/** GitHub-side evidence gate: a topic tag alone never admits. The repo tree
 *  must show an opencode-specific signal AND an installable artifact.
 *  Path-only (no content fetches) — runs after fetchRepoTree. */
export function hasRepoEvidence(
  paths: ReadonlySet<string>,
  topics: readonly string[] = [],
): { ok: boolean; via: string[] } {
  const has = (re: RegExp) => [...paths].some(p => re.test(p))
  const via: string[] = []
  if (has(/^\.opencode\//)) via.push('opencode-dir')
  if (has(/(^|\/)opencode\.jsonc?$/)) via.push('opencode-config')
  const skillFile = has(/(^|\/)SKILL\.md$/)
  if (skillFile) via.push('skill-file')
  const pkg = has(/(^|\/)package\.json$/)
  if (pkg) via.push('package')
  const pluginArtifact = has(/^\.opencode\/(plugin|plugins|skills)\//)
  if (pluginArtifact) via.push('opencode-artifact')
  // generic 'opencode' topic is affiliation, not an artifact claim — only the
  // extension-specific topics count
  const opencodeTopic = topics.some(t => /^(opencode-plugin|opencode-skill|agent-skill)$/.test(t))
  if (opencodeTopic) via.push('opencode-topic')

  const specific = via.includes('opencode-dir') || via.includes('opencode-config')
    || skillFile || opencodeTopic
  // SKILL.md is itself the installable skill artifact — counts for both sides
  const artifact = pluginArtifact || skillFile || pkg
  return { ok: specific && artifact, via }
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
