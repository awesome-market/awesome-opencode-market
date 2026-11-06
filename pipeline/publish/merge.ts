/** Index merge: new entries layered over old index — unchanged packages keep prior
 *  scan/verify results (incremental cache carrier, DEV §1).
 *  Two cache layers (PIPELINE-ISSUES I-2):
 *    identity fields (firstSeenAt/aliases/discoveredVia/slug) — matched by npm name
 *    per-version fields (capabilities/verification) — matched by name@version+host+ruleset
 */
import type { CatalogIndex, PluginEntry, RemovedEntry } from '../../src/schema.ts'
import { CatalogIndex as CatalogIndexSchema } from '../../src/schema.ts'
import { CAT_NAMES, catId } from '../../src/categories.ts'

/** Host opencode version used for verification cache keys (name@version+host, DEV §4).
 *  Bump in lockstep with verify.yml's installed @opencode/cli version. */
export const OPENCODE_VERSION = '2.2.5'

export function cacheKey(e: Pick<PluginEntry, 'name' | 'latestVersion'>, opencodeVersion: string): string {
  return `${e.name}@${e.latestVersion ?? '?'}+${opencodeVersion}`
}

const ruleOf = (finding: string) => finding.split(':')[0] ?? finding

/** Delta-scan strong rules: newly-appearing install-time code execution (SEC-3.5). */
const STRONG_DELTA_RULES = new Set(['lifecycle-script', 'prepare-script'])

/** Identity-change + delta-scan red flags (SEC-2/SEC-3).
 *  `e` must carry the CANDIDATE version's data: for held bumps the caller passes
 *  `{...entry, latestVersion: pendingUpdate.version, capabilities: pendingUpdate.capabilities}`
 *  so delta findings describe the version under review, not the pinned display.
 *  Rollback is measured against the currently-held target
 *  (`pendingUpdate?.version ?? latestVersion`) so a held version doesn't fire
 *  rollback against the pinned display every run (AI-DIAGNOSIS §10). */
export function trustFlags(prev: PluginEntry | undefined, e: PluginEntry): { findings: string[]; redFlags: string[] } {
  const findings: string[] = []
  const redFlags: string[] = []
  if (!prev) return { findings, redFlags }
  // name re-registered after we first saw it (package recreated — possible squat)
  if (e.createdAt && e.createdAt > prev.firstSeenAt) redFlags.push('sec:name-reused')
  // publisher identity drift (weak signal: also fires on legit transfers — still human review)
  if (prev.maintainers.length > 0 && e.maintainers.length > 0 &&
      [...prev.maintainers].sort().join(',') !== [...e.maintainers].sort().join(',')) {
    findings.push('sec:maintainer-changed')
  }
  // repo numeric id changed — repo was deleted & recreated under same URL (repojacking)
  if (prev.source.repoId && e.source.repoId && prev.source.repoId !== e.source.repoId) {
    redFlags.push('sec:repo-recreated')
  }
  // dist-tags.latest rolled backwards (vs the held target when a hold exists)
  if (versionCmp(e.latestVersion, prev.pendingUpdate?.version ?? prev.latestVersion) < 0) redFlags.push('sec:version-rollback')
  // delta scan: rules present in new findings but absent from previous findings.
  // Only meaningful when both sides were scanned by the SAME ruleset — a ruleset
  // upgrade surfaces pre-existing issues, which is not a behavior change.
  if (prev.capabilities.rulesetVersion === e.capabilities.rulesetVersion) {
    const prevRules = new Set(prev.capabilities.findings.map(ruleOf))
    for (const f of e.capabilities.findings) {
      const r = ruleOf(f)
      if (prevRules.has(r)) continue
      prevRules.add(r)
      const tag = `sec-delta:${r}`
      ;(STRONG_DELTA_RULES.has(r) ? redFlags : findings).push(tag)
    }
  }
  return { findings, redFlags }
}

/** Semver-ish compare: numeric core first, then prerelease semantics
 *  (a release outranks its own prereleases; identifiers compare semver-style —
 *  numeric < alphanumeric, shorter identifier list < longer on equal prefix).
 *  Non-numeric core (or empty input) → 0: unparsable means "can't order", not
 *  "equal" — callers treat 0 as no-rollback either way. */
export function versionCmp(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  const split = (v: string): readonly [string, string | undefined] => {
    const i = v.indexOf('-')
    return i < 0 ? [v, undefined] : [v.slice(0, i), v.slice(i + 1)]
  }
  const [ac, ap] = split(a)
  const [bc, bp] = split(b)
  const pa = ac.split('.').map(Number), pb = bc.split('.').map(Number)
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return 0
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (ap === undefined) return bp === undefined ? 0 : 1   // 1.0.0 > 1.0.0-rc.9
  if (bp === undefined) return -1
  const ai = ap.split('.'), bi = bp.split('.')
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const x = ai[i], y = bi[i]
    if (x === undefined) return -1                        // 1.0.0-alpha < 1.0.0-alpha.1
    if (y === undefined) return 1
    const nx = Number(x), ny = Number(y)
    const xn = !Number.isNaN(nx), yn = !Number.isNaN(ny)
    if (xn && yn) { if (nx !== ny) return Math.sign(nx - ny) }
    else if (xn !== yn) return xn ? -1 : 1                // numeric < alphanumeric
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Slug collision healing: npm name is the stable identity — collided entries get
 *  re-slugged to their name, old slug preserved in aliases (I-1). */
export function dedupeSlugs(entries: PluginEntry[]): PluginEntry[] {
  const bySlug = new Map<string, PluginEntry[]>()
  for (const e of entries) bySlug.set(e.slug, [...(bySlug.get(e.slug) ?? []), e])
  const taken = new Set(bySlug.keys())
  return entries.map(e => {
    const group = bySlug.get(e.slug)!
    if (group.length === 1) return e
    // canonical survivor: entry whose slug already equals its name; else name-asc first
    const canonical = group.find(g => g.slug === g.name.toLowerCase())
      ?? [...group].sort((a, b) => a.name.localeCompare(b.name))[0]!
    if (e === canonical) return e
    let slug = e.name.toLowerCase()
    let i = 2
    while (taken.has(slug)) slug = `${e.name.toLowerCase()}--${i++}`
    taken.add(slug)
    return { ...e, slug, aliases: [...new Set([...e.aliases, e.slug])] }
  })
}

export function mergeEntries(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
  opencodeVersion: string,
  rulesetVersion?: string,
): PluginEntry[] {
  const oldByKey = new Map<string, PluginEntry>()
  const oldByName = new Map<string, PluginEntry>()
  if (old) for (const e of old.plugins) {
    oldByKey.set(cacheKey(e, opencodeVersion), e)
    if (!oldByName.has(e.name)) oldByName.set(e.name, e)
  }
  const merged = fresh.map(e => {
    const prev = oldByName.get(e.name)
    const prevVer = oldByKey.get(cacheKey(e, opencodeVersion))
    const sameRuleset = !rulesetVersion || prevVer?.capabilities.rulesetVersion === rulesetVersion
    const out: PluginEntry = { ...e }

    // identity layer (name-matched): preserve across version bumps
    if (prev) {
      out.firstSeenAt = prev.firstSeenAt
      out.slug = prev.slug
      out.aliases = [...new Set([...prev.aliases, ...e.aliases, ...(e.slug !== prev.slug ? [e.slug] : [])])]
      out.discoveredVia = [...new Set([...prev.discoveredVia, ...e.discoveredVia])] as PluginEntry['discoveredVia']
    }

    // approval/hold state layer (AI-DIAGNOSIS §4): e carries it for paths that
    // know it (run worker surgery, remerge's own computed entries); prev —
    // the post-verdict old index — fills it otherwise (github-kind rebuilds).
    out.approval = e.approval ?? prev?.approval ?? 'pending'
    out.approvalReason = e.approvalReason ?? prev?.approvalReason
    if (out.approval === 'pending') out.approvalReason ??= 'awaiting-review'
    if (e.pendingUpdate && prev && !prev.pendingUpdate && prev.latestVersion === e.pendingUpdate.version
        && prev.approval !== 'pending') {
      // remote already RELEASED our held version between our fetch and this
      // merge (a verdict/remerge landed first). Resurrecting the hold would
      // re-pend a released version — adopt the remote's released display
      // state instead (R-8). Runs before the pending gate below: ours may be
      // in the transitional pending+pu shape (a brake fired mid-run) while
      // remote legitimately released the same version.
      delete out.pendingUpdate
      out.latestVersion = prev.latestVersion
      out.publishedAt = prev.publishedAt
      out.capabilities = prev.capabilities
      out.verification = prev.verification
      out.features = prev.features
      // contains is version-scoped too — the remote released the HELD version
      // and promoted its parts; keeping our pinned display parts would route
      // installs for the released version by the old payload shape
      out.contains = prev.contains
      out.source = prev.source
      out.integrity = prev.integrity
      out.approval = prev.approval
      out.approvalReason = prev.approvalReason
    } else if (out.approval !== 'pending') {
      if (e.pendingUpdate) {
        out.pendingUpdate = e.pendingUpdate
        if (prev?.pendingUpdate?.version === e.pendingUpdate.version) {
          // same held version on both sides → keep the remote verification
          // slot (a verify-merge may have written into it after ours was
          // built); remote also fills byte-anchor/parts fields ours lacks
          // (a drift-rescan could have re-anchored it between runs)
          out.pendingUpdate = {
            ...e.pendingUpdate,
            verification: prev.pendingUpdate.verification,
            integrity: e.pendingUpdate.integrity ?? prev.pendingUpdate.integrity,
            contains: e.pendingUpdate.contains ?? prev.pendingUpdate.contains,
          }
        }
      } else if (prev?.pendingUpdate && prev.pendingUpdate.version !== out.latestVersion) {
        // remote holds a version we never saw → keep the hold (unless ours just
        // released that exact version — then the hold is resolved, don't resurrect)
        out.pendingUpdate = prev.pendingUpdate
      }
    } else if (out.pendingUpdate) {
      // a pendingUpdate only exists ON A DISPLAYED entry — for a pending
      // entry latestVersion IS the candidate, so a leftover hold is always
      // an older version that would shadow the real one on every review
      // surface (the pending+pu inverted state: a brake on the displayed
      // version left the hold behind, then upstream bumped past it and the
      // stale hold starved the new candidate permanently). Dropping it
      // demotes the version back to the normal pending path — its verdicts
      // still apply via the displayed slot, nothing is lost (R-9).
      delete out.pendingUpdate
    }

    // per-version layer (name@version+host-matched) — under hold semantics
    // e.latestVersion is the PINNED display version, so this restores the
    // displayed version's own scan/verify data (e.g. fresher verification
    // written by a verify-merge on the remote side of a rebase race).
    if (prevVer) {
      if (sameRuleset) out.capabilities = {
        // remote caps are authoritative for the slot — but findings/redFlags
        // the fresh entry computed THIS run (evidence-regression markers,
        // carried-forward extras) must union in: they're additive signals,
        // never a reason to drop either side
        ...prevVer.capabilities,
        findings: [...new Set([...prevVer.capabilities.findings, ...e.capabilities.findings])],
        redFlags: [...new Set([...prevVer.capabilities.redFlags, ...e.capabilities.redFlags])],
      }
      out.verification = prevVer.verification
    }

    // trust flags (SEC-2/3/3.5) — computed against the CANDIDATE version's
    // scan (pendingUpdate when held, else the entry itself), then split by
    // layer: identity-level flags attach to the DISPLAYED capabilities,
    // version-level sec-delta:* flags attach to the version under review
    // (pendingUpdate.capabilities) and ride along when it releases.
    const cand: PluginEntry = out.pendingUpdate
      ? { ...e, latestVersion: out.pendingUpdate.version, capabilities: out.pendingUpdate.capabilities,
          // cand describes the HELD version — its parts live on pendingUpdate
          // now that entry.contains is pinned to the displayed release
          contains: out.pendingUpdate.contains ?? e.contains }
      : e
    const tf = trustFlags(prev, cand)
    const isDelta = (f: string) => f.startsWith('sec-delta:')
    const idFindings = tf.findings.filter(f => !isDelta(f))
    const idRed = tf.redFlags.filter(f => !isDelta(f))
    const dFindings = tf.findings.filter(isDelta)
    const dRed = tf.redFlags.filter(isDelta)
    if (idFindings.length || idRed.length) {
      out.capabilities = {
        ...out.capabilities,
        findings: [...new Set([...out.capabilities.findings, ...idFindings])],
        redFlags: [...new Set([...out.capabilities.redFlags, ...idRed])],
      }
      if (out.capabilities.redFlags.length > 0 && out.verification.status === 'verified') {
        out.verification = { status: 'skipped', level: out.verification.level ?? 'install' }
      }
    }
    if (dFindings.length || dRed.length) {
      if (out.pendingUpdate) {
        out.pendingUpdate = {
          ...out.pendingUpdate,
          capabilities: {
            ...out.pendingUpdate.capabilities,
            findings: [...new Set([...out.pendingUpdate.capabilities.findings, ...dFindings])],
            redFlags: [...new Set([...out.pendingUpdate.capabilities.redFlags, ...dRed])],
          },
        }
      } else {
        // no hold in play — the entry itself IS the candidate
        out.capabilities = {
          ...out.capabilities,
          findings: [...new Set([...out.capabilities.findings, ...dFindings])],
          redFlags: [...new Set([...out.capabilities.redFlags, ...dRed])],
        }
      }
    }
    // honest-label invariant: a flagged version never gets run → 'skipped'
    // ("有高危信号没跑"), not 'unverified' ("还没验"). 'failed' results keep
    // their real outcome. Applies to both layers — trust flags can add
    // redFlags after scan time produced 'unverified'.
    // Evidence survives the downgrade: verifiedAt/runUrl/integrity stay so
    // the detail page keeps the audit trail of what WAS measured before the
    // flags appeared — and plan can re-enter a cleared slot honestly.
    const skipIfFlagged = (v: PluginEntry['verification'], flagged: boolean): PluginEntry['verification'] =>
      flagged && (v.status === 'verified' || v.status === 'unverified')
        ? { ...v, status: 'skipped', level: v.level ?? 'install' }
        : v
    out.verification = skipIfFlagged(out.verification, out.capabilities.redFlags.length > 0)
    if (out.pendingUpdate) {
      out.pendingUpdate = {
        ...out.pendingUpdate,
        verification: skipIfFlagged(out.pendingUpdate.verification, out.pendingUpdate.capabilities.redFlags.length > 0),
      }
    }
    return out
  })
  return dedupeSlugs(merged)
}

/** Corruption gate (dsh-market build-site.mjs pattern + >20% drop alarm, DEV §1). */
export function corruptionGate(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
): { ok: boolean; reason: string | null; dropPct: number } {
  if (fresh.length === 0) return { ok: false, reason: 'empty index — refusing to publish', dropPct: 100 }
  if (!old || old.plugins.length === 0) return { ok: true, reason: null, dropPct: 0 }
  const dropPct = (1 - fresh.length / old.plugins.length) * 100
  if (dropPct > 20) return { ok: false, reason: `entry count dropped ${dropPct.toFixed(1)}% — needs human confirmation`, dropPct }
  return { ok: true, reason: null, dropPct }
}

const REMOVED_RETENTION_MS = 180 * 24 * 3600 * 1000

export function buildIndex(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
  opts: {
    opencodeVersion: string
    now?: string
    rulesetVersion?: string
    /** tombstones computed by the caller (gone-check probes) */
    removed?: RemovedEntry[]
  },
): { index: CatalogIndex; gate: ReturnType<typeof corruptionGate> } {
  const now = opts.now ?? new Date().toISOString()
  const merged = mergeEntries(fresh, old, opts.opencodeVersion, opts.rulesetVersion)
  const gate = corruptionGate(merged, old)
  const aliveNames = new Set(merged.map(e => e.name))
  const cutoff = Date.parse(now) - REMOVED_RETENTION_MS
  const removed = [
    ...(old?.removed ?? []).filter(r =>
      !aliveNames.has(r.name) && (Number.isNaN(Date.parse(r.disappearedAt)) || Date.parse(r.disappearedAt) > cutoff)),
    ...(opts.removed ?? []),
  ]
  // categories registry (I-3): english ids are canonical — legacy zh labels
  // in old entries/dict keys normalize through catId() on every merge, so a
  // single scheduled run migrates the whole index without a repair pass.
  // Whitelist to CAT_NAMES: marketMeta/submission-declared categories are
  // author-controlled text — arbitrary strings must not mint global dict
  // entries or stick to entries (they fall back to classify at admission).
  for (const e of merged) e.category = (e.category ?? []).map(catId).filter(id => CAT_NAMES[id] !== undefined)
  const categories: CatalogIndex['categories'] = {}
  for (const [k] of Object.entries(old?.categories ?? {})) {
    const id = catId(k)
    if (CAT_NAMES[id]) categories[id] ??= CAT_NAMES[id]!
  }
  for (const e of merged) for (const id of e.category) {
    categories[id] ??= CAT_NAMES[id]!
  }
  const index = CatalogIndexSchema.parse({
    version: '1',
    generatedAt: now,
    categories,
    plugins: merged.sort((a, b) => a.slug.localeCompare(b.slug)),
    removed,
  })
  return { index, gate }
}
