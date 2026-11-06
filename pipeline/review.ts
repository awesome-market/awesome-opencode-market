/** Submission review: package/repo → markdown review report (scan findings, evidence, metrics). Human decides. */
import { fetchPackument, fetchTarball, fetchDownloads30d } from './fetch/npm.ts'
import { fetchRepoMeta, fetchRepoTree, fetchRepoPackage, type RepoMetaStatus } from './fetch/github.ts'
import { scanTarball } from './scan/scan.ts'
import { hasPluginEvidence, hasRepoEvidence } from './discover/filter.ts'

/** Fetch outcome — 'error'/'rate-limited' are TRANSIENT (registry/API hiccup),
 *  never a verdict on the submission itself. Collapsing them into not-found
 *  produced false `invalid` labels during routine npm/GitHub flakiness. */
export type FetchStatus = 'ok' | 'not-found' | 'error' | 'rate-limited'

export interface Review {
  name: string
  exists: boolean               // confirmed present — false also covers "unknown" (error)
  status: FetchStatus           // packument fetch outcome
  evidenceOk: boolean           // hasPluginEvidence.ok — the SAME gate the catalog applies
  evidence: string[]            // via list for display (empty when the gate fails)
  scanned: boolean              // the tarball scan actually ran — false ≠ "no findings"
  scanError: string | null      // why the scan did not run/failed
  findings: string[]
  redFlags: string[]
  downloads30d: number | null
  repo: string | null
  createdAt: string | null        // packument time.created — name-squat heuristics
  version: string | null          // the version the tarball scan covered — a human
  integrity: string | null        // pass must land on THIS version, not whatever
}                                 // dist-tags.latest resolves to at click time

export async function reviewPackage(name: string, opts: { fetchFn?: typeof fetch } = {}): Promise<Review> {
  const base = { name, exists: false, evidenceOk: false, evidence: [] as string[], scanned: false, scanError: null as string | null, findings: [] as string[], redFlags: [] as string[], downloads30d: null as number | null, repo: null as string | null, createdAt: null as string | null, version: null as string | null, integrity: null as string | null }
  const { pk, status } = await fetchPackument(name, opts)
  if (!pk) return { ...base, status: status === 'not-found' ? 'not-found' : 'error' }
  const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports, readme: pk.readme ?? undefined })
  let findings: string[] = [], redFlags: string[] = []
  let scanned = false, scanError: string | null = null
  if (pk.tarballUrl) {
    try {
      const r = await scanTarball(await fetchTarball(pk.tarballUrl, opts))
      scanned = true
      findings = r.findings.map(f => `${f.rule}: ${f.file} — ${f.detail}`)
      redFlags = r.redFlags.map(f => `${f.rule}: ${f.file}`)
    } catch (e) {
      // scan failure is NOT "no findings" — surface it so the report can say so
      scanError = (e as Error).message
    }
  } else {
    scanError = 'no tarball for the reviewed version'
  }
  return {
    ...base,
    exists: true, status: 'ok', evidenceOk: ev.ok, evidence: ev.via,
    scanned, scanError, findings, redFlags,
    downloads30d: await fetchDownloads30d(name, opts),
    repo: pk.repository,
    createdAt: pk.createdAt,
    version: pk.latest,
    integrity: pk.latest ? pk.integrityOf[pk.latest] ?? null : null,
  }
}

/** Repo-only submissions get the same evidence gate + codeload scan the
 *  catalog's github-kind admission applies — the review predicts what the
 *  pipeline will do, never rubber-stamps on zero evidence. */
export interface RepoReview {
  repo: string
  exists: boolean
  status: FetchStatus            // repo-meta fetch outcome
  treeStatus: RepoMetaStatus | null  // tree fetch outcome — a transient tree
                                   // failure must not masquerade as "no evidence"
  evidenceOk: boolean
  evidence: string[]
  scanned: boolean
  scanError: string | null
  findings: string[]
  redFlags: string[]
  resolvedSha: string | null          // commit the HEAD ref resolved to — identity of the scanned bytes
  createdAt: string | null        // repo created_at — repojack mirror of the npm guard
  stars: number | null
  pkgName: string | null          // repo's own package.json name — npm↔repo audit link
  truncated: boolean
  /** catalog rejects archived repos and forks regardless of evidence — the
   *  review must say so up front instead of letting a clean scan sail into a
   *  seed row that admission then refuses ('archived'/'archived-or-fork') */
  archived?: boolean
  fork?: boolean
}

export async function reviewRepo(repo: string, opts: { token?: string | undefined; fetchFn?: typeof fetch } = {}): Promise<RepoReview> {
  const base = { repo, exists: false, treeStatus: null as RepoMetaStatus | null, evidenceOk: false, evidence: [] as string[], scanned: false, scanError: null as string | null, findings: [] as string[], redFlags: [] as string[], resolvedSha: null as string | null, createdAt: null as string | null, stars: null as number | null, pkgName: null as string | null, truncated: false, archived: false, fork: false }
  const { meta, status } = await fetchRepoMeta(repo, opts)
  if (status === 'not-found' || !meta) return { ...base, status }
  const tree = await fetchRepoTree(repo, 'HEAD', opts)
  const ev = hasRepoEvidence(tree.paths ?? new Set(), meta.topics)
  let findings: string[] = [], redFlags: string[] = []
  let scanned = false, scanError: string | null = null
  if (ev.ok) {
    try {
      // fetch the tarball by the RESOLVED commit sha, not HEAD — the tree call
      // above already resolved HEAD→sha; a second HEAD resolution here races a
      // push and would scan bytes different from the recorded anchor
      const tgz = await fetchTarball(`https://codeload.github.com/${repo}/tar.gz/${tree.sha ?? 'HEAD'}`, opts)
      const r = await scanTarball(tgz)
      scanned = true
      const strip = (p: string) => p.replace(/^[^/]+\//, '')   // owner-repo-sha/ wrapper
      findings = r.findings.map(f => `${f.rule}: ${strip(f.file)} — ${f.detail}`)
      redFlags = r.redFlags.map(f => `${f.rule}: ${strip(f.file)}`)
    } catch (e) {
      scanError = (e as Error).message
    }
  }
  const repoPkg = await fetchRepoPackage(repo, opts)
  return {
    ...base,
    exists: true, status: 'ok', treeStatus: tree.status,
    evidenceOk: ev.ok, evidence: ev.ok ? ev.via : [],
    scanned, scanError, findings, redFlags,
    resolvedSha: tree.sha ?? null, createdAt: meta.createdAt, stars: meta.stars,
    pkgName: typeof repoPkg.pkg?.name === 'string' ? repoPkg.pkg.name : null,
    truncated: tree.truncated,
    archived: meta.archived, fork: meta.fork,
  }
}

/** Machine verdict driving the auto label/close in submit.yml.
 *  'error' = transient infra failure — retry-able, never a judgment on the
 *  submission. 'flagged' covers red flags AND scan failure (findings unknown
 *  is not "clean"). */
export function verdict(r: Pick<Review, 'exists' | 'status' | 'evidenceOk' | 'scanned' | 'redFlags'>): 'clean' | 'flagged' | 'invalid' | 'error' {
  if (r.status === 'error' || r.status === 'rate-limited') return 'error'
  if (!r.exists) return 'invalid'
  // the catalog's own gate — keyword-without-artifact must not auto-approve
  // into submissions.txt only to be rejected at ingest (F-7)
  if (!r.evidenceOk) return 'invalid'
  if (!r.scanned || r.redFlags.length) return 'flagged'
  return 'clean'
}

/** Repo verdict mirrors the catalog's github-kind admission: opencode-specific
 *  tree evidence required, red flags escalate to human. */
export function repoVerdict(r: Pick<RepoReview, 'exists' | 'status' | 'treeStatus' | 'evidenceOk' | 'scanned' | 'redFlags' | 'archived' | 'fork'>): 'clean' | 'flagged' | 'invalid' | 'error' {
  if (r.status === 'error' || r.status === 'rate-limited') return 'error'
  if (r.treeStatus === 'error' || r.treeStatus === 'rate-limited') return 'error'
  if (!r.exists) return 'invalid'
  // admission rejects archived/fork upstream of evidence — same verdict as a
  // missing artifact: it will never be listed as submitted
  if (r.archived || r.fork) return 'invalid'
  if (!r.evidenceOk) return 'invalid'
  if (!r.scanned || r.redFlags.length) return 'flagged'
  return 'clean'
}

const fold = (title: string, items: string[], limit = 30): string =>
  items.length
    ? `<details><summary>${title} (${items.length})</summary>\n\n${items.slice(0, limit).map(f => `- ${f}`).join('\n')}${items.length > limit ? `\n- … +${items.length - limit} more` : ''}\n\n</details>`
    : `${title}: none`

const scanLine = (scanned: boolean, scanError: string | null, findings: number, redFlags: number): string =>
  scanned
    ? `Scan: completed — findings ${findings}, redFlags ${redFlags}`
    : scanError
      ? `Scan: FAILED — ${scanError} — findings 未知，这不等于安全`
      : 'Scan: not run'

export function renderReview(r: Review): string {
  // `target` marker: which package THIS report reviewed. submit.yml's
  // edited-skip copies prior markers only when the last review's target still
  // matches the current parse — without it an A→B→A title/body ping-pong can
  // donate B's reviewedVersion/sha to A.
  const markers = `\n\n<!-- createdAt: ${r.createdAt ?? 'null'} -->\n<!-- reviewedVersion: ${r.version ?? 'null'} -->\n<!-- target: ${r.name} -->\n<!-- verdict: ${verdict(r)} -->`
  if (r.status === 'error' || r.status === 'rate-limited')
    return `**${r.name}** — 审查失败：npm registry 暂时不可用（${r.status}）。这不是投稿内容的问题——请稍后在本 issue 回复任意评论即可重新审查。${markers}`
  if (!r.exists) return `**${r.name}** — package not found on npm.${markers}`
  const lines = [
    `**${r.name}** — found on npm${r.repo ? `, repo: ${r.repo}` : ''}`,
    `Reviewed: ${r.name}@${r.version ?? 'unknown'}${r.integrity ? ` (\`${r.integrity}\`)` : ''}`,
    `Evidence signals: ${r.evidence.length ? r.evidence.join(', ') : 'none'}`,
    `Downloads (30d): ${r.downloads30d ?? 'unknown'}`,
    scanLine(r.scanned, r.scanError, r.findings.length, r.redFlags.length),
    !r.evidenceOk
      ? `### ⚠️ 证据不足\n仅有 ${r.evidence.join(', ') || 'none'} 个信号——缺少可安装产物证据（\`main\`/\`exports\` 或安装说明）。目录收录端同样会拒收，请确认这是 OpenCode 插件/技能。`
      : '',
    r.redFlags.length ? `### ⚠️ Red flags (${r.redFlags.length})\n${r.redFlags.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.redFlags.length > 30 ? `\n- … +${r.redFlags.length - 30} more` : ''}` : '### Red flags: none',
    r.scanned && r.findings.length ? fold('### Findings', r.findings) : (r.scanned ? '### Findings: none — this does not mean safe.' : ''),
  ]
  return `${lines.filter(Boolean).join('\n\n')}${markers}`
}

export function renderRepoReview(r: RepoReview): string {
  const markers = `\n\n<!-- createdAt: ${r.createdAt ?? 'null'} -->\n<!-- repoSha: ${r.resolvedSha ?? 'null'} -->\n<!-- repoPkg: ${r.pkgName ?? 'null'} -->\n<!-- target: ${r.repo} -->\n<!-- verdict: ${repoVerdict(r)} -->`
  const apiDown = r.status === 'error' || r.status === 'rate-limited' || r.treeStatus === 'error' || r.treeStatus === 'rate-limited'
  if (apiDown)
    return `**${r.repo}** — 审查失败：GitHub API 暂时不可用（${r.status === 'ok' ? r.treeStatus : r.status}）。这不是投稿内容的问题——请稍后在本 issue 回复任意评论即可重新审查。${markers}`
  if (!r.exists) return `**${r.repo}** — repository not found on GitHub.${markers}`
  const lines = [
    `**${r.repo}** — GitHub 仓库${r.stars != null ? ` (${r.stars}★)` : ''}${r.pkgName ? `, package.json: \`${r.pkgName}\`` : ''}`,
    `Scanned commit: \`${r.resolvedSha ?? 'unknown'}\`${r.truncated ? ' (tree listing truncated — 深层路径可能漏检)' : ''}`,
    scanLine(r.scanned, r.scanError, r.findings.length, r.redFlags.length),
    `Evidence signals: ${r.evidence.length ? r.evidence.join(', ') : 'none'}`,
    r.archived
      ? `### ⚠️ 仓库已归档\n目录只收仍在维护的项目——归档仓库即使证据齐全也会在收录端被拒。如需收录请先解除归档，或以仍在维护的继任仓库重新投稿。`
      : '',
    r.fork
      ? `### ⚠️ 该仓库是 fork\n目录只收仍在维护的主仓库——fork 继承了上游全部代码与证据，无法证明自身是可独立维护的项目。请改投上游主仓库；若 fork 已是独立项目请先脱离 fork 关系。`
      : '',
    !r.evidenceOk && !r.archived && !r.fork
      ? `### ⚠️ 证据不足\n缺少 opencode 专属信号（\`.opencode/\` 目录、\`opencode.json\` 或 \`opencode-*\` topic）——目录收录端同样会被证据门拒收，请确认这是 OpenCode 插件/技能仓库。`
      : '',
    r.redFlags.length ? `### ⚠️ Red flags (${r.redFlags.length})\n${r.redFlags.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.redFlags.length > 30 ? `\n- … +${r.redFlags.length - 30} more` : ''}` : '### Red flags: none',
    r.scanned && r.findings.length ? fold('### Findings', r.findings) : (r.scanned ? '### Findings: none — this does not mean safe.' : ''),
  ]
  return `${lines.filter(Boolean).join('\n\n')}${markers}`
}

/* v8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv
  if (argv[2] === '--repo') console.log(renderRepoReview(await reviewRepo(argv[3]!, { token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN })))
  else console.log(renderReview(await reviewPackage(argv[2]!)))
}
