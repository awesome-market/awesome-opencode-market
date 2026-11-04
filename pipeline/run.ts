/** Daily pipeline orchestrator: discover → fetch → scan → assemble entries → merge+gate → index.json */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverNpm } from './discover/npm.ts'
import { discoverGithub, normalizeRepoUrl } from './discover/github.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence } from './discover/filter.ts'
import { fetchPackument, fetchTarball, fetchDownloads30d } from './fetch/npm.ts'
import { fetchRepoMeta, fetchMarketMeta, fetchRepoTree, fetchRepoPackageName } from './fetch/github.ts'
import { scanTarball } from './scan/scan.ts'
import { RULESET_VERSION } from './scan/rules.ts'
import { buildIndex, OPENCODE_VERSION } from './publish/merge.ts'
import { loadVerdicts, loadLastDigestAt, applyMatureVerdicts } from './verdicts.ts'
import { slugOf } from './publish/slug.ts'
import { CatalogIndex, type PluginEntry, type RemovedEntry } from '../src/schema.ts'
import { classify } from '../src/categories.ts'
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
}

export function loadOldIndex(path?: string): CatalogIndex | null {
  if (!path) return null
  try {
    return CatalogIndex.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

interface Blocklist { names: string[]; slugs: string[] }

function loadBlocklist(path?: string): Blocklist | null {
  if (!path) return null
  try {
    const b = JSON.parse(readFileSync(path, 'utf8')) as { names?: unknown; slugs?: unknown }
    return {
      names: Array.isArray(b.names) ? b.names.filter(x => typeof x === 'string') as string[] : [],
      slugs: Array.isArray(b.slugs) ? b.slugs.filter(x => typeof x === 'string') as string[] : [],
    }
  } catch {
    return null
  }
}

/** Best-effort replacement extraction from npm deprecate message ("use X instead"). */
export function replacementOf(msg: string | null): string | null {
  if (!msg) return null
  const m = msg.match(/(?:use|moved to|renamed to|install|migrate to)\s+[`'"]?(@[\w-]+\/[\w.-]+|[\w-]+)/i)
  return m?.[1] ?? null
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
  if (old) {
    const verdicts = loadVerdicts(opts.verdictsPath)
    const lastDigestAt = loadLastDigestAt(opts.digestStatePath)
    if (verdicts.length || lastDigestAt !== null) {
      const applied = applyMatureVerdicts(old, verdicts, lastDigestAt)
      old = applied.index
      console.log(`verdicts: ${verdicts.length} loaded, lastDigestAt=${lastDigestAt ?? '-inf'} → released [${applied.releases.join(', ')}], held ${applied.held.length}`)
    }
  }
  const oldByName = new Map((old?.plugins ?? []).map(e => [e.name, e]))
  const blocklist = loadBlocklist(opts.blocklistPath)
  const isBlocked = (name: string, slug?: string) =>
    !!blocklist && (blocklist.names.includes(name) || (!!slug && blocklist.slugs.includes(slug)))

  // 1. discover (+ optional seed file: one npm name or github:owner/repo per line)
  const [npmCands, ghCands] = await Promise.all([
    discoverNpm(undefined, { fetchFn: f }),
    discoverGithub(undefined, { token: opts.ghToken, fetchFn: f }),
  ])
  // seeds: submissions.txt lines — JSONL (issue-form submissions carry declared
  // metadata) or legacy plain names or github:owner/repo
  const seedMeta = new Map<string, { type?: string; category?: string[]; desc?: Record<string, string> }>()
  const seedNames = new Set<string>()
  if (opts.seedPath) {
    let seeded = 0
    const lines = readFileSync(opts.seedPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    for (const line of lines) {
      let name: string | null = null
      let repo: string | null = null
      if (line.startsWith('{')) {
        try {
          const s = JSON.parse(line) as { name?: string | null; repo?: string | null; type?: string; category?: string[] | null; desc?: Record<string, string | null> }
          name = s.name ?? null
          repo = s.repo ?? null
          if (name) {
            const desc: Record<string, string> = {}
            for (const [k, v] of Object.entries(s.desc ?? {})) if (v) desc[k] = v
            seedMeta.set(name, {
              ...(s.type ? { type: s.type } : {}),
              ...(s.category?.length ? { category: s.category } : {}),
              ...(Object.keys(desc).length ? { desc } : {}),
            })
          }
        } catch { continue }
      } else if (line.startsWith('github:')) {
        repo = line.slice(7)
      } else {
        name = line
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
      } else if (!name && repo && !ghCands.has(repo)) {
        // repo-only submission (e.g. a skill with no npm package) → github-kind
        ghCands.set(repo, {
          fullName: repo, description: '', archived: false, fork: false, pushedAt: null,
          stars: 0, defaultBranch: 'HEAD', id: null, createdAt: null, license: null, topics: [],
          discoveredVia: ['submission' as const],
        })
        seeded++
      }
    }
    console.log(`seed: ${seeded} entries injected`)
  }
  console.log(`discover: ${npmCands.size} npm + ${ghCands.size} github candidates`)

  // 2. cheap admission filters
  // npm candidates carry no archived/fork signals — preAdmit applies to GitHub side only
  const npmList = [...npmCands.values()]
  const ghList = [...ghCands.values()].filter(c =>
    preAdmit({ name: c.fullName, repoUrl: c.fullName, archived: c.archived, fork: c.fork }).admit)
  const byOwner = new Map<string, string[]>()
  for (const c of npmList) {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0] ?? c.name.split('/')[0]!
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), c.name])
  }
  const spamOwners = new Set([...byOwner.entries()].filter(([, ns]) => looksLikeTemplateSpam(ns)).map(([o]) => o))
  const admitted = npmList.filter(c => {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0] ?? c.name.split('/')[0]!
    return !spamOwners.has(owner)
  })
  console.log(`admitted: ${admitted.length} npm + ${ghList.length} github (spam owners: ${spamOwners.size})`)

  // deterministic admission order: name asc — the slice cap must not flap (PIPELINE-ISSUES §F-1)
  const limit = opts.maxEntries ?? 500
  const sorted = [...admitted].sort((a, b) => a.name.localeCompare(b.name))
  const queue = sorted.slice(0, limit)
  // submissions bypass the cap — a human-reviewed seed must not starve behind
  // alphabetical truncation (E2E rehearsal: 'oc-market-…' sorts past the cap)
  const queued = new Set(queue.map(c => c.name))
  for (const c of sorted) if (seedNames.has(c.name) && !queued.has(c.name)) queue.push(c)
  const cappedOut = new Set(sorted.slice(limit).map(c => c.name).filter(n => !seedNames.has(n)))

  // github side gets the same deterministic cap — a topic-search burst must not
  // silently grow the index past maxEntries. Submission-injected repos bypass.
  const isSeedRepo = (c: (typeof ghList)[number]) => c.discoveredVia.includes('submission')
  const ghSorted = [...ghList].sort((a, b) => a.fullName.localeCompare(b.fullName))
  const ghQueue = ghSorted.slice(0, limit)
  const ghQueued = new Set(ghQueue.map(c => c.fullName))
  for (const c of ghSorted) if (isSeedRepo(c) && !ghQueued.has(c.fullName)) ghQueue.push(c)
  for (const c of ghSorted.slice(limit)) if (!isSeedRepo(c)) cappedOut.add(c.fullName)

  // 3. fetch + evidence gate + scan — concurrent batches of 10.
  //    Incremental short-circuit (S-2): name@version unchanged in old index → reuse
  //    the whole entry; only metrics get a rolling refresh (>7d stale).
  const entries: PluginEntry[] = []
  const reusedNames = new Set<string>()
  let rateLimitedCalls = 0

  const refreshMeta = async (e: PluginEntry): Promise<PluginEntry> => {
    const { pk } = await fetchPackument(e.name, { fetchFn: f })
    const repoMetaRes = e.source.repo
      ? await fetchRepoMeta(e.source.repo, { token: opts.ghToken, fetchFn: f })
      : null
    if (repoMetaRes?.status === 'rate-limited') rateLimitedCalls++
    const downloads = await fetchDownloads30d(e.name, { fetchFn: f })
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
      metrics: {
        stars: repoMetaRes?.meta?.stars ?? e.metrics.stars,
        npmDownloads30d: downloads ?? e.metrics.npmDownloads30d,
        checkedAt: now,
      },
      // refresh repoId so repojacking detection works on reused entries too
      ...(repoMetaRes?.meta?.id ? { source: { ...e.source, repoId: repoMetaRes.meta.id } } : {}),
    }
  }

  const worker = async (cand: (typeof admitted)[number]) => {
    try {
      const prev = oldByName.get(cand.name)
      // incremental short-circuit: same version + same ruleset → reuse wholesale.
      // Under hold-by-default the candidate to compare is the HELD version —
      // a held bump already carries that version's scan in pendingUpdate.
      if (prev && cand.version && cand.version === (prev.pendingUpdate?.version ?? prev.latestVersion)
          && (prev.pendingUpdate?.capabilities.rulesetVersion ?? prev.capabilities.rulesetVersion) === RULESET_VERSION
          && !isBlocked(cand.name)) {
        const stale = Date.parse(now) - Date.parse(prev.metrics.checkedAt) > METRICS_STALE_MS
        entries.push(stale ? await refreshMeta(prev) : prev)
        reusedNames.add(cand.name)
        return
      }

      const { pk, status: pkStatus } = await fetchPackument(cand.name, { fetchFn: f })
      if (!pk) {
        // transient failure ≠ disappearance — keep the old entry rather than
        // letting the candidate vanish into gone-check (which would double-fetch)
        if (pkStatus === 'error' && prev && !isBlocked(prev.name)) {
          entries.push(prev)
          reusedNames.add(prev.name)
        } else if (pkStatus === 'error' && seedNames.has(cand.name)) {
          console.warn(`submission ${cand.name}: packument fetch failed (transient) — skipped this run`)
        }
        return
      }
      const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports, readme: pk.readme ?? undefined })
      if (!ev.ok) return

      // packument.repository is authoritative; the submission-declared repo is
      // the fallback — and a disagreement between them is itself a signal.
      // (organic search repoUrl is the same packument field — comparing it
      // would only flag stale search indexes, so only submissions declare)
      const declaredRepo = cand.discoveredVia.includes('submission') ? normalizeRepoUrl(cand.repoUrl) : null
      const repo = normalizeRepoUrl(pk.repository) ?? declaredRepo
      const slug = slugOf({ repo: repo ?? undefined, npmName: cand.name })
      if (isBlocked(cand.name, slug)) return

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
          console.warn(`scan failed ${cand.name}:`, (e as Error).message)
        }
      }

      const repoMetaRes = repo ? await fetchRepoMeta(repo, { token: opts.ghToken, fetchFn: f }) : null
      if (repoMetaRes?.status === 'rate-limited') rateLimitedCalls++
      const repoMeta = repoMetaRes?.meta ?? null
      const downloads = await fetchDownloads30d(cand.name, { fetchFn: f })
      // one recursive tree call covers all path probes (was 2 contents HEAD calls)
      const treeRes = repo && repoMeta?.defaultBranch
        ? await fetchRepoTree(repo, repoMeta.defaultBranch, { token: opts.ghToken, fetchFn: f })
        : null
      if (treeRes?.status === 'rate-limited') rateLimitedCalls++
      const hasSkill = !!treeRes?.paths &&
        (treeRes.paths.has('SKILL.md') || [...treeRes.paths].some(p => p.startsWith('.opencode/skills')))
      if (treeRes?.paths && treeRes.truncated)
        console.warn(`repo tree truncated for ${repo} — deep .opencode/skills probes may miss`)
      const marketMeta = repo ? await fetchMarketMeta(repo, { token: opts.ghToken, fetchFn: f }) : null
      // npm↔repo correspondence: the repo's own package.json should name this
      // package. A positive mismatch (claiming an unrelated popular repo to
      // borrow its stars/trust) → finding; absence of evidence isn't proof.
      if (repo) {
        const dir = pk.repositoryDir ?? undefined
        const dirTraversal = !!dir && dir.split('/').some(s => s === '..' || s === '.')
        if (dirTraversal) scan.findings.push('sec:repo-dir-traversal')
        const { pkgName, status: pjStatus } = dirTraversal
          ? { pkgName: null, status: 'error' as const }
          : await fetchRepoPackageName(repo, { dir, fetchFn: f })
        if (pjStatus === 'ok' && pkgName && pkgName !== cand.name && pkgName !== cand.name.split('/').pop()) {
          scan.findings.push(`sec:repo-mismatch:${pkgName}`)
        }
      }
      if (declaredRepo && declaredRepo !== repo)
        scan.findings.push(`sec:repo-declared-mismatch:${declaredRepo}`)
      // author-claimed fields precedence: repo .opencode-market.json > issue submission > auto-derived
      const sub = seedMeta.get(cand.name)

      const entry: PluginEntry = {
        name: cand.name,
        slug,
        aliases: [],
        type: (sub?.type === 'skill' ? 'skill' : 'plugin'),
        ...(hasSkill ? { contains: ['skill' as const] } : {}),
        discoveredVia: cand.discoveredVia as PluginEntry['discoveredVia'],
        source: { kind: 'npm', id: cand.name, ...(repo ? { repo } : {}), ...(repoMeta?.id ? { repoId: repoMeta.id } : {}), ...(pk.latest ? { version: pk.latest } : {}) },
        description: {
          en: marketMeta?.description?.en ?? sub?.desc?.en ?? cand.description,
          ...(marketMeta?.description?.zh || sub?.desc?.zh ? { zh: marketMeta?.description?.zh ?? sub?.desc?.zh } : {}),
        },
        features: detectFeatures({ exports: pk.exports, main: pk.main, files: scanFiles }),
        category: marketMeta?.category ?? sub?.category ?? classify(cand.name, slug, cand.description ?? '', [...pk.keywords, ...(repoMeta?.topics ?? [])]),
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
        metrics: { stars: repoMeta?.stars ?? null, npmDownloads30d: downloads, checkedAt: now },
        capabilities: scan,
        verification: scan.redFlags.length > 0
          ? { status: 'skipped', level: 'install' }
          : { status: 'unverified' },
        compat: {},
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
          // described the previous candidate version, so reset it
          entry.approvalReason = 'awaiting-review'
        }
      }
      entries.push(entry)
      console.log(`  [${entries.length}] ${cand.name}`)
    } catch (e) {
      console.warn(`candidate ${cand.name} failed:`, (e as Error).message)
    }
  }
  const BATCH = 10
  for (let i = 0; i < queue.length; i += BATCH) {
    await Promise.all(queue.slice(i, i + BATCH).map(worker))
  }

  // 3b. github-topic candidates with no npm counterpart (D-1: ghList wiring).
  //     Search results already carry id/stars/createdAt/license/topics — no extra
  //     api.github.com calls needed here. fetchMarketMeta hits raw.githubusercontent
  //     (CDN, uncounted) so it stays free even under API quota exhaustion.
  const coveredRepos = new Set(entries.map(e => e.source.repo).filter(Boolean))
  const ghMissing = ghQueue.filter(c => !coveredRepos.has(c.fullName) && !isBlocked(c.fullName, c.fullName))
  for (let i = 0; i < ghMissing.length; i += BATCH) {
    const batch = await Promise.all(ghMissing.slice(i, i + BATCH).map(async (c) => {
      const mm = await fetchMarketMeta(c.fullName, { token: opts.ghToken, fetchFn: f })
      const ghPrev = oldByName.get(c.fullName)
      const entry: PluginEntry = {
        name: c.fullName,
        slug: c.fullName.toLowerCase(),
        aliases: [],
        type: 'plugin',
        discoveredVia: c.discoveredVia as PluginEntry['discoveredVia'],
        source: { kind: 'github', id: c.fullName, repo: c.fullName, ...(c.id ? { repoId: c.id } : {}) },
        description: { en: mm?.description?.en ?? c.description, ...(mm?.description?.zh ? { zh: mm.description.zh } : {}) },
        features: [],
        category: mm?.category ?? classify(c.fullName, c.fullName.toLowerCase(), c.description, c.topics),
        license: c.license,
        deprecated: false,
        deprecatedMessage: null,
        replacement: null,
        createdAt: c.createdAt,
        modifiedAt: null,
        maintainers: [],
        distTags: {},
        firstSeenAt: now,
        latestVersion: null,
        publishedAt: null,
        metrics: { stars: c.stars, npmDownloads30d: null, checkedAt: now },
        capabilities: { scannedAt: null, findings: [], redFlags: [] },
        // 'unverified', not 'skipped' — skipped means red flags blocked a run;
        // repo-only entries simply have no installable artifact yet (AGENTS §检验规则)
        verification: { status: 'unverified' },
        compat: {},
        approval: ghPrev?.approval ?? 'pending',
        ...(ghPrev?.approvalReason ? { approvalReason: ghPrev.approvalReason } : {}),
      }
      return entry
    }))
    entries.push(...batch)
  }
  if (rateLimitedCalls > 0) {
    console.warn(`github api rate-limited on ${rateLimitedCalls} call(s) — repoId/tree coverage partial; heals on subsequent runs`)
  }

  // 4. gone-check: old entries missing from fresh set — probe before tombstoning (F-2)
  const freshNames = new Set(entries.map(e => e.name))
  const removedNow: RemovedEntry[] = []
  const goneCheck = async (e: PluginEntry) => {
    let reason: RemovedEntry['reason'] = 'unknown'
    if (cappedOut.has(e.name)) reason = 'capped'
    else if (isBlocked(e.name, e.slug)) reason = 'manual'
    else if (e.source.kind === 'npm') {
      const { status } = await fetchPackument(e.name, { fetchFn: f })
      if (status === 'error') {
        // transient failure (429/5xx/network) is NOT proof of disappearance —
        // keep the stale entry rather than emitting a false tombstone (F-2).
        entries.push(e)
        return
      }
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
      reason = status === 'not-found' ? 'repo-404' : 'filtered'
    }
    removedNow.push({
      slug: e.slug, name: e.name, lastSource: e.source,
      disappearedAt: now, reason,
    })
  }
  const missing = (old?.plugins ?? []).filter(e => !freshNames.has(e.name))
  for (let i = 0; i < missing.length; i += BATCH) {
    await Promise.all(missing.slice(i, i + BATCH).map(goneCheck))
  }
  if (removedNow.length) {
    console.log(`removed: ${removedNow.length} (${removedNow.map(r => `${r.name}:${r.reason}`).join(', ')})`)
  }

  // 5. build index (merge + corruption gate)
  const { index, gate } = buildIndex(entries, old, {
    opencodeVersion: OPENCODE_VERSION, now, rulesetVersion: RULESET_VERSION, removed: removedNow,
  })
  if (!gate.ok) throw new Error(`publish gate: ${gate.reason}`)

  // 6. write
  const out = opts.outPath ?? 'dist/index.json'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(index, null, 2))
  console.log(`index.json: ${index.plugins.length} entries (${reusedNames.size} reused, ${removedNow.length} removed) → ${out}`)
  return index
}

// CLI entry (untestable in vitest — excluded from coverage)
/* v8 ignore next 11 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
  run({
    ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    outPath: arg('--out'),
    oldIndexPath: arg('--old'),
    seedPath: arg('--seed'),
    blocklistPath: arg('--blocklist'),
    ...(arg('--max') ? { maxEntries: Number(arg('--max')) } : {}),
    verdictsPath: arg('--verdicts'),
    digestStatePath: arg('--digest-state'),
  }).catch(e => { console.error(e); process.exit(1) })
}
