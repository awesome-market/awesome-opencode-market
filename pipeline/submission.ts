/** Parse a submission issue body → structured fields.
 *  Issue forms render `### <label>\n\n<value>` sections; freeform issues fall
 *  back to the legacy first-package-like-token extraction. */
export interface Submission {
  name: string | null             // npm package name (may be null for repo-only skills)
  repo: string | null             // owner/repo
  descEn: string | null
  descOther: Record<string, string>  // { zh: '...', ja: '...' }
  type: 'plugin' | 'skill' | null
  category: string | null         // author-claimed; null = let pipeline classify
}

const NO_RESPONSE = /^\s*_?no response_?\s*$/i

function sections(body: string): Map<string, string> {
  const map = new Map<string, string>()
  const parts = body.split(/^###\s+/m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    if (nl < 0) continue
    const label = p.slice(0, nl).trim()
    const value = p.slice(nl + 1).trim()
    if (value && !NO_RESPONSE.test(value)) map.set(label, value)
  }
  return map
}

function field(map: Map<string, string>, ...labels: string[]): string | null {
  for (const l of labels) {
    const v = map.get(l)
    if (v) return v.split('\n')[0]!.trim()
  }
  return null
}

const PKG_RE = /^(@[a-z0-9-]+\/)?[a-z0-9-_.]+$/i
const LANG_LINE = /^([a-z]{2,3}(?:-[A-Za-z]{2,8})?)\s*[:：]\s*(.+)$/

export function parseSubmission(body: string): Submission {
  const map = sections(body)
  let name = field(map, 'npm 包名', 'package', 'npm package', '包名')
  if (name && !PKG_RE.test(name)) name = null
  // freeform fallback: first package-like token in the body
  if (!name) {
    for (const tok of body.split(/\s+/)) {
      const m = tok.match(/^(@[a-z0-9-]+\/)?[a-z0-9-_.]+/i)
      const t = m?.[0]
      if (t && PKG_RE.test(t) && (t.includes('-') || t.includes('/') || t.startsWith('@'))) {
        name = t
        break
      }
    }
  }
  const repoRaw = field(map, 'GitHub 仓库地址', 'repo', 'repository', 'github', '仓库')
  const repoM = repoRaw?.match(/github\.com\/([^/\s]+\/[^/\s?#]+)/) ?? body.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)
  const repo = repoM ? repoM[1]!.replace(/\.git$/, '').replace(/\/$/, '') : null

  const descEn = field(map, '英文描述', 'english description', 'description (en)') ?? null
  const descOtherRaw = map.get('其他语言描述（可选）') ?? map.get('other languages') ?? ''
  const descOther: Record<string, string> = {}
  for (const line of descOtherRaw.split('\n')) {
    const m = line.trim().match(LANG_LINE)
    if (m) descOther[m[1]!.toLowerCase()] = m[2]!.trim()
  }

  const typeRaw = (field(map, '类型', 'type') ?? '').toLowerCase()
  const type: Submission['type'] = typeRaw.startsWith('skill') ? 'skill' : typeRaw.startsWith('plugin') ? 'plugin' : null

  const catRaw = field(map, '分类', 'category')
  const category = catRaw && !catRaw.startsWith('自动') ? catRaw : null

  return { name, repo, descEn, descOther, type, category }
}

/** One-line JSONL for catalog-branch submissions.txt (consumed by run.ts --seed). */
export function seedLine(s: Submission, issue: number): string {
  return JSON.stringify({
    name: s.name,
    repo: s.repo,
    type: s.type,
    category: s.category ? [s.category] : null,
    desc: { en: s.descEn, ...s.descOther },
    issue,
    notified: false,
  })
}

// CLI: ISSUE_BODY=<body> npx tsx pipeline/submission.ts          → JSON fields
//      ISSUE_BODY=<body> npx tsx pipeline/submission.ts --seedline <issue#> → JSONL
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = parseSubmission(process.env.ISSUE_BODY ?? '')
  const i = process.argv.indexOf('--seedline')
  console.log(i > 0 ? seedLine(s, Number(process.argv[i + 1])) : JSON.stringify(s))
}
