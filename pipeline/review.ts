/** Submission review: package → markdown review report (scan findings, evidence, metrics). Human decides. */
import { fetchPackument, fetchTarball, fetchDownloads30d } from './fetch/npm.ts'
import { scanTarball } from './scan/scan.ts'
import { hasPluginEvidence } from './discover/filter.ts'

export interface Review {
  name: string
  exists: boolean
  evidence: string[]
  findings: string[]
  redFlags: string[]
  downloads30d: number | null
  repo: string | null
}

export async function reviewPackage(name: string, opts: { fetchFn?: typeof fetch } = {}): Promise<Review> {
  const pk = await fetchPackument(name, opts)
  if (!pk) return { name, exists: false, evidence: [], findings: [], redFlags: [], downloads30d: null, repo: null }
  const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports })
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
  }
}

/** Machine verdict driving the auto label/close in submit.yml. */
export function verdict(r: Review): 'clean' | 'flagged' | 'invalid' {
  if (!r.exists) return 'invalid'
  return r.redFlags.length ? 'flagged' : 'clean'
}

export function renderReview(r: Review): string {
  if (!r.exists) return `**${r.name}** — package not found on npm.\n\n<!-- verdict: invalid -->`
  const lines = [
    `**${r.name}** — found on npm${r.repo ? `, repo: ${r.repo}` : ''}`,
    `Evidence signals: ${r.evidence.length ? r.evidence.join(', ') : 'none'}`,
    `Downloads (30d): ${r.downloads30d ?? 'unknown'}`,
    '',
    r.redFlags.length ? `### ⚠️ Red flags (${r.redFlags.length})\n${r.redFlags.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.redFlags.length > 30 ? `\n- … +${r.redFlags.length - 30} more` : ''}` : '### Red flags: none',
    r.findings.length ? `\n### Findings (${r.findings.length})\n${r.findings.slice(0, 30).map(f => `- ${f}`).join('\n')}${r.findings.length > 30 ? `\n- … +${r.findings.length - 30} more (truncated)` : ''}` : '\n### Findings: none — this does not mean safe.',
  ]
  return `${lines.join('\n')}\n\n<!-- verdict: ${verdict(r)} -->`
}

/* v8 ignore next 4 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await reviewPackage(process.argv[2]!)
  console.log(renderReview(r))
}
