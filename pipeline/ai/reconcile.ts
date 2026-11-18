/** reconcile.ts — close the gap between the two judge layers.
 *
 *  The version-level judge (diagnose) writes one verdict per slot; the
 *  line-level judge (flag-context) writes one pre-read per flagged line.
 *  They never see each other — so a package can hold a version 'concern'
 *  while every flagged-line pre-read under it is 'pass' (the concern is
 *  about a design-level worry the line evidence already answers, e.g. a
 *  configurable endpoint that IS the declared feature).
 *
 *  This pass finds exactly that disagreement — latest verdict = AI
 *  concern, and the package has ≥1 judged flag-context ALL pass — and
 *  asks the judge to rule on the conflict with the evidence in front of
 *  it. The outcome is written as a NEW verdict record (same authority as
 *  any AI verdict):
 *    - pass    → carries flagsReviewed (the flag evidence was engaged),
 *                so the release gate honours it on flagged slots
 *    - concern → reason prefixed 对账维持 so the slot stops re-queueing
 *  Records with no flag-context coverage are never touched — the pass
 *  only reconciles where line-level evidence actually exists.
 *
 *  Usage: tsx pipeline/ai/reconcile.ts --index I --verdicts V --contexts C \
 *           --spool S [--limit N] [--dry] [-m model] [-p proxy]
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { loadVerdicts, latestVerdicts, vkey } from '../verdicts.ts'
import { loadFlagContexts, latestFlagContexts, type FlagContext } from './flag-context.ts'
import { pickJudge, type JudgeFn } from './flag-delta.ts'
import { installMarketProxy, normalizeProxy } from '../net.ts'
import type { CatalogIndex, PluginEntry } from '../../src/schema.ts'

const RECONCILED = '对账'

const arg = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const RECONCILE_SYSTEM = 'You are the reconciling judge for an OpenCode plugin marketplace. A version-level reviewer flagged this package "concern". Separately, EVERY statically-flagged code line was pre-read in full file context and judged benign. You see both sides: the concern reason and each line verdict. Decide whether the concern survives its own evidence — e.g. a "configurable endpoint" that IS the package\'s declared function, or a child_process import whose only call site is a fixed local command. If the concern describes a real risk the line evidence does NOT cover (unreviewed files, behaviour beyond the flagged lines), keep it. Reply with ONLY a JSON object {"verdict":"pass"|"concern","reason_zh":"<一句话中文理由>","reason_en":"<one-sentence English reason>"} — both required.'

interface Cand { e: PluginEntry; name: string; version: string | null; vReason: string; sha?: string; ctxs: FlagContext[] }

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: { judge?: JudgeFn } = {},
): Promise<void> {
  const idxPath = arg(argv, '--index'), vPath = arg(argv, '--verdicts')
  const cPath = arg(argv, '--contexts'), spool = arg(argv, '--spool')
  if (!idxPath || !vPath || !cPath) {
    console.error('usage: --index <i> --verdicts <v> --contexts <c> [--spool <s>] [--limit n] [--dry] [-m model] [-p proxy]')
    process.exit(1)
  }
  const dry = argv.includes('--dry')
  const limit = Number(arg(argv, '--limit') ?? '50')
  const mArg = arg(argv, '-m') ?? arg(argv, '--model')
  const pArg = arg(argv, '-p') ?? arg(argv, '--proxy')
  if (mArg === 'devin' || mArg?.startsWith('devin:')) {
    process.env.AI_BACKEND = 'devin'
    if (mArg.startsWith('devin:')) process.env.DEVIN_REVIEW_MODEL = mArg.slice(6)
  } else if (mArg) process.env.AI_MODEL = mArg
  installMarketProxy(pArg !== undefined ? normalizeProxy(pArg) ?? undefined : undefined)

  const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as CatalogIndex
  const byKey = new Map<string, PluginEntry>()
  for (const e of idx.plugins) {
    for (const ver of new Set([e.latestVersion, e.pendingUpdate?.version].filter(Boolean) as string[]))
      byKey.set(vkey(e.name, ver), e)
    // github-kind slots key on name\0 — the version loop above never mints
    // one (latestVersion/pendingUpdate are null), so version-less packages
    // silently skipped reconciliation entirely
    if (e.source?.kind === 'github') byKey.set(vkey(e.name, null), e)
  }
  const latestV = latestVerdicts(loadVerdicts(vPath))
  const ctxByName = new Map<string, FlagContext[]>()
  for (const c of latestFlagContexts(loadFlagContexts(cPath)).values()) {
    const k = c.name.toLowerCase()
    ;(ctxByName.get(k) ?? ctxByName.set(k, []).get(k)!).push(c)
  }

  const cands: Cand[] = []
  for (const [k, v] of latestV) {
    if (v.verdict !== 'concern' || v.source !== 'ai') continue
    if ((v.reason ?? '').startsWith(RECONCILED)) continue          // already reconciled
    const ctxs = (ctxByName.get(k.split('\0')[0]!) ?? []).filter(c => c.ai)
    if (!ctxs.length || ctxs.some(c => c.ai!.verdict !== 'pass')) continue
    const e = byKey.get(k); if (!e) continue
    cands.push({ e, name: v.name, version: v.version, vReason: v.reason ?? '', ...(v.sha ? { sha: v.sha } : {}), ctxs })
    if (cands.length >= limit) break
  }
  console.log(`[reconcile] ${cands.length} concern-vs-evidence conflicts`)

  const flagUser = (m: { summary: string; commits: string; patches: string }) => m.summary
  const judge: JudgeFn | null = deps.judge ?? pickJudge(process.env.AI_MODEL, process.env, RECONCILE_SYSTEM, flagUser)
  if (!judge) { console.error('[reconcile] no judge configured — set AI_MODEL / -m'); process.exit(1) }
  let passN = 0, heldN = 0, failN = 0
  for (const [i, c] of cands.entries()) {
    const material = {
      summary: `Package: ${c.name}@${c.version}\nDeclared: ${c.e.description.en}\n\nVERSION-LEVEL CONCERN:\n${c.vReason}\n\nLINE-LEVEL PRE-READS (all judged benign):\n` +
        c.ctxs.map(x => `- ${x.flag}\n  ↳ ${x.ai!.reasonZh} / ${x.ai!.reasonEn}${x.call ? `\n  ↳ call site L${x.call.line}: ${x.call.text}` : ''}`).join('\n'),
      commits: '', patches: '',
    }
    try {
      const r = await judge(material, false)
      const rec = {
        name: c.name, version: c.version, verdict: r.verdict,
        reason: `${RECONCILED}：${r.reasonZh}`, reasonEn: `reconciled: ${r.reasonEn}`,
        at: new Date().toISOString(), source: 'ai',
        ...(c.sha ? { sha: c.sha } : {}),
        ...(r.verdict === 'pass' ? { flagsReviewed: true } : {}),
      }
      const line = JSON.stringify(rec)
      if (dry) console.log(line)
      else if (spool) appendFileSync(spool, line + '\n')
      r.verdict === 'pass' ? passN++ : heldN++
      console.log(`[reconcile] ${c.name}@${c.version} → ${r.verdict} [${i + 1}/${cands.length}]`)
    } catch (e) {
      failN++
      console.log(`[reconcile] ${c.name}@${c.version} judge-failed: ${(e as Error).message}`)
    }
  }
  console.log(`[reconcile] done — ${passN} overturned to pass, ${heldN} concerns upheld, ${failN} failed`)
}

if (process.argv[1]?.endsWith('reconcile.ts')) await main()
