/** One-off: populate `call` on already-judged flag-context records whose
 *  flagged line is an import/require declaration. Mechanical — refetches the
 *  source file, runs findCallSite, appends an updated record to the spool.
 *  Usage: MARKET_PROXY=… npx tsx scripts/backfill-callsite.mts <index.json> <contexts.jsonl> <out-spool.jsonl> */
import { appendFileSync, readFileSync } from 'node:fs'
import { loadFlagContexts, latestFlagContexts, findCallSite, contextUrl } from '../pipeline/ai/flag-context.ts'
import { installMarketProxy } from '../pipeline/net.ts'
import type { CatalogIndex } from '../src/schema.ts'

installMarketProxy()
const [idxPath, ctxPath, outPath] = process.argv.slice(2)
if (!idxPath || !ctxPath || !outPath) { console.error('usage: backfill-callsite.mts <index> <contexts> <out>'); process.exit(1) }
const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as CatalogIndex
const byName = new Map(idx.plugins.map(p => [p.name.toLowerCase(), p]))
const latest = latestFlagContexts(loadFlagContexts(ctxPath))
const DECL = /^\s*(import|export|const|let|var)\b/
let queued = 0, done = 0, wrote = 0
const targets = [...latest.values()].filter(c => c.ai && !c.call)
console.log(`[backfill] ${targets.length} judged records to inspect`)
for (const c of targets) {
  const e = byName.get(c.name.toLowerCase()); if (!e) continue
  const url = contextUrl(e, c.path); if (!url) continue
  queued++
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) continue
    const text = await res.text()
    const flagged = text.split('\n')[c.line - 1]
    if (!flagged || !DECL.test(flagged)) { done++; continue }
    const call = findCallSite(text, flagged)
    done++
    if (!call) continue
    appendFileSync(outPath, JSON.stringify({ ...c, call, at: new Date().toISOString() }) + '\n')
    wrote++
    if (wrote % 25 === 0) console.log(`[backfill] ${wrote} calls captured (${done}/${queued})`)
  } catch { /* skip */ }
}
console.log(`[backfill] done — ${wrote} call-sites appended (${done} files checked)`)
