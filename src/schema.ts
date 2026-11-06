import { z } from 'zod'

// z.looseObject everywhere in this file (not z.object): the catalog-branch
// data plane gets PARSED-AND-REWRITTEN by release.ts / verify-merge / remerge,
// and the writer may run an older schema than the pipeline that produced the
// file — default z.object strips unknown keys, so a forward field (e.g. a new
// pendingUpdate slot property) would silently die on the next apply. Loose
// keeps unknown keys flowing through validation so forward fields survive
// the rewrite; known keys still validate strictly.

/** Localized text: en required, zh optional */
export const LocalizedText = z.looseObject({ en: z.string(), zh: z.string().optional() })
export type LocalizedText = z.infer<typeof LocalizedText>

export const PluginType = z.enum(['plugin', 'skill', 'agent', 'command', 'mcp', 'theme', 'bundle', 'rule'])
export type PluginType = z.infer<typeof PluginType>

export const SourceKind = z.enum(['npm', 'github'])
export const PluginFeature = z.enum(['server', 'tui', 'gui', 'rpc'])
/** Producers today: 'npm-keyword' (registry search), 'github-topic' (topic
 *  search), 'code-search' (GitHub code search — .opencode/, opencode.json,
 *  SKILL.md mentions), 'submission' (issue seeds). 'topic-list' is RESERVED —
 *  declared for a future curated-list channel; no file currently emits it
 *  (kept in the enum so old indexes carrying it still parse). */
export const DiscoveryChannel = z.enum(['npm-keyword', 'github-topic', 'code-search', 'topic-list', 'submission'])

export const VerificationStatus = z.enum(['verified', 'failed', 'unverified', 'skipped'])
/** deepest stage reached: install → load (server canary) → interactive (L2 tmux) → render (L3a gui harness) */
export const VerificationLevel = z.enum(['install', 'load', 'interactive', 'render', 'structure'])

export const Source = z.looseObject({
  kind: SourceKind,
  id: z.string(),                    // npm name or owner/repo
  repo: z.string().optional(),       // canonical owner/repo when known
  repoId: z.number().int().optional(), // GitHub numeric repo id — repojacking detection
  version: z.string().optional(),    // resolved version or ref
})

export const Capabilities = z.looseObject({
  /** null = never scanned (renders differently from empty findings) */
  scannedAt: z.string().nullable(),
  /** scan ruleset version — cacheKey component; bump to re-scan unchanged packages */
  rulesetVersion: z.string().optional(),
  findings: z.array(z.string()),
  redFlags: z.array(z.string()),
  /** when the CURRENT identity-level flag set (sec:* redFlags) was first observed
   *  on this slot — stamped by merge, cleared when the set empties. Docket uses
   *  it to tell "a human verdict decided this flag" from "verdict predates it". */
  flaggedAt: z.string().optional(),
})

export const Verification = z.looseObject({
  status: VerificationStatus,
  level: VerificationLevel.optional(),
  opencodeVersion: z.string().optional(),
  verifiedAt: z.string().optional(),
  runUrl: z.string().optional(),
  logExcerpt: z.string().max(2048).optional(),
  /** SRI (npm) or commit sha (github-kind) of the bytes the verify run actually
   *  measured — the anchor content-addressed reuse + drift checks key on. A
   *  slot's pinned integrity (entry.integrity / pendingUpdate.integrity /
   *  github source.version) may describe different bytes after a re-tag. */
  integrity: z.string().optional(),
  /** consecutive failed verify attempts recorded by verify merge — cleared on
   *  any non-failed result. plan re-queues recent failures while retries < 3 (V-3). */
  retries: z.number().int().optional(),
})

/** AI/human review state (AI-DIAGNOSIS §4).
 *  approved = passed review, displayed
 *  pending  = not yet reviewed, filtered from site + client
 *  legacy   = pre-migration entry: displayed, flagged "predates AI review" */
export const Approval = z.enum(['approved', 'pending', 'legacy'])
export type Approval = z.infer<typeof Approval>

/** A version bump held back from display (hold-by-default). Display fields stay
 *  pinned to the last approved version until this releases via verdict+verify. */
export const PendingUpdate = z.looseObject({
  version: z.string(),
  capabilities: Capabilities,
  verification: Verification,
  /** new version's detected features — promoted to display on release */
  features: z.array(PluginFeature).optional(),
  /** the HELD version's installable parts — entry.contains is pinned to the
   *  displayed version while a hold exists, so the candidate's payload
   *  description must live here (verify routing + release promotion read it).
   *  Absent on holds created before this field existed; those still carry
   *  candidate parts on the entry itself. */
  contains: z.array(z.enum(['plugin', 'skill', 'mcp', 'command', 'agent', 'hook'])).optional(),
  /** the HELD version's tarball SRI — entry.integrity is pinned to the
   *  displayed version while a hold exists, so the candidate's integrity
   *  must live here for release to promote it (same version-scoped rule as
   *  contains). Absent on holds created before this field existed. */
  integrity: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  /** AI concern reason / awaiting-review */
  reason: z.string().optional(),
  heldAt: z.string(),
})
export type PendingUpdate = z.infer<typeof PendingUpdate>

export const Compat = z.looseObject({
  engines: z.string().optional(),
  peer: z.string().optional(),
})

export const PluginEntry = z.looseObject({
  name: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()).default([]),
  type: PluginType,
  contains: z.array(z.enum(['plugin', 'skill', 'mcp', 'command', 'agent', 'hook'])).optional(),
  features: z.array(PluginFeature).optional(),
  discoveredVia: z.array(DiscoveryChannel).default([]),
  source: Source,
  description: LocalizedText.partial().default({}),
  category: z.array(z.string()).default([]),
  license: z.string().nullable().default(null),
  deprecated: z.boolean().default(false),
  deprecatedMessage: z.string().nullable().default(null),
  replacement: z.string().nullable().default(null),
  /** npm packument time.created — package birth; > firstSeenAt ⇒ name was re-registered */
  createdAt: z.string().nullable().default(null),
  modifiedAt: z.string().nullable().default(null),
  /** npm maintainer account names — publisher identity tracking */
  maintainers: z.array(z.string()).default([]),
  /** npm dist-tags table (latest/next/...) — rollback detection beyond latest alone */
  distTags: z.record(z.string(), z.string()).default({}),
  firstSeenAt: z.string(),
  latestVersion: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  /** SRI (sha512-…) of the registry artifact for `latestVersion` — install-time
   *  drift check: the bytes a client fetches must equal what review approved.
   *  null for github-kind entries (codeload archives have no registry integrity). */
  integrity: z.string().nullable().optional(),
  metrics: z.looseObject({
    stars: z.number().int().nonnegative().nullable().default(null),
    npmDownloads30d: z.number().int().nonnegative().nullable().default(null),
    checkedAt: z.string(),
  }),
  capabilities: Capabilities,
  verification: Verification,
  compat: Compat.default({}),
  /** 'legacy' default migrates old indexes that predate the field */
  approval: Approval.default('legacy'),
  approvalReason: z.string().optional(),
  pendingUpdate: PendingUpdate.optional(),
})
export type PluginEntry = z.infer<typeof PluginEntry>

/** Tombstone record: entry observed missing from a run — kept so disappearance
 *  has a cause, a URL that doesn't 404, and name-reuse detection data (DEV §F-2). */
export const RemovedReason = z.enum(['npm-404', 'repo-404', 'filtered', 'capped', 'manual', 'unknown'])
export type RemovedReason = z.infer<typeof RemovedReason>

export const RemovedEntry = z.looseObject({
  slug: z.string(),
  name: z.string(),
  lastSource: Source.optional(),
  disappearedAt: z.string(),
  reason: RemovedReason,
  /** package/repo birth stamp at disappearance — a same-name re-entry with a
   *  NEWER createdAt is a re-registration under a recycled identity (the
   *  tombstone-side mirror of trustFlags' createdAt>firstSeenAt check) */
  createdAt: z.string().nullable().optional(),
})
export type RemovedEntry = z.infer<typeof RemovedEntry>

export const CatalogIndex = z.looseObject({
  version: z.literal('1'),
  generatedAt: z.string(),
  categories: z.record(z.string(), LocalizedText),
  plugins: z.array(PluginEntry),
  removed: z.array(RemovedEntry).default([]),
})
export type CatalogIndex = z.infer<typeof CatalogIndex>

/** One record in catalog-branch ai-verdicts.jsonl (append-only, AI-DIAGNOSIS §4). */
export const AiVerdict = z.looseObject({
  name: z.string(),
  /** null = github-kind entries (no versions); matches latestVersion: null */
  version: z.string().nullable().default(null),
  verdict: z.enum(['pass', 'concern']),
  /** primary reason — Chinese for ai-sourced records, whatever the human typed otherwise */
  reason: z.string().optional(),
  /** English rendering for ai-sourced records (bilingual audit trail) */
  reasonEn: z.string().optional(),
  /** ISO-8601 — a malformed timestamp would silently land in the digest's
   *  "future-dated" bucket and never mature; validate at the boundary.
   *  Offsets (+08:00) accepted — loadVerdicts normalizes to Z so akey/time
   *  compares stay lexicographic; rejecting offsets would drop the line. */
  at: z.iso.datetime({ offset: true }),
  /** stamped by our writers, never by the model — AI can't forge 'human' */
  source: z.enum(['ai', 'human']),
  /** sha of the reviewed tarball — same-sha re-tag/re-publish reuses the verdict */
  sha: z.string().optional(),
  /** reviewer model id (audit metadata, AI-DIAGNOSIS §5 — absent on verdicts
   *  written without an LLM call, e.g. verify-fail short-circuit / sha reuse) */
  model: z.string().optional(),
  /** L0.5 classifier evidence: which model + its max score over the material */
  l05: z.looseObject({ model: z.string(), score: z.number() }).optional(),
  /** human verdicts: which maintainer decided (audit — a free-text reason can
   *  omit or spoof this; stamped by the writer from github.actor) */
  by: z.string().optional(),
  /** human verdicts: the issue the decision came from (audit trail back to
   *  the [review]/[concern]/[submit] thread) */
  issue: z.number().optional(),
})
export type AiVerdict = z.infer<typeof AiVerdict>

/** catalog-branch digest-state.json — pass verdicts mature only after they have
 *  appeared in a daily digest. Membership in `announced` is the maturity test,
 *  NOT at ≤ lastDigestAt: a verdict pushed to the branch after a digest render
 *  but carrying an older `at` must not mature unseen. Absent → empty → every
 *  pass stays frozen until the next digest republishes (fail-closed). */
export const DigestState = z.looseObject({
  lastDigestAt: z.string(),
  /** verdict-line keys ("name\0version\0at") announced across digests so far —
   *  cumulative; a NEW judgment on the same name@version is a new key and must
   *  be announced again. */
  announced: z.array(z.string()).default([]),
  /** UTC day of the last render + keys first announced on that day — a same-day
   *  re-render stays cumulative instead of overwriting with a narrower view. */
  day: z.string().optional(),
  dayAnnounced: z.array(z.string()).default([]),
})
export type DigestState = z.infer<typeof DigestState>
