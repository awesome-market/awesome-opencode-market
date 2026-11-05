import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanLabel, verifyLabel, buildSite, listPage, detailPage } from '../pipeline/site/build.ts'
import type { PluginEntry, CatalogIndex } from '../src/schema.ts'

const mk = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: { en: 'desc' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 5, npmDownloads30d: 100, checkedAt: 't' },
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
    expect(verifyLabel(mk({ verification: { status: 'skipped' } })).text).toContain('skipped')
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

  it('source.version (tree sha) pins codeload — served bytes = scanned bytes', async () => {
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
  })
})
