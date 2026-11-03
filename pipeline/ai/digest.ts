/** publish-digest — daily advance-notice surface + digest-state.json.
 *
 *  The digest is the ONLY complete announcement surface: every pass verdict
 *  (ai AND human) must appear in a digest before it can mature
 *  (verdict.at ≤ lastDigestAt). Writes digest/YYYY-MM-DD.md + digest-state.json
 *  on the catalog branch. Missing digest-state → lastDigestAt = -∞ → all
 *  releases frozen (fail-closed bootstrap).
 *
 *  Usage:
 *    tsx pipeline/ai/digest.ts --index index.json --verdicts ai-verdicts.jsonl \
 *      --state digest-state.json --out-dir . [--date YYYY-MM-DD] [--dry] */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { argv, exit } from 'node:process'
import { join } from 'node:path'
import { CatalogIndex, AiVerdict } from '../../src/schema.ts'

export interface DigestInput {
  index: CatalogIndex
  verdicts: AiVerdict[]
  lastDigestAt: string | null
  now: Date
}

export function renderDigest({ index, verdicts, lastDigestAt, now }: DigestInput): string {
  const day = now.toISOString().slice(0, 10)
  const prev = lastDigestAt ?? '1970-01-01T00:00:00.000Z'
  const fresh = verdicts.filter(v => v.at > prev && v.at <= now.toISOString())
  const passes = fresh.filter(v => v.verdict === 'pass')
  const concerns = fresh.filter(v => v.verdict === 'concern')
  const held = index.plugins.filter(e => e.approval === 'pending' || e.pendingUpdate)

  const rows = (vs: AiVerdict[]) => vs.map(v =>
    `| ${v.name} | ${v.version ?? '—'} | ${v.source} | ${(v.reason ?? '').replaceAll('|', '\\|')} |`).join('\n')
  return `# marketplace digest ${day}

> 本日报是**唯一完整的上架预告面**：下列 pass verdict 在本日报发布后进入成熟期（digest-appearance 门）。
> "no findings" ≠ safe.

## ① 今日新放行（pass verdicts — ${passes.length}）

${passes.length ? `| 包 | 版本 | 来源 | 理由 |\n|---|---|---|---|\n${rows(passes)}` : '_无_'}

## ② 审核队列积压（held — ${held.length}）

${held.length ? held.map(e => `- \`${e.name}\` ${e.pendingUpdate ? `v${e.pendingUpdate.version}` : '(未发布过)'}`).join('\n') : '_空_'}

## ③ Concerns（${concerns.length}）

${concerns.length ? `| 包 | 版本 | 来源 | 理由 |\n|---|---|---|---|\n${rows(concerns)}` : '_无_'}

---
generated ${now.toISOString()}
`
}

async function main(): Promise<void> {
  const arg = (k: string) => argv[argv.indexOf(k) + 1]
  const [idxPath, verdictsPath, statePath, outDir] = ['--index', '--verdicts', '--state', '--out-dir'].map(arg)
  const dry = argv.includes('--dry')
  const now = argv.includes('--date') ? new Date(`${arg('--date')}T21:00:00Z`) : new Date()
  if (!idxPath || !verdictsPath || !statePath || !outDir)
    exit('usage: --index <p> --verdicts <p> --state <p> --out-dir <d> [--date YYYY-MM-DD] [--dry]')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  const verdicts = readFileSync(verdictsPath, 'utf8').split('\n').filter(Boolean)
    .map(l => AiVerdict.parse(JSON.parse(l)))
  const lastDigestAt = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as { lastDigestAt?: string }).lastDigestAt ?? null
    : null

  const md = renderDigest({ index, verdicts, lastDigestAt, now })
  const day = now.toISOString().slice(0, 10)
  const digestPath = join(outDir, 'digest', `${day}.md`)
  if (dry) { console.log(md); console.log(`[digest] lastDigestAt ${lastDigestAt ?? '∅'} → ${now.toISOString()}`); return }
  mkdirSync(join(outDir, 'digest'), { recursive: true })
  writeFileSync(digestPath, md)
  writeFileSync(statePath, JSON.stringify({ lastDigestAt: now.toISOString() }, null, 2))
  console.log(`[digest] wrote ${digestPath}; lastDigestAt=${now.toISOString()}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(x => { console.error(x); exit(1) })
}
