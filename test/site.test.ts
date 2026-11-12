import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanLabel, verifyLabel, buildSite, listPage, detailPage } from '../pipeline/site/build.ts'
import type { PluginEntry, CatalogIndex } from '../src/schema.ts'

const mk = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: { en: 'desc' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 5, npmDownloads30d: 100, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})

describe('site honest labels', () => {
  it('scanLabel distinguishes all four states', () => {
    expect(scanLabel(mk()).text).toBe('not scanned')
    expect(scanLabel(mk({ capabilities: { scannedAt: 't', findings: [], redFlags: [] } })).text).toBe('scanned, no findings')
    expect(scanLabel(mk({ capabilities: { scannedAt: 't', findings: ['x'], redFlags: [] } })).text).toContain('finding')
    expect(scanLabel(mk({ capabilities: { scannedAt: 't', findings: [], redFlags: ['r'] } })).cls).toBe('bad')
  })
  it('verifyLabel covers all statuses', () => {
    expect(verifyLabel(mk()).text).toBe('unverified')
    expect(verifyLabel(mk({ verification: { status: 'verified', level: 'load' } })).text).toBe('verified (load)')
    expect(verifyLabel(mk({ verification: { status: 'failed' } })).cls).toBe('bad')
    // 'skipped' requires CURRENT redFlags to claim high risk (AGENTS.md) —
    // an unflagged skip is stale and renders 'unverified' instead
    expect(verifyLabel(mk({ verification: { status: 'skipped' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['x:y'] } })).text).toContain('skipped')
    expect(verifyLabel(mk({ verification: { status: 'skipped' } })).text).toBe('unverified')
  })
  it('verifyLabel: github-kind skipped is not "high risk" — nothing to install', () => {
    // github-kind entries are constructed as skipped with zero flags: there is
    // no npm artifact to run. "skipped (high risk)" would be a lie (AGENTS.md).
    const gh = mk({ latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'o/r' },
      verification: { status: 'skipped', level: 'install' } })
    expect(verifyLabel(gh).text).toBe('nothing to install')
    expect(verifyLabel(gh).text).not.toContain('high risk')
    // an npm entry skipped WITH red flags still reports high risk honestly
    const flagged = mk({ verification: { status: 'skipped' }, capabilities: { scannedAt: 't', findings: [], redFlags: ['x:y'] } })
    expect(verifyLabel(flagged).text).toContain('skipped')
  })
  it('detailPage renders honest semantics + escaped content', () => {
    const html = detailPage(mk({ description: { en: '<script>x</script>' }, source: { kind: 'npm', id: 'p', repo: 'o/p' } }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('opencode plugin add p')
  })
  it('buildSite writes index + detail pages', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [mk({ name: 'a' }), mk({ name: 'b' })], removed: [] }
    await buildSite(idx, out)
    expect(existsSync(join(out, 'index.json'))).toBe(true)
    expect(existsSync(join(out, 'p', 'o/p.html'))).toBe(true)
    const list = readFileSync(join(out, 'index.html'), 'utf8')
    expect(list).toContain('2 entries')
  })
  it('listPage search input present', () => {
    expect(listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] })).toContain('id=q')
  })
})
  it('buildSite writes skills/index.json even when skill tarball unavailable', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'definitely-not-a-real-pkg-zz9', contains: ['skill'] }), mk({ name: 'b' })], removed: [] }
    await buildSite(idx, out)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(Array.isArray(cat.skills)).toBe(true)
    expect(cat.skills).toHaveLength(0)   // npm view fails → skipped, no crash
    rmSync(out, { recursive: true, force: true })
  }, 60000)
  it('buildSkillCatalog success path: extracts SKILL.md from real tgz', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { execSync } = await import('node:child_process')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# demo skill')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-real', contains: ['skill'], latestVersion: '2' })], removed: [] }
    await buildSkillCatalog(idx, out, () => `file://${join(src, 's.tgz')}`)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toHaveLength(1)
    expect(cat.skills[0].name).toBe('sk-real')
    expect(cat.skills[0].files).toContain('SKILL.md')
    expect(existsSync(join(out, 'skills', 'sk-real', 'SKILL.md'))).toBe(true)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })
  it('buildSkillCatalog pins the approved version — never dist-tags.latest', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { execSync } = await import('node:child_process')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# pinned')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    // approved 1.2.3 while npm latest would be a held pendingUpdate
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-pin', contains: ['skill'], latestVersion: '1.2.3' })], removed: [] }
    const seen: string[] = []
    await buildSkillCatalog(idx, out, (spec) => { seen.push(spec); return `file://${join(src, 's.tgz')}` })
    expect(seen).toEqual(['sk-pin@1.2.3'])
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })
  it('buildSkillCatalog edge: slug fallback, version default, empty md skip', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { execSync } = await import('node:child_process')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    execSync(`cd "${src}" && tar czf empty.tgz package`)   // tarball with no .md
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    execSync(`cd "${src}" && tar czf ok.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: '', slug: 'fb-slug', contains: ['skill'], latestVersion: '3' }),     // id falls back to slug
      mk({ name: 'sk-empty', contains: ['skill'] }),                                  // empty md → skipped
      mk({ name: 'sk-nover', contains: ['skill'], latestVersion: null }),             // no approved version → skipped, never latest
    ], removed: [] }
    const specs: string[] = []
    await buildSkillCatalog(idx, out, (n) => { specs.push(n); return n.startsWith('sk-empty') ? `file://${join(src, 'empty.tgz')}` : `file://${join(src, 'ok.tgz')}` })
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toHaveLength(1)
    expect(cat.skills[0].version).toBe('3')
    expect(specs).toEqual(['@3', 'sk-empty@1.0.0'])   // sk-nover never reached tarballOf
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })
  it('buildSkillCatalog skips ids that would escape the skills dir', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { execSync } = await import('node:child_process')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      // name '' → id falls back to slug; '../../escape' would rmSync/renameSync outside skills/
      mk({ name: '', slug: '../../escape', contains: ['skill'], latestVersion: '1' }),
      // '..' basename — dest would resolve to the skills dir's parent
      mk({ name: '..', slug: 'dotdot', contains: ['skill'], latestVersion: '1' }),
      mk({ name: 'sk-ok', contains: ['skill'], latestVersion: '1' }),
    ], removed: [] }
    const specs: string[] = []
    await buildSkillCatalog(idx, out, (n) => { specs.push(n); return `file://${join(src, 's.tgz')}` })
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toHaveLength(1)
    expect(cat.skills[0].name).toBe('sk-ok')
    // rejected at plan stage — no tarball fetch was even attempted for them
    expect(specs).toEqual(['sk-ok@1'])
    expect(existsSync(join(out, 'escape'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

describe('buildSkillCatalog github-kind entries', () => {
  const mkGhTgz = () => {
    const src = mkdtempSync(join(tmpdir(), 'gh-'))
    // codeload archives wrap content in <repo>-<ref>/ — --strip-components=1 peels it
    mkdirSync(join(src, 'repo-abc123', 'skills', 'demo'), { recursive: true })
    writeFileSync(join(src, 'repo-abc123', 'skills', 'demo', 'SKILL.md'), '# gh skill')
    execSync(`cd "${src}" && tar czf s.tgz repo-abc123`)
    return { src, tgz: join(src, 's.tgz') }
  }
  const ghEntry = (over: Partial<PluginEntry> = {}): PluginEntry => mk({
    name: 'gh-skill', contains: ['skill'], latestVersion: null,
    source: { kind: 'github', id: 'o/gh-skill', repo: 'o/gh-skill' },
    modifiedAt: '2026-03-01T00:00:00Z', ...over,
  })

  it('github skill → codeload path, version = modifiedAt, md extracted', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { src, tgz } = mkGhTgz()
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [ghEntry()], removed: [] }
    const npmSpecs: string[] = []; const ghRepos: string[] = []
    await buildSkillCatalog(idx, out,
      (spec) => { npmSpecs.push(spec); return null },
      undefined,
      (repo) => { ghRepos.push(repo); return `file://${tgz}` })
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(npmSpecs).toHaveLength(0)                        // github never hits npm tarballOf
    expect(ghRepos).toEqual(['o/gh-skill'])
    expect(cat.skills).toHaveLength(1)
    expect(cat.skills[0].version).toBe('2026-03-01T00:00:00Z')   // pushedAt marker
    expect(cat.skills[0].files).toContain('skills/demo/SKILL.md')
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('github entry without modifiedAt or with malformed repo is skipped', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      ghEntry({ name: 'g1', modifiedAt: null }),
      ghEntry({ name: 'g2', source: { kind: 'github', id: 'g2', repo: 'not a repo' } }),
    ], removed: [] }
    const ghRepos: string[] = []
    const r = await buildSkillCatalog(idx, out, () => null, undefined, (repo) => { ghRepos.push(repo); return null })
    expect(ghRepos).toHaveLength(0)
    expect(r.candidates).toBe(0)
    rmSync(out, { recursive: true, force: true })
  })

  it('source.version (commit sha) pins codeload — served bytes = scanned bytes', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { src, tgz } = mkGhTgz()
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      ghEntry({ source: { kind: 'github', id: 'o/gh-skill', repo: 'o/gh-skill', version: 'abc123def' } }),
    ], removed: [] }
    const seen: (string | null | undefined)[][] = []
    await buildSkillCatalog(idx, out, () => null, undefined,
      (repo, sha) => { seen.push([repo, sha]); return `file://${tgz}` })
    expect(seen).toEqual([['o/gh-skill', 'abc123def']])
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].version).toBe('abc123def')   // sha is the version marker now
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('pre-sha github rows count as unpinned — HEAD fallback disclosed in stats', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const { src, tgz } = mkGhTgz()
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      ghEntry({ name: 'g-old' }),   // no source.version → codeload HEAD
      ghEntry({ name: 'g-new', source: { kind: 'github', id: 'o/gh-skill', repo: 'o/gh-skill', version: 'abc123def' } }),
    ], removed: [] }
    const r = await buildSkillCatalog(idx, out, () => null, undefined, () => `file://${tgz}`)
    expect(r.unpinned).toBe(1)
    expect(r.landed).toBe(2)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })
})

describe('buildSkillCatalog failure paths', () => {
  it('tarball fetch failure → skill skipped, tmp dir cleaned', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-dead', contains: ['skill'], latestVersion: '9' })], removed: [] }
    // https URL that refuses — curl -f fails fast on a refused connection
    await buildSkillCatalog(idx, out, () => 'https://127.0.0.1:1/nope.tgz')
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toHaveLength(0)
    expect(existsSync(join(out, 'skills', 'sk-dead.tmp'))).toBe(false)
    rmSync(out, { recursive: true, force: true })
  })
})

describe('skill catalog hardening (S-1/S-4/S-5/S-12)', () => {
  const tgz = (dir: string, files: Record<string, string>, links: Record<string, string> = {}) => {
    mkdirSync(join(dir, 'package'), { recursive: true })
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, 'package', p, '..'), { recursive: true })
      writeFileSync(join(dir, 'package', p), c)
    }
    for (const [p, tgt] of Object.entries(links)) {
      mkdirSync(join(dir, 'package', p, '..'), { recursive: true })
      execSync(`ln -sf "${tgt}" "${join(dir, 'package', p)}"`)
    }
    execSync(`cd "${dir}" && tar czf s.tgz package`)
    return `file://${join(dir, 's.tgz')}`
  }

  it('S-1 cache: hit skips network entirely; version bump refetches; stale pruned', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    const idx = (ver: string): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-c', contains: ['skill'], latestVersion: ver })], removed: [] })
    // miss → fetch + seed cache
    const url = tgz(src, { 'SKILL.md': '# v1' })
    let calls = 0
    await buildSkillCatalog(idx('1.0.0'), out, () => { calls++; return url }, cache)
    expect(calls).toBe(1)
    expect(existsSync(join(cache, 'sk-c%401.0.0', 'SKILL.md'))).toBe(true)
    // hit → zero network
    calls = 0
    await buildSkillCatalog(idx('1.0.0'), out, () => { calls++; return 'https://127.0.0.1:1/x' }, cache)
    expect(calls).toBe(0)
    expect(existsSync(join(out, 'skills', 'sk-c', 'SKILL.md'))).toBe(true)
    // bump → refetch + old key pruned
    calls = 0
    await buildSkillCatalog(idx('2.0.0'), out, () => { calls++; return url }, cache)
    expect(calls).toBe(1)
    expect(existsSync(join(cache, 'sk-c%401.0.0'))).toBe(false)
    expect(existsSync(join(cache, 'sk-c%402.0.0'))).toBe(true)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true })
  })

  it('S-4/S-5 two-pass extract: node_modules never lands; .md symlink members are removed', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const url = tgz(src, { 'SKILL.md': '# ok', 'node_modules/dep/README.md': '# leak', 'docs/UP.MD': '# caps' }, { 'evil.md': '/tmp/pwned-site' })
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-x', contains: ['skill'], latestVersion: '1' })], removed: [] }
    await buildSkillCatalog(idx, out, () => url)
    const dest = join(out, 'skills', 'sk-x')
    expect(existsSync(join(dest, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dest, 'docs', 'UP.MD'))).toBe(true)
    expect(existsSync(join(dest, 'node_modules'))).toBe(false)
    expect(existsSync(join(dest, 'evil.md'))).toBe(false)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].files).not.toContain('evil.md')
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('S-12 id collision: namespaced a--x vs literal a--x package get unique dirs', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const url = tgz(src, { 'SKILL.md': '# x' })
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: '@a/x', contains: ['skill'], latestVersion: '1' }),
      mk({ name: '@b/x', contains: ['skill'], latestVersion: '1' }),
      mk({ name: 'a--x', contains: ['skill'], latestVersion: '1' }),
    ], removed: [] }
    await buildSkillCatalog(idx, out, () => url)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    const names = cat.skills.map((s: { name: string }) => s.name).sort()
    expect(new Set(names).size).toBe(3)
    expect(names).toContain('a--x')        // one of them claims the bare id
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('all skill payload files ship — scripts/configs included, url-unsafe names filtered', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const url = tgz(src, {
      'SKILL.md': '# x', 'scripts/run.py': 'print(1)', 'data/cfg.json': '{}',
      'a#b.md': '# fragment-name must not ship', 'sp ace.md': '# spaced ok',
    })
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-files', contains: ['skill'], latestVersion: '1' })], removed: [] }
    await buildSkillCatalog(idx, out, () => url)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    const files: string[] = cat.skills[0].files
    expect(files).toContain('SKILL.md')
    expect(files).toContain('scripts/run.py')
    expect(files).toContain('data/cfg.json')
    expect(files).toContain('sp ace.md')
    expect(files).not.toContain('a#b.md')
    expect(existsSync(join(out, 'skills', 'sk-files', 'a#b.md'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('over-sized single files are dropped, oversized payload skips the skill', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const url = tgz(src, { 'SKILL.md': '# x', 'big.bin': Buffer.alloc(3 * 1024 * 1024, 65).toString() })
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-big', contains: ['skill'], latestVersion: '1' })], removed: [] }
    await buildSkillCatalog(idx, out, () => url)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].files).toEqual(['SKILL.md'])
    expect(existsSync(join(out, 'skills', 'sk-big', 'big.bin'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('SRI: index-announced integrity gates the served tarball — mismatch skips', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const url = tgz(src, { 'SKILL.md': '# pinned' })
    const tgzPath = new URL(url).pathname
    const good = `sha512-${createHash('sha512').update(readFileSync(tgzPath)).digest('base64')}`
    const idx = (integrity: string | null): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-sri', contains: ['skill'], latestVersion: '1', integrity })], removed: [] })
    // match → landed + cache keyed by integrity, not version
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    const r = await buildSkillCatalog(idx(good), out, () => url, cache)
    expect(r.landed).toBe(1)
    expect([...readdirSync(cache)].some(d => decodeURIComponent(d).startsWith('sk-sri@sha512-'))).toBe(true)
    // mismatch → skipped (re-tag / corrupted artifact never ships)
    const r2 = await buildSkillCatalog(idx('sha512-deadbeef'), out, () => url)
    expect(r2.landed).toBe(0)
    // integrity null → unverifiable, proceeds (same contract as the client)
    const r3 = await buildSkillCatalog(idx(null), out, () => url)
    expect(r3.landed).toBe(1)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true })
  })

  it('warm cache rides out an outage; bump keys are kept even when the fetch fails', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    const url = tgz(src, { 'SKILL.md': '# v1' })
    const idx = (ver: string): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-k', contains: ['skill'], latestVersion: ver })], removed: [] })
    await buildSkillCatalog(idx('1.0.0'), out, () => url, cache)
    expect(existsSync(join(cache, 'sk-k%401.0.0'))).toBe(true)
    // outage run: pinned cache hit serves the skill with zero network — the
    // catalog doesn't degrade at all while the same pin holds
    const r = await buildSkillCatalog(idx('1.0.0'), out, () => null, cache)
    expect(r.landed).toBe(1)
    // version bumped during the outage → new key misses, fetch fails → the
    // old pin is obsolete and pruned, the new key is kept for retry
    const r2 = await buildSkillCatalog(idx('1.1.0'), out, () => null, cache)
    expect(r2.landed).toBe(0)
    expect(existsSync(join(cache, 'sk-k%401.0.0'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true })
  })
})

describe('site extras (S-2/S-3/S-7/S-9/S-10)', () => {
  it('health.json carries skill stats + degraded flag', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'a' }),
      mk({ name: 'sk-1', contains: ['skill'], latestVersion: '1' }),
      mk({ name: 'sk-2', contains: ['skill'], latestVersion: '1' })], removed: [] }
    await buildSite(idx, out)   // real tarballOf → npm view fails → 0/2 landed → degraded
    const h = JSON.parse(readFileSync(join(out, 'health.json'), 'utf8'))
    expect(h.entries).toBe(3)
    expect(h.skills).toMatchObject({ candidates: 2, landed: 0, degraded: true })
    // disclosure counters ride along even when zero — ops can tell "no
    // unpinned rows" apart from "field missing on an old snapshot"
    expect(h.skills).toMatchObject({ unpinned: 0, membersDropped: 0 })
    // sha256 covers the exact serialized index.json bytes — manifest-first fetch
    // pins on this; a drifted/truncated index must never match
    const indexBytes = readFileSync(join(out, 'index.json'))
    expect(h.sha256).toBe(createHash('sha256').update(indexBytes).digest('hex'))
    expect(h.bytes).toBe(indexBytes.length)
    expect(h.generatedAt).toBe('t')
    rmSync(out, { recursive: true, force: true })
  }, 60000)

  it('S-3 healthGate: absolute floor + 50%-of-previous ratio', async () => {
    const { healthGate } = await import('../pipeline/site/build.ts')
    expect(healthGate(null, { entries: 500 })).toBeNull()
    expect(healthGate(null, { entries: 50 })).toContain('floor')
    expect(healthGate({ entries: 1000 }, { entries: 400 })).toContain('50%')
    expect(healthGate({ entries: 1000 }, { entries: 600 })).toBeNull()
    expect(healthGate({ entries: null as unknown as number }, { entries: 500 })).toBeNull()
    // S-15: a >50% skill-fetch outage gates deploy — infra failure, not data
    expect(healthGate(null, { entries: 500, skills: { candidates: 20, landed: 5, degraded: true } })).toContain('skills degraded')
    expect(healthGate(null, { entries: 500, skills: { candidates: 20, landed: 15, degraded: false } })).toBeNull()
    expect(healthGate(null, { entries: 500, skills: { candidates: 3, landed: 1, degraded: true } })).toBeNull()   // tiny set → warn only
    // floor is a parameter — a small curated catalog must publish below 200
    expect(healthGate(null, { entries: 50 }, 40)).toBeNull()
    expect(healthGate(null, { entries: 50 }, 60)).toContain('floor 60')
  })

  it('index.json is the only data file — full catalog incl pending; lite dropped (no consumer)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'a', pendingUpdate: { version: '9', heldAt: 't', capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' } } }),
      mk({ name: 'b', approval: 'pending' })], removed: [] }
    await buildSite(idx, out)
    expect(existsSync(join(out, 'index.lite.json'))).toBe(false)
    const full = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(full.plugins).toHaveLength(2)   // full index keeps pending — auditable
    expect(full.plugins[0].pendingUpdate).toBeTruthy()
    expect(existsSync(join(out, '404.html'))).toBe(true)
    expect(readFileSync(join(out, '404.html'), 'utf8')).toContain('removed.html')
    rmSync(out, { recursive: true, force: true })
  })

  it('S-9/S-10 removed.html + skills.html pages render', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [mk({ name: 'a' })], removed: [
      { slug: 'o/gone', name: 'gone-pkg', disappearedAt: '2026-01-02T00:00:00Z', reason: 'npm-404' },
      { slug: 'o/old', name: 'old-pkg', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' }] }
    await buildSite(idx, out)
    const rem = readFileSync(join(out, 'removed.html'), 'utf8')
    expect(rem).toContain('gone-pkg')
    expect(rem.indexOf('gone-pkg')).toBeLessThan(rem.indexOf('old-pkg'))  // newest first
    expect(readFileSync(join(out, 'skills.html'), 'utf8')).toContain('skills')
    const list = readFileSync(join(out, 'index.html'), 'utf8')
    expect(list).toContain('removed.html')
    rmSync(out, { recursive: true, force: true })
  })

  it('listPage: category select + zh description + escaped data-cats', () => {
    const html = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'a', category: ['tools'], description: { en: 'e', zh: '中"文' } })], removed: [] })
    expect(html).toContain('id=cat')
    expect(html).toContain('<option value="tools">')
    expect(html).toContain('data-cats="[&quot;tools&quot;]"')
    expect(html).toContain('中&quot;文')
  })

  it('buildSite clears stale output before writing', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    writeFileSync(join(out, 'stale.html'), 'old')
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] }, out)
    expect(existsSync(join(out, 'stale.html'))).toBe(false)
    rmSync(out, { recursive: true, force: true })
  })

  it('skillsPage hrefs are URI-encoded — spaced/unicode filenames must not 404', async () => {
    const { skillsPage } = await import('../pipeline/site/build.ts')
    const html = skillsPage([{ name: 'sk', version: '1', files: ['docs/my file.md', 'README.md'] }])
    expect(html).toContain('href="skills/sk/docs/my%20file.md"')
    expect(html).not.toContain('href="skills/sk/docs/my file.md"')
    expect(html).toContain('>docs/my file.md<')   // display text stays human-readable
  })

  it('installHint mirrors installPlan — github plugin gets no bogus add line', async () => {
    const { installHint } = await import('../pipeline/site/build.ts')
    // npm plugin → pinned plugin add
    expect(installHint(mk({ latestVersion: '2.0.0' }))).toContain('opencode plugin add p@2.0.0')
    // dual-nature npm → plugin + skills catalog
    const dual = installHint(mk({ contains: ['plugin', 'skill'] }))
    expect(dual).toContain('opencode plugin add')
    expect(dual).toContain('skills catalog')
    // github plugin-only → browse only (client itself has no path)
    const ghPlugin = mk({ latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'o/r' } })
    expect(installHint(ghPlugin)).toContain('browse only')
    expect(installHint(ghPlugin)).not.toContain('plugin add')
    // github skill → skills catalog link
    const ghSkill = mk({ latestVersion: null, type: 'skill', contains: ['skill'],
      source: { kind: 'github', id: 'o/s', repo: 'o/s' } })
    expect(installHint(ghSkill)).toContain('skills catalog')
    // versionless npm entry → browse only
    expect(installHint(mk({ latestVersion: null }))).toContain('browse only')
    // github skill with malformed repo — catalog skips it, hint must not promise it
    const ghBad = mk({ latestVersion: null, contains: ['skill'],
      source: { kind: 'github', id: 'x', repo: 'not a repo' } })
    expect(installHint(ghBad)).toContain('browse only')
    expect(installHint(ghBad)).not.toContain('skills catalog')
    // mcp-type without contains — no plugin payload to `plugin add`
    expect(installHint(mk({ type: 'mcp' }))).toContain('browse only')
  })

  it('detailPage nested slug → root links carry one "../" per slug segment', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const h = detailPage(mk({ slug: 'owner/repo', contains: ['skill'] }))
    expect(h).toContain('href="../../index.html"')
    expect(h).toContain('href="../../skills.html"')
    const flat = detailPage(mk({ slug: 'flat' }))
    expect(flat).toContain('href="../index.html"')
    expect(flat).not.toContain('href="../../index.html"')
  })

  it('detailPage pendingUpdate renders held version verify+scan state', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const h = detailPage(mk({ pendingUpdate: {
      version: '9.9.9', heldAt: '2026-02-02T00:00:00Z', reason: 'awaiting-review',
      publishedAt: '2026-02-01T00:00:00Z',
      capabilities: { scannedAt: 't', findings: ['net:x'], redFlags: [] },
      verification: { status: 'failed', level: 'install', logExcerpt: 'boom' } } }))
    expect(h).toContain('v9.9.9')
    expect(h).toContain('under review')
    expect(h).toContain('verification failed (install)')
    expect(h).toContain('finding')
    expect(h).toContain('next version findings')
    expect(h).toContain('next version failure log')
  })

  it('listPage: categories registry labels, aliases, deprecated + under-review badges', async () => {
    const { listPage } = await import('../pipeline/site/build.ts')
    const html = listPage({
      version: '1', generatedAt: 't',
      categories: { tools: { en: 'tools & capabilities', zh: '工具与能力' } },
      plugins: [
        mk({ name: 'a', category: ['tools'], aliases: ['old-a'], deprecated: true }),
        mk({ name: 'b', pendingUpdate: { version: '2', heldAt: 't', capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' } } }),
      ], removed: [] })
    expect(html).toContain('tools &amp; capabilities · 工具与能力')
    expect(html).toContain('old-a')
    expect(html).toContain('data-zh="又名"')
    expect(html).toContain('>deprecated</span>')
    expect(html).toContain('update under review')
    expect(html).toContain('JSON.parse')   // category filter parses the JSON array back
    const empty = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [], removed: [] })
    expect(empty).toContain('no entries yet')
  })

  it('removedPage: human-readable reasons + lastSource link', async () => {
    const { removedPage } = await import('../pipeline/site/build.ts')
    const html = removedPage({ version: '1', generatedAt: 't', categories: {}, plugins: [], removed: [
      { slug: 'o/x', name: 'x', disappearedAt: '2026-01-02T00:00:00Z', reason: 'npm-404' },
      { slug: 'o/y', name: 'y', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual',
        lastSource: { kind: 'github', id: 'o/y', repo: 'o/y' } },
    ] })
    expect(html).toContain('unpublished from npm')
    expect(html).toContain('removed by maintainer')
    expect(html).toContain('href="https://github.com/o/y"')
  })

  it('404.html uses absolute site-base links — survives any missing-path depth', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] }, out)
    const h = readFileSync(join(out, '404.html'), 'utf8')
    expect(h).toMatch(/href="\/[^"]*removed\.html"/)
    expect(h).toMatch(/href="\/[^"]*index\.html"/)
    expect(h).not.toContain('href="removed.html"')   // relative link would die on deep 404s
    rmSync(out, { recursive: true, force: true })
  })
})

describe('site audit hardening — gate totals, active content, i18n, url safety', () => {
  it('healthGate compares TOTAL catalog size — a visible collapse (mass brake) must not freeze the deploy', async () => {
    const { healthGate } = await import('../pipeline/site/build.ts')
    // prev deploy: 3000 total / 2082 visible; current: same total but only
    // 400 visible (brakes pulled approvals back to pending) → gate must PASS:
    // the brake HAS to reach the site or the flagged packages keep serving.
    expect(healthGate({ entries: 2082, total: 3000 }, { entries: 400, total: 3000 })).toBeNull()
    // genuine catalog shrink still blocks — total halves
    expect(healthGate({ entries: 2082, total: 3000 }, { entries: 1500, total: 1400 })).toContain('50%')
    // floor also reads total: a catalog of pending-only entries is not "empty"
    expect(healthGate(null, { entries: 0, total: 500 })).toBeNull()
    // legacy prev without `total` falls back to entries
    expect(healthGate({ entries: 1000 }, { entries: 400, total: 3000 })).toBeNull()
    expect(healthGate({ entries: 1000 }, { entries: 400, total: 400 })).toContain('50%')
  })

  it('health.json carries total + builtAt + commit alongside the visible count', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    process.env.SITE_COMMIT = 'abc123'
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk(), mk({ name: 'b', approval: 'pending' })], removed: [] }, out)
    delete process.env.SITE_COMMIT
    const h = JSON.parse(readFileSync(join(out, 'health.json'), 'utf8'))
    expect(h.entries).toBe(1)        // visible only — informational
    expect(h.total).toBe(2)          // full catalog incl. pending — gate input
    expect(h.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(h.commit).toBe('abc123')
    rmSync(out, { recursive: true, force: true })
  })

  it('SKIP_SKILLS=1 publishes an empty skills catalog without fetching tarballs', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    process.env.SKIP_SKILLS = 'true'
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-x', contains: ['skill'], latestVersion: '1' })], removed: [] }, out)
    delete process.env.SKIP_SKILLS
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toEqual([])
    const h = JSON.parse(readFileSync(join(out, 'health.json'), 'utf8'))
    expect(h.skills).toMatchObject({ candidates: 0, landed: 0, degraded: false })
    rmSync(out, { recursive: true, force: true })
  })

  it('web-active payload files (.html/.svg/.js) are withheld from the HTTP skill catalog', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    writeFileSync(join(src, 'package', 'evil.html'), '<script>alert(1)</script>')
    writeFileSync(join(src, 'package', 'icon.svg'), '<svg onload=alert(1)>')
    writeFileSync(join(src, 'package', 'helper.js'), 'console.log(1)')
    writeFileSync(join(src, 'package', 'notes.txt'), 'ok')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-act', contains: ['skill'], latestVersion: '1' })], removed: [] }
    await buildSkillCatalog(idx, out, () => `file://${join(src, 's.tgz')}`)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    const files: string[] = cat.skills[0].files
    expect(files).toEqual(['SKILL.md', 'notes.txt'].sort())
    expect(existsSync(join(out, 'skills', 'sk-act', 'evil.html'))).toBe(false)
    expect(existsSync(join(out, 'skills', 'sk-act', 'helper.js'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('tar members beyond MAX_SKILL_MEMBERS are dropped AND counted in stats', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    for (let i = 0; i < 105; i++) writeFileSync(join(src, 'package', `f${i}.md`), `# ${i}`)
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-big', contains: ['skill'], latestVersion: '1' })], removed: [] }
    const r = await buildSkillCatalog(idx, out, () => `file://${join(src, 's.tgz')}`)
    expect(r.membersDropped).toBe(6)              // 106 members − 100 cap
    expect(r.landed).toBe(1)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].files.length).toBeLessThanOrEqual(100)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('npm skill version binds to the approved bytes — integrity tag appended', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const tgzPath = join(src, 's.tgz')
    const sri = `sha512-${createHash('sha512').update(readFileSync(tgzPath)).digest('base64')}`
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-v', contains: ['skill'], latestVersion: '1.2.3', integrity: sri })], removed: [] }
    await buildSkillCatalog(idx, out, () => `file://${tgzPath}`)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    // version tag = sha256 of the announced SRI, hex — semver-safe build metadata
    const tag = createHash('sha256').update(sri).digest('hex').slice(0, 10)
    expect(cat.skills[0].version).toBe(`1.2.3+${tag}`)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('SRI check honors the announced algo — sha1 verifies, unparseable skips (fail-closed)', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const tgzPath = join(src, 's.tgz')
    const buf = readFileSync(tgzPath)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx = (integrity: string | null): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-algo', contains: ['skill'], latestVersion: '1', integrity })], removed: [] })
    const url = `file://${tgzPath}`
    // correct sha1 → lands (previously hard-failed on the sha512-only compare)
    expect((await buildSkillCatalog(idx(`sha1-${createHash('sha1').update(buf).digest('base64')}`), out, () => url)).landed).toBe(1)
    // wrong sha1 → real mismatch → skipped
    expect((await buildSkillCatalog(idx('sha1-deadbeef'), out, () => url)).landed).toBe(0)
    // unparseable integrity → announced but unverifiable → skipped: the
    // publish surface fails closed rather than serve unpinned bytes
    expect((await buildSkillCatalog(idx('not-a-sri'), out, () => url)).landed).toBe(0)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('unsafe slugs never reach the filesystem — detail page skipped, entry kept in index.json', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const evil = mk({ name: 'evil', slug: '../../escape' })
    const good = mk({ name: 'good', slug: 'o/good' })
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [evil, good], removed: [] }, out)
    expect(existsSync(join(out, 'p', 'o', 'good.html'))).toBe(true)
    // nothing may land outside p/ — check the would-be traversal target
    expect(existsSync(join(out, 'escape.html'))).toBe(false)
    expect(existsSync(join(out, '..', 'escape.html'))).toBe(false)
    const full = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(full.plugins).toHaveLength(2)   // data plane keeps it — auditability
    rmSync(out, { recursive: true, force: true })
  })

  it('non-https verification.runUrl renders as text — never a javascript: link', async () => {
    const evil = detailPage(mk({ verification: { status: 'verified', level: 'install', runUrl: 'javascript:alert(1)' } }))
    expect(evil).not.toContain('href="javascript:')
    expect(evil).toContain('javascript:alert(1)')
    const ok = detailPage(mk({ verification: { status: 'verified', level: 'install', runUrl: 'https://ci.example/run/1' } }))
    expect(ok).toContain('href="https://ci.example/run/1"')
  })

  it('pages ship data-en/data-zh pairs + the footer lang toggle', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] }, out)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).toContain('data-zh="未扫描"')
    expect(html).toContain('id=langsw')
    expect(html).toContain('ocm-lang')
    const d = readFileSync(join(out, 'p', 'o', 'p.html'), 'utf8')
    expect(d).toContain('data-zh="隐私"')          // footer privacy link, depth-aware
    expect(d).toContain('href="../../privacy.html"')
    rmSync(out, { recursive: true, force: true })
  })
})

describe('site audit round — routing parity, honest empty states, ops polish', () => {
  it('buildSkillCatalog routes through entryParts: legacy type:skill (no contains) lands; contains:[] does not', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# legacy')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'legacy-skill', type: 'skill', latestVersion: '1' }),   // no contains — type fallback must still route it
      mk({ name: 'no-parts', contains: [] }),                            // explicit [] = no installable payload
      mk({ name: 'dual', contains: ['plugin', 'skill'], latestVersion: '1' }),
    ], removed: [] }
    const r = await buildSkillCatalog(idx, out, () => `file://${join(src, 's.tgz')}`)
    expect(r.candidates).toBe(2)              // legacy + dual — no-parts never a candidate
    expect(r.landed).toBe(2)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills.map((s: { name: string }) => s.name).sort()).toEqual(['dual', 'legacy-skill'])
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('default ghTarballOf rejects a non-hex source pin — never fetches un-reviewed bytes', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'gh-s', contains: ['skill'], latestVersion: null,
        source: { kind: 'github', id: 'o/s', repo: 'o/s', version: 'not-a-hex!!' },
        modifiedAt: '2026-03-01T00:00:00Z' })], removed: [] }
    // no ghTarballOf injected → the default pin validator runs; a bad ref
    // returns null before any URL is built (lands 0 without touching network).
    // malformed source.version is corrupt index data — skipped before
    // candidacy (never a fetch candidate, unlike the HEAD-fallback rows the
    // unpinned counter honestly describes)
    const r = await buildSkillCatalog(idx, out, () => null)
    expect(r.candidates).toBe(0)
    expect(r.landed).toBe(0)
    rmSync(out, { recursive: true, force: true })
  })

  it('detailPage: empty findings under scannedAt:null says "not scanned", not "none"', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const unscanned = detailPage(mk())
    expect(unscanned).toContain('not scanned — nothing was analyzed')
    expect(unscanned).toContain('这里为空≠检净')
    const scanned = detailPage(mk({ capabilities: { scannedAt: 't', findings: [], redFlags: [] } }))
    expect(scanned).not.toContain('not scanned — nothing was analyzed')
    expect(scanned).toContain('>none</span>')
  })

  it('detailPage: AI verdict reasons render bilingually — reasonEn on en, reason on zh', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const verdicts = [
      { name: 'p', version: '1', verdict: 'concern' as const, at: '2026-01-02T00:00:00Z', source: 'ai' as const,
        reason: '中文理由', reasonEn: 'english reason' },
      { name: 'p', version: '1', verdict: 'pass' as const, at: '2026-01-01T00:00:00Z', source: 'human' as const,
        reason: 'human note', by: 'terry', issue: 7 },
      { name: 'other', version: '1', verdict: 'pass' as const, at: '2026-01-03T00:00:00Z', source: 'ai' as const, reason: 'not mine' },
    ]
    const h = detailPage(mk(), verdicts)
    expect(h).toContain('data-en="english reason"')
    expect(h).toContain('data-zh="中文理由"')
    expect(h).toContain('human note')            // single-language reason serves both
    expect(h).toContain('#7')                    // issue backlink
    expect(h).not.toContain('not mine')          // other entries' verdicts filtered out
  })

  it('detailPage verdict lookup is case-insensitive — vkey() parity', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    // github entries keep 'Owner/Repo' casing; verdict lines arrive lowercased —
    // an exact-match filter would hide the record the pipeline is acting on
    const h = detailPage(mk({ name: 'Owner/Repo', slug: 'o/r' }), [
      { name: 'owner/repo', version: null, verdict: 'concern' as const, at: '2026-01-02T00:00:00Z',
        source: 'human' as const, reason: 'lowercase verdict', by: 'terry' }])
    expect(h).toContain('lowercase verdict')
    expect(h).toContain('评审记录')
  })

  it('buildSite verdict grouping is case-insensitive — mixed-case log still lands on the page', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const vdir = mkdtempSync(join(tmpdir(), 'v-'))
    const vf = join(vdir, 'ai-verdicts.jsonl')
    writeFileSync(vf, JSON.stringify({ name: 'owner/repo', verdict: 'concern', at: '2026-01-02T00:00:00Z',
      source: 'human', reason: 'case-mismatch verdict', by: 'terry' }) + '\n')
    const gh = mk({ name: 'Owner/Repo', slug: 'o/r', latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'o/r' } })
    await buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [gh], removed: [] }, out, undefined, vf)
    const html = readFileSync(join(out, 'p', 'o', 'r.html'), 'utf8')
    expect(html).toContain('case-mismatch verdict')
    rmSync(out, { recursive: true, force: true }); rmSync(vdir, { recursive: true, force: true })
  })

  it('detailPage labels npmDownloads30d honestly — 30d, not 周下载', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const h = detailPage(mk())
    expect(h).toContain('npm 30天下载')
    expect(h).not.toContain('周下载')
  })

  it('detailPage surfaces verify retries + pendingUpdate integrity', async () => {
    const { detailPage } = await import('../pipeline/site/build.ts')
    const h = detailPage(mk({
      verification: { status: 'failed', retries: 3, integrity: 'sha512-measured' },
      pendingUpdate: { version: '2', heldAt: 't', integrity: 'sha512-abc',
        capabilities: { scannedAt: null, findings: [], redFlags: [] },
        verification: { status: 'failed', retries: 2 } } }))
    expect(h).toContain('verify retries')
    expect(h).toContain('sha512-abc')
    expect(h).toContain('retry')
    expect(h).toContain('verify integrity')
    expect(h).toContain('sha512-measured')
  })

  it('skillsPage: usage snippet + detail backlink; slug stripped from published index', async () => {
    const { skillsPage, buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const html = skillsPage(
      [{ name: 'sk', version: '1', files: ['SKILL.md'], slug: 'o/sk' }],
      'https://o.github.io/repo')
    expect(html).toContain('"skills": ["https://o.github.io/repo"]')
    expect(html).toContain('href="p/o/sk.html"')   // backlink via detailHref
    const bare = skillsPage([{ name: 'sk', version: '1', files: ['SKILL.md'] }])
    expect(bare).not.toContain('"skills":')        // no URL → no bogus snippet
    expect(bare).not.toContain('details')
    // stats caveats surface only when nonzero — honest disclosure, not noise
    const cav = skillsPage([{ name: 'sk', version: '1', files: ['SKILL.md'] }], null, { unpinned: 3, membersDropped: 7 })
    expect(cav).toContain('lack a commit-sha pin')
    expect(cav).toContain('7')
    // end-to-end: the published index.json keeps the {name,version,files} contract
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# x')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const r = await buildSkillCatalog(
      { version: '1', generatedAt: 't', categories: {}, plugins: [
        mk({ name: 'sk-s', slug: 'owner/sk-s', contains: ['skill'], latestVersion: '1' })], removed: [] },
      out, () => `file://${join(src, 's.tgz')}`)
    expect(r.entries[0]!.slug).toBe('owner/sk-s')          // in-memory page metadata
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].slug).toBeUndefined()             // published contract unchanged
    expect(Object.keys(cat.skills[0]).sort()).toEqual(['files', 'name', 'version'])
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

  it('poisoned cache entry self-heals: cleaned files are synced back over the hit', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    // seed a cache entry as if a rule change made a stored file unpublishable
    const key = join(cache, 'sk-x%401')
    mkdirSync(key, { recursive: true })
    writeFileSync(join(key, 'SKILL.md'), '# ok')
    writeFileSync(join(key, 'evil.html'), '<script>x</script>')
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-x', contains: ['skill'], latestVersion: '1' })], removed: [] }
    const r = await buildSkillCatalog(idx, out, () => null, cache)
    expect(r.landed).toBe(1)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills[0].files).toEqual(['SKILL.md'])
    // the SOURCE cache entry was rewritten too — next build won't re-drop it
    expect(existsSync(join(key, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(key, 'evil.html'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true })
  })

  it('installHint degrades when the skill never landed — no link to an empty slot', async () => {
    const { installHint } = await import('../pipeline/site/build.ts')
    const e = mk({ slug: 'o/s', contains: ['skill'] })
    expect(installHint(e, '../', new Set(['o/s']))).toContain('skills catalog')
    const missed = installHint(e, '../', new Set())
    expect(missed).toContain('not yet in this site')
    expect(missed).not.toContain('skills.html')
    // no landed set passed (tests/older callers) → original link, backwards compatible
    expect(installHint(e, '../')).toContain('skills catalog')
  })

  it('listPage: verified first, red-flagged sinks below unflagged, name breaks ties', async () => {
    const { listPage } = await import('../pipeline/site/build.ts')
    const html = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'zz-flagged', verification: { status: 'verified' },
        capabilities: { scannedAt: 't', findings: ['f'], redFlags: ['r'] } }),
      mk({ name: 'bb-unverified' }),
      mk({ name: 'cc-failed', verification: { status: 'failed' } }),
      mk({ name: 'aa-verified', verification: { status: 'verified' } }),
    ], removed: [] })
    const pos = (n: string) => html.indexOf(`<b>${n}</b>`)
    expect(pos('aa-verified')).toBeGreaterThan(-1)
    expect(pos('aa-verified')).toBeLessThan(pos('bb-unverified'))
    expect(pos('bb-unverified')).toBeLessThan(pos('cc-failed'))
    expect(pos('cc-failed')).toBeLessThan(pos('zz-flagged'))   // flags sink below everything
  })

  it('listPage: parts filter select + nested-slug detail hrefs', async () => {
    const { listPage } = await import('../pipeline/site/build.ts')
    const html = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'a', contains: ['plugin'], slug: 'o/a' }),
      mk({ name: 'b', contains: ['skill'], slug: 'owner/b' }),
    ], removed: [] })
    expect(html).toContain('id=part')
    expect(html).toContain('data-parts="[&quot;skill&quot;]"')
    expect(html).toContain('href="p/owner/b.html"')   // canonical nested path, not owner%2Fb
  })
})
