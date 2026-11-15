// Batch triage for open [review] issues — classifies each issue against the
// CURRENT catalog index + verdict log, emits a draft plan, and (--apply)
// appends source:human verdict lines to ai-verdicts.jsonl on the catalog
// branch. Docket then closes decided issues on its next sync.
//
// Usage:
//   node scripts/triage-issues.mjs            # report only
//   node scripts/triage-issues.mjs --apply    # LIVE: commit verdicts to catalog branch
// Inputs: /tmp/idx.json + /tmp/verdicts.jsonl refreshed from UPSTREAM catalog.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const IDX = JSON.parse(readFileSync('/tmp/idx.json', 'utf8'))
// the pinned verification host — read from the single source of truth so a
// host bump doesn't silently stale this script's "current evidence" rule
const CURRENT_HOST = readFileSync(new URL('../pipeline/publish/merge.ts', import.meta.url), 'utf8')
  .match(/OPENCODE_VERSION\s*=\s*'([^']+)'/)?.[1] ?? 'unknown'
const VKEY = (n, v) => `${n.toLowerCase()}${v ?? ''}`
const VERDICTS = readFileSync('/tmp/verdicts.jsonl', 'utf8').trim().split('\n')
  .filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

const byName = new Map()
for (const p of IDX.plugins)
  for (const k of [p.name, p.slug, p.source?.repo].filter(Boolean)) byName.set(k.toLowerCase(), p)
const rem = new Set(IDX.removed.flatMap(r => [r.name?.toLowerCase(), r.slug?.toLowerCase()].filter(Boolean)))
const latest = new Map()
for (const v of VERDICTS) {
  const k = VKEY(v.name, v.version)
  if (!latest.has(k) || (v.at ?? '') > latest.get(k).at) latest.set(k, v)
}
// candidateVer (verdicts.ts): pending → latestVersion; otherwise held pu.version
const candVer = p => p.approval === 'pending' ? p.latestVersion : (p.pendingUpdate?.version ?? null)
// sha anchor for the CANDIDATE slot: github → pinned commit; npm → candidate integrity
const candSha = p => {
  const slot = p.approval === 'pending' ? p : (p.pendingUpdate ?? p)
  return p.source?.kind === 'github' ? p.source.version : (slot.integrity ?? null)
}

const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', 'awesome-market/awesome-opencode-market',
  '--state', 'open', '--search', '[review] in:title', '--limit', '2000',
  '--json', 'number,title,labels,body'], { maxBuffer: 64 << 20 }).toString())

const plan = []
for (const i of issues) {
  const m = i.title.match(/^\[review\]\s+(.+?)(@(\S+))?\s*$/)
  if (!m || /^\(/.test(m[1])) { plan.push({ n: i.number, title: i.title, cls: 'aggregate', act: 'skip' }); continue }
  const name = m[1], lname = name.toLowerCase()
  const p = byName.get(lname)
  if (!p) {
    plan.push({ n: i.number, title: i.title, cls: rem.has(lname) ? 'tombstoned' : 'gone', act: 'docket' })
    continue
  }
  const ap = p.approval, vs = p.verification?.status, lv = p.verification?.level
  const flags = p.capabilities?.redFlags ?? []
  const cv = candVer(p)
  const v = latest.get(VKEY(lname, cv))
  const slot = `${p.name}@${cv ?? 'repo'}`

  if (ap === 'approved') { plan.push({ n: i.number, title: i.title, slot, cls: 'released', act: 'docket', entry: p }); continue }
  if (v?.verdict === 'concern' && v.source === 'human') { plan.push({ n: i.number, title: i.title, slot, cls: 'human-decided', act: 'docket', entry: p }); continue }

  // Hard package failures — host-independent signals only:
  //  - install-level: no plugin entrypoint at all
  //  - 'must export a default definition': fails the plugin contract on ANY host
  //  - load-level failed ON THE CURRENT HOST: serve explicitly reported the
  //    plugin failed / it never activated after a forced session — re-measured
  //    evidence, not a stale-host artifact (older-host evidence still waits
  //    for its amnesty re-measure)
  const excerpt = p.verification?.logExcerpt ?? ''
  const hard = excerpt.includes('must export a default definition')
  const host = p.verification?.opencodeVersion
  const currentHostFail = vs === 'failed' && lv === 'load' && host === CURRENT_HOST
  if (vs === 'failed' && (lv === 'install' || hard || currentHostFail)) {
    const why = hard ? '缺 default{id,setup|effect} 导出契约，非可装插件'
      : currentHostFail ? `宿主 ${host} 装测确认加载失败（serve 报错或插件未激活）`
      : '包无插件入口，确认非可装插件'
    plan.push({ n: i.number, title: i.title, slot, cls: `fail-${lv ?? '?'}-hard`, act: 'concern', entry: p,
      reason: `装测失败（${lv ?? 'load'} 级）：${why} → 维持 concern 刹车` })
    continue
  }
  if (vs === 'failed') { plan.push({ n: i.number, title: i.title, slot, cls: `fail-${lv ?? '?'}`, act: 'review', entry: p }); continue }
  if (flags.length) { plan.push({ n: i.number, title: i.title, slot, cls: 'flagged', act: 'review', entry: p }); continue }
  if (vs === 'verified' || vs === 'skipped') { plan.push({ n: i.number, title: i.title, slot, cls: `releasable/${vs}`, act: 'docket', entry: p }); continue }
  plan.push({ n: i.number, title: i.title, slot, cls: `waiting/${vs}`, act: 'docket', entry: p })
}

const buckets = {}
for (const r of plan) buckets[`${r.act}:${r.cls}`] = (buckets[`${r.act}:${r.cls}`] ?? 0) + 1
console.log(`issues=${issues.length}`)
for (const [k, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(` ${String(n).padStart(4)} ${k}`)
writeFileSync('/tmp/triage-plan.json', JSON.stringify(plan.map(({ entry, ...r }) => r), null, 1))

if (!APPLY) process.exit(0)

// ———— LIVE apply: append human-concern verdict lines to catalog branch ————
const at = new Date().toISOString()
const lines = []
for (const r of plan) {
  if (r.act !== 'concern' || !r.entry) continue
  const p = r.entry, cv = candVer(p)
  const k = VKEY(p.name, cv)
  const cur = latest.get(k)
  if (cur?.verdict === 'concern' && cur.source === 'human') continue // already decided
  const sha = candSha(p)
  lines.push(JSON.stringify({
    name: p.name, version: cv ?? null, verdict: 'concern', reason: r.reason,
    at, source: 'human', ...(sha ? { sha } : {}), by: 'triage-batch', issue: r.n,
  }))
}
if (!lines.length) { console.log('nothing to apply'); process.exit(0) }
console.log(`appending ${lines.length} verdict lines`)

const wt = mkdtempSync(join(tmpdir(), 'triage-cat-'))
try {
  execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'catalog',
    'https://github.com/awesome-market/awesome-opencode-market.git', wt], { stdio: 'inherit' })
  const av = join(wt, 'ai-verdicts.jsonl')
  execFileSync('bash', ['-c', `cat >> '${av}' <<'EOF'\n${lines.join('\n')}\nEOF`])
  execFileSync('git', ['-C', wt, 'add', 'ai-verdicts.jsonl'])
  execFileSync('git', ['-C', wt, '-c', 'user.name=Devin', '-c', 'user.email=158243242+devin-ai-integration[bot]@users.noreply.github.com',
    'commit', '-q', '-m', `human verdict: batch triage — ${lines.length} concern (verify-hard failures)`])
  execFileSync('git', ['-C', wt, 'push', 'origin', 'HEAD:catalog'], { stdio: 'inherit' })
  console.log('pushed verdict batch to catalog')
} finally {
  rmSync(wt, { recursive: true, force: true })
}
