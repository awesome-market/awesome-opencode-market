// coverage10 — third edge batch: review render matrix, gui-bundle stages,
// findGuiBundle layouts, fetchFn-default arms via stubbed global fetch,
// re-features caches, digest/verdicts/human-verdict/merge residuals.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogIndex } from '../src/schema.ts'
import type { PluginEntry, AiVerdict, DigestState } from '../src/schema.ts'
import { reviewPackage, reviewRepo, renderReview, renderRepoReview, repoVerdict, type Review, type RepoReview } from '../pipeline/review.ts'
import { checkGuiBundle, findGuiBundle } from '../pipeline/verify/gui.ts'
import { main as reFeaturesMain } from '../pipeline/re-features.ts'
import { detectFeatures } from '../src/features.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { applyMatureVerdicts, explainEntry, akey, vkey, latestVerdicts } from '../pipeline/verdicts.ts'
import { resolveVerdictEvent } from '../pipeline/human-verdict.ts'
import { mergeEntries, buildIndex } from '../pipeline/publish/merge.ts'
import { verifyTargetOf, hostStaleVerify } from '../pipeline/verify/plan.ts'
import { verifyPartsOf } from '../pipeline/verify/plan.ts'
import { checkTui } from '../pipeline/verify/tui.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { searchByKeyword } from '../pipeline/discover/npm.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { backfill } from '../pipeline/backfill.ts'
import { sections } from '../pipeline/submission.ts'
import { fetchPackument, fetchTarball, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { fetchRepoMeta, fetchRepoPackage } from '../pipeline/fetch/github.ts'

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
const dg = (announced: string[], over: Partial<DigestState> = {}): DigestState =>
  ({ lastDigestAt: '2026-01-10T00:00:00Z', announced, day: '2026-01-10', dayAnnounced: announced, ...over })

// minimal valid tar.gz: one SKILL.md file (512B header + content + pad + 2×512 zero)
const tarEntry = (name: string, body: string): Buffer => {
  const h = Buffer.alloc(512)
  h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136)
  h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263)
  h.fill(0x20, 148, 156)
  const sum = h.reduce((a, b) => a + b, 0)
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  const data = Buffer.from(body)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([h, data, pad])
}
const tgzOf = (...files: [string, string][]): Buffer => {
  const tar = Buffer.concat([...files.map(([n, b]) => tarEntry(n, b)), Buffer.alloc(1024)])
  const { gzipSync } = require('node:zlib') as typeof import('node:zlib')
  return gzipSync(tar)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('reviewPackage/reviewRepo residual fetch paths', () => {
  const packument = (over: Record<string, unknown> = {}) => ({
    name: 'p', 'dist-tags': { latest: '1.0.0' }, time: { created: '2020-01-01T00:00:00Z' },
    versions: { '1.0.0': { name: 'p', version: '1.0.0', dist: { tarball: 'https://r/p.tgz', integrity: 'sha512-x' }, exports: { '.': './i.js' } } },
    ...over,
  })
  it('no tarballUrl → scan skipped cleanly; latest missing → integrity null', async () => {
    const fetchFn = (async (u: unknown) => {
      const s = String(u)
      if (s.includes('registry.npmjs.org') && !s.includes('.tgz'))
        return mkRes(packument({ versions: { '1.0.0': { name: 'p', version: '1.0.0', exports: { '.': './i.js' } } } }))
      if (s.includes('api.npmjs.org')) return mkRes({ downloads: 5 })
      return mkRes('nf', 404)
    }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn })
    expect(r.exists).toBe(true)
    expect(r.scanned).toBe(false)
    expect(r.scanError).toContain('no tarball')
    expect(r.integrity).toBeNull()
  })
  it('packument fetch throws → status error → renderReview error branch', async () => {
    const fetchFn = (async () => { throw new Error('net down') }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn })
    expect(r.status).toBe('error')
    expect(r.exists).toBe(false)
    const md = renderReview(r)
    expect(md).toContain('审查失败')
    expect(md).toContain('<!-- verdict: error -->')
    // rate-limited status → same error render
    expect(renderReview({ ...r, status: 'rate-limited' })).toContain('暂时不可用')
  })
  it('dist-tags.latest missing → version null + integrity null', async () => {
    const fetchFn = (async (u: unknown) => {
      const s = String(u)
      if (s.includes('registry.npmjs.org') && !s.includes('.tgz'))
        return mkRes({ name: 'p', versions: { '1.0.0': { name: 'p', version: '1.0.0', exports: { '.': './i.js' } } } })
      if (s.includes('api.npmjs.org')) return mkRes({ downloads: 5 })
      return mkRes('nf', 404)
    }) as typeof fetch
    const r = await reviewPackage('p', { fetchFn })
    expect(r.version).toBeNull()
    expect(r.integrity).toBeNull()
  })
  it('reviewRepo: meta ok + tree error → paths fallback + no evidence scan; pkgName non-string → null', async () => {
    const fetchFn = (async (u: unknown) => {
      const s = String(u)
      if (s.includes('api.github.com/repos/') && s.endsWith('/o/r'))
        return mkRes({ id: 1, created_at: '2020-01-01T00:00:00Z', stargazers_count: 3, default_branch: 'main', topics: [] })
      if (s.includes('api.github.com/repos/') && s.includes('/git/trees/')) return mkRes('nf', 404)
      if (s.includes('raw.githubusercontent.com')) return mkRes({ name: 7 })
      return mkRes('nf', 404)
    }) as typeof fetch
    const r = await reviewRepo('o/r', { fetchFn })
    expect(r.exists).toBe(true)
    expect(r.scanned).toBe(false)         // no evidence (empty tree) → scan skipped
    expect(r.pkgName).toBeNull()          // name:7 non-string → null
    expect(r.stars).toBe(3)
    const md = renderRepoReview(r)
    expect(md).toContain('GitHub 仓库')
    expect(md).toContain('Scan: not run')
    expect(md).toContain('缺少 opencode 专属信号')   // repo evidence-insufficient wording
    expect(repoVerdict(r)).toBe('invalid')
  })
  it('reviewRepo: meta not-found + repoVerdict/renderRepoReview edges', async () => {
    const r = await reviewRepo('o/r', { fetchFn: (async () => mkRes('nf', 404)) as typeof fetch })
    expect(r.exists).toBe(false)
    expect(r.status).toBe('not-found')
    expect(renderRepoReview(r)).toContain('repository not found')
    // apiDown: status ok but treeStatus error → 审查失败 render
    const apiDown = { ...r, exists: true, status: 'ok' as const, treeStatus: 'error' as const }
    expect(renderRepoReview(apiDown)).toContain('GitHub API 暂时不可用')
    // full render: stars/pkgName/truncated/findings>30/redFlags>30/scanned-no-findings
    const big = Array.from({ length: 35 }, (_, i) => `f${i}`)
    const full: RepoReview = {
      ...r, exists: true, status: 'ok', treeStatus: 'ok', evidenceOk: true, evidence: ['pkg.json'],
      scanned: true, scanError: null, findings: big, redFlags: big,
      resolvedSha: 'abc123', createdAt: '2020-01-01', stars: 9, pkgName: 'pn', truncated: true,
    }
    const md = renderRepoReview(full)
    expect(md).toContain('9★')
    expect(md).toContain('`pn`')
    expect(md).toContain('tree listing truncated')
    expect(md).toContain('+5 more')
    expect(repoVerdict(full)).toBe('flagged')
    const clean = { ...full, findings: [], redFlags: [] }
    expect(repoVerdict(clean)).toBe('clean')
    expect(renderRepoReview({ ...clean, evidenceOk: false, evidence: [] })).toContain('缺少 opencode 专属信号')
  })
})

describe('renderReview edge matrix', () => {
  const base: Review = {
    name: 'p', exists: true, status: 'ok', evidenceOk: true, evidence: ['main'],
    scanned: true, scanError: null, findings: [], redFlags: [],
    downloads30d: null, repo: null, pkgName: null, createdAt: null, version: null, integrity: null,
  }
  it('scanError / not-scanned / findings>30 / redFlags>30 / evidence-fail / all-null fields', () => {
    const se = renderReview({ ...base, scanned: false, scanError: 'boom' })
    expect(se).toContain('Scan: FAILED — boom')
    const ns = renderReview({ ...base, scanned: false, scanError: null })
    expect(ns).toContain('Scan: not run')
    const many = Array.from({ length: 35 }, (_, i) => `x${i}`)
    const md = renderReview({ ...base, findings: many, redFlags: many })
    expect(md).toContain('+5 more')
    const noFind = renderReview({ ...base, findings: [] })
    expect(noFind).toContain('### Findings: none — this does not mean safe.')
    const evFail = renderReview({ ...base, evidenceOk: false, evidence: [] })
    expect(evFail).toContain('证据不足')
    expect(evFail).toContain('仅有 none 个信号'.replace('none 个', 'none 个'))
    const nulls = renderReview({ ...base, repo: null, downloads30d: null, version: null, integrity: null, createdAt: null })
    expect(nulls).toContain('unknown')
    expect(nulls).toContain('createdAt: null')
    const flagged = renderReview({ ...base, redFlags: ['r'] })
    expect(flagged).toContain('Red flags (1)')
  })
})

describe('checkGuiBundle stage coverage', () => {
  it('registering bundle → ok; contrib without render → rendered=0 error; render variants', async () => {
    const good = `module.exports = { default: { setup(ctx) {
      ctx.add({ cname: 'Panel', name: 'Panel' }, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'hi'; return d } }))
    } } }`
    const r1 = await checkGuiBundle(good)
    expect(r1.ok).toBe(true)
    expect(r1.rendered).toBe(1)
    // contribution factory returns object without render → skipped → rendered 0
    const noRender = `module.exports = { default: { setup(ctx) {
      ctx.add({ name: 'Tab' }, () => ({}))
    } } }`
    const r2 = await checkGuiBundle(noRender)
    expect(r2.ok).toBe(false)
    expect(r2.stage).toBe('render')
    expect(r2.error).toContain('no contribution exposed a render()')
    // render throws → stage render error
    const throws = `module.exports = { default: { setup(ctx) {
      ctx.add({ name: 'Panel' }, () => ({ render: () => { throw new Error('x') } }))
    } } }`
    expect((await checkGuiBundle(throws)).stage).toBe('render')
    // render returns non-HTMLElement
    const badEl = `module.exports = { default: { setup(ctx) {
      ctx.add({ name: 'Panel' }, () => ({ render: () => 42 }))
    } } }`
    const r4 = await checkGuiBundle(badEl)
    expect(r4.error).toContain('not HTMLElement')
    // render returns empty element
    const empty = `module.exports = { default: { setup(ctx) {
      ctx.add({ name: 'Panel' }, () => ({ render: () => document.createElement('div') }))
    } } }`
    expect((await checkGuiBundle(empty)).error).toContain('empty element')
    // setup throws → stage setup
    const badSetup = `module.exports = { default: { setup() { throw new Error('setup boom') } } }`
    const r6 = await checkGuiBundle(badSetup)
    expect(r6.stage).toBe('setup')
    expect(r6.error).toContain('setup boom')
    // syntax error → evaluate stage
    const syn = await checkGuiBundle('this is not js {{{')
    expect(syn.stage).toBe('evaluate')
    // dynamic import inside bundle → whitelist error at evaluate
    const dyn = `module.exports = { default: { setup() { return import('fs').catch(() => {}) } } }`
    const r8 = await checkGuiBundle(dyn)
    expect(r8.ok).toBe(false)   // no registrations → setup-stage 'no contributions'
  })
  it('findGuiBundle: full layout matrix — direct, scoped, missing pieces', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fgb-'))
    // no npm cache at all
    expect('error' in findGuiBundle(home, 'p')).toBe(true)
    const npmRoot = join(home, 'cache', 'opencode', 'npm')
    mkdirSync(join(npmRoot, 'p@1.0.0', 'ts1', 'node_modules', 'p'), { recursive: true })
    writeFileSync(join(npmRoot, 'p@1.0.0', 'ts1', 'node_modules', 'p', 'package.json'),
      JSON.stringify({ name: 'p', exports: { './gui': './gui.js' } }))
    writeFileSync(join(npmRoot, 'p@1.0.0', 'ts1', 'node_modules', 'p', 'gui.js'), 'x')
    // scoped package via scoped node_modules path
    mkdirSync(join(npmRoot, 'p@2.0.0', 'ts9', 'node_modules', '@s', 'p'), { recursive: true })
    writeFileSync(join(npmRoot, 'p@2.0.0', 'ts9', 'node_modules', '@s', 'p', 'package.json'),
      JSON.stringify({ name: '@s/p', exports: { './gui-x': { import: './g.mjs' } } }))
    writeFileSync(join(npmRoot, 'p@2.0.0', 'ts9', 'node_modules', '@s', 'p', 'g.mjs'), 'y')
    // unreadable package.json
    mkdirSync(join(npmRoot, 'bad@1', 't', 'node_modules', 'bad'), { recursive: true })
    writeFileSync(join(npmRoot, 'bad@1', 't', 'node_modules', 'bad', 'package.json'), '{oops')
    // no gui export key
    mkdirSync(join(npmRoot, 'nogui@1', 't', 'node_modules', 'nogui'), { recursive: true })
    writeFileSync(join(npmRoot, 'nogui@1', 't', 'node_modules', 'nogui', 'package.json'), JSON.stringify({ exports: { '.': './i.js' } }))
    // gui key with empty target
    mkdirSync(join(npmRoot, 'empty@1', 't', 'node_modules', 'empty'), { recursive: true })
    writeFileSync(join(npmRoot, 'empty@1', 't', 'node_modules', 'empty', 'package.json'), JSON.stringify({ exports: { './gui': {} } }))
    // gui target file missing
    mkdirSync(join(npmRoot, 'miss@1', 't', 'node_modules', 'miss'), { recursive: true })
    writeFileSync(join(npmRoot, 'miss@1', 't', 'node_modules', 'miss', 'package.json'), JSON.stringify({ exports: { './gui': './nope.js' } }))

    const hit = findGuiBundle(home, 'p')
    expect('path' in hit && hit.path.endsWith('gui.js')).toBe(true)
    const scoped = findGuiBundle(home, '@s/p')
    expect('path' in scoped && scoped.path.endsWith('g.mjs')).toBe(true)
    expect((findGuiBundle(home, 'bad') as { error: string }).error).toContain('unreadable')
    expect((findGuiBundle(home, 'nogui') as { error: string }).error).toContain('no gui export')
    expect((findGuiBundle(home, 'empty') as { error: string }).error).toContain('no file target')
    expect((findGuiBundle(home, 'miss') as { error: string }).error).toContain('entrypoint missing')
    expect((findGuiBundle(home, 'absent') as { error: string }).error).toContain('not found')
  })
})

describe('fetchFn-default arms via stubbed global fetch', () => {
  it('all fetch wrappers honor a replaced global fetch when fetchFn omitted', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', (async (u: unknown) => {
      seen.push(String(u))
      const s = String(u)
      if (s.includes('registry.npmjs.org') && !s.includes('.tgz'))
        return mkRes({ name: 'p', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'p', version: '1.0.0', dist: { tarball: 'https://r/t.tgz' } } } })
      if (s.includes('.tgz')) return new Response(new Uint8Array(tgzOf(['package/SKILL.md', '# s'])))
      if (s.includes('api.github.com/repos/o%2Fr') || s.includes('api.github.com/repos/o/r'))
        return mkRes({ id: 1, created_at: 'x', default_branch: 'main' })
      if (s.includes('git/trees')) return mkRes({ tree: [{ path: 'package.json' }], sha: 's' })
      if (s.includes('raw.githubusercontent.com')) return mkRes({ name: 'rn' })
      if (s.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes('nf', 404)
    }) as typeof fetch)
    // fetch/npm.ts: packument + tarball + downloads without fetchFn
    const pk = await fetchPackument('p')
    expect(pk.pk?.name).toBe('p')
    const tb = await fetchTarball('https://r/t.tgz')
    expect(tb.length).toBeGreaterThan(0)
    await fetchDownloads30d('p')
    // fetch/github.ts: meta + tree + package without fetchFn/token
    const meta = await fetchRepoMeta('o/r')
    expect(meta.status).toBe('ok')
    const pkg = await fetchRepoPackage('o/r')
    expect(pkg.pkg?.name).toBe('rn')
    // discover + backfill without fetchFn
    await searchByKeyword('k', { size: 1 })
    await searchTopic('t', { maxPages: 1 })
    await backfill(mkIdx([mkEntry('p')]))
    expect(seen.length).toBeGreaterThan(3)
  })
})

describe('re-features cache + edge branches', () => {
  it('docCache hit via duplicate entry names; tarFiles hit via shared tarball URL; dry default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf10-'))
    const f = join(dir, 'i.json')
    const mkRaw = (name: string, extra: Record<string, unknown> = {}) => ({
      name, slug: name, aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
      license: null, deprecated: false, replacement: null, deprecatedMessage: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {}, approval: 'approved',
      features: [], ...extra,
    })
    // two entries SAME name → packument fetched once (docCache hit on 2nd)
    // displayed+pending share one tarball URL → filesOf cache hit
    const shared = { versions: {
      '1.0.0': { dist: { tarball: 'https://r/shared.tgz' } },
      '2.0.0': { dist: { tarball: 'https://r/shared.tgz' } },
    } }
    const e1 = mkRaw('dup', { latestVersion: '2.0.0', pendingUpdate: { version: '1.0.0', heldAt: 't', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } })
    const fillers = Array.from({ length: 11 }, (_, i) => mkRaw(`fill${i}`))
    writeFileSync(f, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: [e1, ...fillers, { ...e1, slug: 'dup2' }], removed: [] }))
    let packFetches = 0, tarFetches = 0
    const fetchFn = (async (u: unknown) => {
      const s = String(u)
      if (s.includes('registry.npmjs.org') && !s.includes('.tgz')) { if (s.includes('/dup')) packFetches++; return mkRes(s.includes('/dup') ? shared : { name: 'x', versions: {} }) }
      if (s.includes('shared.tgz')) { tarFetches++; return new Response(new Uint8Array(tgzOf(['package/tui.js', 'x']))) }
      return mkRes('nf', 404)
    }) as typeof fetch
    await reFeaturesMain(f, { fetchFn })   // dry omitted → writes file
    expect(packFetches).toBe(1)           // docCache dedupe across same-name entries
    expect(tarFetches).toBe(1)            // tarFiles dedupe across slots sharing URL
  })
  it('github-kind entry without features field → githubCleared path; sameSet ?? arms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf10b-'))
    const f = join(dir, 'i.json')
    const gh = {
      name: 'o/r', slug: 'o-r', aliases: [], type: 'skill', discoveredVia: [],
      source: { kind: 'github', id: 'o/r', repo: 'o/r' }, description: { en: 'd' }, category: [],
      license: null, deprecated: false, replacement: null, deprecatedMessage: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: null, publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {}, approval: 'approved',
      features: ['tui'],   // github kind → cleared to []
    }
    writeFileSync(f, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: [gh], removed: [] }))
    const out = await reFeaturesMain(f, { dry: true, fetchFn: (async () => mkRes('nf', 404)) as typeof fetch })
    expect(out.githubCleared).toBe(1)
  })
})

describe('detectFeatures exports array leafs', () => {
  it('exports value as array → flatMap leafs; gui-experimental array targets', () => {
    const r = detectFeatures({
      main: 'i.js',
      exports: { '.': './i.js', './tui': ['./a.js', './b.js'], './gui-experimental': { import: ['./g.cjs'] } },
    })
    expect(r).toContain('tui')
    expect(r).toContain('gui')
  })
})

describe('digest residual branches', () => {
  it('repoUrl env, pendingUpdate ver arm, non-pass rec, version-null verdict row, liveAlarms>30, main() arg parse', async () => {
    const env = process.env
    env.MARKET_REPO_URL = 'https://site.example/'
    try {
      const prev = { lastDigestAt: '2026-01-01T00:00:00Z', announced: [], day: '2026-01-01', dayAnnounced: [] }
      const held = (n: string, over: Record<string, unknown> = {}) => mkEntry(n, {
        approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: [] },
        verification: { status: 'unverified' }, ...over,
      } as Partial<PluginEntry>)
      // approval:'approved' — pendingUpdate is only the candidate slot on a
      // displayed entry; on pending it's the B3 inverted state (audit #6)
      const puEntry = held('pu', { approval: 'approved', latestVersion: '9.9.9', pendingUpdate: { version: '2.0.0', heldAt: 't', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never })
      const concernEntry = held('cc')   // latest verdict = concern → not pass → other phase
      const alarmEntries = Array.from({ length: 35 }, (_, i) => mkEntry(`al${i}`, {
        approval: 'approved', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-recreated'] },
      }))
      const idx = mkIdx([puEntry, concernEntry, ...alarmEntries])
      const vs: AiVerdict[] = [
        verdict({ name: 'cc', version: '1.0.0', verdict: 'concern', reason: 'r', at: '2026-01-02T00:00:00Z' }),
        verdict({ name: 'ghost', version: null, verdict: 'concern', source: 'human', reason: 'pkg', at: '2026-01-02T00:00:00Z' }),
      ]
      const md = renderDigest({ index: idx, verdicts: vs, prev, now: new Date('2026-01-03T00:00:00Z') })
      expect(md).toContain('site.example')
      expect(md).toContain('—')               // version-null verdict row renders '—'
      expect(md).toContain('还有 5 条')        // liveAlarms 35 > 30 → +N more
      expect(md).toContain('v2.0.0')          // pendingUpdate slot version surfaces
    } finally { env.MARKET_REPO_URL = undefined }
  })
})

describe('verdicts residual branches', () => {
  it('latestVerdicts older-second no-replace; null-version held.push; pkgPass reset; slotHuman overrides pkgBrake; reason-less concern', async () => {
    const { akey, vkey } = await import('../pipeline/verdicts.ts')
    // older verdict processed second does NOT replace newer (if[1] false arm)
    const newer = verdict({ at: '2026-01-02T00:00:00Z', verdict: 'concern' })
    const older = verdict({ at: '2026-01-01T00:00:00Z', verdict: 'pass' })
    expect(latestVerdicts([newer, older]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    expect(latestVerdicts([older, newer]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    // github-kind entry (latestVersion null) + concern → held 'name@null'
    const gh = mkEntry('gh', { latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'o/r' } })
    const vc = verdict({ name: 'gh', version: null, verdict: 'concern', source: 'human', reason: 'r', at: '2026-01-05T00:00:00Z' })
    const r1 = applyMatureVerdicts(mkIdx([gh]), [vc], dg([akey(vc)]))
    expect(r1.held).toContain('gh@null')
    // pkgPass reset: pending + stale reason + human pass on name@null, no slot verdict
    const stale = mkEntry('st', { approval: 'pending', approvalReason: 'old why' })
    const pkgPass = verdict({ name: 'st', version: null, verdict: 'pass', source: 'human', at: '2026-01-05T00:00:00Z' })
    const r2 = applyMatureVerdicts(mkIdx([stale]), [pkgPass], dg([akey(pkgPass)]))
    expect(r2.index.plugins[0]!.approvalReason).toBe('awaiting-review')
    // slotHuman pass NEWER than pkgBrake dissolves brake → explains via effectiveVerdict
    const pkgBrake = verdict({ name: 'pb', version: null, verdict: 'concern', source: 'human', reason: 'pkg', at: '2026-01-01T00:00:00Z' })
    const slotPass = verdict({ name: 'pb', version: '1.0.0', verdict: 'pass', source: 'human', at: '2026-01-09T00:00:00Z' })
    const pb = mkEntry('pb', { approval: 'pending' })
    const slots = explainEntry(pb as never, [pkgBrake, slotPass], dg([akey(pkgBrake), akey(slotPass)]))
    expect(slots[0]!.verdict).toBe('pass')   // newer human slot pass beats package brake
    // reason-less concern → why falls back to ''
    const noReason = verdict({ name: 'nr', version: '1.0.0', verdict: 'concern', source: 'human', at: '2026-01-05T00:00:00Z' })
    const nr = mkEntry('nr', { approval: 'pending' })
    const slots2 = explainEntry(nr as never, [noReason], null)
    expect(slots2[0]!.outcome).toBe('concern')
  })
})

describe('human-verdict residual branches', () => {
  const ev = (over: Record<string, unknown>) => ({
    event: 'issue_comment', action: 'created', issueTitle: '[review] pkg@1.0.0',
    issueBody: '', issueNumber: 9, actor: 'u', label: '', commentBody: '', ...over,
  }) as never
  it('mismatch without version; issues/edited re-parse; dedupeHumanVerdicts edges', async () => {
    const { resolveVerdictEvent } = await import('../pipeline/human-verdict.ts')
    // spec arg 'owner/repo' (slash, no @) on titled issue → mismatch msg w/o @ver
    const r = resolveVerdictEvent(ev({ commentBody: '/concern other/repo wrong target' }))
    expect(r.mismatch).toContain('other/repo')
    expect(r.mismatch).not.toContain('@2')
    // issues edited event on [concern] form → re-resolves
    const formBody = '### npm 包名或 owner/repo\n\npp\n\n### 版本（可留空）\n\n\n\n### 操作 / Action\n\nconcern\n'
    const edited = resolveVerdictEvent(ev({
      event: 'issues', action: 'edited', issueTitle: '[concern] x', issueBody: formBody, commentBody: '',
    }))
    expect(edited.name).toBe('pp')
    expect(edited.verdict).toBe('concern')
    // isDupVerdict: blank/mismatch/parse-error lines skipped; human+same verdict+reason → dup
    const { isDupVerdict, amendAt } = await import('../pipeline/human-verdict.ts')
    const lines = [
      '',
      'garbage line',
      JSON.stringify(verdict({ name: 'b', version: '2.0.0', verdict: 'pass', source: 'human', reason: 'r2', at: '2026-01-01T00:00:00Z' })),
      JSON.stringify(verdict({ name: 'a', version: '1.0.0', verdict: 'pass', source: 'human', reason: 'r1', at: '2026-01-01T00:00:00Z' })),
    ]
    expect(isDupVerdict(lines, 'a', '1.0.0', 'pass', 'r1')).toBe(true)
    expect(isDupVerdict(lines, 'a', '1.0.0', 'pass', 'different')).toBe(false)
    expect(isDupVerdict(lines, 'a', '9.9.9', 'pass', 'r1')).toBe(false)
    // amendAt: same verdict different reason on LATEST human line → reuse its `at`
    const amendLines = [
      JSON.stringify(verdict({ name: 'a', version: '1.0.0', verdict: 'pass', source: 'human', reason: 'old reason', at: '2026-01-01T00:00:00Z' })),
    ]
    expect(amendAt(amendLines, 'a', '1.0.0', 'pass', 'new reason')).toBe('2026-01-01T00:00:00Z')
    expect(amendAt(amendLines, 'a', '1.0.0', 'pass', 'old reason')).toBeNull()   // same reason → no amend
    expect(amendAt(amendLines, 'a', '1.0.0', 'concern', 'new reason')).toBeNull() // verdict flip → fresh ts
    expect(amendAt([''], 'a', '1.0.0', 'pass', 'r')).toBeNull()                  // only blank lines
  })
})

describe('publish/merge residual branches', () => {
  it('dup names in merged list; approval ?? chain; verified-without-redFlags keeps; category filter; now default', async () => {
    const { mergeEntries, buildIndex } = await import('../pipeline/publish/merge.ts')
    // duplicate name entries → oldByName second hit (if[1])
    const dupA = mkEntry('d', { approval: 'pending' })
    const dupB = mkEntry('d', { approval: 'approved' })
    const m = mergeEntries([dupA, dupB], mkIdx([]), 'oc1', 'r1')
    expect(m.length).toBe(2)
    // e.approval undefined → falls to prev?.approval ?? 'pending'
    const noApproval = { ...mkEntry('na'), approval: undefined } as unknown as PluginEntry
    const prevIdx = mkIdx([{ ...mkEntry('na'), approval: 'approved' as const }])
    const m2 = mergeEntries([noApproval], prevIdx, 'oc1', 'r1')
    expect(m2[0]!.approval).toBe('approved')
    const m3 = mergeEntries([{ ...mkEntry('nb'), approval: undefined } as unknown as PluginEntry], mkIdx([]), 'oc1', 'r1')
    expect(m3[0]!.approval).toBe('pending')
    // verified entry WITHOUT redFlags → stays verified (223 if[1] else arm)
    const clean = mkEntry('cl', {
      approval: 'pending',
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
    })
    const idx = mkIdx([clean])
    const results = [{ name: 'cl', version: '1.0.0', status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' }]
    // mergeResults not mergeEntries — use verify merge path instead
    const { mergeResults } = await import('../pipeline/verify/merge.ts')
    const out = mergeResults(idx, results as never)
    expect(out.plugins[0]!.verification.status).toBe('verified')
    // flagged slot + verified result without level → skipped, level ?? 'install'
    const flaggedIdx = mkIdx([mkEntry('fl', { approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] } })])
    const out2 = mergeResults(flaggedIdx, [{ name: 'fl', version: '1.0.0', status: 'verified' }] as never)
    expect(out2.plugins[0]!.verification.status).toBe('skipped')
    expect(out2.plugins[0]!.verification.level).toBe('install')
    // buildIndex without opts.now + category ?? [] + unknown catId filtered
    const eCat = mkEntry('cat', { category: ['tools', 'bogus'] as never, approval: 'pending' })
    const eNoCat = { ...mkEntry('nc'), category: undefined } as unknown as PluginEntry
    const bi = buildIndex([eCat, eNoCat], mkIdx([]), { opencodeVersion: 'oc1' })
    expect(bi.index.plugins.find(p => p.name === 'cat')!.category).toEqual(['tools'])
    expect(typeof bi.index.generatedAt).toBe('string')
  })
})

describe('plan residual branches', () => {
  it('skill-only parts → hasParts true via right arm; contains:[] → skipped in planTargets', async () => {
    const { verifyPartsOf, planTargets } = await import('../pipeline/verify/plan.ts')
    const skillOnly = mkEntry('sk', { contains: ['skill'] as never, approval: 'pending' })
    expect(verifyPartsOf(skillOnly)).toEqual(['skill'])
    const noparts = mkEntry('np', { contains: [] as never, approval: 'pending' })
    expect(verifyPartsOf(noparts)).toEqual([])
    // planTargets skips entries with no plugin/skill parts
    const targets = planTargets(mkIdx([skillOnly, noparts, mkEntry('pm', { contains: ['plugin'] as never, approval: 'pending' })]))
    expect(targets.every(t => t.name !== 'np')).toBe(true)
    expect(targets.some(t => t.name === 'sk')).toBe(true)
    // hostStaleVerify: verified on old opencode → stale; same version no-ver → false
    const { OPENCODE_VERSION } = await import('../pipeline/publish/merge.ts')
    const stale = mkEntry('st', { latestVersion: '1.0.0', verification: { status: 'verified', level: 'load', opencodeVersion: 'oc-old', verifiedAt: 't' } as never })
    expect(hostStaleVerify(stale)).toBe(true)
    const cur = mkEntry('st2', { verification: { status: 'verified', level: 'load', opencodeVersion: OPENCODE_VERSION, verifiedAt: 't' } as never })
    expect(hostStaleVerify(cur)).toBe(false)
  })
})

describe('checkTui settleMs default + submission sections + misc', () => {
  it('checkTui without settleMs uses 8s default (tmux mocked)', async () => {
    vi.useFakeTimers()
    const run = (async (_c: string, args: string[]) => {
      if (args.includes('new-session')) return { stdout: '', stderr: '' }
      if (args[0] === 'has-session') return { stdout: '', stderr: '' }
      if (args[0] === 'capture-pane') return { stdout: 'opencode v1 ' + 'x'.repeat(30), stderr: '' }
      return { stdout: '', stderr: '' }
    }) as never
    const p = checkTui({}, run)
    await vi.advanceTimersByTimeAsync(8100)
    const r = await p
    vi.useRealTimers()
    expect(r.ok).toBe(true)
  })
  it('sections(): negative lookahead + type/skill edges', async () => {
    const { sections: secs, parseSubmission } = await import('../pipeline/submission.ts')
    // body without '### ' headers → empty map (nl<0 continue arm)
    expect(secs('just text no headers\nmore text\n').size).toBe(0)
    const sub = parseSubmission('### npm 包名或 owner/repo\n\nmy-pkg\n\n### 类型\n\nskill\n')
    expect(sub.name).toBe('my-pkg')
  })
  it('fetchTarball small body success + MAX cap false arm', async () => {
    const small = tgzOf(['package/SKILL.md', '# hi'])
    const tb = await fetchTarball('https://r/s.tgz', { fetchFn: (async () => new Response(new Uint8Array(small))) as typeof fetch })
    expect(tb.length).toBe(small.length)
  })
})
