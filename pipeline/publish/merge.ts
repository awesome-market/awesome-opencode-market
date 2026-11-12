/** Index merge: new entries layered over old index — unchanged packages keep prior
 *  scan/verify results (incremental cache carrier, DEV §1).
 *  Two cache layers (PIPELINE-ISSUES I-2):
 *    identity fields (firstSeenAt/aliases/discoveredVia/slug) — matched by npm name
 *    per-version fields (capabilities/verification) — matched by name@version+host+ruleset
 */
import type { CatalogIndex, PluginEntry, RemovedEntry } from '../../src/schema.ts'
import { CatalogIndex as CatalogIndexSchema } from '../../src/schema.ts'
import { CAT_NAMES, catId } from '../../src/categories.ts'
import { candidateVer } from '../verdicts.ts'

/** Host opencode version used for verification cache keys (name@version+host, DEV §4).
 *  Bump in lockstep with verify.yml's installed @opencode/cli version. */
export const OPENCODE_VERSION = '2.2.5'

export function cacheKey(e: Pick<PluginEntry, 'name' | 'latestVersion'>, opencodeVersion: string): string {
  return `${e.name}@${e.latestVersion ?? '?'}+${opencodeVersion}`
}

/** Byte-anchor agreement for the per-version restore in mergeEntries:
 *  github-kind pins `source.version` (the scanned commit) while npm pins the
 *  displayed tarball's SRI. cacheKey (name@version+host) cannot see a moved
 *  commit — github latestVersion is always null — so without this check a
 *  repo that advanced inherits the OLD commit's capabilities union and its
 *  'verified' badge forever: verify plan never re-queues a verified slot,
 *  so the moved bytes would never be measured at all. A missing anchor on
 *  either side can't disprove sameness → keep the legacy restore. */
const samePinnedBytes = (cur: PluginEntry, prev: PluginEntry): boolean => {
  if (cur.source?.kind === 'github' || prev.source?.kind === 'github')
    return (cur.source?.version ?? null) === (prev.source?.version ?? null)
  const a = cur.integrity ?? null
  const b = prev.integrity ?? null
  return a === null || b === null || a === b
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
  // dist-tags.latest rolled backwards — compare UPSTREAM markers on both
  // sides. For a held bump e.latestVersion is the pinned HOLD version, not
  // upstream latest, so the old hold-vs-hold comparison always read 0 and a
  // registry rollback under a pinned hold was invisible exactly where the
  // pin hides upstream from every other surface (fresh upstream latest is
  // only observable via distTags). Legacy entries without distTags fall
  // back to the held/displayed markers as before.
  const curUpstream = e.distTags?.latest ?? e.latestVersion
  // candidateVer, not raw pendingUpdate: on a pending entry a leftover hold
  // is the B3 inverted state — the stale hold's version is not "upstream"
  const prevUpstream = prev.distTags?.latest ?? candidateVer(prev) ?? prev.latestVersion
  if (versionCmp(curUpstream, prevUpstream) < 0) redFlags.push('sec:version-rollback')
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
 *  re-slugged to their name, old slug preserved in aliases (I-1).
 *  Loser slugs are assigned in GLOBAL name order, not encounter order: `entries`
 *  arrives in pool-completion order which varies run to run, and two losers can
 *  contest the same fallback (one's --N suffix is another's name-slug) — an
 *  unstable order would flap slugs (and therefore detail-page URLs) between
 *  publishes of identical data. */
export function dedupeSlugs(entries: PluginEntry[]): PluginEntry[] {
  const bySlug = new Map<string, PluginEntry[]>()
  for (const e of entries) bySlug.set(e.slug, [...(bySlug.get(e.slug) ?? []), e])
  const taken = new Set(bySlug.keys())
  const losers: PluginEntry[] = []
  for (const group of bySlug.values()) {
    if (group.length === 1) continue
    // canonical survivor: entry whose slug already equals its name; else name-asc first
    const canonical = group.find(g => g.slug === g.name.toLowerCase())
      ?? [...group].sort((a, b) => a.name.localeCompare(b.name))[0]!
    for (const g of group) if (g !== canonical) losers.push(g)
  }
  losers.sort((a, b) => a.name.localeCompare(b.name))
  const assigned = new Map<PluginEntry, string>()
  for (const e of losers) {
    let slug = e.name.toLowerCase()
    let i = 2
    while (taken.has(slug)) slug = `${e.name.toLowerCase()}--${i++}`
    taken.add(slug)
    assigned.set(e, slug)
  }
  return entries.map(e => {
    const slug = assigned.get(e)
    return slug ? { ...e, slug, aliases: [...new Set([...e.aliases, e.slug])] } : e
  })
}

/** Identity-level red flags (`sec:*`) — the standing-review signals, distinct
 *  from version-level `sec-delta:*` scan flags. Key used for flag-set diffing. */
const identKey = (caps: { redFlags: string[] } | undefined): string =>
  (caps?.redFlags ?? []).filter(f => f.startsWith('sec:')).sort().join(' ')

/** Stamp flaggedAt = "when the current identity-flag set was first observed on
 *  this slot": set changes (or a missing/legacy stamp) → now; identical set →
 *  keep the previous stamp; empty set → clear. A human verdict can only be said
 *  to have decided a flag if it postdates the flag's flaggedAt. */
const stampFlaggedAt = (
  caps: PluginEntry['capabilities'],
  prevCaps: PluginEntry['capabilities'] | undefined,
  now: string,
): PluginEntry['capabilities'] => {
  const ident = identKey(caps)
  const flaggedAt = ident === ''
    ? undefined
    : ident === identKey(prevCaps) && prevCaps?.flaggedAt ? prevCaps.flaggedAt : now
  return caps.flaggedAt === flaggedAt ? caps : { ...caps, flaggedAt }
}

export function mergeEntries(
  fresh: PluginEntry[],
  old: CatalogIndex | null,
  opencodeVersion: string,
  rulesetVersion?: string,
  now = new Date().toISOString(),
): PluginEntry[] {
  const oldByKey = new Map<string, PluginEntry>()
  const oldByName = new Map<string, PluginEntry>()
  if (old) for (const e of old.plugins) {
    oldByKey.set(cacheKey(e, opencodeVersion), e)
    // name keys are canonical lowercase everywhere else in the pipeline — an
    // exact-case lookup here would silently drop the whole identity layer
    // (approval, firstSeenAt, slug, verification) if a stored name's casing
    // ever drifted (legacy index data, a github rename changing canonical
    // case). Matching lowercase loses nothing: name collisions that differ
    // ONLY by case are already rejected at admission.
    const k = e.name.toLowerCase()
    if (!oldByName.has(k)) oldByName.set(k, e)
  }
  const merged = fresh.map(e => {
    const prev = oldByName.get(e.name.toLowerCase())
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
      // compat is version-scoped like contains/capabilities — the released
      // version must show ITS engines/peer constraints, not our stale
      // display's (every other version-scoped field is adopted above; this
      // one stayed stale for up to a metrics-refresh window)
      out.compat = prev.compat
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
          const pinA = e.pendingUpdate.integrity ?? prev.pendingUpdate.integrity ?? null
          const rv = prev.pendingUpdate.verification
          const measA = rv.integrity ?? null
          // the restored slot claims "these bytes were measured" — but a
          // re-tag since then means our pinned anchor describes DIFFERENT
          // bytes. Same rule as samePinnedBytes on the display slot: a
          // proven mismatch must not inherit the old measurement (the pin
          // path's puDrift only covers holds that stayed pinned; a hold
          // rebuilt via the full path re-anchors to current registry
          // bytes). Missing anchors can't disprove sameness → keep legacy.
          // Evidence fields stay for audit; verify plan re-queues the slot.
          const measuredElsewhere = pinA !== null && measA !== null && pinA !== measA
          out.pendingUpdate = {
            ...e.pendingUpdate,
            verification: measuredElsewhere ? { ...rv, status: 'unverified' } : rv,
            integrity: e.pendingUpdate.integrity ?? prev.pendingUpdate.integrity,
            contains: e.pendingUpdate.contains ?? prev.pendingUpdate.contains,
          }
        }
      } else if (prev?.pendingUpdate && prev.pendingUpdate.version !== out.latestVersion
          && !e.capabilities.findings.includes(`sec:evidence-regressed@${prev.pendingUpdate.version}`)) {
        // remote holds a version we never saw → keep the hold (unless ours just
        // released that exact version — then the hold is resolved, don't resurrect).
        // Exception: the worker deliberately UNBOUND a hold pinned to a version
        // whose plugin evidence regressed (spec §1 — "解绑交回 merge 重估") and
        // stamped sec:evidence-regressed@<version>; resurrecting it here would
        // re-pin evidence-less code on the release path, defeating the unbind.
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
    // samePinnedBytes guards the restore: a github-kind entry whose pinned
    // commit moved keeps the same cacheKey, and inheriting the old commit's
    // 'verified'/caps would certify bytes nobody scanned or ran.
    if (prevVer && samePinnedBytes(out, prevVer)) {
      if (sameRuleset) out.capabilities = {
        // remote caps are authoritative for the slot — but findings/redFlags
        // the fresh entry computed THIS run (evidence-regression markers,
        // carried-forward extras) must union in: they're additive signals,
        // never a reason to drop either side.
        // sec:*/sec-delta:* findings are the exception on the PREV side: every
        // one is re-derived each run (worker probes, trustFlags deltas, or the
        // rescan keepFindings carry on the fresh entry's own caps). Unioning
        // the stored copy would make a resolved signal — fixed repo name,
        // restored evidence, moved-on delta — immortal on the detail page.
        // Byte-stable scan findings (rule:file) still union normally.
        ...prevVer.capabilities,
        findings: [...new Set([
          ...prevVer.capabilities.findings.filter(f => !f.startsWith('sec:') && !f.startsWith('sec-delta:')),
          ...e.capabilities.findings])],
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
    // flag-set clock (R-14 follow-up): runs LAST so every flag writer upstream
    // (trustFlags, remote caps restore, drift/tombstone rescan) is covered. The
    // held slot compares against the remote's SAME held version — a different
    // held version is a new slot whose flags are observed now.
    out.capabilities = stampFlaggedAt(out.capabilities, prev?.capabilities, now)
    if (out.pendingUpdate) {
      const puPrev = prev?.pendingUpdate?.version === out.pendingUpdate.version
        ? prev?.pendingUpdate?.capabilities : undefined
      out.pendingUpdate = { ...out.pendingUpdate, capabilities: stampFlaggedAt(out.pendingUpdate.capabilities, puPrev, now) }
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
  const merged = mergeEntries(fresh, old, opts.opencodeVersion, opts.rulesetVersion, now)
  const gate = corruptionGate(merged, old)
  // lowercase: a live entry must retire its tombstone even if stored casing
  // drifted — otherwise a zombie tombstone survives next to the live entry and
  // its disappearedAt epoch keeps gating the live entry's pass verdicts.
  const aliveNames = new Set(merged.map(e => e.name.toLowerCase()))
  const cutoff = Date.parse(now) - REMOVED_RETENTION_MS
  const removed = [
    ...(old?.removed ?? []).filter(r =>
      !aliveNames.has(r.name.toLowerCase()) && (Number.isNaN(Date.parse(r.disappearedAt)) || Date.parse(r.disappearedAt) > cutoff)),
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
