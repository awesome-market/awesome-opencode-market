/** AI verdict consumption (AI-DIAGNOSIS §4/§10): load catalog-branch
 *  ai-verdicts.jsonl and apply mature verdicts to the OLD index at the start
 *  of a catalog run — BEFORE discovery comparison, so a high-frequency
 *  package's reviewed-but-unreleased version gets a deterministic release
 *  window instead of being starved by the next version bump. */
import { readFileSync } from 'node:fs'
import { AiVerdict, DigestState, type CatalogIndex } from '../src/schema.ts'

export function loadVerdicts(path?: string): AiVerdict[] {
  if (!path) return []
  try {
    let bad = 0
    const out = readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      .flatMap(l => {
        try { return [AiVerdict.parse(JSON.parse(l))] } catch { bad++; return [] }
      })
    // append-only audit log: a corrupt line (truncated write, merge artifact)
    // must not silently vanish — count it so ops can notice
    if (bad) console.warn(`[verdicts] dropped ${bad} malformed line(s) from ${path}`)
    return out
  } catch { return [] }
}

/** Full digest-state.json — null on missing/unreadable (fail-closed: every
 *  pass verdict stays frozen until the first digest exists). */
export function loadDigestState(path?: string): DigestState | null {
  if (!path) return null
  try {
    return DigestState.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch { return null }
}

export function loadLastDigestAt(path?: string): string | null {
  return loadDigestState(path)?.lastDigestAt ?? null
}

/** verdict lookup key — NUL separator (a '@' join collides with scoped names
 *  like @kyan-plugins/x@1.0 and silently broke diagnose's seen-check: every
 *  entry always looked unreviewed → re-reviewed every tick) */
export const vkey = (name: string, version: string | null | undefined) => `${name}\0${version ?? ''}`

/** announcement key — identifies a verdict LINE, not just the target: a new
 *  judgment on the same name@version must be announced again before it can
 *  mature. Stored in DigestState.announced. */
export const akey = (v: Pick<AiVerdict, 'name' | 'version' | 'at'>) => `${vkey(v.name, v.version)}\0${v.at}`

/** Test/tooling helper: build the DigestState a digest render would write for
 *  `verdicts` at anchor `lastDigestAt` (all of them announced). */
export function digestStateOf(lastDigestAt: string, verdicts: AiVerdict[]): DigestState {
  const keys = verdicts.map(akey)
  return { lastDigestAt, announced: keys, day: lastDigestAt.slice(0, 10), dayAnnounced: keys }
}

/** Newest verdict per name@version — the file is append-only, `at` wins. */
export function latestVerdicts(verdicts: AiVerdict[]): Map<string, AiVerdict> {
  const m = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    const k = vkey(v.name, v.version)
    const cur = m.get(k)
    if (!cur || v.at >= cur.at) m.set(k, v)
  }
  return m
}

/** Latest HUMAN verdict per key — the brake layer under latestVerdicts.
 *  Shared by applyMatureVerdicts (R-4 stickiness) and display surfaces
 *  (docket/digest) that need to show "a human brake stands" context. */
export function latestHumanVerdicts(verdicts: AiVerdict[]): Map<string, AiVerdict> {
  const m = new Map<string, AiVerdict>()
  for (const v of verdicts) {
    if (v.source !== 'human') continue
    const k = vkey(v.name, v.version)
    const cur = m.get(k)
    if (!cur || v.at >= cur.at) m.set(k, v)
  }
  return m
}

/** R-4: an ai 'pass' can never outrank a human 'concern' on the same key —
 *  only a newer HUMAN verdict lifts a human brake. An ai 'concern' may still
 *  override a human 'pass' (conservative direction stays open). */
export function effectiveVerdict(v: AiVerdict | undefined, human: Map<string, AiVerdict>): AiVerdict | undefined {
  const h = v ? human.get(vkey(v.name, v.version)) : undefined
  return v?.verdict === 'pass' && v.source === 'ai' && h?.verdict === 'concern' ? h : v
}

/** Release gate (AI-DIAGNOSIS §10): the target version's own verification must
 *  have run. 'verified' = install/load passed. 'skipped' = deliberately not
 *  run (red-flag short-circuit, or no-install-concept kinds like github entries)
 *  — an AI pass on a flagged entry is already intercepted below, so a skipped
 *  entry can only release via a human pass: an informed, audited decision.
 *  'unverified'/'failed' = never releasable — a verify outage freezes releases
 *  rather than letting anything through (fail-closed). */
const RELEASABLE = new Set(['verified', 'skipped'])

export interface VerdictApplyResult {
  index: CatalogIndex
  /** "name@version" promoted to display by this application */
  releases: string[]
  /** "name@version" concern-annotated (or braked back to pending) */
  held: string[]
}

/** Apply mature verdicts to an index. Semantics per AI-DIAGNOSIS §10:
 *  - `pass` matures only after appearing in the latest digest (at ≤ lastDigestAt)
 *  - `concern` applies immediately (conservative direction needs no window)
 *  - `source:ai` pass landing on a red-flagged entry is ignored (defense in
 *    depth — the model never reaches flagged content with a release);
 *    `source:human` pass is allowed (stamped by our writers, audited)
 *  - concern on the DISPLAYED version → approval back to pending (human brake;
 *    the AI only audits pending targets, so this can only be a human verdict)
 *  - human stickiness: `latest` ranks by `at` alone, so an ai 'pass' stamped
 *    after a human 'concern' (skewed writer clock, or just a later re-review)
 *    would otherwise outrank the brake and release over it. Only a newer
 *    HUMAN verdict lifts a human concern; an ai 'concern' may still override
 *    a human 'pass' — the conservative direction stays open. */
export function applyMatureVerdicts(
  index: CatalogIndex,
  verdicts: AiVerdict[],
  digest: DigestState | null,
): VerdictApplyResult {
  const latest = latestVerdicts(verdicts)
  const releases: string[] = []
  const held: string[] = []
  if (latest.size === 0) return { index, releases, held }
  const latestHuman = latestHumanVerdicts(verdicts)
  const effective = (v: AiVerdict | undefined): AiVerdict | undefined => effectiveVerdict(v, latestHuman)
  // Maturity = the verdict LINE was announced in a digest — membership, not a
  // timestamp comparison. A verdict pushed late with an old `at` can never
  // slip under the anchor; it must appear in a future digest first.
  const announced = new Set(digest?.announced ?? [])
  const mature = (v: AiVerdict) => announced.has(akey(v))
  const concernOf = (v: AiVerdict) => v.reason ?? 'concern'

  const plugins = index.plugins.map(entry => {
    let e = entry
    // 1. held-version slot — pendingUpdate releases only via its own keyed verdict
    if (e.pendingUpdate) {
      const pu = e.pendingUpdate
      const v = effective(latest.get(vkey(e.name, pu.version)))
      if (v?.verdict === 'concern') {
        const reason = concernOf(v)
        if (pu.reason !== reason) {
          e = { ...e, pendingUpdate: { ...pu, reason } }
          held.push(`${e.name}@${pu.version}`)
        }
      } else if (v && mature(v)
        && !(v.source === 'ai' && pu.capabilities.redFlags.length > 0)
        && RELEASABLE.has(pu.verification.status)) {
        e = {
          ...e,
          approval: 'approved',
          approvalReason: undefined,
          latestVersion: pu.version,
          publishedAt: pu.publishedAt ?? e.publishedAt,
          capabilities: pu.capabilities,
          verification: pu.verification,
          features: pu.features ?? e.features,
          source: { ...e.source, version: pu.version },
          pendingUpdate: undefined,
        }
        releases.push(`${e.name}@${pu.version}`)
      }
    }
    // 2. displayed-version slot — pending entries approve here; displayed
    //    entries get pulled back to pending by a human concern
    const v = effective(latest.get(vkey(e.name, e.latestVersion)))
    if (v) {
      if (e.approval === 'pending') {
        if (v.verdict === 'concern') {
          const reason = concernOf(v)
          if (e.approvalReason !== reason) {
            e = { ...e, approvalReason: reason }
            held.push(`${e.name}@${e.latestVersion ?? 'null'}`)
          }
        } else if (mature(v)
          && !(v.source === 'ai' && e.capabilities.redFlags.length > 0)
          && RELEASABLE.has(e.verification.status)) {
          e = { ...e, approval: 'approved', approvalReason: undefined }
          releases.push(`${e.name}@${e.latestVersion ?? 'null'}`)
        }
      } else if (v.verdict === 'concern') {
        e = { ...e, approval: 'pending', approvalReason: concernOf(v) }
        held.push(`${e.name}@${e.latestVersion ?? 'null'}`)
      }
    }
    return e
  })
  return { index: { ...index, plugins }, releases, held }
}
