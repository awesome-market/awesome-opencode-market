/** Submission review: package/repo → markdown review report (scan findings, evidence, metrics). Human decides. */
import { fetchPackument, fetchTarball, fetchDownloads30d } from './fetch/npm.ts'
import { fetchRepoMeta, fetchRepoTree } from './fetch/github.ts'
import { scanTarball } from './scan/scan.ts'
import { hasPluginEvidence, hasRepoEvidence } from './discover/filter.ts'

export interface Review {
  name: string
  exists: boolean
  evidence: string[]
  findings: string[]
  redFlags: string[]
  downloads30d: number | null
  repo: string | null
  createdAt: string | null        // packument time.created — name-squat heuristics
  version: string | null          // the version the tarball scan covered — a human
  integrity: string | null        // pass must land on THIS version, not whatever
}                                 // dist-tags.latest resolves to at click time

export async function reviewPackage(name: string, opts: { fetchFn?: typeof fetch } = {}): Promise<Review> {
  const { pk } = await fetchPackument(name, opts)
  if (!pk) return { name, exists: false, evidence: [], findings: [], redFlags: [], downloads30d: null, repo: null, createdAt: null, version: null, integrity: null }
  const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports, readme: pk.readme ?? undefined })
  let findings: string[] = [], redFlags: string[] = []
  if (pk.tarballUrl) {
    try {
      const r = await scanTarball(await fetchTarball(pk.tarballUrl, opts))
      findings = r.findings.map(f => `${f.rule}: ${f.file} — ${f.detail}`)
      redFlags = r.redFlags.map(f => `${f.rule}: ${f.file}`)
    } catch { /* scan failure reported as empty findings honestly below */ }
  }
  return {
    name, exists: true, evidence: ev.via, findings, redFlags,
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
  evidence: string[]
  findings: string[]
  redFlags: string[]
  treeSha: string | null          // content identity of the scanned tree
  createdAt: string | null        // repo created_at — repojack mirror of the npm guard
  stars: number | null
  truncated: boolean
}

export async function reviewRepo(repo: string, opts: { token?: string | undefined; fetchFn?: typeof fetch } = {}): Promise<RepoReview> {
  const { meta, status } = await fetchRepoMeta(repo, opts)
  if (status === 'not-found' || !meta) {
    return { repo, exists: false, evidence: [], findings: [], redFlags: [], treeSha: null, createdAt: null, stars: null, truncated: false }
  }
  const tree = await fetchRepoTree(repo, 'HEAD', opts)
  const ev = hasRepoEvidence(tree.paths ?? new Set(), meta.topics)
  let findings: string[] = [], redFlags: string[] = []
  if (ev.ok) {
    try {
      const tgz = await fetchTarball(`https://codeload.github.com/${repo}/tar.gz/HEAD`, opts)
      const r = await scanTarball(tgz)
      const strip = (p: string) => p.replace(/^[^/]+\//, '')   // owner-repo-sha/ wrapper
      findings = r.findings.map(f => `${f.rule}: ${strip(f.file)} — ${f.detail}`)
      redFlags = r.redFlags.map(f => `${f.rule}: ${strip(f.file)}`)
    } catch { /* scan failure reported as empty findings honestly below */ }
  }
  return {
    repo, exists: true, evidence: ev.ok ? ev.via : [], findings, redFlags,
    treeSha: tree.sha ?? null, createdAt: meta.createdAt, stars: meta.stars,
    truncated: tree.truncated,
  }
}

/** Machine verdict driving the auto label/close in submit.yml. */
export function verdict(r: Pick<Review, 'exists' | 'evidence' | 'redFlags'>): 'clean' | 'flagged' | 'invalid' {
  if (!r.exists) return 'invalid'
  // an opencode-specific evidence signal is required — otherwise any npm
  // package with a main/exports would auto-approve into submissions.txt
  if (!r.evidence.some(v => v === 'keyword' || v === 'readme-install')) return 'invalid'
  return r.redFlags.length ? 'flagged' : 'clean'
}

/** Repo verdict mirrors the catalog's github-kind admission: opencode-specific
 *  tree evidence required, red flags escalate to human. */
export function repoVerdict(r: Pick<RepoReview, 'exists' | 'evidence' | 'redFlags'>): 'clean' | 'flagged' | 'invalid' {
  if (!r.exists) return 'invalid'
  if (r.evidence.length === 0) return 'invalid'
  return r.redFlags.length ? 'flagged' : 'clean'
}

const fold = (title: string, items: string[], limit = 30): string =>
  items.length
    ? `<details><summary>${title} (${items.length})</summary>\n\n${items.slice(0, limit).map(f => `- ${f}`).join('\n')}${items.length > limit ? `\n- … +${items.length - limit} more` : ''}\n\n</details>`
    : `${title}: none`

export function renderReview(r: Review): string {
  if (!r.exists) return `**${r.name}** — package not found on npm.\n\n<!-- verdict: invalid -->`
  const lines = [
    `**${r.name}** — found on npm${r.repo ? `, repo: ${r.repo}` : ''}`,
    `Reviewed: ${r.name}@${r.version ?? 'unknown'}${r.integrity ? ` (\`${r.integrity}\`)` : ''}`,
    `Evidence signals: ${r.evidence.length ? r.evidence.join(', ') : 'none'}`,
    `Downloads (30d): ${r.downloads30d ?? 'unknown'}`,
    '',
    r.redFlags.length ? `### ⚠️ Red flags (${r.redFlags.length})\n${r.redFlags.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.redFlags.length > 30 ? `\n- … +${r.redFlags.length - 30} more` : ''}` : '### Red flags: none',
    r.findings.length ? `\n${fold('### Findings', r.findings)}` : '\n### Findings: none — this does not mean safe.',
  ]
  // markers go LAST — report body above contains package-controlled text
  // (repo url, filenames, matched code), so consumers must take the LAST
  // 'verdict:'/'createdAt:' occurrence, never the first.
  return `${lines.join('\n')}\n\n<!-- createdAt: ${r.createdAt ?? 'null'} -->\n<!-- reviewedVersion: ${r.version ?? 'null'} -->\n<!-- verdict: ${verdict(r)} -->`
}

export function renderRepoReview(r: RepoReview): string {
  if (!r.exists) return `**${r.repo}** — repository not found on GitHub.\n\n<!-- verdict: invalid -->`
  const lines = [
    `**${r.repo}** — GitHub 仓库${r.stars != null ? ` (${r.stars}★)` : ''}`,
    `Scanned tree: \`${r.treeSha ?? 'unknown'}\`${r.truncated ? ' (truncated — 深层路径可能漏检)' : ''}`,
    `Evidence signals: ${r.evidence.length ? r.evidence.join(', ') : 'none — 缺少 opencode 专属信号（.opencode/ 目录、opencode.json 或 opencode-* topic），目录端同样会被证据门拒收'}`,
    '',
    r.redFlags.length ? `### ⚠️ Red flags (${r.redFlags.length})\n${r.redFlags.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.redFlags.length > 30 ? `\n- … +${r.redFlags.length - 30} more` : ''}` : '### Red flags: none',
    r.findings.length ? `\n${fold('### Findings', r.findings)}` : '\n### Findings: none — this does not mean safe.',
  ]
  return `${lines.join('\n')}\n\n<!-- createdAt: ${r.createdAt ?? 'null'} -->\n<!-- repoSha: ${r.treeSha ?? 'null'} -->\n<!-- verdict: ${repoVerdict(r)} -->`
}

/* v8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv
  if (argv[2] === '--repo') console.log(renderRepoReview(await reviewRepo(argv[3]!, { token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN })))
  else console.log(renderReview(await reviewPackage(argv[2]!)))
}
