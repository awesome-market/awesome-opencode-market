/** Daily pipeline orchestrator: discover → fetch → scan → assemble entries → merge+gate → index.json */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverNpm } from './discover/npm.ts'
import { discoverGithub, normalizeRepoUrl } from './discover/github.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence, hasRepoEvidence, hasSkillPath } from './discover/filter.ts'
import { fetchPackument, fetchTarball, fetchDownloads30d, compatStrings } from './fetch/npm.ts'
import { fetchRepoMeta, fetchMarketMeta, fetchRepoTree, fetchRepoPackage, fetchRepoPackageName, unsafeRepoDir, type RepoMetaStatus } from './fetch/github.ts'
import { scanTarball } from './scan/scan.ts'
import { RULESET_VERSION } from './scan/rules.ts'
import { buildIndex, OPENCODE_VERSION } from './publish/merge.ts'
import { loadVerdicts, loadDigestState, applyMatureVerdicts, latestVerdicts, latestHumanVerdicts, slotVerdict, vkey, tombEpochs, candidateSlot } from './verdicts.ts'
import { retryable } from './verify/plan.ts'
import { mapPool } from './pool.ts'
import { slugOf } from './publish/slug.ts'
import { CatalogIndex, type PluginEntry, type RemovedEntry, type AiVerdict } from '../src/schema.ts'
import { classify, catId, CAT_NAMES } from '../src/categories.ts'
import { detectFeatures } from '../src/features.ts'

export interface RunOptions {
  seedPath?: string | undefined
  oldIndexPath?: string | undefined
  blocklistPath?: string | undefined
  outPath?: string | undefined
  ghToken?: string | undefined
  maxEntries?: number | undefined
  now?: string | undefined
  fetchFn?: typeof fetch | undefined
  /** catalog-branch ai-verdicts.jsonl (AI-DIAGNOSIS §4) */
  verdictsPath?: string | undefined
  /** catalog-branch digest-state.json — pass verdict maturity anchor */
  digestStatePath?: string | undefined
  /** workflow_dispatch escape hatch: publish despite a red corruption gate
   *  (legitimate mass-deprecation/removal events otherwise dead-lock every run) */
  forceGate?: boolean | undefined
  /** optional output: {submissionKey: rejectionCode} for seed rows the
   *  admission path rejected this run — the publish job stamps them onto
   *  submissions.txt so the issue's status comment can explain WHY the
   *  package isn't queueing instead of leaving it 'queued' for 14 days */
  seedOutcomesPath?: string | undefined
}

export function loadOldIndex(path?: string): CatalogIndex | null {
  if (!path || !existsSync(path)) return null
  // a present-but-unreadable index must hard-fail: running blind would publish
  // a fresh index that re-pends every approval and wipes verification state
  // (same WF-1 posture the workflow enforces — defense in depth, C-4)
  return CatalogIndex.parse(JSON.parse(readFileSync(path, 'utf8')))
}

interface Blocklist { names: string[]; slugs: string[] }

function loadBlocklist(path?: string): Blocklist | null {
  if (!path || !existsSync(path)) return null
  try {
    const b = JSON.parse(readFileSync(path, 'utf8')) as { names?: unknown; slugs?: unknown }
    // normalize to lowercase AT LOAD — lookups lowercase their side too, so a
    // row written with display casing ('Owner/Repo') must still hit; leaving
    // the file's casing authoritative would make the list silently not-block
    return {
      names: Array.isArray(b.names) ? b.names.filter(x => typeof x === 'string').map(s => s.toLowerCase()) as string[] : [],
      slugs: Array.isArray(b.slugs) ? b.slugs.filter(x => typeof x === 'string').map(s => s.toLowerCase()) as string[] : [],
    }
  } catch (e) {
    // corrupt blocklist must not silently disable blocking (fail-open) — abort
    // the run rather than re-admitting blocked entries (C-4)
    throw new Error(`blocklist unreadable at ${path} — refusing to run without it: ${(e as Error).message}`)
  }
}

/** Best-effort replacement extraction from npm deprecate message ("use X instead"). */
export function replacementOf(msg: string | null): string | null {
  if (!msg) return null
  const m = msg.match(/(?:use|moved to|renamed to|install|migrate to)\s+[`'"]?(@[\w-]+\/[\w.-]+|[\w-]+)/i)
  return m?.[1] ?? null
}

/** Re-tag guard: `integrity` must describe the bytes REVIEWED, not whatever
 *  the registry serves now. Same version string + different SRI =
 *  unpublish/republish — the single most suspicious supply-chain signal, so
 *  freeze the reviewed anchor and flag the slot instead of silently
 *  re-certifying new bytes. `sec:integrity-drift` rides the normal
 *  sec:* → trustFlags/docket-flag surface; merge's skipIfFlagged keeps the
 *  affected slot honestly 'skipped' until a human decides.
 *  oldSha null → backfill (nothing to compare — anchors didn't exist yet);
 *  newSha null → keep the old anchor (a missing registry value proves nothing). */
export const DRIFT_FLAG = 'sec:integrity-drift'

/** Bounded interpolation for attacker-adjacent values inside `sec:*` finding
 *  strings — a packument's repository.url or a repo package.json `name` is
 *  author-controlled and unbounded; without the cap a 1MB field becomes a
 *  1MB finding carried in index.json, issue comments, and review surfaces. */
export const clip = (s: string, n = 120): string => (s.length > n ? s.slice(0, n) : s)

export function anchorIntegrity(
  capabilities: PluginEntry['capabilities'],
  oldSha: string | null | undefined,
  newSha: string | null | undefined,
): { integrity: string | null; capabilities: PluginEntry['capabilities'] } {
  if (newSha == null) return { integrity: oldSha ?? null, capabilities }
  if (oldSha == null || oldSha === newSha) return { integrity: newSha, capabilities }
  return { integrity: oldSha, capabilities: { ...capabilities, redFlags: [...new Set([...capabilities.redFlags, DRIFT_FLAG])] } }
}

const METRICS_STALE_MS = 7 * 24 * 3600 * 1000

export async function run(opts: RunOptions = {}) {
  const f = opts.fetchFn ?? fetch
  const now = opts.now ?? new Date().toISOString()
  // Order is load-bearing (AI-DIAGNOSIS §10): mature verdicts apply to the OLD
  // index BEFORE discovery comparison — a reviewed-but-unreleased version gets
  // its release window here, otherwise the next npm bump would overwrite the
  // pendingUpdate slot and high-frequency packages would starve forever.
  let old = loadOldIndex(opts.oldIndexPath)
  // verdict lookups are also used by the worker for R-1 pin decisions — hoisted.
  // The raw-latest map alone can't express "which verdict governs this key"
  // (R-4 human stickiness + package brake) — slotVerdict needs both layers
  const latestByKey = new Map<string, AiVerdict>()
  const latestHumanByKey = new Map<string, AiVerdict>()
  if (old) {
    const verdictBad = { bad: 0 }
    const verdicts = loadVerdicts(opts.verdictsPath, verdictBad)
    for (const [k, v] of latestVerdicts(verdicts)) latestByKey.set(k, v)
    for (const [k, v] of latestHumanVerdicts(verdicts)) latestHumanByKey.set(k, v)
    const digest = loadDigestState(opts.digestStatePath)
    if (verdicts.length || digest !== null || verdictBad.bad) {
      const applied = applyMatureVerdicts(old, verdicts, digest)
      old = applied.index
      console.log(`verdicts: ${verdicts.length} loaded${verdictBad.bad ? `, malformed=${verdictBad.bad}` : ''}, lastDigestAt=${digest?.lastDigestAt ?? '-inf'} announced=${digest?.announced.length ?? 0} → released [${applied.releases.join(', ')}], held ${applied.held.length}`)
    }
  }
  // name keys are canonical lowercase — a github entry stored as 'Owner/Repo'
  // must still match a 'owner/repo' candidate on a later run (GitHub's API is
  // case-insensitive, our maps must be too). npm names are already lowercase.
  const oldByName = new Map((old?.plugins ?? []).map(e => [e.name.toLowerCase(), e]))
  // latest tombstone per name — the re-entry identity check compares against
  // the most recent disappearance (a package can cycle in and out)
  const removedByName = new Map<string, RemovedEntry>()
  for (const r of old?.removed ?? []) {
    const key = r.name.toLowerCase()
    const cur = removedByName.get(key)
    if (!cur || r.disappearedAt > cur.disappearedAt) removedByName.set(key, r)
  }
  // epoch map for the shared verdict predicates (slotVerdict) — keeps the
  // worker's hold-pin checks on the same tombstone rules as the release gate
  // (named tombAt — `tomb` is already the worker's per-name RemovedEntry)
  const tombAt = tombEpochs(old?.removed)
  const blocklist = loadBlocklist(opts.blocklistPath)
  const isBlocked = (name: string, slug?: string) =>
    !!blocklist && (blocklist.names.includes(name) || (!!slug && blocklist.slugs.includes(slug)))
  // github fullName carries display case ('Owner/Repo') while slugs and
  // hand-written blocklist rows are lowercase — a case-variant name must not
  // slip past the list. npm names are registry-lowercase already.
  const isBlockedAnyCase = (name: string, slug?: string) =>
    isBlocked(name, slug) || isBlocked(name.toLowerCase(), slug)

  // 1. discover (+ optional seed file: one npm name or github:owner/repo per line)
  const [npmCands, ghCands] = await Promise.all([
    discoverNpm(undefined, { fetchFn: f }),
    discoverGithub(undefined, { token: opts.ghToken, fetchFn: f }),
  ])
  // seeds: submissions.txt lines — JSONL (issue-form submissions carry declared
  // metadata) or legacy plain names or github:owner/repo
  interface SeedMeta {
    type?: string; category?: string[]; desc?: Record<string, string>
    /** reviewed artifact identity: npm version or repo commit sha — repo seeds
     *  use it for moved-since-review drift detection */
    version?: string; pkg?: string; issue?: number; author?: string
    /** submission-declared repo (npm seeds) — refreshMeta re-derives
     *  sec:repo-declared-mismatch from it on the reuse path */
    repo?: string
  }
  const seedMeta = new Map<string, SeedMeta>()
  // repo-only submissions (name:null) keep declared metadata too — keyed by repo
  const seedRepoMeta = new Map<string, SeedMeta>()
  const seedNames = new Set<string>()
  // per-seed rejection reasons — the status comment contract promises "届时会
  // 在本 issue 说明原因"; this map is what makes that promise true
  const seedOutcomes = new Map<string, string>()
  if (opts.seedPath && !existsSync(opts.seedPath)) {
    // consistent with every other optional input (old index, blocklist):
    // warn and continue rather than hard-fail — a mistyped local path must
    // not nuke the run, and the workflow always touches the file anyway
    console.warn(`seed file not found: ${opts.seedPath} — continuing without submissions`)
  }
  if (opts.seedPath && existsSync(opts.seedPath)) {
    let seeded = 0
    const lines = readFileSync(opts.seedPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    for (const line of lines) {
      let name: string | null = null
      let repo: string | null = null
      if (line.startsWith('{')) {
        try {
          const s = JSON.parse(line) as { name?: string | null; repo?: string | null; type?: string; category?: unknown; desc?: Record<string, unknown>; version?: string; pkg?: string; issue?: number; author?: string; dead?: boolean; notified?: boolean }
          // dead = withdrawn/expired; notified = landed + submitter told — both
          // terminal. A notified row re-injected every run kept paying the full
          // repo probe + codeload + scan for a submission already resolved.
          if (s.dead || s.notified) continue
          name = typeof s.name === 'string' ? s.name.toLowerCase() : null
          // repo feeds RAW into api.github.com/raw.githubusercontent.com/codeload
          // URL paths AND the entry slug — it must be canonical owner/repo, the
          // same gate the npm-side repository field passes through. A malformed
          // value ('../repos/o/r') would path-normalize onto a DIFFERENT repo's
          // endpoints; a name+repo seed drops just the bad hint (the npm package
          // still resolves its own packument repo), a repo-only seed is dead.
          const repoNorm = typeof s.repo === 'string' ? normalizeRepoUrl(s.repo) : null
          if (s.repo != null && !repoNorm) {
            if (!name) seedOutcomes.set(String(s.repo).toLowerCase(), 'invalid-repo')
            // name+repo seed: the bad hint drops but the name still ingests —
            // say so, a silently-lost repo hint is invisible drift otherwise
            else console.warn(`seed '${name}': repo hint rejected (${String(s.repo).slice(0, 80)}) — name seed still ingested`)
          }
          repo = repoNorm?.toLowerCase() ?? null
          // seed metadata is attacker-adjacent (issue-form fields, editable) —
          // cap counts/lengths like fetchMarketMeta does (F-4)
          const desc: Record<string, string> = {}
          for (const [k, v] of Object.entries(s.desc ?? {})) if (typeof v === 'string' && v) desc[k] = v.slice(0, 4_000)
          const cats = Array.isArray(s.category)
            ? s.category.map(c => typeof c === 'string' ? c.slice(0, 80) : '').filter(Boolean).slice(0, 8)
            : []
          const meta: SeedMeta = {
            ...(s.type ? { type: s.type } : {}),
            ...(repo ? { repo } : {}),
            ...(cats.length ? { category: cats } : {}),
            ...(Object.keys(desc).length ? { desc } : {}),
            ...(s.version ? { version: s.version.slice(0, 80) } : {}),
            ...(s.pkg ? { pkg: s.pkg.slice(0, 214) } : {}),
            ...(s.issue ? { issue: s.issue } : {}),
            ...(s.author ? { author: s.author.slice(0, 100) } : {}),
          }
          if (name) seedMeta.set(name, meta)
          else if (repo) seedRepoMeta.set(repo, meta)
        } catch { continue }
      } else if (line.startsWith('github:')) {
        // legacy seed form — same canonicalization gate as JSONL repo fields
        const r = normalizeRepoUrl(line.slice(7))
        if (r) repo = r.toLowerCase()
        else console.warn(`seed: ignoring malformed github: line '${line.slice(0, 80)}'`)
      } else {
        name = line.toLowerCase()
      }
      if (name) seedNames.add(name)
      if (name && !npmCands.has(name)) {
        npmCands.set(name, {
          name, version: '', description: '', keywords: [], repoUrl: repo, publishedAt: null,
          discoveredVia: ['submission' as const],
        } as never)
        seeded++
      } else if (name) {
        // already discovered organically — still record the submission channel
        const ex = npmCands.get(name)!
        if (!ex.discoveredVia.includes('submission')) ex.discoveredVia.push('submission')
      } else if (!name && repo) {
        const ex = ghCands.get(repo)
        if (ex) {
          // topic search found it first — still record the submission channel
          // so seedRepoMeta hooks (desc/type/drift check) stay armed
          if (!ex.discoveredVia.includes('submission')) ex.discoveredVia.push('submission')
        } else {
          // repo-only submission (e.g. a skill with no npm package) → github-kind.
          // Identity fields are fabricated here — ghWorker backfills them via
          // fetchRepoMeta before the evidence gate (repoId/pushedAt/createdAt
          // are needed for repojacking, reuse, and tombstone checks)
          ghCands.set(repo, {
            fullName: repo, description: '', archived: false, fork: false, pushedAt: null,
            stars: 0, defaultBranch: 'HEAD', id: null, createdAt: null, license: null, topics: [],
            discoveredVia: ['submission' as const],
          })
          seeded++
        }
      }
    }
    console.log(`seed: ${seeded} entries injected`)
  }
  console.log(`discover: ${npmCands.size} npm + ${ghCands.size} github candidates`)

  // 2. cheap admission filters
  // npm candidates carry no archived/fork signals — preAdmit applies to GitHub side only
  const npmList = [...npmCands.values()]
  const rejectedGh = new Set<string>()
  const ghList = [...ghCands.values()].filter(c => {
    const ok = preAdmit({ name: c.fullName, repoUrl: c.fullName, archived: c.archived, fork: c.fork }).admit
    if (!ok) {
      rejectedGh.add(c.fullName.toLowerCase())
      if (c.discoveredVia.includes('submission')) seedOutcomes.set(c.fullName.toLowerCase(), 'archived-or-fork')
    }
    return ok
  })
  const byOwner = new Map<string, string[]>()
  for (const c of npmList) {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0]?.toLowerCase() ?? c.name.split('/')[0]!
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), c.name])
  }
  const spamOwners = new Set([...byOwner.entries()].filter(([, ns]) => looksLikeTemplateSpam(ns)).map(([o]) => o))
  const rejectedNpm = new Set<string>()
  const admitted = npmList.filter(c => {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0]?.toLowerCase() ?? c.name.split('/')[0]!
    if (spamOwners.has(owner)) {
      rejectedNpm.add(c.name)
      if (seedNames.has(c.name)) seedOutcomes.set(c.name, 'template-spam')
      return false
    }
    return true
  })
  // same template-spam heuristic on the gh side — a burst of near-identical
  // repo names under one owner is the same fingerprint with a different
  // surface (evidence gate still backs it up, cheap insurance)
  const byGhOwner = new Map<string, string[]>()
  for (const c of ghList) {
    const owner = c.fullName.split('/')[0]!.toLowerCase()
    byGhOwner.set(owner, [...(byGhOwner.get(owner) ?? []), c.fullName])
  }
  const ghSpamOwners = new Set([...byGhOwner.entries()].filter(([, ns]) => looksLikeTemplateSpam(ns)).map(([o]) => o))
  const ghAdmitted = ghList.filter(c => {
    const owner = c.fullName.split('/')[0]!.toLowerCase()
    if (ghSpamOwners.has(owner)) {
      rejectedGh.add(c.fullName.toLowerCase())
      if (c.discoveredVia.includes('submission')) seedOutcomes.set(c.fullName.toLowerCase(), 'template-spam')
      return false
    }
    return true
  })
  console.log(`admitted: ${admitted.length} npm + ${ghAdmitted.length} github (spam owners: ${[...spamOwners, ...ghSpamOwners].join(', ') || 'none'})`)

  // deterministic admission order: name asc — the slice cap must not flap (PIPELINE-ISSUES §F-1).
  // The cap bounds NEW-discovery work, not catalog size: entries already in the
  // index bypass it like seeds do — they mostly hit the no-fetch reuse path, so
  // processing them is cheap, and tombstoning live entries for alphabetical
  // position silently evicts the catalog tail once discovery outgrows --max (C-1).
  const limit = opts.maxEntries ?? 500
  const sorted = [...admitted].sort((a, b) => a.name.localeCompare(b.name))
  const existing = sorted.filter(c => oldByName.has(c.name.toLowerCase()))
  const newbies = sorted.filter(c => !oldByName.has(c.name.toLowerCase()))
  // the cap bounds NEW-discovery work per run, not catalog size — existing
  // entries don't consume the budget (DATA-FLOWS §1: 已在 index 里的条目 +
  // 投稿 seed 全部豁免). Otherwise a large catalog would starve new
  // discovery to zero without any signal.
  const queue = [...existing, ...newbies.slice(0, limit)]
  // submissions bypass the cap — a human-reviewed seed must not starve behind
  // alphabetical truncation (E2E rehearsal: 'oc-market-…' sorts past the cap)
  const queued = new Set(queue.map(c => c.name))
  for (const c of sorted) if (seedNames.has(c.name) && !queued.has(c.name)) queue.push(c)
  // seeds front-run the queue — a human asked for them; under a worker time
  // budget the tail position could starve a submission for runs. sort is
  // stable, so each tier keeps its deterministic name-asc order.
  queue.sort((a, b) => Number(seedNames.has(b.name)) - Number(seedNames.has(a.name)))
  const cappedOut = new Set(newbies.slice(limit).map(c => c.name).filter(n => !seedNames.has(n)))

  // github side gets the same deterministic cap — a topic-search burst must not
  // silently grow the index past maxEntries. Submissions and existing entries bypass.
  const isSeedRepo = (c: (typeof ghAdmitted)[number]) => c.discoveredVia.includes('submission')
  const ghSorted = [...ghAdmitted].sort((a, b) => a.fullName.localeCompare(b.fullName))
  const ghExisting = ghSorted.filter(c => oldByName.has(c.fullName.toLowerCase()))
  const ghNew = ghSorted.filter(c => !oldByName.has(c.fullName.toLowerCase()))
  const ghQueue = [...ghExisting, ...ghNew.slice(0, limit)]
  const ghQueued = new Set(ghQueue.map(c => c.fullName))
  for (const c of ghSorted) if (isSeedRepo(c) && !ghQueued.has(c.fullName)) ghQueue.push(c)
  ghQueue.sort((a, b) => Number(isSeedRepo(b)) - Number(isSeedRepo(a)))
  for (const c of ghNew.slice(limit)) if (!isSeedRepo(c)) cappedOut.add(c.fullName.toLowerCase())

  // 3. fetch + evidence gate + scan — concurrent batches of 10.
  //    Incremental short-circuit (S-2): name@version unchanged in old index → reuse
  //    the whole entry; only metrics get a rolling refresh (>7d stale).
  const entries: PluginEntry[] = []
  const reusedNames = new Set<string>()
  let rateLimitedCalls = 0

  const addFinding = (caps: PluginEntry['capabilities'], f: string): PluginEntry['capabilities'] =>
    caps.findings.includes(f) ? caps : { ...caps, findings: [...caps.findings, f] }

  /** Findings that are NOT tarball-scan output — identity/observation signals
   *  other layers wrote (sec:repo-*, sec:evidence-regressed, tree-truncated)
   *  or merge-derived deltas (sec-delta:*). A ruleset rescan rebuilds
   *  capabilities from scan output alone; without unioning these back, a
   *  gone-check-kept entry silently loses signals nothing re-derives for it
   *  (and flaggedAt resets, so the docket re-asks decided questions). */
  const keepFindings = (caps: PluginEntry['capabilities']): string[] =>
    caps.findings.filter(f => f.startsWith('sec:') || f.startsWith('sec-delta:'))

  // bounded worker pool (was 10-at-a-time batches): a slow candidate stalled
  // a whole batch's barrier — the pool lets the next candidate start as soon
  // as any worker frees, same concurrency without the tail latency
  const POOL = 10
  const pool = <T>(items: T[], fn: (x: T) => Promise<void>) => mapPool(items, POOL, fn)

  const refreshMeta = async (e: PluginEntry): Promise<PluginEntry> => {
    // the npm version is pinned — but the REPO keeps moving underneath it:
    // .opencode-market.json (author-declared desc/category) and the repo's
    // own package.json name drift between version bumps, so the reuse path
    // refreshes them too, same as the pin path (O-8's twin). Both probes hit
    // raw.githubusercontent (CDN, no API quota).
    const pkResP = fetchPackument(e.name, { fetchFn: f })
    // the packument's repository field is authoritative — resolve the repo
    // anchor from the FRESH packument, falling back to the stored source.repo
    // only when the field is absent or unusable. A repointed repository field
    // would otherwise stay invisible on the reuse path: repoMeta/marketMeta/
    // repoPkg would keep probing the stale repo forever and repoId could never
    // drift onto a different repo, so sec:repo-recreated could never fire.
    const repoP = pkResP.then(({ pk }) =>
      normalizeRepoUrl(pk?.repository ?? null) ?? e.source.repo ?? null)
    const [pkRes, repoMetaRes, downloads, marketMeta, repoPkg] = await Promise.all([
      pkResP,
      repoP.then(r => r ? fetchRepoMeta(r, { token: opts.ghToken, fetchFn: f }) : null),
      fetchDownloads30d(e.name, { fetchFn: f }),
      repoP.then(r => r ? fetchMarketMeta(r, { token: opts.ghToken, fetchFn: f }) : null),
      repoP.then(repo => pkResP.then(({ pk }) => repo && pk?.repositoryDir
        ? fetchRepoPackageName(repo, { dir: pk.repositoryDir, fetchFn: f })
        : repo ? fetchRepoPackageName(repo, { fetchFn: f }) : null)),
    ])
    const { pk } = pkRes
    const repo = await repoP
    if (repoMetaRes?.status === 'rate-limited') rateLimitedCalls++
    // a refresh where EVERY probe failed refreshed nothing — stamping `now`
    // into checkedAt anyway froze dead metrics for another week and lied to
    // the catalog about when the entry was last seen healthy. Bail unchanged
    // so the next run retries (a missing .opencode-market.json returns null
    // too — treating that as failure errs on the cheap side: one extra probe)
    if (pk === null && repoMetaRes?.meta == null && downloads === null
        && marketMeta === null && repoPkg?.status !== 'ok') return e
    // SRI pins the DISPLAYED version's tarball (R-1) — but it must describe
    // the bytes REVIEWED: a same-version registry re-tag freezes the old
    // anchor + flags the slot rather than silently re-certifying new bytes.
    // The held slot gets the same check via pu.integrity.
    const disp = pk && e.latestVersion
      ? anchorIntegrity(e.capabilities, e.integrity, pk.integrityOf[e.latestVersion] ?? null)
      : { integrity: e.integrity ?? null, capabilities: e.capabilities }
    const eSlot = candidateSlot(e)
    const held = pk && eSlot
      ? anchorIntegrity(eSlot.capabilities, eSlot.integrity ?? null,
          pk.integrityOf[eSlot.version] ?? null)
      : null
    // identity findings re-derive with the fresh packument — a repo
    // package.json rename or repository-url drift must not freeze until the
    // next version bump. Only when the probes answered: a failed fetch keeps
    // the prior findings (absence of evidence isn't a verdict either way)
    let caps = disp.capabilities
    if (pk && repo) {
      caps = { ...caps, findings: caps.findings.filter(x =>
        !x.startsWith('sec:repo-mismatch') && x !== 'sec:repo-dir-traversal' && !x.startsWith('sec:repo-declared-mismatch')) }
      const dir = pk.repositoryDir ?? undefined
      if (unsafeRepoDir(dir)) {
        caps = addFinding(caps, 'sec:repo-dir-traversal')
      } else if (repoPkg?.status === 'ok' && repoPkg.pkgName
          && repoPkg.pkgName !== e.name && repoPkg.pkgName !== e.name.split('/').pop()) {
        caps = addFinding(caps, `sec:repo-mismatch:${clip(repoPkg.pkgName)}`)
      }
      const declaredRepo = seedMeta.get(e.name)?.repo ?? null
      if (declaredRepo && declaredRepo.toLowerCase() !== repo.toLowerCase())
        caps = addFinding(caps, `sec:repo-declared-mismatch:${clip(declaredRepo)}`)
    }
    const sub = seedMeta.get(e.name)
    const claimedCats = (marketMeta?.category ?? sub?.category ?? [])
      .map(catId).filter(cc => CAT_NAMES[cc] !== undefined)
    return {
      ...e,
      ...(pk ? {
        deprecated: pk.deprecated,
        deprecatedMessage: pk.deprecatedMessage,
        replacement: pk.deprecated ? replacementOf(pk.deprecatedMessage) : e.replacement,
        createdAt: pk.createdAt ?? e.createdAt,
        modifiedAt: pk.modifiedAt ?? e.modifiedAt,
        maintainers: pk.maintainers.length ? pk.maintainers : e.maintainers,
        distTags: Object.keys(pk.distTags).length ? pk.distTags : e.distTags,
      } : {}),
      // author-declared fields precedence, same as build/pin paths:
      // repo .opencode-market.json > issue submission > prior auto-derived
      description: {
        en: marketMeta?.description?.en ?? sub?.desc?.en ?? e.description.en,
        ...(marketMeta?.description?.zh || sub?.desc?.zh
          ? { zh: marketMeta?.description?.zh ?? sub?.desc?.zh }
          : e.description.zh ? { zh: e.description.zh } : {}),
      },
      category: claimedCats.length ? claimedCats : e.category,
      license: pk?.license ?? repoMetaRes?.meta?.license ?? e.license,
      metrics: {
        stars: repoMetaRes?.meta?.stars ?? e.metrics.stars,
        npmDownloads30d: downloads ?? e.metrics.npmDownloads30d,
        checkedAt: now,
      },
      // backfill SRI for entries that predate the integrity field — the field
      // pins the DISPLAYED version's tarball (R-1)
      integrity: disp.integrity,
      capabilities: caps,
      ...(held ? { pendingUpdate: { ...eSlot!, capabilities: held.capabilities, integrity: held.integrity } } : {}),
      // refresh repoId so repojacking detection works on reused entries too —
      // and write the packument-resolved repo back so a repoint actually lands
      // (repoId then describes the NEW repo's identity; if its id differs from
      // the stored one, merge's trustFlags emit sec:repo-recreated). Keeping
      // the old repoId when the new repo's meta hasn't answered yet preserves
      // the "different identity observed" signal for the next run.
      source: {
        ...e.source,
        ...(repo ? { repo } : {}),
        ...(repoMetaRes?.meta?.id ? { repoId: repoMetaRes.meta.id } : {}),
      },
      // compat follows the DISPLAYED version — packument carries every
      // version's engines/peerDependencies, so refreshing is free
      compat: pk?.compatOf[e.latestVersion ?? ''] ?? e.compat,
    }
  }

  const worker = async (cand: (typeof admitted)[number]) => {
    try {
      const prev = oldByName.get(cand.name.toLowerCase())
      // seed candidates carry no version — without one the incremental
      // short-circuit can never hit, so a submission row would refetch the
      // full packument + tarball every run for its ~90d seed life. One
      // abbreviated packument call buys dist-tags.latest cheaply; a match
      // then reuses the entry like any rediscovered candidate.
      let candVersion = cand.version
      if (!candVersion && prev) {
        const { pk: abbr } = await fetchPackument(cand.name, { fetchFn: f, abbreviated: true })
        candVersion = abbr?.latest ?? ''
      }
      // incremental short-circuit: same version + same ruleset → reuse wholesale.
      // Under hold-by-default the candidate to compare is the HELD version —
      // a held bump already carries that version's scan in pendingUpdate.
      // The ruleset check must read the capabilities of the slot the candidate
      // version ACTUALLY occupies: a scan-failed pendingUpdate carries no
      // rulesetVersion, and the old `?? prev.capabilities` fallback borrowed
      // the displayed slot's ruleset — failed held scans froze forever.
      // candidateSlot, not raw pendingUpdate: on a pending entry a leftover
      // hold is the B3 inverted state — its version/caps describe bytes
      // nobody reviews, so matching it here would short-circuit reuse of an
      // entry whose REAL candidate (latestVersion) was never re-evaluated
      const prevSlot = prev ? candidateSlot(prev) : null
      const prevCandVer = prevSlot?.version ?? prev?.latestVersion
      const slotCaps = prev && candVersion && prevCandVer === candVersion
        ? prevSlot?.capabilities ?? prev.capabilities
        : null
      if (prev && candVersion && candVersion === prevCandVer
          && slotCaps?.rulesetVersion === RULESET_VERSION
          && !isBlocked(cand.name, prev.slug)) {
        const stale = Date.parse(now) - Date.parse(prev.metrics.checkedAt) > METRICS_STALE_MS
        // entries that predate the integrity field need one packument fetch to
        // backfill the SRI — otherwise they'd stay sha-less until the next bump.
        // Same for held slots whose hold predates pendingUpdate.integrity.
        const needsIntegrity = (!prev.integrity && !!prev.latestVersion)
          || (prevSlot !== null && !prevSlot.integrity)
        entries.push(stale || needsIntegrity ? await refreshMeta(prev) : prev)
        reusedNames.add(cand.name)
        return
      }

      const { pk, status: pkStatus } = await fetchPackument(cand.name, { fetchFn: f })
      if (!pk) {
        // transient failure ≠ disappearance — keep the old entry rather than
        // letting the candidate vanish into gone-check (which would double-fetch)
        if (pkStatus === 'error' && prev && !isBlocked(prev.name, prev.slug)) {
          entries.push(prev)
          reusedNames.add(prev.name)
        } else if (seedNames.has(cand.name)) {
          // a submitted package that 404s is dead on arrival — the issue gets
          // no notify-published comment, so at least make it visible (R-5)
          console.warn(`submission ${cand.name}: packument ${pkStatus} — submission not admitted`)
          seedOutcomes.set(cand.name, pkStatus === 'error' ? 'fetch-error' : 'pkg-not-found')
        }
        return
      }
      const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports, readme: pk.readme ?? undefined })
      // the gate reads LATEST-version metadata — a regression (author drops
      // the opencode keyword, renames main) must not tombstone an existing
      // entry's still-valid approved slot. Keep the entry, surface the
      // regression as a finding, and drop a hold pinned to the regressed
      // version so merge re-evaluates instead of releasing evidence-less code.
      if (!ev.ok) {
        // only an APPROVED slot is worth protecting — a still-pending entry
        // that loses its evidence tombstones normally (nothing displayed)
        if (prev && prev.approval !== 'pending' && !isBlocked(prev.name, prev.slug)) {
          const base = prev.pendingUpdate?.version === pk.latest
            ? (() => { const { pendingUpdate: _pu, ...r } = prev; return r })()
            : prev
          entries.push({ ...base, capabilities: addFinding(base.capabilities, `sec:evidence-regressed@${pk.latest}`) })
          reusedNames.add(cand.name)
        } else {
          rejectedNpm.add(cand.name)
          if (seedNames.has(cand.name)) seedOutcomes.set(cand.name, 'no-plugin-evidence')
        }
        return
      }

      // packument.repository is authoritative; the submission-declared repo is
      // the fallback — and a disagreement between them is itself a signal.
      // The DECLARED value lives in seedMeta — reading cand.repoUrl here was
      // wrong for organically-discovered candidates that also carry a
      // submission: repoUrl there is the search hit's links.repository (the
      // same packument-derived field), so the check either no-oped or flagged
      // stale search index drift while the actual submitted repo hint was
      // never compared (refreshMeta's reuse path already reads seedMeta).
      const declaredRepo = seedMeta.get(cand.name)?.repo ?? null
      const repo = normalizeRepoUrl(pk.repository) ?? declaredRepo
      const slug = slugOf({ repo: repo ?? undefined, npmName: cand.name })
      if (isBlocked(cand.name, slug)) {
        if (seedNames.has(cand.name)) seedOutcomes.set(cand.name, 'blocklisted')
        return
      }

      // R-1 pin-until-terminal: a live hold keeps its version across upstream
      // bumps — verification, in-flight review state and heldAt are all keyed
      // to that version, so retargeting on every npm bump would starve
      // fast-publishing packages forever (each retarget wiped verify results,
      // reset the 48h review defer, and orphaned the keyed verdict). The hold
      // re-targets only when terminal (concern verdict on the held version,
      // or failed verification with retries exhausted) or when a HUMAN
      // verdict already exists for the newer upstream version. Pinned entries
      // refresh registry-level metadata only — the tarball fetch/scan and
      // repo-evidence probes for the non-held version are skipped entirely
      // (a ruleset upgrade still re-scans the HELD tarball in place — a
      // release must not be judged by retired rules); distTags.latest still
      // records the true upstream version.
      const heldPrev = prev && prev.approval !== 'pending' && pk.latest !== prev.latestVersion && prev.pendingUpdate
        ? prev : null
      if (heldPrev) {
        const heldPin = heldPrev.pendingUpdate!
        // "the held version is decided" must evaluate through the SAME lens
        // applyMatureVerdicts uses: raw latestByKey ranks by `at` alone, so an
        // ai pass stamped after a human concern (drift re-review, --force,
        // clock skew) would read "not terminal" and pin the hold forever
        // while the release gate still treats the slot as braked (R-4). The
        // tomb map keeps the pin check on the same epoch rules as the gate —
        // a pre-tombstone pass must not dissolve a live brake here either.
        const terminal = slotVerdict(latestByKey, latestHumanByKey, cand.name, heldPin.version, tombAt)?.verdict === 'concern'
          || (heldPin.verification.status === 'failed' && !retryable(heldPin.verification))
        const humanOnLatest = pk.latest !== null
          && slotVerdict(latestByKey, latestHumanByKey, cand.name, pk.latest, tombAt)?.source === 'human'
        if (!terminal && !humanOnLatest) {
          // the pin path used to skip every repo/metadata probe — a held
          // entry's description/category/license froze for as long as the
          // hold lasted (upstream bumps re-pin indefinitely). Same refresh
          // the fresh-entry path gets: repoMeta + marketMeta + downloads +
          // the npm↔repo package-name correspondence check (dir-traversal
          // guard included — repository.directory is attacker-controlled)
          const dir = pk.repositoryDir ?? undefined
          const dirTraversal = unsafeRepoDir(dir)
          const [repoMetaRes, downloads, marketMeta, repoPkg] = await Promise.all([
            repo ? fetchRepoMeta(repo, { token: opts.ghToken, fetchFn: f }) : Promise.resolve(null),
            fetchDownloads30d(cand.name, { fetchFn: f }),
            repo ? fetchMarketMeta(repo, { token: opts.ghToken, fetchFn: f }) : Promise.resolve(null),
            repo && !dirTraversal
              ? fetchRepoPackageName(repo, { dir, fetchFn: f })
              : Promise.resolve({ pkgName: null, status: 'not-found' as RepoMetaStatus }),
          ])
          if (repoMetaRes?.status === 'rate-limited') rateLimitedCalls++
          // ruleset staleness OR a byte-swap on a pinned hold: the held
          // version never re-enters the full scan path, so a ruleset upgrade
          // would leave it permanently judged by retired rules and a same-
          // version re-tag (unpublish+republish) would carry the OLD scan and
          // verdicts onto NEW bytes. Re-scan the HELD tarball in place; a
          // confirmed integrity drift also flags the slot (redFlag → the
          // release gate holds until a human decides) and re-anchors to the
          // bytes actually scanned. verification/heldAt/verdict annotations
          // stay keyed to the version; merge's skipIfFlagged downgrades the
          // held slot's verification honestly.
          let puCaps = heldPin.capabilities
          let puIntegrity = heldPin.integrity ?? null
          const regSha = pk.integrityOf[heldPin.version] ?? null
          const puDrift = puIntegrity !== null && regSha !== null && puIntegrity !== regSha
          if (puCaps.rulesetVersion !== RULESET_VERSION || puDrift) {
            const url = pk.tarballOf[heldPin.version]
            if (url) {
              try {
                const r = await scanTarball(await fetchTarball(url, { fetchFn: f }))
                puCaps = {
                  scannedAt: now,
                  rulesetVersion: RULESET_VERSION,
                  findings: [...new Set([...r.findings.map(x => `${x.rule}:${x.file}`), ...keepFindings(heldPin.capabilities)])],
                  // a confirmed re-tag stays flagged even after the fresh
                  // scan — "bytes changed under a stable version" is the
                  // signal a reviewer must see
                  redFlags: [...new Set([...r.redFlags.map(x => `${x.rule}:${x.file}`), ...(puDrift ? [DRIFT_FLAG] : [])])],
                }
                puIntegrity = regSha ?? puIntegrity  // anchor the bytes just scanned
              } catch (e) {
                console.warn(`hold re-scan failed ${cand.name}@${heldPin.version}:`, (e as Error).message)
                // rescan unavailable ≠ drift excused: flag on the stale caps
                if (puDrift) puCaps = { ...puCaps, redFlags: [...new Set([...puCaps.redFlags, DRIFT_FLAG])] }
              }
            } else if (puDrift) {
              puCaps = { ...puCaps, redFlags: [...new Set([...puCaps.redFlags, DRIFT_FLAG])] }
            }
          }
          // legacy holds predate pu.integrity — backfill the current anchor so
          // drift detection engages going forward
          puIntegrity = puIntegrity ?? regSha
          // the DISPLAYED version can re-tag too — same freeze+flag rule as
          // refreshMeta; its anchor only ever describes the reviewed bytes
          const dispA = heldPrev.latestVersion
            ? anchorIntegrity(heldPrev.capabilities, heldPrev.integrity, pk.integrityOf[heldPrev.latestVersion] ?? null)
            : { integrity: heldPrev.integrity ?? null, capabilities: heldPrev.capabilities }
          // repo-evidence findings ride the displayed slot's caps — same
          // checks the fresh-entry path runs (identity-level, not scan-level)
          let dispCaps = dispA.capabilities
          if (dirTraversal) dispCaps = addFinding(dispCaps, 'sec:repo-dir-traversal')
          else if (repoPkg.status === 'ok' && repoPkg.pkgName && repoPkg.pkgName !== cand.name && repoPkg.pkgName !== cand.name.split('/').pop()) {
            dispCaps = addFinding(dispCaps, `sec:repo-mismatch:${clip(repoPkg.pkgName)}`)
          }
          if (declaredRepo && repo && declaredRepo.toLowerCase() !== repo.toLowerCase()) {
            dispCaps = addFinding(dispCaps, `sec:repo-declared-mismatch:${clip(declaredRepo)}`)
          }
          const puChanged = puCaps !== heldPin.capabilities || puIntegrity !== (heldPin.integrity ?? null)
          // long-held entries still refresh author-declared metadata — a
          // pinned display must not keep describing what the repo looked
          // like at hold time (submission-declared values keep precedence
          // over nothing, marketMeta wins over both)
          const sub = seedMeta.get(cand.name)
          const heldCats = (marketMeta?.category ?? sub?.category ?? [])
            .map(catId).filter(cc => CAT_NAMES[cc] !== undefined)
          entries.push({
            ...heldPrev,
            ...(puChanged
              ? { pendingUpdate: { ...heldPin, capabilities: puCaps, integrity: puIntegrity } }
              : {}),
            capabilities: dispCaps,
            description: {
              en: marketMeta?.description?.en ?? sub?.desc?.en ?? heldPrev.description.en,
              ...(marketMeta?.description?.zh || sub?.desc?.zh
                ? { zh: marketMeta?.description?.zh ?? sub?.desc?.zh }
                : heldPrev.description.zh ? { zh: heldPrev.description.zh } : {}),
            },
            category: heldCats.length ? heldCats : heldPrev.category,
            license: pk.license ?? repoMetaRes?.meta?.license ?? heldPrev.license,
            distTags: Object.keys(pk.distTags).length ? pk.distTags : heldPrev.distTags,
            modifiedAt: pk.modifiedAt ?? heldPrev.modifiedAt,
            maintainers: pk.maintainers.length ? pk.maintainers : heldPrev.maintainers,
            deprecated: pk.deprecated,
            deprecatedMessage: pk.deprecatedMessage,
            replacement: pk.deprecated ? replacementOf(pk.deprecatedMessage) : heldPrev.replacement,
            source: { ...heldPrev.source, ...(repo ? { repo } : {}), ...(repoMetaRes?.meta?.id ? { repoId: repoMetaRes.meta.id } : {}) },
            integrity: dispA.integrity,
            compat: pk.compatOf[heldPrev.latestVersion ?? ''] ?? heldPrev.compat,
            metrics: { stars: repoMetaRes?.meta?.stars ?? heldPrev.metrics.stars, npmDownloads30d: downloads ?? heldPrev.metrics.npmDownloads30d, checkedAt: now },
          })
          reusedNames.add(cand.name)
          console.log(`  [${entries.length}] ${cand.name} (hold pinned at v${heldPin.version}; upstream ${pk.latest})`)
          return
        }
      }

      let scan = { scannedAt: null as string | null, rulesetVersion: undefined as string | undefined, findings: [] as string[], redFlags: [] as string[] }
      let scanFiles: string[] = []
      if (pk.tarballUrl) {
        try {
          const tgz = await fetchTarball(pk.tarballUrl, { fetchFn: f })
          const r = await scanTarball(tgz)
          scanFiles = r.files
          scan = {
            scannedAt: now,
            rulesetVersion: RULESET_VERSION,
            findings: r.findings.map(x => `${x.rule}:${x.file}`),
            redFlags: r.redFlags.map(x => `${x.rule}:${x.file}`),
          }
        } catch (e) {
          const msg = (e as Error).message
          console.warn(`scan failed ${cand.name}:`, msg)
          // oversize tarballs fail deterministically — stamp the ruleset so
          // the incremental short-circuit skips the doomed refetch every run
          // (retries resume on any version bump, which carries no stamp)
          if (/too large/.test(msg)) scan.rulesetVersion = RULESET_VERSION
        }
      }

      // independent metadata probes run concurrently — repoMeta/downloads/
      // marketMeta don't depend on each other and the serial awaits were pure
      // queue latency (the dead fetchRepoTree call that used to sit here only
      // fed a truncated-warning; skill detection uses tarball scanFiles)
      const [repoMetaRes, downloads, marketMeta] = await Promise.all([
        repo ? fetchRepoMeta(repo, { token: opts.ghToken, fetchFn: f }) : Promise.resolve(null),
        fetchDownloads30d(cand.name, { fetchFn: f }),
        repo ? fetchMarketMeta(repo, { token: opts.ghToken, fetchFn: f }) : Promise.resolve(null),
      ])
      if (repoMetaRes?.status === 'rate-limited') rateLimitedCalls++
      const repoMeta = repoMetaRes?.meta ?? null
      const hasSkill = hasSkillPath(new Set(scanFiles.map(f => f.replace(/^package\//, ''))))
      // npm↔repo correspondence: the repo's own package.json should name this
      // package. A positive mismatch (claiming an unrelated popular repo to
      // borrow its stars/trust) → finding; absence of evidence isn't proof.
      if (repo) {
        const dir = pk.repositoryDir ?? undefined
        const dirTraversal = unsafeRepoDir(dir)
        if (dirTraversal) scan.findings.push('sec:repo-dir-traversal')
        const { pkgName, status: pjStatus } = dirTraversal
          ? { pkgName: null, status: 'error' as const }
          : await fetchRepoPackageName(repo, { dir, fetchFn: f })
        if (pjStatus === 'ok' && pkgName && pkgName !== cand.name && pkgName !== cand.name.split('/').pop()) {
          scan.findings.push(`sec:repo-mismatch:${clip(pkgName)}`)
        }
      }
      if (declaredRepo && repo && declaredRepo.toLowerCase() !== repo.toLowerCase())
        scan.findings.push(`sec:repo-declared-mismatch:${clip(declaredRepo)}`)
      // tombstone identity check: a same-name package re-entering after a
      // disappearance is compared against the tombstone record — a different
      // repoId on the same repo or a NEWER package createdAt means the
      // recycled name is a new object, not a resurrection (name-reuse
      // detection the live-path trustFlags can't see across the tombstone gap)
      const tomb = removedByName.get(cand.name.toLowerCase())
      if (tomb?.lastSource?.kind === 'npm') {
        if (pk.createdAt && tomb.createdAt && Date.parse(pk.createdAt) > Date.parse(tomb.createdAt) + 1000) {
          scan.redFlags.push('sec:name-reused')
        }
        const tombRepo = tomb.lastSource.repo
        if (repo && tombRepo && repo.toLowerCase() === tombRepo.toLowerCase()
            && repoMeta?.id && tomb.lastSource.repoId && repoMeta.id !== tomb.lastSource.repoId) {
          scan.redFlags.push('sec:repo-recreated')
        }
      }
      // author-claimed fields precedence: repo .opencode-market.json > issue submission > auto-derived
      const sub = seedMeta.get(cand.name)

      // contains claims only what the artifacts support: an npm 'plugin' part
      // requires an entry point (main/exports — what opencode loads); a
      // tarball whose only artifact is SKILL.md declares 'skill' and routes
      // off the plugin verify chain instead of failing a nonexistent plugin
      // install. An explicit empty list means "no installable payload".
      // The author-DECLARED type never strips a real entry point's plugin
      // part — a 'skill'-labeled package that ships main/exports still goes
      // through install+load verification (the label sets the badge, not
      // the verification level).
      const hasEntry = !!(pk.main || pk.exports)
      const parts: NonNullable<PluginEntry['contains']> = [
        ...(hasEntry ? ['plugin' as const] : []),
        ...(hasSkill ? ['skill' as const] : []),
      ]
      // marketMeta/submission category strings are author-controlled — only
      // canonical taxonomy ids may bind; an unrecognized claim falls back to
      // the classifier instead of minting a global category
      const claimedCats = (marketMeta?.category ?? sub?.category ?? [])
        .map(catId).filter(c => CAT_NAMES[c] !== undefined)
      const entry: PluginEntry = {
        name: cand.name,
        slug,
        aliases: [],
        type: (sub?.type === 'skill' ? 'skill' : 'plugin'),
        contains: parts,
        discoveredVia: cand.discoveredVia as PluginEntry['discoveredVia'],
        source: { kind: 'npm', id: cand.name, ...(repo ? { repo } : {}), ...(repoMeta?.id ? { repoId: repoMeta.id } : {}), ...(pk.latest ? { version: pk.latest } : {}) },
        description: {
          en: marketMeta?.description?.en ?? sub?.desc?.en ?? cand.description,
          ...(marketMeta?.description?.zh || sub?.desc?.zh ? { zh: marketMeta?.description?.zh ?? sub?.desc?.zh } : {}),
        },
        features: detectFeatures({ exports: pk.exports, main: pk.main, files: scanFiles }),
        category: claimedCats.length ? claimedCats
          : classify(cand.name, slug, cand.description ?? '', [...pk.keywords, ...(repoMeta?.topics ?? [])]),
        license: pk.license ?? repoMeta?.license ?? null,
        deprecated: pk.deprecated,
        deprecatedMessage: pk.deprecatedMessage,
        replacement: replacementOf(pk.deprecatedMessage),
        createdAt: pk.createdAt,
        modifiedAt: pk.modifiedAt,
        maintainers: pk.maintainers,
        distTags: pk.distTags,
        firstSeenAt: now,
        latestVersion: pk.latest,
        publishedAt: pk.latestPublishedAt,
        integrity: pk.integrityOf[pk.latest ?? ''] ?? null,
        metrics: { stars: repoMeta?.stars ?? null, npmDownloads30d: downloads, checkedAt: now },
        capabilities: scan,
        // no installable payload → 'skipped' like repo-only entries: the
        // release gate treats it as "deliberately not run", and verifyPartsOf
        // honors the explicit empty contains (never queues)
        verification: parts.length === 0 || scan.redFlags.length > 0
          ? { status: 'skipped', level: 'install' }
          : { status: 'unverified' },
        // engines/peerDependencies from the packument's latest version —
        // the field the site/client render as the 兼容性 row (was always {})
        compat: pk.compatOf[pk.latest ?? ''] ?? {},
        approval: 'pending',
        approvalReason: 'awaiting-review',
      }
      // hold-by-default (AI-DIAGNOSIS §4): a version bump on a DISPLAYED entry
      // holds the new version in pendingUpdate and pins display fields to the
      // last approved version. A bump on a pending entry just moves the
      // candidate in place (nothing displayed to protect).
      if (prev && prev.approval !== 'pending' && pk.latest !== prev.latestVersion) {
        if (pk.latest) {
          entry.pendingUpdate = {
            version: pk.latest,
            capabilities: entry.capabilities,
            verification: entry.verification,
            ...(entry.features ? { features: entry.features } : {}),
            // the CANDIDATE's parts must be captured before display pinning —
            // entry.contains is about to be rewound to the displayed version;
            // explicit [] means "no installable payload" and must survive
            contains: entry.contains,
            // same for the candidate's engines/peer — entry.compat is about to
            // be pinned to the displayed version below; an empty {} is still
            // the candidate's truth ("no constraints") and must promote, not
            // fall back to the displayed version's compat
            compat: entry.compat,
            // same for the candidate's tarball SRI — entry.integrity is about
            // to be pinned to the displayed version below; release promotes it
            integrity: pk.integrityOf[pk.latest ?? ''] ?? null,
            publishedAt: entry.publishedAt,
            reason: 'awaiting-review',
            heldAt: now,
          }
          entry.approval = prev.approval
          entry.approvalReason = prev.approvalReason
          entry.latestVersion = prev.latestVersion
          entry.publishedAt = prev.publishedAt
          entry.capabilities = prev.capabilities
          entry.verification = prev.verification
          entry.features = prev.features
          // contains is version-scoped like capabilities/verification: pin it
          // to the DISPLAYED version's parts so install routing never offers
          // the held candidate's payload shape for the shown release
          entry.contains = prev.contains
          // compat describes the DISPLAYED version too — the packument
          // carries every version's fields, so pinning is free
          entry.compat = pk.compatOf[prev.latestVersion ?? ''] ?? prev.compat
          entry.source = { ...entry.source, ...(prev.source.version ? { version: prev.source.version } : {}) }
        } else {
          // npm has no latest tag at all — carry the whole display state
          entry.approval = prev.approval
          entry.approvalReason = prev.approvalReason
          entry.pendingUpdate = prev.pendingUpdate
          entry.latestVersion = prev.latestVersion
          entry.publishedAt = prev.publishedAt
          entry.capabilities = prev.capabilities
          entry.verification = prev.verification
          entry.features = prev.features
          entry.contains = prev.contains
          entry.compat = pk.compatOf[prev.latestVersion ?? ''] ?? prev.compat
          entry.source = { ...entry.source, ...(prev.source.version ? { version: prev.source.version } : {}) }
        }
      } else if (prev) {
        entry.approval = prev.approval
        if (prev.approval !== 'pending') {
          // npm latest rolled back to the displayed version — hold survives
          entry.pendingUpdate = prev.pendingUpdate
          entry.approvalReason = prev.approvalReason
        } else {
          // pending candidate updated in place — the old concern reason
          // described the previous candidate version, so reset it. A rebuild
          // at the SAME version (e.g. ruleset upgrade) keeps the annotation.
          entry.approvalReason = pk.latest !== prev.latestVersion ? 'awaiting-review' : prev.approvalReason
        }
      }
      // integrity follows the DISPLAYED version — a held entry pins the approved
      // tarball's SRI, not the pending one (packument carries every version).
      // Compare against the prior anchor ONLY when it described the same
      // version string: a held bump re-tags the DISPLAYED version under its
      // own name (drift → freeze + flag); a candidate bump re-anchors fresh
      // and comparing across versions would false-positive every release.
      if (prev && entry.latestVersion === prev.latestVersion) {
        const dispA = anchorIntegrity(entry.capabilities, prev.integrity,
          entry.latestVersion ? pk.integrityOf[entry.latestVersion] ?? null : null)
        entry.integrity = dispA.integrity
        entry.capabilities = dispA.capabilities
      } else {
        entry.integrity = (entry.latestVersion ? pk.integrityOf[entry.latestVersion] : null) ?? null
      }
      entries.push(entry)
      console.log(`  [${entries.length}] ${cand.name}`)
    } catch (e) {
      console.warn(`candidate ${cand.name} failed:`, (e as Error).message)
      // a crashed seed still owes its issue an explanation — without an
      // outcome the status comment sits at '排队中' until the 30d dead-close
      if (seedNames.has(cand.name)) seedOutcomes.set(cand.name, 'run-error')
    }
  }
  await pool(queue, worker)

  // 3b. github-topic candidates with no npm counterpart (D-1: ghList wiring).
  //     Search results already carry id/stars/createdAt/license/topics — the tree
  //     call doubles as the evidence gate, and the codeload tarball gets the same
  //     static scan npm packages get. fetchMarketMeta/package.json hit
  //     raw.githubusercontent (CDN, uncounted) so they stay free under API quota
  //     exhaustion.
  // npm↔gh dedup compares repo identity case-insensitively — GitHub's display
  // case ('Owner/Repo') vs the packument-normalized value must not slip a
  // duplicate through. The covered filter drops NEW gh candidates only —
  // an EXISTING gh entry is the canonical record for its repo and keeps
  // flowing through ghWorker for metrics/scan freshness (slug-dedup merges
  // the two views at publish); before this exemption it was filtered here
  // and re-added by gone-check every run — a wasted probe with frozen
  // metrics. Submission seeds are exempt too: a human asked for the repo
  // even when an npm twin exists.
  const coveredRepos = new Set(entries.map(e => e.source.repo?.toLowerCase()).filter(Boolean))
  const ghMissing = ghQueue.filter(c => {
    if (coveredRepos.has(c.fullName.toLowerCase())
        && !oldByName.has(c.fullName.toLowerCase())
        && !isSeedRepo(c)) return false
    if (isBlockedAnyCase(c.fullName, c.fullName.toLowerCase())) {
      if (c.discoveredVia.includes('submission')) seedOutcomes.set(c.fullName.toLowerCase(), 'blocklisted')
      return false
    }
    return true
  })
  // admission audit counters — gate outcomes must be countable, not just silent
  // nulls. 'covered' counts only npm-covered candidates; blocklist drops get
  // their own counter (the old math lumped them into covered).
  const ghStats = {
    covered: ghQueue.length - ghMissing.length
      - ghQueue.filter(c => isBlockedAnyCase(c.fullName, c.fullName.toLowerCase())).length,
    blocked: 0, reused: 0, treeTransient: 0, treeEmpty: 0, truncated: 0, archived: 0,
    evidenceRejected: 0, scanFailed: 0, scanOversize: 0, admitted: 0,
  }
  ghStats.blocked = ghQueue.filter(c => isBlockedAnyCase(c.fullName, c.fullName.toLowerCase())).length
  const ghWorker = async (c: (typeof ghMissing)[number]) => {
      // every identity comparison keys on the canonical lowercase repo name —
      // display casing ('Owner/Repo') is kept for the entry NAME only
      const lower = c.fullName.toLowerCase()
      const ghPrev = oldByName.get(lower)
      let cand = c
      let canonicalName: string | null = null
      // submission seeds arrive with fabricated metadata (id:null, stars:0,
      // pushedAt:null, archived:false) — one meta call anchors them to real
      // identity: repoId for repojacking, createdAt for name-reuse
      // tombstones, pushedAt for incremental reuse, canonical casing, and a
      // truthful archived flag (the fake 'false' previously let an archived
      // submission slip past preAdmit). The gate keys on missing identity
      // fields rather than isSeedRepo: code-search results can also arrive
      // with partial repo objects (missing pushed_at or id), and any
      // candidate without both can't reuse-check or repojack-check anyway.
      if (cand.pushedAt == null || cand.id == null) {
        const metaRes = await fetchRepoMeta(cand.fullName, { token: opts.ghToken, fetchFn: f })
        if (metaRes.status === 'rate-limited') rateLimitedCalls++
        if (metaRes.meta) {
          const m = metaRes.meta
          if (m.archived || m.fork) {
            ghStats.archived++
            rejectedGh.add(lower)
            // submissions must nominate the maintained canonical repo — a
            // fork inherits the parent's tree/evidence wholesale
            if (isSeedRepo(cand)) seedOutcomes.set(lower, m.fork ? 'archived-or-fork' : 'archived')
            return null
          }
          canonicalName = m.fullName
          cand = {
            ...cand,
            id: m.id ?? cand.id,
            createdAt: cand.createdAt ?? m.createdAt,
            stars: cand.stars || m.stars,
            pushedAt: cand.pushedAt ?? m.pushedAt,
            license: cand.license ?? m.license,
            topics: cand.topics.length ? cand.topics : m.topics,
            archived: m.archived,
            defaultBranch: cand.defaultBranch === 'HEAD' ? (m.defaultBranch ?? cand.defaultBranch) : cand.defaultBranch,
          }
        } else if (metaRes.status === 'not-found') {
          // definitive 404 — let the tree probe record the repo-not-found
          // rejection below (two endpoints agreeing beats one)
        } else {
          // 'error'/'rate-limited': the identity probe FAILED — proceeding
          // would evaluate every gate below on the fabricated values
          // (archived:false, fork:false, id:null, createdAt:null), silently
          // bypassing the archived/fork guard, repojack repoId check and
          // name-reuse createdAt tombstone. Same posture as a tree failure:
          // keep the old entry / defer a new seed to the next run.
          ghStats.treeTransient++
          if (isSeedRepo(cand)) seedOutcomes.set(lower, 'repo-fetch-error')
          return ghPrev ?? null
        }
      }
      // fork guard for candidates that never entered the backfill branch —
      // their payload (code-search/topic hit) already carried pushedAt+id so
      // meta wasn't re-fetched; a truthful fork bit must still reject the same
      // way (preAdmit's fork arm only fires on proven no-own-commits)
      if (cand.fork) {
        rejectedGh.add(lower)
        if (isSeedRepo(cand)) seedOutcomes.set(lower, 'archived-or-fork')
        return null
      }
      // incremental reuse: pushedAt unchanged + same ruleset → carry the prior
      // scan. modifiedAt stores last-seen pushedAt for github-kind entries.
      if (ghPrev && cand.pushedAt && ghPrev.modifiedAt === cand.pushedAt
          && ghPrev.capabilities.rulesetVersion === RULESET_VERSION
          // a github-kind carry-over with no source.version has no byte
          // anchor — verify can't pin what was never recorded, and reuse
          // would preserve the gap forever (pre-anchor legacy rows). Fall
          // through to the full path once: the rebuilt entry anchors
          // source.version = the scanned commit and the slot heals.
          && (ghPrev.source?.kind !== 'github' || !!ghPrev.source.version)
          && !isBlockedAnyCase(cand.fullName, ghPrev.slug)) {
        ghStats.reused++
        reusedNames.add(lower)
        // pushedAt unchanged means the BYTES are identical — but stars move
        // while code doesn't; refresh the metrics stamp from the search hit
        // (free: already in memory) instead of freezing it forever
        return { ...ghPrev, metrics: { ...ghPrev.metrics, stars: cand.stars, checkedAt: now } }
      }
      // evidence gate: a topic tag alone never admits — the tree must show an
      // opencode-specific signal AND an installable artifact. 'HEAD' resolves
      // the default branch server-side — a search-index-stale defaultBranch
      // (branch rename) would 404 a named-ref fetch and falsely filter the repo.
      const treeRes = await fetchRepoTree(cand.fullName, 'HEAD', { token: opts.ghToken, fetchFn: f })
      if (treeRes.status === 'rate-limited') rateLimitedCalls++
      if (treeRes.status === 'error' || treeRes.status === 'rate-limited') {
        // transient failure ≠ junk — keep the old entry rather than dropping it
        // into gone-check on a network hiccup
        ghStats.treeTransient++
        return ghPrev ?? null
      }
      if (!treeRes.paths || treeRes.paths.size === 0) {
        // 404/409 → paths null (gone); a 200 with zero entries is a real repo
        // with no files — equally unusable, and now counted the same instead of
        // leaking into evidenceRejected and mislabeling the audit line
        ghStats.treeEmpty++
        rejectedGh.add(lower)
        if (isSeedRepo(cand)) seedOutcomes.set(lower, treeRes.paths?.size === 0 ? 'no-opencode-evidence' : 'repo-not-found')
        return null
      }   // gone/empty — gone-check decides
      // a truncated tree is INCOMPLETE data, not a verdict — the API cut the
      // deep paths, so evidence judged on the front of the tree alone gets a
      // visible counter (and a finding on the admitted entry), instead of a
      // silent 'evidence-rejected' against partial information
      if (treeRes.truncated) ghStats.truncated++
      const ev = hasRepoEvidence(treeRes.paths, cand.topics)
      if (!ev.ok) {
        // mirror the npm-side rule (hasPluginEvidence above): an APPROVED
        // slot's pinned commit still describes reviewed bytes — HEAD losing
        // its opencode signals must not tombstone the displayed entry (a
        // temporary .opencode/ move or a truncated tree would otherwise
        // delist a live plugin and reset its review state on return).
        // modifiedAt stays stale on purpose: the reuse fast-path must not
        // skip re-evaluation, so a restored tree heals the entry next run.
        if (ghPrev && ghPrev.approval !== 'pending' && !isBlockedAnyCase(ghPrev.name, ghPrev.slug)) {
          return {
            ...ghPrev,
            metrics: { ...ghPrev.metrics, stars: cand.stars, checkedAt: now },
            capabilities: addFinding(ghPrev.capabilities, `sec:evidence-regressed@${(treeRes.sha ?? 'HEAD').slice(0, 12)}`),
          }
        }
        ghStats.evidenceRejected++
        rejectedGh.add(lower)
        if (isSeedRepo(cand)) seedOutcomes.set(lower, 'no-opencode-evidence')
        return null
      }
      // the tree already told us whether a package.json exists — a 404 fetch
      // would only burn a raw.githubusercontent round-trip to learn the same
      const [marketMeta, repoPkg] = await Promise.all([
        fetchMarketMeta(cand.fullName, { token: opts.ghToken, fetchFn: f }),
        treeRes.paths.has('package.json')
          ? fetchRepoPackage(cand.fullName, { fetchFn: f })
          : Promise.resolve<{ pkg: null; status: RepoMetaStatus }>({ pkg: null, status: 'not-found' }),
      ])
      // scan the bytes the resolved sha anchors — the tree call above pinned
      // treeRes.sha (a commit); a second HEAD resolution here races a push and
      // would scan code the recorded pin doesn't describe (codeload accepts a
      // commit sha verbatim — archives are immutable)
      let scan = { scannedAt: null as string | null, rulesetVersion: undefined as string | undefined, findings: [] as string[], redFlags: [] as string[] }
      let scanFiles: string[] = []
      try {
        const tgz = await fetchTarball(`https://codeload.github.com/${cand.fullName}/tar.gz/${treeRes.sha ?? 'HEAD'}`, { fetchFn: f })
        const r = await scanTarball(tgz)
        const strip = (p: string) => p.replace(/^[^/]+\//, '')   // owner-repo-sha/ prefix
        scanFiles = r.files.map(strip)
        scan = {
          scannedAt: now,
          rulesetVersion: RULESET_VERSION,
          findings: r.findings.map(x => `${x.rule}:${strip(x.file)}`),
          redFlags: r.redFlags.map(x => `${x.rule}:${strip(x.file)}`),
        }
      } catch (e) {
        const msg = (e as Error).message
        console.warn(`scan failed ${cand.fullName}:`, msg)
        ghStats.scanFailed++
        // oversize repos fail deterministically — stamp the ruleset so the
        // incremental-reuse check above skips re-fetching them every run
        // (retries resume naturally when pushedAt changes)
        if (/too large/.test(msg)) { scan.rulesetVersion = RULESET_VERSION; ghStats.scanOversize++ }
      }
      ghStats.admitted++
      // an admitted entry built on a truncated tree says so — deep paths the
      // API never returned could hide evidence the gate didn't see
      if (treeRes.truncated) scan.findings.push('sec:tree-truncated')
      const hasSkill = hasSkillPath(treeRes.paths) || hasSkillPath(new Set(scanFiles))
      const sub = seedRepoMeta.get(lower)
      // repo drift, review anchor: the submission review scanned tree
      // `sub.version`; if HEAD's tree hash moved, the bytes a reviewer saw are
      // gone. This is an identity-level signal → redFlag, not finding: while
      // the entry is still pending it must fail-closed into the human-review
      // surface (sec:* → flaggedAt → docket flag target → skipIfFlagged), the
      // same surface sec:integrity-drift rides on npm. Once the entry is
      // released the verdict-sha anchor (below) takes over — the seed row's
      // stale review sha would otherwise flag forever.
      const drifted = !!(sub?.version && treeRes.sha && sub.version !== treeRes.sha
        && (ghPrev?.approval ?? 'pending') === 'pending')
      // sha embedded for the same reason as the release variant below — a
      // second move while still pending is a NEW flag set, so flaggedAt
      // re-stamps and the docket re-asks instead of inheriting "decided"
      if (drifted && treeRes.sha) scan.redFlags.push(`sec:repo-moved-since-review:${treeRes.sha.slice(0, 12)}`)
      // repo drift, release anchor: a standing human pass stamped sha X at
      // verdict time (submit/concern now record it) but HEAD moved — the
      // displayed install pin now points at bytes no decision covers.
      // Embedding the new sha makes each move a NEW flag set, so flaggedAt
      // re-stamps and every move re-asks the question on the flag surface
      // (a bare flag name would stay "decided" by the last verdict).
      const hvPass = latestHumanByKey.get(vkey(ghPrev?.name ?? canonicalName ?? cand.fullName, null))
      if (hvPass?.verdict === 'pass' && hvPass.sha && treeRes.sha && hvPass.sha !== treeRes.sha
          && (ghPrev?.approval === 'approved' || ghPrev?.approval === 'legacy')) {
        scan.redFlags.push(`sec:repo-moved-since-release:${treeRes.sha.slice(0, 12)}`)
      }
      // same signal one level down: the package.json `name` the review saw
      // differs from what's at HEAD now — reviewed artifact identity changed
      if (sub?.pkg && repoPkg.pkg?.name && sub.pkg !== repoPkg.pkg.name)
        scan.redFlags.push(`sec:repo-pkg-changed:${clip(repoPkg.pkg.name)}`)
      // tombstone identity: a same-name repo reappearing with a different
      // repoId (or a newer createdAt) is a recreated repo under a recycled
      // fullName, not a resurrection
      const tomb = removedByName.get(lower)
      if (tomb?.lastSource?.kind === 'github') {
        if (cand.id && tomb.lastSource.repoId && cand.id !== tomb.lastSource.repoId) {
          scan.redFlags.push('sec:repo-recreated')
        }
        if (tomb.createdAt && cand.createdAt && Date.parse(cand.createdAt) > Date.parse(tomb.createdAt) + 1000) {
          scan.redFlags.push('sec:name-reused')
        }
      }
      // type drives the site badge: declared wins; otherwise a repo whose only
      // artifact is skills (no root package.json, no .opencode plugin path)
      // is a skill repo, not a plugin
      const pluginArtifact = [...treeRes.paths].some(p => /(^|\/)\.opencode\/(plugin|plugins)\//.test(p))
      const type: PluginEntry['type'] = sub?.type === 'skill' ? 'skill'
        : (hasSkill && !treeRes.paths.has('package.json') && !pluginArtifact ? 'skill' : 'plugin')
      const feats = detectFeatures({ exports: repoPkg.pkg?.exports, main: repoPkg.pkg?.main ?? null, files: scanFiles })
      // contains = parts list: 'plugin' when plugin code/artifact evidence
      // exists (a plugin repo needs a host install path, npm or manual), plus
      // 'skill' for skill artifacts — drives client install routing
      const ghParts: NonNullable<PluginEntry['contains']> = [
        ...(pluginArtifact || feats.length ? ['plugin' as const] : []),
        ...(hasSkill ? ['skill' as const] : []),
      ]
      // marketMeta/submission categories are author-controlled — whitelist
      // to the canonical taxonomy (unrecognized claims fall back to classify)
      const ghClaimedCats = (marketMeta?.category ?? sub?.category ?? [])
        .map(catId).filter(cc => CAT_NAMES[cc] !== undefined)
      // name stability beats case freshness: an existing entry keeps its
      // established name (a display-case-only rename doesn't fork identity);
      // new entries get the API's canonical casing when we fetched meta
      const entryName = ghPrev?.name ?? canonicalName ?? cand.fullName
      const entry: PluginEntry = {
        name: entryName,
        slug: lower,
        aliases: [],
        type,
        contains: ghParts,
        discoveredVia: cand.discoveredVia as PluginEntry['discoveredVia'],
        source: { kind: 'github', id: entryName, repo: canonicalName ?? cand.fullName, ...(cand.id ? { repoId: cand.id } : {}), ...(treeRes.sha ? { version: treeRes.sha } : {}) },
        description: {
          en: marketMeta?.description?.en ?? sub?.desc?.en ?? cand.description,
          ...(marketMeta?.description?.zh || sub?.desc?.zh ? { zh: marketMeta?.description?.zh ?? sub?.desc?.zh } : {}),
        },
        features: feats,
        category: ghClaimedCats.length ? ghClaimedCats
          : classify(cand.fullName, lower, cand.description, cand.topics),
        license: cand.license,
        deprecated: false,
        deprecatedMessage: null,
        replacement: null,
        createdAt: cand.createdAt,
        modifiedAt: cand.pushedAt,
        maintainers: [],
        distTags: {},
        firstSeenAt: ghPrev?.firstSeenAt ?? now,
        latestVersion: null,
        publishedAt: null,
        integrity: null,
        metrics: { stars: cand.stars, npmDownloads30d: null, checkedAt: now },
        capabilities: scan,
        // parts-aware initial state: an installable payload (plugin/skill) is
        // 'unverified' and enters the shard queue — github-kind now verifies
        // via `plugin add owner/repo#<commit>` / codeload structure checks.
        // Only an entry with NO installable parts stays 'skipped' — the
        // "deliberately not run" state RELEASABLE admits so a human pass can
        // still release a docs-only repo. A flagged payload likewise never
        // executes, so it stays 'skipped' rather than claiming a queue slot.
        // Display layers render latestVersion===null as "nothing to install".
        verification: {
          status: ghParts.length === 0 || scan.redFlags.length > 0 ? 'skipped' : 'unverified',
          level: 'install',
        },
        // repo-root package.json carries engines/peerDependencies too
        compat: compatStrings(repoPkg.pkg?.engines, repoPkg.pkg?.peerDependencies),
        // drift is enforced, not just noted: the sec:repo-moved-* redFlags
        // above ride the flag review surface (flaggedAt → docket/digest), and
        // repo verdicts stamped with the reviewed sha get refused by shaOk
        // when the pinned commit moved — same pin discipline npm gets from
        // dist.integrity, keyed on name@'' (repo verdicts have no version
        // slot).
        approval: ghPrev?.approval ?? 'pending',
        ...(ghPrev?.approvalReason ? { approvalReason: ghPrev.approvalReason } : {}),
      }
      return entry
  }
  await pool(ghMissing, async c => {
    try {
      const e = await ghWorker(c)
      if (e) entries.push(e)
    } catch (err) {
      // same per-candidate isolation as the npm worker — one malformed repo
      // must not fail the whole generate after the npm side already produced
      console.warn(`github candidate ${c.fullName} failed:`, (err as Error).message)
      if (isSeedRepo(c)) seedOutcomes.set(c.fullName.toLowerCase(), 'run-error')
    }
  })
  console.log(`github-kind: ${ghStats.admitted} admitted (${ghStats.reused} reused, ${ghStats.covered} npm-covered, ` +
    `${ghStats.blocked} blocked, ${ghStats.evidenceRejected} evidence-rejected, ${ghStats.archived} archived-or-fork, ` +
    `${ghStats.treeTransient} transient-kept, ${ghStats.treeEmpty} empty, ${ghStats.truncated} truncated-tree, ` +
    `${ghStats.scanFailed} scan-failed of which ${ghStats.scanOversize} oversize)`)
  if (rateLimitedCalls > 0) {
    console.warn(`github api rate-limited on ${rateLimitedCalls} call(s) — repoId/tree coverage partial; heals on subsequent runs`)
  }

  // 4. gone-check: old entries missing from fresh set — probe before tombstoning (F-2).
  //    'filtered' requires POSITIVE rejection evidence (admission gate actually
  //    saw and rejected it this run). A live entry the discovery surface simply
  //    missed — search truncated, topic sort window passed, worker crash — is
  //    kept, not tombstoned: absence from a paginated search result is not
  //    evidence of anything (R-3). Real departures still tombstone via 404.
  const freshNames = new Set(entries.map(e => e.name.toLowerCase()))
  const removedNow: RemovedEntry[] = []

  // periodic ruleset sweep (bounded slice per run): carried-over entries whose
  // scan predates the current ruleset never re-enter discovery, so without a
  // sweep a ruleset upgrade would leave them judged by retired rules forever.
  // Failed scans stay retryable (undefined rulesetVersion is stale by
  // definition); the oversize stamp exempts itself since it IS current-rules.
  let rescanBudget = 20
  const staleCaps = (c: PluginEntry['capabilities'] | undefined) =>
    c !== undefined && c.rulesetVersion !== RULESET_VERSION
  const rescanStaleNpm = async (e: PluginEntry, pk: { tarballOf: Record<string, string | undefined>; integrityOf: Record<string, string | undefined> } | null): Promise<PluginEntry> => {
    if (!pk) return e
    // candidateSlot: a pending entry's leftover hold is the B3 inverted
    // state — rescanning/drift-checking it burns budget on dead bytes and
    // keeps the shadow alive; the candidate slot is what needs fresh rules
    const pu = candidateSlot(e)
    const needScan = staleCaps(e.capabilities) || staleCaps(pu?.capabilities)
    let caps = e.capabilities
    let puCaps = pu?.capabilities
    let puScanned = false
    if (needScan && rescanBudget > 0) {
      rescanBudget--
      const scanOf = async (ver: string | null, c: PluginEntry['capabilities']) => {
        if (!staleCaps(c) || !ver) return c
        const url = pk.tarballOf[ver]
        if (!url) return c
        try {
          const r = await scanTarball(await fetchTarball(url, { fetchFn: f }))
          return {
            scannedAt: now, rulesetVersion: RULESET_VERSION,
            findings: [...new Set([...r.findings.map(x => `${x.rule}:${x.file}`), ...keepFindings(c)])],
            redFlags: r.redFlags.map(x => `${x.rule}:${x.file}`),
          }
        } catch { return c }
      }
      caps = await scanOf(e.latestVersion, caps)
      if (pu) {
        const next = await scanOf(pu.version, puCaps!)
        if (next !== puCaps) { puCaps = next; puScanned = true }
      }
    }
    // integrity drift check is free — the gone-probe already fetched pk, and
    // an entry dropped from discovery never reaches refreshMeta/pin paths, so
    // this sweep is the only place a re-tag here can be caught. Displayed slot
    // freezes its anchor (install SRI fails closed on the swapped bytes); the
    // held slot re-anchors to whatever bytes the current caps describe — the
    // rescanned tarball when a rescan ran, else the previously anchored ones.
    const dispA = e.latestVersion
      ? anchorIntegrity(caps, e.integrity ?? null, pk.integrityOf[e.latestVersion] ?? null)
      : { integrity: e.integrity ?? null, capabilities: caps }
    let puIntegrity = pu?.integrity ?? null
    if (pu) {
      const regSha = pk.integrityOf[pu.version] ?? null
      const drift = puIntegrity !== null && regSha !== null && puIntegrity !== regSha
      if (drift) puCaps = { ...puCaps!, redFlags: [...new Set([...puCaps!.redFlags, DRIFT_FLAG])] }
      puIntegrity = puScanned ? (regSha ?? puIntegrity) : (puIntegrity ?? regSha)
    }
    const puChanged = pu !== null
      && (puCaps !== pu.capabilities || puIntegrity !== (pu.integrity ?? null))
    return {
      ...e, capabilities: dispA.capabilities, integrity: dispA.integrity,
      ...(pu && puChanged ? { pendingUpdate: { ...pu, capabilities: puCaps!, integrity: puIntegrity } } : {}),
    }
  }
  const rescanStaleGh = async (e: PluginEntry): Promise<PluginEntry> => {
    if (rescanBudget <= 0 || !staleCaps(e.capabilities)) return e
    rescanBudget--
    try {
      const repo = e.source.repo ?? e.name
      const tree = await fetchRepoTree(repo, 'HEAD', { token: opts.ghToken, fetchFn: f })
      if (tree.status === 'rate-limited') rateLimitedCalls++
      if (!tree.paths) return e
      // same pin discipline as ghWorker: scan the resolved commit, not a
      // second HEAD resolution that could have moved between the two calls
      const tgz = await fetchTarball(`https://codeload.github.com/${repo}/tar.gz/${tree.sha ?? 'HEAD'}`, { fetchFn: f })
      const r = await scanTarball(tgz)
      const strip = (p: string) => p.replace(/^[^/]+\//, '')
      const redFlags = r.redFlags.map(x => `${x.rule}:${strip(x.file)}`)
      // an aged-out entry never sees ghWorker — mirror its drift flags here
      // or a moved HEAD re-anchors source.version silently (reviewed commit →
      // unreviewed pin with nothing for the flag/docket surfaces to catch)
      const sub = seedRepoMeta.get(repo.toLowerCase())
      if (sub?.version && tree.sha && sub.version !== tree.sha
          && (e.approval ?? 'pending') === 'pending') {
        redFlags.push(`sec:repo-moved-since-review:${tree.sha.slice(0, 12)}`)
      }
      const hvPass = latestHumanByKey.get(vkey(e.name, null))
      if (tree.sha && hvPass?.verdict === 'pass' && hvPass.sha && hvPass.sha !== tree.sha
          && (e.approval === 'approved' || e.approval === 'legacy')) {
        redFlags.push(`sec:repo-moved-since-release:${tree.sha.slice(0, 12)}`)
      }
      if (sub?.pkg && tree.paths.has('package.json')) {
        const repoPkg = await fetchRepoPackage(repo, { fetchFn: f })
        if (repoPkg.pkg?.name && sub.pkg !== repoPkg.pkg.name)
          redFlags.push(`sec:repo-pkg-changed:${clip(repoPkg.pkg.name)}`)
      }
      // the pinned commit moved → the carried verification measured DIFFERENT
      // bytes. Reset to unverified so plan re-queues the new sha (merge's
      // samePinnedBytes gate can't help here — the stale status arrives
      // inside this fresh entry, not via the prevVer restore). Evidence
      // fields (verifiedAt/runUrl/integrity) stay as the audit trail of what
      // WAS measured; merge's skipIfFlagged still downgrades if redFlags stand.
      const moved = !!(tree.sha && e.source.version && tree.sha !== e.source.version)
      return {
        ...e,
        capabilities: {
          scannedAt: now, rulesetVersion: RULESET_VERSION,
          // non-scan findings union back in (repo-mismatch/drift/delta signals
          // nothing re-derives on this keep-path); tree-truncated is the one
          // exception — it describes THIS probe's completeness, so it
          // re-derives fresh below instead of carrying a stale marker
          findings: [...new Set([
            ...r.findings.map(x => `${x.rule}:${strip(x.file)}`),
            ...keepFindings(e.capabilities).filter(f => f !== 'sec:tree-truncated'),
            ...(tree.truncated ? ['sec:tree-truncated'] : []),
          ])],
          redFlags,
        },
        ...(moved ? { verification: { ...e.verification, status: 'unverified' as const } } : {}),
        ...(tree.sha ? { source: { ...e.source, version: tree.sha } } : {}),
      }
    } catch { return e }
  }

  const goneCheck = async (e: PluginEntry) => {
    const lower = e.name.toLowerCase()
    let reason: RemovedEntry['reason'] = 'unknown'
    if (cappedOut.has(lower)) reason = 'capped'
    else if (isBlockedAnyCase(e.name, e.slug)) reason = 'manual'
    else if (e.source.kind === 'npm') {
      // abbreviated packument — the probe only needs existence + dist.tarball
      const { pk, status } = await fetchPackument(e.name, { fetchFn: f, abbreviated: true })
      if (status === 'error') {
        // transient failure (429/5xx/network) is NOT proof of disappearance —
        // keep the stale entry rather than emitting a false tombstone (F-2).
        entries.push(e)
        return
      }
      if (status === 'ok' && !rejectedNpm.has(lower)) { entries.push(await rescanStaleNpm(e, pk)); return }
      reason = status === 'not-found' ? 'npm-404' : 'filtered'
    }
    // github-kind entries never pass through the candidate filters — but a
    // discovery-side rate-limit/error silently truncates search results, so a
    // missing entry needs a live re-probe before the tombstone (same fail-closed
    // posture as the npm side)
    else if (e.source.kind === 'github') {
      const { status } = await fetchRepoMeta(e.source.repo ?? e.name, { token: opts.ghToken, fetchFn: f })
      if (status === 'rate-limited') rateLimitedCalls++
      if (status === 'error' || status === 'rate-limited') {
        entries.push(e)
        return
      }
      if (status === 'ok' && !rejectedGh.has(lower)) { entries.push(await rescanStaleGh(e)); return }
      reason = status === 'not-found' ? 'repo-404' : 'filtered'
    }
    removedNow.push({
      slug: e.slug, name: e.name, lastSource: e.source,
      disappearedAt: now, reason,
      // the birth stamp lets a future same-name re-entry tell "resurrected
      // object" from "recycled name" (name-reuse detection, P1-5)
      createdAt: e.createdAt,
    })
  }
  const missing = (old?.plugins ?? []).filter(e => !freshNames.has(e.name.toLowerCase()))
  await pool(missing, goneCheck)
  if (removedNow.length) {
    console.log(`removed: ${removedNow.length} (${removedNow.map(r => `${r.name}:${r.reason}`).join(', ')})`)
  }

  // 5. build index (merge + corruption gate)
  const { index, gate } = buildIndex(entries, old, {
    opencodeVersion: OPENCODE_VERSION, now, rulesetVersion: RULESET_VERSION, removed: removedNow,
  })
  if (!gate.ok && !opts.forceGate) throw new Error(`publish gate: ${gate.reason}`)
  if (!gate.ok) console.error(`publish gate: ${gate.reason} — overridden by --force-gate`)

  // seed rejection receipts — the publish job stamps these onto submissions.txt
  // rows so a rejected submission's status comment says why, not '排队中'
  if (opts.seedOutcomesPath) {
    writeFileSync(opts.seedOutcomesPath, JSON.stringify(Object.fromEntries(seedOutcomes)))
    if (seedOutcomes.size) console.log(`seed outcomes: ${[...seedOutcomes].map(([k, v]) => `${k}→${v}`).join(', ')}`)
  }

  // 6. write
  const out = opts.outPath ?? 'dist/index.json'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(index, null, 2))
  console.log(`index.json: ${index.plugins.length} entries (${reusedNames.size} reused, ${removedNow.length} removed) → ${out}`)
  return index
}

// CLI entry (untestable in vitest — excluded from coverage)
/* v8 ignore next 16 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
  const max = arg('--max') !== undefined ? Number(arg('--max')) : undefined
  if (max !== undefined && (!Number.isFinite(max) || max <= 0)) {
    console.error('--max must be a positive number')
    process.exit(2)
  }
  run({
    ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    outPath: arg('--out'),
    oldIndexPath: arg('--old'),
    seedPath: arg('--seed'),
    blocklistPath: arg('--blocklist'),
    ...(max !== undefined ? { maxEntries: max } : {}),
    verdictsPath: arg('--verdicts'),
    digestStatePath: arg('--digest-state'),
    seedOutcomesPath: arg('--seed-outcomes'),
    ...(process.argv.includes('--force-gate') ? { forceGate: true } : {}),
  }).catch(e => { console.error(e); process.exit(1) })
}
