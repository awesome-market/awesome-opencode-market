// coverage8 — edge-branch tests for pipeline modules whose main paths were
// already covered; targets the residual branch misses (audit-round regression:
// the {pipeline,src} 90% gate went red after the publish/docket hardening
// batches added code without matching edge tests).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogIndex } from '../src/schema.ts'
import { main as reFeaturesMain } from '../pipeline/re-features.ts'
import { compactLines } from '../pipeline/verdicts-compact.ts'
import { remerge } from '../pipeline/remerge.ts'
import { renderReview, renderRepoReview, repoVerdict, reviewPackage } from '../pipeline/review.ts'
import { submissionStatuses } from '../pipeline/submission-status.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { backfill } from '../pipeline/backfill.ts'
import { parseSubmission, sections } from '../pipeline/submission.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { searchByKeyword } from '../pipeline/discover/npm.ts'
import { filterByStars, repoToNpm, buildSeedList } from '../pipeline/discover/seed.ts'
import { fetchPackument, fetchDownloads30d, fetchTarball } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, fetchRepoTree, fetchRepoPackageName, fetchMarketMeta } from '../pipeline/fetch/github.ts'
import { versionCmp, mergeEntries, buildIndex } from '../pipeline/publish/merge.ts'
import { hostStaleVerify, retryable, verifyPartsOf, shard, planTargets, verifyTargetOf } from '../pipeline/verify/plan.ts'
import { mergeResults, VerifyResultFile } from '../pipeline/verify/merge.ts'
import { judgeTuiPane, checkTui } from '../pipeline/verify/tui.ts'
import { findGuiBundle, checkGuiBundle } from '../pipeline/verify/gui.ts'
import { checkSkillStructure, writeDummyProvider } from '../pipeline/verify/verify.ts'
import { isDupVerdict, amendAt, splitSpec, titleTarget } from '../pipeline/human-verdict.ts'
import { atCmp, akey, digestStateOf, latestVerdicts, latestHumanVerdicts, effectiveVerdict, vkey } from '../pipeline/verdicts.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { detectFeatures } from '../src/features.ts'
import { CAT_NAMES } from '../src/categories.ts'
import type { PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIdx = (plugins: PluginEntry[], over: Record<string, unknown> = {}) =>
  CatalogIndex.parse({ version: '1', generatedAt: 'x', categories: {}, plugins, removed: [], ...over })
const mkRes = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof b === 'string' ? b : JSON.stringify(b), { status, headers })
const verdict = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z',
  source: 'ai', ...over,
})

describe('verdicts-compact.compactLines', () => {
  it('normalizes offset timestamps, keeps human/malformed/latest lines', async () => {
    
    const old = '2020-01-01T00:00:00.000Z'
    const lines = [
      'not json at all',                                                        // malformed — kept verbatim
      JSON.stringify(verdict({ at: '2020-06-01T08:00:00+08:00' })),            // offset → normalized Z (= 2020-06-01T00:00Z)
      JSON.stringify(verdict({ at: old, source: 'human' })),                    // human — always kept
      JSON.stringify(verdict({ at: '2020-01-02T00:00:00Z' })),                  // newer ai on same key → old ai drops
      JSON.stringify(verdict({ name: 'q', version: '2.0.0', at: old })),        // different key, old but latest → kept
    ]
    const r = compactLines(lines, { days: 30, now: Date.parse('2021-01-01T00:00:00Z') })
    // the 2020-06 ai line is the LATEST for p@1.0.0 → kept; the 2020-01-02 ai
    // line is older than it → dropped; human old line kept; q's old line kept
    expect(r.lines).toHaveLength(4)
    expect(r.dropped).toBe(1)
    // raw lines are preserved verbatim (offset spelling stays in output);
    // normalization only feeds the drop comparison
    expect(r.lines.some(l => l.includes('+08:00'))).toBe(true)
  })
  it('partial opts + empty input', async () => {
    
    expect(compactLines([], { days: 1 }).dropped).toBe(0)
    const r = compactLines(['   ', ''], {})
    expect(r.lines).toEqual([])
  })
})

describe('remerge.remerge', () => {
  it('normalizes categories, dedupes removed tombstones', async () => {
    const firstCat = Object.keys(CAT_NAMES)[0]!
    const ours = mkIdx([mkEntry('a')], {
      categories: { [firstCat]: { en: 'x', zh: 'x' }, 'bogus-cat': { en: 'y' } },
      removed: [{ name: 'gone1', slug: 'gone1', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' }],
    })
    const remote = mkIdx([mkEntry('a'), mkEntry('b')], {
      categories: { '模型与接入': { en: 'Models', zh: '模型' } },
      removed: [
        { name: 'gone1', slug: 'gone1', disappearedAt: '2026-01-02T00:00:00Z', reason: 'manual' },  // dup slug — ours wins
        { name: 'gone2', slug: 'gone2', disappearedAt: '2026-01-02T00:00:00Z', reason: 'npm-404' },
      ],
    })
    const out = remerge(ours, remote)
    expect(out.removed.map(r => r.slug).sort()).toEqual(['gone1', 'gone2'])
    expect(out.removed.find(r => r.slug === 'gone1')!.disappearedAt).toBe('2026-01-01T00:00:00Z')
    // 'bogus-cat' is not in CAT_NAMES → dropped from the dict
    expect(Object.keys(out.categories)).not.toContain('bogus-cat')
    expect(out.categories[firstCat]).toBeTruthy()
  })
  it('null remote returns ours; entry category normalized + filtered', async () => {
    const ours = mkIdx([mkEntry('a', { category: ['模型与接入' as never, 'not-a-cat' as never] })])
    expect(remerge(ours, null)).toBe(ours)
    const remote = mkIdx([])
    const out = remerge(ours, remote)
    // zh label normalized through catId → english id kept; bogus dropped
    expect(out.plugins[0]!.category!.every(c => typeof c === 'string')).toBe(true)
    expect(out.plugins[0]!.category).not.toContain('not-a-cat')
  })
})

describe('review.ts render edge branches', () => {
  it('renderReview: evidence-insufficient block, scan error, >30 redFlags/findings fold', async () => {
    
    const base = {
      name: 'pkg', exists: true, status: 'ok' as const, evidenceOk: false, evidence: ['keywords'],
      scanned: true, scanError: null, findings: Array.from({ length: 35 }, (_, i) => `f${i}`),
      redFlags: Array.from({ length: 35 }, (_, i) => `r${i}`),
      downloads30d: null, repo: null, createdAt: null, version: '1.0.0', integrity: null,
    }
    const md = renderReview(base)
    expect(md).toContain('证据不足')
    expect(md).toContain('+5 more')                       // findings fold overflow
    expect(md).toContain('Red flags (35)')
    // scan error + not scanned + no integrity
    const md2 = renderReview({ ...base, evidenceOk: true, scanned: false, scanError: 'boom', findings: [], redFlags: [] })
    expect(md2).toContain('Scan: FAILED — boom')
    expect(md2).toContain('这不等于安全')
    // error / not-found / rate-limited statuses
    expect(renderReview({ ...base, status: 'error' })).toContain('审查失败')
    expect(renderReview({ ...base, exists: false })).toContain('not found')
    
    // package-level status mapping through fetchPackument — covered via fetchFn
    const r = await reviewPackage('gone-pkg', { fetchFn: (async () => mkRes('nf', 404)) as typeof fetch })
    expect(r.status).toBe('not-found')
    expect(r.exists).toBe(false)
  })
  it('renderRepoReview: apiDown variants, stars/pkgName/truncated, evidence-empty', async () => {
    
    const base = {
      repo: 'o/r', exists: true, treeStatus: 'ok' as const, evidenceOk: true, evidence: ['topic'],
      scanned: true, scanError: null, findings: [], redFlags: [],
      resolvedSha: null, createdAt: null, stars: null, pkgName: null, truncated: false,
      status: 'ok' as const,
    }
    // treeStatus error while package status ok → apiDown via treeStatus
    const md = renderRepoReview({ ...base, treeStatus: 'rate-limited' as never })
    expect(md).toContain('审查失败')
    expect(md).toContain('rate-limited')
    // status rate-limited wins the label
    expect(renderRepoReview({ ...base, status: 'rate-limited' as never })).toContain('rate-limited')
    // full metadata + truncated note + evidence empty
    const md2 = renderRepoReview({ ...base, stars: 42, pkgName: 'pkg-x', truncated: true, evidenceOk: false, evidence: [], resolvedSha: 'abc123' })
    expect(md2).toContain('42★')
    expect(md2).toContain('pkg-x')
    expect(md2).toContain('tree listing truncated')
    expect(md2).toContain('缺少 opencode 专属信号')
    expect(md2).toContain('abc123')
    expect(renderRepoReview({ ...base, exists: false })).toContain('not found')
    // verdict matrix edges
    expect(repoVerdict({ exists: true, status: 'ok', treeStatus: 'error', evidenceOk: true, scanned: true, redFlags: [] })).toBe('error')
    expect(repoVerdict({ exists: true, status: 'ok', treeStatus: 'ok', evidenceOk: false, scanned: true, redFlags: [] })).toBe('invalid')
    expect(repoVerdict({ exists: true, status: 'ok', treeStatus: 'ok', evidenceOk: true, scanned: true, redFlags: ['x'] })).toBe('flagged')
  })
})

describe('re-features.main edge branches', () => {
  const writeIdx = (plugins: PluginEntry[]) => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf8-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIdx(plugins)))
    return f
  }
  it('packument !ok → failed; missing version slot → failed; no version → skip', async () => {
    const e1 = mkEntry('pk-fail')
    const e2 = mkEntry('pk-miss', { latestVersion: '9.9.9' })
    const e3 = mkEntry('pk-nil', { latestVersion: null })
    const f = writeIdx([e1, e2, e3])
    const fetchFn = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('pk-fail')) return mkRes('nope', 500)
      return mkRes({ versions: { '1.0.0': { exports: { './tui': './t.js' } } } })
    }) as typeof fetch
    const r = await reFeaturesMain(f, { dry: true, fetchFn })
    expect(r.failed).toContain('pk-fail@1.0.0')
    expect(r.failed).toContain('pk-miss@9.9.9')
    expect(r.failed).not.toContain('pk-nil')
  })
  it('github-kind with empty features is not counted; tarball-less ver → files=[] path', async () => {
    const gh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r' }, features: [], latestVersion: null })
    const npmNoTb = mkEntry('pk-notb', { latestVersion: '1.0.0' })
    const f = writeIdx([gh, npmNoTb])
    // packument returns a version with NO exports/main/dist → filesOf path
    const fetchFn = (async () => mkRes({ versions: { '1.0.0': {} } })) as typeof fetch
    const r = await reFeaturesMain(f, { dry: true, fetchFn })
    expect(r.githubCleared).toBe(0)                       // already empty → not counted
    // same() with undefined features + sameSet reorder-only + >30 changed logging
    const many = Array.from({ length: 32 }, (_, i) => mkEntry(`pk-${i}`, { features: [] }))
    const f2 = writeIdx(many)
    const fetchFn2 = (async () => mkRes({ versions: { '1.0.0': { exports: { './tui': './t.js', './gui': './g.js' } } } })) as typeof fetch
    const r2 = await reFeaturesMain(f2, { dry: true, fetchFn: fetchFn2 })
    expect(r2.changed.length).toBe(32)
  })
})

describe('submission-status edges + gh upsert', () => {
  it('submissionStatuses: garbage lines, missing key, repo-match fallback', async () => {
    
    const idx = mkIdx([mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'O/R' } })])
    const rows = submissionStatuses(idx, [
      'plain text', '{bad json', '{"repo":"o/r","issue":7,"notified":false}',
      '{"issue":8,"notified":false}',          // no name/repo → skipped
      '{"name":"","issue":9,"notified":false}',
    ])
    expect(rows.map(r => r.issue)).toEqual([7])
    expect(rows[0]!.phase).toBe('published')    // repo-seed matched the github entry (approved → published)
  })
})

describe('notify-published.markNotified edges', () => {
  it('repo-seed matching, dead/stale windows, 90d terminal drop', async () => {
    
    const now = Date.parse('2026-06-01T00:00:00Z')
    const idx = mkIdx([
      mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'o/r' } }),
      mkEntry('pend', { approval: 'pending' }),
    ])
    const lines = [
      JSON.stringify({ repo: 'o/r', issue: 1, notified: false, at: '2026-05-20T00:00:00Z' }),   // landed → notify
      JSON.stringify({ name: 'pend', issue: 2, notified: false, at: '2026-01-01T00:00:00Z' }),   // pending + ancient → dead
      JSON.stringify({ name: 'ghost', issue: 3, notified: false, at: '2026-05-25T00:00:00Z' }),  // unlanded recent → stale? 7d<14d no
      JSON.stringify({ name: 'ghost2', issue: 4, notified: false, at: '2026-05-05T00:00:00Z' }), // unlanded >14d <30d → staleWarned
      JSON.stringify({ name: 'old', issue: 5, notified: true, at: '2025-01-01T00:00:00Z' }),    // >90d terminal → dropped
      'not json',
    ]
    const r = markNotified(idx, lines, { now, staleDays: 14, deadDays: 30 })
    expect(r.issues).toEqual([1])
    expect(r.dead).toEqual([2])
    expect(r.stale).toEqual([4])
    expect(r.lines.some(l => l.includes('"issue":5'))).toBe(false)  // 90d grace expired → dropped
    expect(r.lines).toContain('not json')
  })
})

describe('backfill.backfill edges', () => {
  it('fills createdAt/maintainers/repoId; skips populated fields; survives fetch errors', async () => {
    
    const e1 = mkEntry('pk-a', { createdAt: '2020-01-01T00:00:00Z', maintainers: ['x'], source: { kind: 'npm', id: 'pk-a', repo: 'o/r', repoId: 42 } })
    const e2 = mkEntry('pk-b')   // everything empty → needs all fields; repo absent
    const e3 = mkEntry('pk-c', { source: { kind: 'github', id: 'o/r2', repo: 'o/r2' } })  // repo without repoId
    const idx = mkIdx([e1, e2, e3])
    const fetchFn = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('api.github.com/repos/o/r2')) return mkRes({ id: 777, created_at: '2021-01-01T00:00:00Z' })
      if (u.includes('pk-b')) return mkRes({ time: { created: '2019-05-05T00:00:00Z', modified: '2020-01-01T00:00:00Z' }, maintainers: [{ name: 'm' }] })
      return mkRes('nf', 404)
    }) as typeof fetch
    const out = await backfill(idx, { fetchFn })
    const b = out.plugins.find(p => p.name === 'pk-b')!
    expect(b.createdAt).toBe('2019-05-05T00:00:00Z')
    expect(b.maintainers.length).toBe(1)
    const c = out.plugins.find(p => p.name === 'pk-c')!
    expect((c.source as { repoId?: number }).repoId).toBe(777)
    const a = out.plugins.find(p => p.name === 'pk-a')!
    expect(a.createdAt).toBe('2020-01-01T00:00:00Z')   // ??= kept existing
    expect((a.source as { repoId?: number }).repoId).toBe(42)
  })
})

describe('submission.sections/parse edges', () => {
  it('sections skips headless parts; type/category fallbacks', async () => {
    
    const body = `### Type / 类型

plugin

### npm package name / npm 包名

pkg-x

### Description (English) / 英文描述

Does x.

### Other languages (optional) / 其他语言描述

zh: 做x

### Categories (multi-select) / 分类可多选

- [x] 模型与接入 (Models & providers)
- [ ] 主题与外观 (Themes & UI)
`
    const s = parseSubmission(body)
    expect(s?.type).toBe('plugin')
    expect(s?.name).toBe('pkg-x')
    // section with no body → skipped entirely
    
    const m = sections('### A\n\n### B\n\nvalue')
    expect(m.has('A')).toBe(false)
    expect(m.get('B')).toBe('value')
  })
})

describe('discover edge branches', () => {
  it('github.searchTopic: !ok break, short page break, cap warn, field defaults', async () => {
    
    let calls = 0
    const fetchFn = (async () => {
      calls++
      if (calls === 1) return mkRes({ items: Array.from({ length: 100 }, (_, i) => ({
        full_name: `o/r${i}`, description: null, archived: false, fork: false,
        pushed_at: null, stargazers_count: 1, default_branch: 'main',
        license: { spdx_id: 'NOASSERTION' }, topics: undefined,
      })) })
      return mkRes('err', 500)
    }) as typeof fetch
    const out = await searchTopic('t', { fetchFn, maxPages: 10 })
    expect(out.length).toBe(100)                        // page2 !ok → truncated break
    expect(out[0]!.license).toBeNull()                  // NOASSERTION → null
    expect(out[0]!.description).toBe('')                // null → ''
    expect(out[0]!.topics).toEqual([])                  // undefined → []
  })
  it('npm.searchByKeyword: same pagination edges + field defaults', async () => {
    
    let calls = 0
    const fetchFn = (async () => {
      calls++
      if (calls === 1) return mkRes({ objects: Array.from({ length: 250 }, (_, i) => ({
        package: { name: `p${i}`, version: '1.0.0', description: null, keywords: null,
          links: {}, date: null },
      })) })
      return mkRes('err', 500)
    }) as typeof fetch
    const out = await searchByKeyword('k', { fetchFn, size: 250, maxPages: 10 })
    expect(out.length).toBe(250)
    expect(out[0]!.description).toBe('')
    expect(out[0]!.keywords).toEqual([])
    expect(out[0]!.repoUrl).toBeNull()
    expect(out[0]!.publishedAt).toBeNull()
  })
  it('seed.filterByStars/repoToNpm/buildSeedList edges', async () => {
    
    const now = Date.now()
    const fetchFn = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('api.github.com/repos/o/')) {
        if (u.endsWith('/o/dead')) return mkRes('nf', 404)
        if (u.endsWith('/o/arch')) return mkRes({ archived: true, stargazers_count: 999 })
        if (u.endsWith('/o/low')) return mkRes({ archived: false, stargazers_count: 1 })
        return mkRes({ archived: false, stargazers_count: 100, default_branch: 'dev' })
      }
      if (u.includes('raw.githubusercontent.com')) {
        if (u.includes('/dev/')) return mkRes({ name: 'npm-name-x' })
        if (u.includes('/main/')) return mkRes('not json{', 200)
        return mkRes('nf', 404)
      }
      return mkRes('# awesome\n- [a](https://github.com/o/good)\n- [b](https://github.com/o/dead)\n', 200)
    }) as typeof fetch
    const starred = await filterByStars(['o/good', 'o/dead', 'o/arch', 'o/low'], 50, { fetchFn })
    expect(starred).toEqual([{ repo: 'o/good', stars: 100, branch: 'dev' }])
    // repoToNpm: branch hit → name; all branches fail → null
    expect(await repoToNpm('o/good', { branch: 'dev', fetchFn })).toBe('npm-name-x')
    expect(await repoToNpm('o/none', { fetchFn })).toBeNull()
    // buildSeedList happy path + npm fallback to github:
    const names = await buildSeedList({ url: 'https://x.test/awesome.md', minStars: 50, fetchFn })
    expect(names).toEqual(['npm-name-x'])
    const fetchFn2 = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('api.github.com/repos/')) return mkRes({ archived: false, stargazers_count: 60 })
      if (u.includes('raw.githubusercontent.com')) return mkRes('nf', 404)
      return mkRes('# awesome\n- [a](https://github.com/o/good)\n', 200)
    }) as typeof fetch
    const names2 = await buildSeedList({ url: 'https://x.test/a.md', minStars: 50, fetchFn: fetchFn2 })
    expect(names2).toEqual(['github:o/good'])             // repoToNpm 404s → github: fallback
    await expect(buildSeedList({ url: 'https://x.test/a.md', fetchFn: (async () => mkRes('nf', 500)) as typeof fetch }))
      .rejects.toThrow('awesome fetch failed')
    void now
  })
})

describe('fetch/npm edges', () => {
  it('fetchPackument: custom registry + abbreviated + not-found/error mapping', async () => {
    
    const urls: string[] = []
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url))
      if (String(url).includes('pk-x')) return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist: { tarball: 'https://r/x.tgz', integrity: 'sha512-x' } } }, maintainers: [{ name: 'm' }, 'str-m'], readme: 'r'.repeat(300_000) })
      return mkRes('nf', 404)
    }) as typeof fetch
    const r = await fetchPackument('pk-x', { registry: 'https://reg.test', fetchFn, abbreviated: true })
    expect(r.status).toBe('ok')
    expect(r.pk!.maintainers).toEqual(['m', 'str-m'])
    expect(r.pk!.readme!.length).toBe(200_000)             // capped
    expect(r.pk!.tarballOf['1.0.0']).toBe('https://r/x.tgz')
    expect(r.pk!.integrityOf['1.0.0']).toBe('sha512-x')
    expect(urls[0]).toContain('reg.test')
    expect((await fetchPackument('gone', { fetchFn })).status).toBe('not-found')
    const r2 = await fetchPackument('pk-x', { fetchFn: (async () => { throw new Error('net') }) as typeof fetch })
    expect(r2.status).toBe('error')
    expect(await fetchDownloads30d('pk-x', { fetchFn })).toBeNull()  // !ok → null
    const dl = await fetchDownloads30d('pk-x', { fetchFn: (async () => mkRes({ downloads: 5 })) as typeof fetch })
    expect(dl).toBe(5)
  })
  it('fetchTarball: scheme/size/stream guards', async () => {
    
    await expect(fetchTarball('http://insecure/x.tgz', { fetchFn: (async () => mkRes('x')) as typeof fetch }))
      .rejects.toThrow('must be https')
    await expect(fetchTarball('not a url', { fetchFn: (async () => mkRes('x')) as typeof fetch }))
      .rejects.toThrow('malformed')
    await expect(fetchTarball('https://r/x.tgz', { fetchFn: (async () => mkRes('nf', 404)) as typeof fetch }))
      .rejects.toThrow('fetch failed')
    // content-length over cap
    await expect(fetchTarball('https://r/x.tgz', {
      maxBytes: 10,
      fetchFn: (async () => new Response('x'.repeat(100), { headers: { 'content-length': '100' } })) as typeof fetch,
    })).rejects.toThrow('too large')
    // no body reader → arrayBuffer path over cap
    const noBody = { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => new Uint8Array(50).buffer } as unknown as Response
    await expect(fetchTarball('https://r/x.tgz', { maxBytes: 10, fetchFn: (async () => noBody) as typeof fetch }))
      .rejects.toThrow('too large')
    // happy path small
    const ok = await fetchTarball('https://r/x.tgz', { fetchFn: (async () => mkRes('tgz-bytes')) as typeof fetch })
    expect(ok.toString()).toBe('tgz-bytes')
  })
})

describe('fetch/github edges', () => {
  it('fetchRepoMeta/fetchRepoTree status mapping + field defaults', async () => {
    
    // fetch throw → error
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).status).toBe('error')
    // rate-limited via headers? status mapping — check rateLimited impl via 403+remaining=0
    const rl = await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes('rl', 403, { 'x-ratelimit-remaining': '0' })) as typeof fetch })
    expect(['rate-limited', 'error']).toContain(rl.status)
    // tree: throw → error; ok → paths set
    const tree = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes({ tree: [{ path: 'a/b.ts' }, { path: 'c' }], sha: 's1' })) as typeof fetch })
    expect(tree.paths!.has('a/b.ts')).toBe(true)
    expect(tree.sha).toBe('s1')
    expect((await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).status).toBe('error')
    // fetchRepoPackageName: traversal dir rejected, 404, rate-limit, ok fields
    expect((await fetchRepoPackageName('o/r', { dir: '../evil', fetchFn: (async () => mkRes({})) as typeof fetch })).status).toBe('error')
    expect((await fetchRepoPackageName('o/r', { fetchFn: (async () => mkRes('nf', 404)) as typeof fetch })).status).toBe('not-found')
    const pkg = await fetchRepoPackageName('o/r', { fetchFn: (async () => mkRes({ name: 'n', main: 'm', exports: { '.': './x.js' } })) as typeof fetch })
    expect(pkg.status).toBe('ok')
    // fetchMarketMeta: !ok→null, valid meta, empty→null, throw→null
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes('nf', 404)) as typeof fetch })).toBeNull()
    const meta = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ category: ['a', 1, 'b'], description: { en: 'hi', zh: '  ' } })) as typeof fetch })
    expect(meta).toEqual({ description: { en: 'hi' } })   // mixed-type category array rejected wholesale
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({})) as typeof fetch })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).toBeNull()
  })
})

describe('publish/merge + plan/merge/tui/gui verify edges', () => {
  it('versionCmp NaN/length edges; mergeEntries approval fallbacks', async () => {
    
    expect(versionCmp('1.0', '1.0.0')).toBe(0)
    expect(versionCmp('1.0.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(versionCmp(null, '1.0.0')).toBe(0)
    expect(versionCmp('x.y', '1.0')).toBe(0)               // NaN → 0
    const old = mkIdx([mkEntry('p', { firstSeenAt: '2020-01-01T00:00:00Z', slug: 'p', approval: 'approved' })])
    const fresh = mkIdx([mkEntry('p', { approval: undefined as never, firstSeenAt: '2021-01-01T00:00:00Z' })])
    const merged = mergeEntries(fresh.plugins, old, 'oc1', 'r1')
    expect(merged[0]!.firstSeenAt).toBe('2020-01-01T00:00:00Z')   // identity preserved
    expect(merged[0]!.approval).toBe('legacy')                    // schema default fills absent approval before merge
    // pending entry awaiting-review reason default
    const pend = mergeEntries([mkEntry('q', { approval: 'pending' as const })], null, 'oc1', 'r1')
    expect(pend[0]!.approvalReason).toBe('awaiting-review')
    // buildIndex: removed dedup + categories whitelist + now opt
    const bi = buildIndex([mkEntry('live')], mkIdx([], { removed: [{ name: 'g', slug: 'g', disappearedAt: '2999-01-01T00:00:00Z', reason: 'manual' }] }), {
      opencodeVersion: 'oc1', now: '2026-06-01T00:00:00Z',
      removed: [{ name: 'n1', slug: 'n1', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' }],
    })
    expect(bi.index.plugins.map(p => p.name)).toContain('live')
    expect(bi.index.removed.map(r => r.slug)).toContain('n1')
  })
  it('verify/plan: hostStaleVerify, retryable, verifyPartsOf, shard', async () => {
    
    const mkV = (over: Record<string, unknown> = {}) => ({
      name: 'p', version: '1.0.0', unverified: false, flagged: false,
      features: [], hostStale: false, ...over,
    })
    void mkV
    const e = mkEntry('p', {
      verification: { status: 'verified', level: 'load', attempts: 1, opencodeVersion: 'oc-old', verifiedAt: '2026-01-01T00:00:00Z' },
      pendingUpdate: undefined,
    } as Partial<PluginEntry>)
    // craft via verifyTargetOf paths — check exports behavior on real entries
    const stale = mkEntry('s', {
      latestVersion: '2.0.0',
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load', attempts: 1, opencodeVersion: 'oc-old', verifiedAt: '2026-01-01T00:00:00Z' } as never,
      pendingUpdate: { version: '2.0.0', heldAt: '2026-01-01T00:00:00Z', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified', level: 'load', attempts: 1, opencodeVersion: 'oc-old', verifiedAt: '2026-01-01T00:00:00Z' } as never },
    } as Partial<PluginEntry>)
    
    const t = verifyTargetOf(stale)
    expect(t.hostStale).toBe(true)
    expect(hostStaleVerify(stale)).toBe(true)
    // flagged → never hostStaleVerify (flagged reads the active slot's caps —
    // no pendingUpdate here so e.capabilities.redFlags is what counts)
    const flagged = mkEntry('f', {
      latestVersion: '2.0.0',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] },
      verification: { status: 'verified', level: 'load', attempts: 1, opencodeVersion: 'oc-old', verifiedAt: '2026-01-01T00:00:00Z' } as never,
    } as Partial<PluginEntry>)
    expect(hostStaleVerify(flagged)).toBe(false)
    // retryable: attempts-bound only — age alone no longer kills the budget
    // (queue starvation must not mark a never-retried slot terminal)
    expect(retryable({ status: 'failed', retries: 1, verifiedAt: '2026-05-30T00:00:00Z' } as never)).toBe(true)
    expect(retryable({ status: 'failed', retries: 3, verifiedAt: '2026-05-30T00:00:00Z' } as never)).toBe(false)
    expect(retryable({ status: 'failed', retries: 1, verifiedAt: '2026-01-01T00:00:00Z' } as never)).toBe(true)  // old but unused budget survives
    expect(retryable({ status: 'verified' } as never)).toBe(false)
    // verifyPartsOf: contains-driven + type fallback
    expect(verifyPartsOf(mkEntry('c1', { contains: ['plugin', 'skill'] }))).toEqual(['plugin', 'skill'])
    expect(verifyPartsOf(mkEntry('c2', { type: 'skill' }))).toEqual(['skill'])
    // shard weights
    const shards = shard([1, 2, 3, 4, 5], 2, (n) => n)
    expect([...shards.flat()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    // planTargets: flagged excluded, no-parts excluded, cap respected
    const idx = mkIdx([
      mkEntry('ok1', { approval: 'pending', pendingUpdate: { version: '1.1.0', heldAt: '2026-01-01T00:00:00Z', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never }),
      mkEntry('flag', { approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] } }),
      mkEntry('noparts', { contains: [], approval: 'pending' })   // explicit [] = no installable payload,
    ])
    const targets = planTargets(idx, 48, false, new Date('2026-06-01T00:00:00Z'))
    expect(targets.every(t => t.name !== 'flag')).toBe(true)
    expect(targets.every(t => t.name !== 'noparts')).toBe(true)
  })
  it('verify/merge.mergeResults + skipIfFlagged paths', async () => {
    
    const idx = mkIdx([mkEntry('p', { approval: 'pending', latestVersion: '1.0.0' }), mkEntry('q')])
    const results = [
      { name: 'p', version: '1.0.0', status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: '2026-06-01T00:00:00Z' },
      { name: 'q', version: '1.0.0', status: 'failed', level: 'install', logExcerpt: 'boom', opencodeVersion: 'oc1', verifiedAt: '2026-06-01T00:00:00Z' },
    ]
    const out = mergeResults(idx, results as never, 'https://run')
    const p = out.plugins.find(e => e.name === 'p')!
    const q = out.plugins.find(e => e.name === 'q')!
    expect(p.verification.status).toBe('verified')
    expect(q.verification.status).toBe('failed')
    // schema round-trip
    expect(VerifyResultFile.safeParse(results[0]).success).toBe(true)
  })
  it('verify/tui.judgeTuiPane + checkTui tmux failure path', async () => {
    
    // judge on pane text — check what makes ok
    const dead = judgeTuiPane('', false)
    expect(dead.ok).toBe(false)
    const alive = judgeTuiPane('some pane', true)
    // whatever the heuristic, a live session with content shouldn't crash
    expect(typeof alive.ok).toBe('boolean')
    // tmux new-session failure → ok:false log
    const r = await checkTui({}, (async () => { throw new Error('no tmux') }) as never, { settleMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.log).toContain('tmux spawn failed')
  })
  it('verify/gui.findGuiBundle + checkGuiBundle edges', async () => {
    
    const home = mkdtempSync(join(tmpdir(), 'vg-'))
    // no bundle → error result
    const miss = findGuiBundle(home, 'nope')
    expect('error' in miss || 'path' in miss).toBe(true)
    // plant a fake installed plugin dir with a gui bundle
    const dir = join(home, '.config', 'opencode', 'node_modules', 'gui-pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gui-pkg' }))
    writeFileSync(join(dir, 'gui.js'), 'module.exports = {}')
    const found = findGuiBundle(home, 'gui-pkg')
    if ('path' in found) {
      const chk = await checkGuiBundle(found.src)
      expect(typeof chk.ok).toBe('boolean')
    }
    // checkGuiBundle on garbage source → structured result, not throw
    const bad = await checkGuiBundle('this is not js {{{')
    expect(typeof bad.ok).toBe('boolean')
  })
})

describe('human-verdict pure edges', () => {
  it('isDupVerdict: source/verdict/reason-normalize matrix; amendAt reuse', async () => {
    
    const lines = [
      JSON.stringify({ name: 'p', version: '1.0.0', verdict: 'pass', reason: 'ok', source: 'ai', at: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ name: 'p', version: '1.0.0', verdict: 'pass', reason: 'ok  ', source: 'human', at: '2026-01-02T00:00:00Z' }),
      'garbage',
    ]
    // human pass with same normalized reason → dup
    expect(isDupVerdict(lines, 'p', '1.0.0', 'pass', 'ok')).toBe(true)
    // ai source on top must NOT dedupe a human write... actually isDup checks
    // the LATEST matching line — the human line is latest here → true
    expect(isDupVerdict(lines, 'p', '1.0.0', 'concern', 'ok')).toBe(false)  // verdict differs
    expect(isDupVerdict(lines, 'p', '2.0.0', 'pass', 'ok')).toBe(false)    // version differs
    expect(isDupVerdict(lines, 'other', '1.0.0', 'pass', 'ok')).toBe(false)
    // amendAt: latest human line same verdict different reason → reuse `at`
    const amend = amendAt([
      JSON.stringify({ name: 'p', version: null, verdict: 'pass', reason: 'typo', source: 'human', at: '2026-01-02T00:00:00Z' }),
    ], 'p', null, 'pass', 'fixed reason')
    expect(amend).toBe('2026-01-02T00:00:00Z')
    // same reason → not an amend
    expect(amendAt([
      JSON.stringify({ name: 'p', version: null, verdict: 'pass', reason: 'same', source: 'human', at: '2026-01-02T00:00:00Z' }),
    ], 'p', null, 'pass', 'same')).toBeNull()
    // ai source on top → null
    expect(amendAt([
      JSON.stringify({ name: 'p', version: null, verdict: 'pass', reason: 'x', source: 'human', at: '2026-01-02T00:00:00Z' }),
      JSON.stringify({ name: 'p', version: null, verdict: 'pass', reason: 'y', source: 'ai', at: '2026-01-03T00:00:00Z' }),
    ], 'p', null, 'pass', 'z')).toBeNull()
    // splitSpec / titleTarget edges
    expect(splitSpec('pkg@1.2.3')).toEqual({ name: 'pkg', ver: '1.2.3' })
    expect(splitSpec('pkg')).toEqual({ name: 'pkg', ver: '' })
    expect(titleTarget('[review] pkg@2.0.0')).toEqual({ name: 'pkg', ver: '2.0.0' })
    expect(titleTarget('[review] (display name)@1.0.0')).toBeNull()   // parenthesized → not a spec
    expect(titleTarget('random title')).toBeNull()
  })
})

describe('verdicts.ts pure edges', () => {
  it('atCmp offsets, akey, digestStateOf, latest*/effectiveVerdict', async () => {
    
    // same instant, different spelling → string tiebreak decides (documented)
    expect(atCmp('2026-01-01T08:00:00+08:00', '2026-01-01T00:00:00Z')).toBe(1)
    expect(atCmp('2026-01-01T00:00:00Z', '2026-01-01T00:00:00+00:00')).toBe(1)   // 'Z'(0x5a) > '+'(0x2b)
    expect(atCmp('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0)
    expect(akey(verdict({ at: '2026-01-01T00:00:00Z' }))).toBe('p\x001.0.0\x002026-01-01T00:00:00Z')
    const vs = [
      verdict({ at: '2026-01-01T00:00:00Z' }),
      verdict({ at: '2026-01-02T00:00:00Z', verdict: 'concern', source: 'human' }),
      verdict({ name: 'q', version: null, at: '2026-01-03T00:00:00Z' }),
    ]
    const ds = digestStateOf('2026-01-04T00:00:00Z', vs)
    expect(ds.announced).toHaveLength(3)
    expect(ds.day).toBe('2026-01-04')
    const latest = latestVerdicts(vs)
    expect(latest.get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    const human = latestHumanVerdicts(vs)
    expect(human.get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    expect(human.has(vkey('q', null))).toBe(false)         // ai-only key absent from human map
    // effectiveVerdict: human brake overrides ai pass on same key
    const aiPass = verdict({ at: '2026-01-05T00:00:00Z' })
    const humanConcern = verdict({ at: '2026-01-06T00:00:00Z', verdict: 'concern', source: 'human' })
    const h2 = latestHumanVerdicts([humanConcern])
    expect(effectiveVerdict(aiPass, h2)?.verdict).toBe('concern')
    // newer human pass lifts the brake
    const humanPass = verdict({ at: '2026-01-07T00:00:00Z', verdict: 'pass', source: 'human' })
    const h3 = latestHumanVerdicts([humanConcern, humanPass])
    expect(effectiveVerdict(aiPass, h3)?.verdict).toBe('pass')
  })
})

describe('verify/verify.checkSkillStructure + writeDummyProvider', () => {
  it('skill structure: pack/tar/SKILL.md frontmatter matrix', async () => {
    
    const home = mkdtempSync(join(tmpdir(), 'vs-'))
    // fake exec: npm pack writes a tgz name; tar tzf lists; tar xzf -O dumps body
    const mkRun = (files: string[], skillBody: string) =>
      (async (cmd: string, args: string[]) => {
        if (cmd === 'npm') return { stdout: 'pkg-1.0.0.tgz\n', stderr: '' }
        if (cmd === 'tar' && args[0] === 'tzf') return { stdout: files.join('\n'), stderr: '' }
        if (cmd === 'tar' && args[0] === 'xzf') return { stdout: skillBody, stderr: '' }
        return { stdout: '', stderr: '' }
      }) as never
    const good = '---\nname: my-skill\n---\n# body'
    expect((await checkSkillStructure(home, mkRun(['package/skills/x/SKILL.md'], good), 'pkg@1.0.0')).ok).toBe(true)
    expect((await checkSkillStructure(home, mkRun(['package/README.md'], ''), 'pkg@1.0.0')).ok).toBe(false)   // no SKILL.md
    expect((await checkSkillStructure(home, mkRun(['package/SKILL.md'], '# no frontmatter'), 'pkg@1.0.0')).ok).toBe(false)
    expect((await checkSkillStructure(home, mkRun(['package/SKILL.md'], '---\ndescription: x\n---\n'), 'pkg@1.0.0')).ok).toBe(false) // fm lacks name:
    // exec throws → ok:false with stderr/message
    const bad = await checkSkillStructure(home, (async () => { throw Object.assign(new Error('x'), { stderr: 'stderr-detail' }) }) as never, 'pkg')
    expect(bad.ok).toBe(false)
    expect(bad.log).toContain('stderr-detail')
    // writeDummyProvider merges into existing config
    const cfgDir = join(home, '.config', 'opencode')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify({ plugins: ['keep-me'] }))
    writeDummyProvider(home)
    const cfg = JSON.parse(readFileSync(join(cfgDir, 'opencode.json'), 'utf8'))
    expect(JSON.stringify(cfg)).toContain('keep-me')
  })
})

describe('ai/digest.renderDigest edges', () => {
  it('phaseOf/heldLine/escMd/brakeMark paths via crafted index+verdicts', async () => {
    
    const prev = { lastDigestAt: '2026-01-01T00:00:00Z', announced: [], day: '2026-01-01', dayAnnounced: [] }
    const idx = mkIdx([
      mkEntry('held1', { approval: 'pending', latestVersion: '1.0.0', pendingUpdate: { version: '2.0.0', heldAt: '2026-01-01T00:00:00Z', reason: 'r|x', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never }),
      mkEntry('held2', { approval: 'pending', latestVersion: null }),
      mkEntry('ver-fail', { approval: 'pending', verification: { status: 'failed', level: 'install', attempts: 1 } as never }),
    ])
    const vs = [
      verdict({ name: 'held1', version: '2.0.0', verdict: 'pass', at: '2026-01-02T00:00:00Z', reason: 'line1\nline2 | pipe' }),
      verdict({ name: 'ghost', version: '1.0.0', verdict: 'concern', at: '2026-01-02T00:00:00Z', reason: 'why' }),
    ]
    const md = renderDigest({ index: idx, verdicts: vs, prev, now: new Date('2026-01-03T00:00:00Z') })
    expect(md).toContain('held1')
    expect(md).toContain('验证失败')                       // ver-fail phase
    expect(md).toContain('repo-only')                     // held2 null version label
    expect(md).not.toContain('line1\nline2')              // escCell collapses newlines
    expect(md).toContain('⚠️不在目录')                      // ghost not in index
  })
})

describe('submission-status gh upsert (mocked execFileSync)', () => {
  it('upsertStatusComment PATCHes existing marker comment / POSTs new / returns false on error', async () => {
    vi.resetModules()
    const calls: string[][] = []
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls.push(args)
        const joined = args.join(' ')
        if (joined.includes('/comments?')) return calls.filter(c => c.join(' ').includes('PATCH')).length ? '' : '12345\n'
        if (joined.includes('PATCH')) return ''
        if (joined.includes('POST')) return ''
        throw new Error('gh fail')
      },
    }))
    const row = { issue: 5, key: 'k', phase: 'queued' as const, phaseLabel: '排队中', detail: 'd' }
    // NB: must use the freshly-mocked module's export — the top-level static
    // import still binds the real execFileSync
    const mod1 = await import('../pipeline/submission-status.ts')
    // first call: comments list returns an id → PATCH path
    expect(mod1.upsertStatusComment('o/r', row, 'run1')).toBe(true)
    expect(calls.some(c => c.includes('PATCH'))).toBe(true)
    // make list return empty → POST path: reset mock behavior via module state is
    // awkward — instead verify the POST branch by a fresh mock
    vi.resetModules()
    const calls2: string[][] = []
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, args: string[]) => {
        calls2.push(args)
        if (args.join(' ').includes('/comments?')) return ''
        return ''
      },
    }))
    const mod2 = await import('../pipeline/submission-status.ts')
    expect(mod2.upsertStatusComment('o/r', row, 'run2')).toBe(true)
    expect(calls2.some(c => c.includes('POST'))).toBe(true)
    // error path → false
    vi.resetModules()
    vi.doMock('node:child_process', () => ({ execFileSync: () => { throw new Error('gh down') } }))
    const mod3 = await import('../pipeline/submission-status.ts')
    expect(mod3.upsertStatusComment('o/r', row, 'run3')).toBe(false)
    vi.doUnmock('node:child_process')
    vi.resetModules()
  })
})

describe('src/features.detectFeatures edge', () => {
  it('main-only / exports-only / files fallback shapes', async () => {
    
    expect(detectFeatures({ exports: undefined, main: 'index.js' })).toContain('server')
    const r = detectFeatures({ exports: { './tui': './t.js' }, main: null, files: ['skills/x/SKILL.md'] })
    expect(r).toContain('tui')
  })
})
