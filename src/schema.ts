import { z } from 'zod'

/** Localized text: en required, zh optional */
export const LocalizedText = z.object({ en: z.string(), zh: z.string().optional() })
export type LocalizedText = z.infer<typeof LocalizedText>

export const PluginType = z.enum(['plugin', 'skill', 'agent', 'command', 'mcp', 'theme', 'bundle', 'rule'])
export type PluginType = z.infer<typeof PluginType>

export const SourceKind = z.enum(['npm', 'github'])
export const PluginFeature = z.enum(['server', 'tui', 'gui', 'rpc'])
export const DiscoveryChannel = z.enum(['npm-keyword', 'github-topic', 'code-search', 'topic-list', 'submission'])

export const VerificationStatus = z.enum(['verified', 'failed', 'unverified', 'skipped'])
/** deepest stage reached: install → load (server canary) → interactive (L2 tmux) → render (L3a gui harness) */
export const VerificationLevel = z.enum(['install', 'load', 'interactive', 'render', 'structure'])

export const Source = z.object({
  kind: SourceKind,
  id: z.string(),                    // npm name or owner/repo
  repo: z.string().optional(),       // canonical owner/repo when known
  repoId: z.number().int().optional(), // GitHub numeric repo id — repojacking detection
  version: z.string().optional(),    // resolved version or ref
})

export const Capabilities = z.object({
  /** null = never scanned (renders differently from empty findings) */
  scannedAt: z.string().nullable(),
  /** scan ruleset version — cacheKey component; bump to re-scan unchanged packages */
  rulesetVersion: z.string().optional(),
  findings: z.array(z.string()),
  redFlags: z.array(z.string()),
})

export const Verification = z.object({
  status: VerificationStatus,
  level: VerificationLevel.optional(),
  opencodeVersion: z.string().optional(),
  verifiedAt: z.string().optional(),
  runUrl: z.string().optional(),
  logExcerpt: z.string().max(2048).optional(),
})

/** AI/human review state (AI-DIAGNOSIS §4).
 *  approved = passed review, displayed
 *  pending  = not yet reviewed, filtered from site + client
 *  legacy   = pre-migration entry: displayed, flagged "predates AI review" */
export const Approval = z.enum(['approved', 'pending', 'legacy'])
export type Approval = z.infer<typeof Approval>

/** A version bump held back from display (hold-by-default). Display fields stay
 *  pinned to the last approved version until this releases via verdict+verify. */
export const PendingUpdate = z.object({
  version: z.string(),
  capabilities: Capabilities,
  verification: Verification,
  /** new version's detected features — promoted to display on release */
  features: z.array(PluginFeature).optional(),
  publishedAt: z.string().nullable().optional(),
  /** AI concern reason / awaiting-review */
  reason: z.string().optional(),
  heldAt: z.string(),
})
export type PendingUpdate = z.infer<typeof PendingUpdate>

export const Compat = z.object({
  engines: z.string().optional(),
  peer: z.string().optional(),
})

export const PluginEntry = z.object({
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
  metrics: z.object({
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

export const RemovedEntry = z.object({
  slug: z.string(),
  name: z.string(),
  lastSource: Source.optional(),
  disappearedAt: z.string(),
  reason: RemovedReason,
})
export type RemovedEntry = z.infer<typeof RemovedEntry>

export const CatalogIndex = z.object({
  version: z.literal('1'),
  generatedAt: z.string(),
  categories: z.record(z.string(), LocalizedText),
  plugins: z.array(PluginEntry),
  removed: z.array(RemovedEntry).default([]),
})
export type CatalogIndex = z.infer<typeof CatalogIndex>

/** One record in catalog-branch ai-verdicts.jsonl (append-only, AI-DIAGNOSIS §4). */
export const AiVerdict = z.object({
  name: z.string(),
  /** null = github-kind entries (no versions); matches latestVersion: null */
  version: z.string().nullable().default(null),
  verdict: z.enum(['pass', 'concern']),
  /** primary reason — Chinese for ai-sourced records, whatever the human typed otherwise */
  reason: z.string().optional(),
  /** English rendering for ai-sourced records (bilingual audit trail) */
  reasonEn: z.string().optional(),
  at: z.string(),
  /** stamped by our writers, never by the model — AI can't forge 'human' */
  source: z.enum(['ai', 'human']),
  /** sha of the reviewed tarball — same-sha re-tag/re-publish reuses the verdict */
  sha: z.string().optional(),
})
export type AiVerdict = z.infer<typeof AiVerdict>

/** catalog-branch digest-state.json — pass verdicts mature only after they have
 *  appeared in a daily digest (verdict.at ≤ lastDigestAt). Missing file → -∞. */
export const DigestState = z.object({
  lastDigestAt: z.string(),
})
export type DigestState = z.infer<typeof DigestState>
