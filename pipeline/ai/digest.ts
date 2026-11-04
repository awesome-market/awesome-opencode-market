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
import { exit } from 'node:process'
import { join } from 'node:path'
import { CatalogIndex, AiVerdict } from '../../src/schema.ts'
import { loadVerdicts } from '../verdicts.ts'

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

  const escCell = (s: string) => s.replaceAll('|', '\\|')
  const reasonOf = (v: AiVerdict) => escCell(v.reason ?? '') + (v.reasonEn ? ` / ${escCell(v.reasonEn)}` : '')
  const repo = (process.env.MARKET_REPO_URL ?? 'https://github.com/terry2010/awesome-opencode-market').replace(/\/$/, '')
  const reviewLink = (v: AiVerdict) => {
    const q = encodeURIComponent(`is:issue in:title "[review] ${v.name}"`)
    return `[审核单](${repo}/issues?q=${q})`
  }
  const rows = (vs: AiVerdict[]) => vs.map(v =>
    `| ${v.name} | ${v.version ?? '—'} | ${v.source} | ${reasonOf(v)} | ${reviewLink(v)} |`).join('\n')
  const table = (vs: AiVerdict[]) =>
    `| 包 | 版本 | 来源 | 理由 | 审核 |\n|---|---|---|---|---|\n${rows(vs)}`
  return `# marketplace digest ${day}

> 本日报是**唯一完整的上架预告面**：下列 pass verdict 在本日报发布后进入成熟期（digest-appearance 门）。
> "no findings" ≠ safe.
> 📱 手机操作：点行的「审核单」链接开 issue → **Labels** 勾 \`verdict:pass\` 或 \`verdict:concern\` 即可写回裁决，零打字。

## ① 今日新放行（pass verdicts — ${passes.length}）

${passes.length ? table(passes) : '_无_'}

## ② 审核队列积压（held — ${held.length}）

${held.length ? held.map(e => `- \`${e.name}\` ${e.pendingUpdate ? `v${e.pendingUpdate.version}` : e.latestVersion === null ? '(repo-only — AI 不审，需人工)' : '(未发布过)'}`).join('\n') : '_空_'}

## ③ Concerns（${concerns.length}）

${concerns.length ? table(concerns) : '_无_'}

---
generated ${now.toISOString()}
`
}

export async function main(args: string[] = process.argv): Promise<void> {
  const arg = (k: string) => args[args.indexOf(k) + 1]
  const [idxPath, verdictsPath, statePath, outDir] = ['--index', '--verdicts', '--state', '--out-dir'].map(arg)
  const dry = args.includes('--dry')
  const now = args.includes('--date') ? new Date(`${arg('--date')}T21:00:00Z`) : new Date()
  if (!idxPath || !verdictsPath || !statePath || !outDir)
    exit('usage: --index <p> --verdicts <p> --state <p> --out-dir <d> [--date YYYY-MM-DD] [--dry]')

  const index = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  // tolerant parse — one malformed line must not kill the whole daily digest
  // (the digest is the maturity anchor; a crash freezes every pass verdict)
  const verdicts = loadVerdicts(verdictsPath)
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

/* v8 ignore next 4 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(x => { console.error(x); exit(1) })
}
