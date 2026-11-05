import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
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
  it('buildSite writes index + detail pages', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [mk({ name: 'a' }), mk({ name: 'b' })], removed: [] }
    buildSite(idx, out)
    expect(existsSync(join(out, 'index.json'))).toBe(true)
    expect(existsSync(join(out, 'p', 'o/p.html'))).toBe(true)
    const list = readFileSync(join(out, 'index.html'), 'utf8')
    expect(list).toContain('2 entries')
  })
  it('listPage search input present', () => {
    expect(listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] })).toContain('id=q')
  })
})
  it('buildSite writes skills/index.json even when skill tarball unavailable', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'definitely-not-a-real-pkg-zz9', contains: ['skill'] }), mk({ name: 'b' })], removed: [] }
    buildSite(idx, out)
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
    buildSkillCatalog(idx, out, () => `file://${join(src, 's.tgz')}`)
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
    buildSkillCatalog(idx, out, (spec) => { seen.push(spec); return `file://${join(src, 's.tgz')}` })
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
    buildSkillCatalog(idx, out, (n) => { specs.push(n); return n.startsWith('sk-empty') ? `file://${join(src, 'empty.tgz')}` : `file://${join(src, 'ok.tgz')}` })
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(cat.skills).toHaveLength(1)
    expect(cat.skills[0].version).toBe('3')
    expect(specs).toEqual(['@3', 'sk-empty@1.0.0'])   // sk-nover never reached tarballOf
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })

describe('buildSkillCatalog failure paths', () => {
  it('tarball fetch failure → skill skipped, tmp dir cleaned', async () => {
    const { buildSkillCatalog } = await import('../pipeline/site/build.ts')
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'sk-dead', contains: ['skill'], latestVersion: '9' })], removed: [] }
    // https URL that refuses — curl -f fails fast on a refused connection
    buildSkillCatalog(idx, out, () => 'https://127.0.0.1:1/nope.tgz')
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
    buildSkillCatalog(idx('1.0.0'), out, () => { calls++; return url }, cache)
    expect(calls).toBe(1)
    expect(existsSync(join(cache, 'sk-c%401.0.0', 'SKILL.md'))).toBe(true)
    // hit → zero network
    calls = 0
    buildSkillCatalog(idx('1.0.0'), out, () => { calls++; return 'https://127.0.0.1:1/x' }, cache)
    expect(calls).toBe(0)
    expect(existsSync(join(out, 'skills', 'sk-c', 'SKILL.md'))).toBe(true)
    // bump → refetch + old key pruned
    calls = 0
    buildSkillCatalog(idx('2.0.0'), out, () => { calls++; return url }, cache)
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
    buildSkillCatalog(idx, out, () => url)
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
    buildSkillCatalog(idx, out, () => url)
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
    buildSite(idx, out)   // real tarballOf → npm view fails → 0/2 landed → degraded
    const h = JSON.parse(readFileSync(join(out, 'health.json'), 'utf8'))
    expect(h.entries).toBe(3)
    expect(h.skills).toMatchObject({ candidates: 2, landed: 0, degraded: true })
    rmSync(out, { recursive: true, force: true })
  }, 60000)

  it('S-3 healthGate: absolute floor + 50%-of-previous ratio', async () => {
    const { healthGate } = await import('../pipeline/site/build.ts')
    expect(healthGate(null, { entries: 500 })).toBeNull()
    expect(healthGate(null, { entries: 50 })).toContain('floor')
    expect(healthGate({ entries: 1000 }, { entries: 400 })).toContain('50%')
    expect(healthGate({ entries: 1000 }, { entries: 600 })).toBeNull()
    expect(healthGate({ entries: null as unknown as number }, { entries: 500 })).toBeNull()
  })

  it('S-7 index.lite.json: visible-only + no pendingUpdate internals', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'a', pendingUpdate: { version: '9', heldAt: 't', capabilities: { scannedAt: null, findings: [], redFlags: [] }, verification: { status: 'unverified' } } }),
      mk({ name: 'b', approval: 'pending' })], removed: [] }
    buildSite(idx, out)
    const lite = JSON.parse(readFileSync(join(out, 'index.lite.json'), 'utf8'))
    expect(lite.plugins).toHaveLength(1)
    expect(lite.plugins[0].name).toBe('a')
    expect(lite.plugins[0].pendingUpdate).toBeUndefined()
    const full = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(full.plugins).toHaveLength(2)   // full index keeps pending — auditable
    rmSync(out, { recursive: true, force: true })
  })

  it('S-9/S-10 removed.html + skills.html pages render', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [mk({ name: 'a' })], removed: [
      { slug: 'o/gone', name: 'gone-pkg', disappearedAt: '2026-01-02T00:00:00Z', reason: 'npm-404' },
      { slug: 'o/old', name: 'old-pkg', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' }] }
    buildSite(idx, out)
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

  it('buildSite clears stale output before writing', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    writeFileSync(join(out, 'stale.html'), 'old')
    buildSite({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()], removed: [] }, out)
    expect(existsSync(join(out, 'stale.html'))).toBe(false)
    rmSync(out, { recursive: true, force: true })
  })
})
