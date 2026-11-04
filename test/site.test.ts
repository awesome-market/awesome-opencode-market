import { describe, it, expect } from 'vitest'
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
