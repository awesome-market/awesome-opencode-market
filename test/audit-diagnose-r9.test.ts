/** audit #4 fresh round (AI diagnosis flow), round 9 — pin the two
 *  load-bearing candidate contracts that had NO direct coverage:
 *
 *  1. epoch re-queue: a pending entry whose latest 'pass' predates the
 *     name's tombstone judged a DIFFERENT (dead) incarnation — the release
 *     gate refuses it via epochGoverning, so the queue must NOT count it as
 *     "already reviewed" or the recycled entry sits verdict-less forever.
 *  2. github-kind admission: version-less entries DO enter the queue once
 *     their commit pin is known (reviewPin admits source.version — the
 *     verdict lands on the name@'' slot with sha=the reviewed commit, so
 *     shaOk pins bytes exactly like dist.integrity does for npm). An entry
 *     withOUT a resolved sha stays out — no bytes to anchor. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unreviewedTargets, main as diagnoseMain } from '../pipeline/ai/diagnose.ts'
import { OPENCODE_VERSION } from '../pipeline/publish/merge.ts'
import { HARNESS_GEN } from '../pipeline/verify/verify.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const idx = (plugins: PluginEntry[], removed: CatalogIndex['removed'] = []): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed,
})
const entry = (o: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', contains: ['plugin'],
  discoveredVia: 'npm-search', source: { kind: 'npm', id: 'pkg' },
  description: { en: 'd' }, features: {}, category: 'other', license: null,
  deprecated: false, deprecatedMessage: null, replacement: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  integrity: null, metrics: {}, capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
  approval: 'pending', approvalReason: null, pendingUpdate: null,
  verification: { status: 'skipped', level: 'install' }, compat: {}, ...o,
} as PluginEntry)
const v = (o: Partial<AiVerdict>): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...o,
} as AiVerdict)

describe('audit#4 r9 — epoch-gated re-queue of recycled names', () => {
  const tomb = [{ slug: 'pkg', name: 'pkg', disappearedAt: '2026-02-01T00:00:00Z', reason: 'npm-404' as const }]
  it('a pre-tombstone pass does not count as reviewed — recycled entry re-queues', () => {
    const e = entry({ latestVersion: '1.0.0' })       // re-entered under the same key
    const stalePass = v({ at: '2026-01-15T00:00:00Z' }) // judged the dead incarnation
    expect(unreviewedTargets(idx([e], tomb), [stalePass])).toHaveLength(1)
  })
  it('a post-tombstone pass governs the new incarnation — still decided', () => {
    const e = entry()
    const freshPass = v({ at: '2026-02-02T00:00:00Z' })
    expect(unreviewedTargets(idx([e], tomb), [freshPass])).toEqual([])
  })
  it('a pre-tombstone CONCERN still governs — recycled names inherit distrust', () => {
    const e = entry()
    const staleConcern = v({ verdict: 'concern', at: '2026-01-15T00:00:00Z' })
    expect(unreviewedTargets(idx([e], tomb), [staleConcern])).toEqual([])
  })
})

describe('flag-review policy — mechanical red-flag placeholders re-enter the queue', () => {
  const mech = v({ verdict: 'concern', reason: '机械红旗待人工：sec:x', at: '2026-01-02T00:00:00Z' })
  it('a 机械红旗待人工 concern is a placeholder, not a judgment — re-queues', () => {
    expect(unreviewedTargets(idx([entry()]), [mech])).toHaveLength(1)
  })
  it('a REAL ai concern (LLM judged the flags) still counts as reviewed', () => {
    const real = v({ verdict: 'concern', reason: '红旗在案，AI 判 concern：可疑', at: '2026-01-02T00:00:00Z' })
    expect(unreviewedTargets(idx([entry()]), [real])).toEqual([])
  })
  it('human verdicts are untouched — the placeholder rule is ai-source only', () => {
    const human = v({ verdict: 'concern', reason: '机械红旗待人工：sec:x', source: 'human', at: '2026-01-02T00:00:00Z' })
    expect(unreviewedTargets(idx([entry()]), [human])).toEqual([])
  })
  it('a retag-prefixed placeholder still re-queues — emit() prepends the re-tag annotation ahead of the marker', () => {
    const retagged = v({ verdict: 'concern',
      reason: '同版本换包（该键曾有人工裁决，re-tag 自动重审）——机械红旗待人工（AI 草稿，LLM 判 pass）：sec:x',
      at: '2026-01-02T00:00:00Z' })
    expect(unreviewedTargets(idx([entry()]), [retagged])).toHaveLength(1)
  })
})

describe('stale verify-fail concerns re-queue on newer measurement', () => {
  const vfConcern = (at: string) => v({ verdict: 'concern',
    reason: '装测失败（verify load 级）：插件模块无法被宿主加载', at, source: 'ai' })
  const failedVf = (verifiedAt: string, retries = 3) =>
    ({ status: 'failed', level: 'load', verifiedAt, retries }) as PluginEntry['verification']
  it('a verify-fail concern whose slot measured NEWER evidence re-queues', () => {
    // verdict judged the 01-02 failure; a 01-05 retest landed verified —
    // the concern's basis is gone, the entry needs a real verdict
    const e = entry({ verification: { status: 'verified', level: 'load', verifiedAt: '2026-01-05T00:00:00Z' } as PluginEntry['verification'] })
    expect(unreviewedTargets(idx([e]), [vfConcern('2026-01-03T00:00:00Z')])).toHaveLength(1)
  })
  it('a verify-fail concern on UNCHANGED evidence stays decided', () => {
    const e = entry({ verification: failedVf('2026-01-02T00:00:00Z') })
    expect(unreviewedTargets(idx([e]), [vfConcern('2026-01-03T00:00:00Z')])).toEqual([])
  })
  it('a newer TERMINAL failed measurement also re-queues — the rewritten concern carries fresh evidence', () => {
    const e = entry({ verification: { ...failedVf('2026-01-06T00:00:00Z'), opencodeVersion: OPENCODE_VERSION, harnessGen: HARNESS_GEN } })
    expect(unreviewedTargets(idx([e]), [vfConcern('2026-01-03T00:00:00Z')])).toHaveLength(1)
  })
  it('a newer RETRYABLE failed measurement still waits for the verify loop', () => {
    const e = entry({ verification: failedVf('2026-01-06T00:00:00Z', 1) })
    expect(unreviewedTargets(idx([e]), [vfConcern('2026-01-03T00:00:00Z')])).toEqual([])
  })
  it('non-verify concerns and human verdicts never re-queue on newer evidence', () => {
    const e = entry({ verification: { status: 'verified', level: 'load', verifiedAt: '2026-01-05T00:00:00Z' } as PluginEntry['verification'] })
    const llm = v({ verdict: 'concern', reason: '红旗在案，AI 判 concern：可疑', at: '2026-01-03T00:00:00Z' })
    expect(unreviewedTargets(idx([e]), [llm])).toEqual([])
    const human = vfConcern('2026-01-03T00:00:00Z'); human.source = 'human'
    expect(unreviewedTargets(idx([e]), [human])).toEqual([])
  })
  it('a retag-prefixed verify-fail concern still counts as stale-evidence re-queue', () => {
    const e = entry({ verification: { status: 'verified', level: 'load', verifiedAt: '2026-01-05T00:00:00Z' } as PluginEntry['verification'] })
    const retagged = vfConcern('2026-01-03T00:00:00Z')
    retagged.reason = `同版本换包（该键曾有人工裁决，re-tag 自动重审）——${retagged.reason}`
    expect(unreviewedTargets(idx([e]), [retagged])).toHaveLength(1)
  })
})

describe('stale L0.5 mechanical concerns re-queue (finding/flag-block evidence evaporated)', () => {
  const l05 = (block: string) => v({ verdict: 'concern', source: 'ai',
    reason: `L0.5 命中注入信号（score 0.9 ≥ 0.662，块 ${block}）；LLM 判 pass：x`,
    at: '2026-01-02T00:00:00Z' })
  it('hit on a finding block — matched-line scoring is gone → re-queue', () => {
    expect(unreviewedTargets(idx([entry()]), [l05('finding:5:network-call:scripts/install.sh — L5: # bash <(curl')])).toHaveLength(1)
  })
  it('hit on a flag block — same scoreText treatment → re-queue', () => {
    expect(unreviewedTargets(idx([entry()]), [l05('flag:0:lifecycle-script:package.json — L9: "postinstall"')])).toHaveLength(1)
  })
  it('retag-prefixed stale L0.5 still re-queues — emit() prepends the annotation', () => {
    const v0 = l05('finding:0:child-process:src/x.ts — L4: re.exec(v)')
    v0.reason = `同版本换包（该键曾有人工裁决，re-tag 自动重审）——${v0.reason}`
    expect(unreviewedTargets(idx([entry()]), [v0])).toHaveLength(1)
  })
  it('hit on prev-findings — block removed from L0.5 input → re-queue', () => {
    expect(unreviewedTargets(idx([entry()]), [l05('prev-findings')])).toHaveLength(1)
  })
  it('hit on a content block — real package text, still terminal', () => {
    expect(unreviewedTargets(idx([entry()]), [l05('content:SKILL.md')])).toEqual([])
  })
  it('hit on the manifest — still scored, still terminal', () => {
    expect(unreviewedTargets(idx([entry()]), [l05('manifest')])).toEqual([])
  })
  it('human L0.5-shaped verdict is untouched — source:ai only', () => {
    const h = l05('finding:0:x — L1: y'); h.source = 'human'
    expect(unreviewedTargets(idx([entry()]), [h])).toEqual([])
  })
})

describe('stale blind-evidence concerns re-queue when scan evidence postdates the verdict', () => {
  const blind = v({ verdict: 'concern', source: 'ai',
    reason: '包内容未能提取（133MB超出上限）且未做任何静态扫描，无法核实其实际行为',
    at: '2026-01-02T00:00:00Z' })
  const scanned = (scannedAt: string) => entry({
    capabilities: { scannedAt, findings: [], redFlags: [] } as PluginEntry['capabilities'] })
  it('scan landed after the verdict → the "cannot judge" basis evaporated → re-queue', () => {
    expect(unreviewedTargets(idx([scanned('2026-01-03T00:00:00Z')]), [blind])).toHaveLength(1)
  })
  it('scan predates the verdict — judged on the same absence → stays decided', () => {
    expect(unreviewedTargets(idx([scanned('2026-01-01T00:00:00Z')]), [blind])).toEqual([])
  })
  it('still unscanned — blind judgment remains honestly true → stays', () => {
    expect(unreviewedTargets(idx([entry({
      capabilities: { scannedAt: null, findings: [], redFlags: [] } as PluginEntry['capabilities'] })]), [blind])).toEqual([])
  })
  it('non-blind concerns never re-queue on rescan churn', () => {
    const real = v({ verdict: 'concern', source: 'ai', reason: '红旗在案，AI 判 concern：postinstall 可疑',
      at: '2026-01-02T00:00:00Z' })
    expect(unreviewedTargets(idx([scanned('2026-01-05T00:00:00Z')]), [real])).toEqual([])
  })
  it('human blind-shaped verdict untouched — source:ai only', () => {
    const h = { ...blind, source: 'human' as const }
    expect(unreviewedTargets(idx([scanned('2026-01-03T00:00:00Z')]), [h])).toEqual([])
  })
})

describe('audit#4 r9 — github-kind entries review at the pinned commit', () => {
  const gh = entry({
    name: 'Owner/Repo', slug: 'owner/repo',
    source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
    latestVersion: null, // gh entries are version-less; name@null is their verdict slot
  })
  it('pending repo entry WITH a resolved sha → queued (AI reviews the pinned commit)', () => {
    expect(unreviewedTargets(idx([gh]), [])).toHaveLength(1)
  })
  it('pending repo entry with NO resolved sha → excluded (no bytes to anchor a verdict to)', () => {
    const noSha = entry({
      name: 'Owner/Repo', slug: 'owner/repo',
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42 },
      latestVersion: null,
    })
    expect(unreviewedTargets(idx([noSha]), [])).toEqual([])
    // the pin guard runs BEFORE the force override: a version-less entry has
    // no bytes to re-review, so --force can't conjure one either
    expect(unreviewedTargets(idx([noSha]), [], new Set(['owner/repo']), { force: true })).toEqual([])
  })
  it('legacy github entry → admitted by default, excluded via includeLegacy:false', () => {
    const lg = entry({
      name: 'Owner/Repo', slug: 'owner/repo',
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
      latestVersion: null, approval: 'legacy',
    })
    expect(unreviewedTargets(idx([lg]), [])).toHaveLength(1)
    expect(unreviewedTargets(idx([lg]), [], null, { includeLegacy: false })).toEqual([])
  })
  it('an ai verdict on name@null → excluded (slot decided; a moved commit re-enters via the drift sweep)', () => {
    const av = v({ name: 'owner/repo', version: null, sha: 'c0ffee' })
    expect(unreviewedTargets(idx([gh]), [av])).toEqual([])
  })
  it('a human name@null verdict exists → still excluded (decided, never re-reviewed)', () => {
    const hv = v({ name: 'owner/repo', version: null, source: 'human', sha: 'c0ffee' })
    expect(unreviewedTargets(idx([gh]), [hv])).toEqual([])
  })
  it('main() emits version:null + sha:commit, fetches codeload at the PIN (never a mutable ref)', async () => {
    const d = mkdtempSync(join(tmpdir(), 'gh-'))
    const ip = join(d, 'i.json'), vp = join(d, 'v.jsonl'), op = join(d, 'o.jsonl')
    // schema-valid github row — the r9 unit fixtures carry nulls the strict
    // CatalogIndex.parse rejects (approvalReason/pendingUpdate), so build the
    // on-disk shape directly: latestVersion:null IS the github form
    const ghRow = {
      name: 'Owner/Repo', slug: 'owner/repo', aliases: [], type: 'plugin',
      contains: ['plugin'], discoveredVia: ['github-topic'],
      source: { kind: 'github', id: 'Owner/Repo', repo: 'Owner/Repo', repoId: 42, version: 'c0ffee' },
      description: { en: 'd' }, features: [], category: [], license: null,
      deprecated: false, deprecatedMessage: null, replacement: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: null, publishedAt: null,
      integrity: null,
      metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
      approval: 'pending', verification: { status: 'skipped', level: 'install' }, compat: {},
    }
    writeFileSync(ip, JSON.stringify(idx([ghRow as PluginEntry])))
    writeFileSync(vp, '')
    const urls: string[] = []
    // a codeload-shaped tarball: wrapper root is `<repo>-<sha>/`, not `package/`
    const { create } = await import('tar')
    const src = join(d, 'src', 'repo-c0ffee')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'SKILL.md'), '# repo skill\n')
    const tgzPath = join(d, 'r.tgz')
    await create({ gzip: true, file: tgzPath, cwd: join(d, 'src') }, ['repo-c0ffee/SKILL.md'])
    const tgz = readFileSync(tgzPath)
    const got: { version?: string | null | undefined; ids?: string[] } = {}
    await diagnoseMain(['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op], {
      l05: () => new Map<string, number>(),
      ornith: async (_e, m, o) => {
        got.version = o?.version; got.ids = m.map(x => x.id)
        return { verdict: 'pass' as const, reasonZh: 'ok', reasonEn: 'ok' }
      },
      fetchFn: (async (u: unknown) => { urls.push(String(u)); return new Response(new Uint8Array(tgz)) }) as unknown as typeof fetch,
      ping: async () => true,
    })
    const lines = readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.name).toBe('Owner/Repo')
    expect(lines[0]!.version).toBeNull()          // the github slot key — name@''
    expect(lines[0]!.sha).toBe('c0ffee')          // byte anchor = the pinned commit
    expect(urls).toEqual(['https://codeload.github.com/Owner/Repo/tar.gz/c0ffee'])
    expect(got.version).toBe('commit c0ffee')     // the judge sees the sha, not a phantom semver
    expect(got.ids).toContain('content:SKILL.md') // codeload wrapper root was stripped correctly
  })
})

describe('flag-blocked AI passes re-queue for a flag-aware verdict', () => {
  const flagged = (o: Partial<PluginEntry> = {}) => entry({
    capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: ['sec:x'] }, ...o,
  })
  it('a pass the gate ignores (flags, no flagsReviewed, no human cover) re-queues', () => {
    expect(unreviewedTargets(idx([flagged()]), [v({})])).toHaveLength(1)
  })
  it('a flagsReviewed pass holds release authority — stays decided', () => {
    expect(unreviewedTargets(idx([flagged()]), [v({ flagsReviewed: true })])).toEqual([])
  })
  it('a covering human pass releases under its own authority — no re-queue', () => {
    // the AI pass must be the GOVERNING (latest) verdict or it never reaches
    // the flag-blocked check — human cover is queried only under a hollow
    // ai pass
    const vs = [v({ at: '2026-01-03T00:00:00Z' }), v({ source: 'human', at: '2026-01-02T00:00:00Z' })]
    expect(unreviewedTargets(idx([flagged()]), vs)).toEqual([])
  })
  it('an unscanned slot stays decided — no re-review conjures a scan', () => {
    const e = entry({ capabilities: { scannedAt: null, findings: [], redFlags: [] } })
    expect(unreviewedTargets(idx([e]), [v({})])).toEqual([])
  })
  it('a clean-slot pass stays decided — nothing is blocked', () => {
    expect(unreviewedTargets(idx([entry()]), [v({})])).toEqual([])
  })
})

describe('unreviewedTargets — re-measure pending defer gate', () => {
  const failedCur = { status: 'failed' as const, level: 'load' as const,
    opencodeVersion: OPENCODE_VERSION, verifiedAt: '2026-01-01T00:00:00Z', retries: 3 }
  it('a gen-stale failed slot defers review — the verify loop owns it', () => {
    const e = entry({ verification: { ...failedCur, harnessGen: 1 } })
    expect(unreviewedTargets(idx([e]), [])).toEqual([])
  })
  it('a current-gen terminal failed slot reviews now (mech concern path)', () => {
    const e = entry({ verification: { ...failedCur, harnessGen: HARNESS_GEN } })
    expect(unreviewedTargets(idx([e]), [])).toHaveLength(1)
  })
  it('a no-payload gen-stale failed slot still reviews — verify would never re-measure it', () => {
    const e = entry({ contains: [], verification: { ...failedCur, harnessGen: 1 } })
    expect(unreviewedTargets(idx([e]), [])).toHaveLength(1)
  })
})
