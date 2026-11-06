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
  // .opencode/ anchored at any depth — monorepo packages keep their host
  // config under packages/<x>/.opencode/ just as often as at the root
  if (has(/(^|\/)\.opencode\//)) via.push('opencode-dir')
  if (has(/(^|\/)opencode\.jsonc?$/)) via.push('opencode-config')
  const skillFile = has(/(^|\/)SKILL\.md$/)
  if (skillFile) via.push('skill-file')
  const pkg = has(/(^|\/)package\.json$/)
  if (pkg) via.push('package')
  const pluginArtifact = has(/(^|\/)\.opencode\/(plugin|plugins|skills)\//)
  if (pluginArtifact) via.push('opencode-artifact')
  // topic tags are affiliation, not artifact claims — and only the opencode-*
  // topics say anything about THIS host. 'agent-skill' is a cross-host generic
  // tag (Claude/Cursor skills wear it too); 'opencode' alone is even weaker (R-4)
  const opencodeTopic = topics.some(t => /^(opencode-plugin|opencode-skill)$/.test(t))
  if (opencodeTopic) via.push('opencode-topic')

  // the specific side needs an actual opencode trace: a .opencode/ dir, an
  // opencode.json config, or an opencode-* topic. A bare SKILL.md is a
  // cross-ecosystem convention — it proves an artifact exists, not that the
  // artifact is for opencode (R-4)
  const specific = via.includes('opencode-dir') || via.includes('opencode-config') || opencodeTopic
  const artifact = pluginArtifact || skillFile || pkg
  return { ok: specific && artifact, via }
}

/** Any SKILL.md in the repo marks a skill artifact — root, skills/<x>/, or
 *  .opencode/skills/ layouts all count. Shared by the npm↔repo probe and the
 *  github-kind admission path so `contains` matches the evidence gate's idea
 *  of a skill. */
export const hasSkillPath = (paths: ReadonlySet<string>): boolean =>
  [...paths].some(p => /(^|\/)SKILL\.md$/.test(p) || /(^|\/)\.opencode\/skills\//.test(p))

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
