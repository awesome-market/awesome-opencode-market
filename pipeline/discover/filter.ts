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

/** Keywords/topics that declare a DIFFERENT plugin host. An artifact wearing
 *  one of these tags may still relate to opencode — dsh-llm-opencode-go
 *  adapts OpenCode Go models into DeepSeek Harness, usage meters read
 *  opencode quotas — but 'integrates with opencode' is not 'installable
 *  into opencode' (a dsh plugin installs via `dsh plugin install`, not
 *  `opencode plugin add`). When a foreign host is declared, the weak
 *  affiliation signals (opencode keyword / opencode-* topic) stop counting
 *  as the opencode-specific arm; positive install evidence is required
 *  instead — readme-install on npm, .opencode/ or opencode.json in a repo
 *  tree. A genuinely dual-host package documents/ships those anyway, so
 *  the demotion never rejects what it shouldn't. Keep entries to tags
 *  that unambiguously name a host's plugin ecosystem. */
const FOREIGN_HOST_TAGS = new Set([
  // DeepSeek Harness / cordis (koishi) plugin ecosystem — 'dsh', 'dsh-plugin',
  // 'deepseek-harness' are how dsh plugins self-tag on npm and GitHub
  'dsh', 'dsh-plugin', 'dsh-plugins', 'dsh-bundle',
  'deepseek-harness', 'deepseek-harness-plugin',
  'cordis', 'cordis-plugin', 'koishi', 'koishi-plugin',
  // other editor/agent hosts whose plugin ecosystems get swept in by the
  // generic keyword/topic nets the same way
  'claude-code', 'claude-code-plugin', 'claude-desktop',
  'cursor', 'cursor-plugin', 'zed-extension',
  'vscode-extension', 'obsidian-plugin', 'neovim-plugin', 'aider',
])

/** Self-declared foreign-host membership in free text (readme/description):
 *  'DeepSeek Harness plugin', 'DSH Agent Skill', 'a cordis plugin'… The
 *  patterns name the host's plugin ecosystem explicitly — integrations
 *  merely MENTIONING a host don't match, and a genuine dual-host package
 *  that does match just faces the readme-install-verb bar like the rest. */
const FOREIGN_HOST_PROSE = /deepseek[ -]harness|\b(?:dsh|cordis|koishi)[- ](?:plugin|skill|bundle|agent|provider)\b|\bclaude[ -]code (?:plugin|skill|extension)\b/i

/** Cheap self-declaration check — any of the foreign-host signals fires.
 *  The admission gates call it with keywords/topics/readme/desc; the
 *  kept-entry sweep calls it with just the stored name/description to
 *  decide whether a re-gate fetch is worth making (a false positive there
 *  only costs one fetch — the real gate still decides). */
export function foreignHostDeclared(i: {
  keywords?: string[] | undefined
  topics?: string[] | undefined
  name?: string | undefined
  text?: string | undefined
}): boolean {
  return (i.keywords ?? []).some(k => FOREIGN_HOST_TAGS.has(k.toLowerCase()))
    || (i.topics ?? []).some(t => FOREIGN_HOST_TAGS.has(t.toLowerCase()))
    || /(^|\/)dsh[-_]/i.test(i.name ?? '')
    || FOREIGN_HOST_PROSE.test(i.text ?? '')
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
  name?: string,
  desc?: string,
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
  // artifact is for opencode (R-4). A repo that declares ANOTHER plugin host
  // in its topics (dsh-plugin, cordis, claude-code…) loses the topic arm:
  // 'integrates with opencode' ≠ 'installable into opencode', so only the
  // positive in-tree evidence (opencode-dir/config) still counts — a repo
  // that genuinely ships an opencode artifact carries those files anyway.
  // The name/desc arms cover untagged repos: 'owner/dsh-x' and 'a DSH
  // Agent Skill' declare the same foreign membership as a topic tag.
  const foreignTopic = foreignHostDeclared({ topics: [...topics], name, text: desc })
  const specific = via.includes('opencode-dir') || via.includes('opencode-config')
    || (opencodeTopic && !foreignTopic)
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
  name?: string | undefined
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
  // either (unrelated package squatting on the keyword). A package that
  // declares ANOTHER plugin host in its keywords (dsh-plugin, cordis,
  // claude-code…) loses the keyword arm entirely — its 'opencode' keyword
  // describes an integration (model adapter, usage meter), not installable
  // membership. readme-install's loose "plugin"-key match isn't enough
  // either (the OTHER host's config snippets carry it too); the foreign
  // bar is the host-qualified opencode install command — `opencode plugin
  // add` — since other hosts share the bare `plugin add` verb (DSH's own
  // installer is `dsh plugin add`). A genuinely dual-host package
  // documents the opencode CLI path anyway.
  //
  // fallback for untagged packages: a 'dsh-*' name or a readme that
  // self-declares the foreign host ('DeepSeek Harness plugin') is the
  // same membership claim as the keyword — sloppy taggers don't get a
  // weaker bar for forgetting the tag.
  const foreignHost = foreignHostDeclared({ keywords: kw, name: pkg.name, text: pkg.readme })
  const readmeInstallVerb = !!pkg.readme && /opencode plugin add/i.test(pkg.readme)
  const opencodeSpecific = foreignHost
    ? readmeInstallVerb
    : via.includes('keyword') || via.includes('readme-install')
  const artifact = via.includes('entry') || via.includes('readme-install')
  return { ok: opencodeSpecific && artifact, via }
}
