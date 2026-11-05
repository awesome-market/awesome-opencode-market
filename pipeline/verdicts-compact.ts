/** Compact ai-verdicts.jsonl — the append-only audit log grows forever and
 *  every consumer parses it whole (diagnose, digest, catalog run, docket).
 *  Each daily digest run invokes this before rendering, keeping the file
 *  bounded without a separate maintenance job.
 *
 *  Drop rule — a line is removed only when ALL of these hold:
 *    • it parses as a verdict (malformed lines are kept verbatim — we never
 *      delete what we can't understand);
 *    • source === 'ai' (human lines are the audit trail — always kept);
 *    • its `at` is older than the retention window;
 *    • it is NOT among the latest-comparing lines for its name@version key
 *      (a superseded AI line can never win latestVerdicts again).
 *
 *  Semantics preserved: latestVerdicts/latestHumanVerdicts reconstruct
 *  identically; digest announced akeys only ever reference latest lines
 *  (liveAkeys pruning), so maturity state is unaffected. The one deliberate
 *  degradation: sha-twin verdict reuse (latestShaVerdicts) for ancient
 *  same-bytes re-tags falls back to a fresh review — the conservative
 *  direction.
 *
 *  Usage: tsx pipeline/verdicts-compact.ts <ai-verdicts.jsonl> [--days N] [--dry] */
import { readFileSync, writeFileSync } from 'node:fs'
import { AiVerdict } from '../src/schema.ts'
import { vkey, atCmp } from './verdicts.ts'

interface Row { raw: string; v: AiVerdict | null }

function parseLine(raw: string): Row {
  try {
    const v = AiVerdict.parse(JSON.parse(raw))
    // same normalization as loadVerdicts — comparisons must see the
    // canonical instant, not the on-disk offset spelling
    if (!v.at.endsWith('Z')) v.at = new Date(v.at).toISOString()
    return { raw, v }
  } catch { return { raw, v: null } }
}

/** Keep/drop decision for one jsonl file. Returns the surviving raw lines
 *  (order preserved) plus the drop count. `now`/`days` are injectable for
 *  tests. */
export function compactLines(lines: string[], opts: { days?: number; now?: number } = {}): { lines: string[]; dropped: number } {
  const days = opts.days ?? 180
  const now = opts.now ?? Date.now()
  const rows = lines.map(l => l.trim()).filter(Boolean).map(parseLine)

  // latest-comparing `at` per key, mirroring latestVerdicts' fold (>= keeps
  // the last top line — we keep ALL lines tying at the top, a safe superset)
  const topAt = new Map<string, string>()
  for (const r of rows) {
    if (!r.v) continue
    const k = vkey(r.v.name, r.v.version)
    const cur = topAt.get(k)
    if (cur === undefined || atCmp(r.v.at, cur) >= 0) topAt.set(k, r.v.at)
  }

  const cutoff = now - days * 86_400_000
  let dropped = 0
  const out: string[] = []
  for (const r of rows) {
    const v = r.v
    const drop = v !== null && v.source === 'ai'
      && Date.parse(v.at) < cutoff
      && atCmp(v.at, topAt.get(vkey(v.name, v.version))!) < 0
    if (drop) { dropped++; continue }
    out.push(r.raw)
  }
  return { lines: out, dropped }
}

/* v8 ignore next 24 — thin CLI adapter */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const path = args.find(a => !a.startsWith('--'))
  const daysIdx = args.indexOf('--days')
  const days = daysIdx > -1 ? Number(args[daysIdx + 1]) : 180
  const dry = args.includes('--dry')
  if (!path || !Number.isFinite(days) || days <= 0)
    throw new Error('usage: verdicts-compact.ts <ai-verdicts.jsonl> [--days N] [--dry]')

  const raw = readFileSync(path, 'utf8').split('\n')
  const { lines, dropped } = compactLines(raw, { days })
  const total = raw.filter(l => l.trim()).length
  if (dropped === 0) {
    console.log(`[verdicts-compact] ${path}: ${total} lines, nothing to drop (window=${days}d)`)
  } else if (dry) {
    console.log(`[verdicts-compact] DRY: would drop ${dropped}/${total} superseded AI lines older than ${days}d`)
  } else {
    writeFileSync(path, lines.join('\n') + '\n')
    console.log(`[verdicts-compact] ${path}: dropped ${dropped}/${total} superseded AI lines older than ${days}d → ${lines.length} lines`)
  }
}
