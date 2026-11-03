import { z } from 'zod'

/** Localized text: en required, zh optional */
export const LocalizedText = z.object({ en: z.string(), zh: z.string().optional() })
export type LocalizedText = z.infer<typeof LocalizedText>

export const PluginType = z.enum(['plugin', 'skill', 'agent', 'command', 'mcp', 'theme', 'bundle', 'rule'])
export type PluginType = z.infer<typeof PluginType>

export const SourceKind = z.enum(['npm', 'github'])
export const DiscoveryChannel = z.enum(['npm-keyword', 'github-topic', 'code-search', 'topic-list', 'submission'])

export const VerificationStatus = z.enum(['verified', 'failed', 'unverified', 'skipped'])
export const VerificationLevel = z.enum(['install', 'load', 'structure'])

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
  features: z.array(z.enum(['server', 'tui', 'gui', 'rpc'])).optional(),
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
})
export type PluginEntry = z.infer<typeof PluginEntry>

/** Tombstone record: entry observed missing from a run — kept so disappearance
 *  has a cause, a URL that doesn't 404, and name-reuse detection data (DEV §F-2). */
export const RemovedReason = z.enum(['npm-404', 'filtered', 'capped', 'manual', 'unknown'])
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
