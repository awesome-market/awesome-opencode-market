import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanLabel, verifyLabel, buildSite, listPage, detailPage } from '../pipeline/site/build.ts'
import type { PluginEntry, CatalogIndex } from '../src/schema.ts'

const mk = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: { en: 'desc' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 5, npmDownloads30d: 100, checkedAt: 't' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
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
  it('detailPage renders honest semantics + escaped content', () => {
    const html = detailPage(mk({ description: { en: '<script>x</script>' }, source: { kind: 'npm', id: 'p', repo: 'o/p' } }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>x')
    expect(html).toContain('opencode plugin add p')
  })
  it('buildSite writes index + detail pages', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [mk({ name: 'a' }), mk({ name: 'b' })] }
    buildSite(idx, out)
    expect(existsSync(join(out, 'index.json'))).toBe(true)
    expect(existsSync(join(out, 'p', 'o/p.html'))).toBe(true)
    const list = readFileSync(join(out, 'index.html'), 'utf8')
    expect(list).toContain('2 entries')
  })
  it('listPage search input present', () => {
    expect(listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [mk()] })).toContain('id=q')
  })
})
  it('buildSite writes skills/index.json even when skill tarball unavailable', () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      mk({ name: 'definitely-not-a-real-pkg-zz9', type: 'skill' }), mk({ name: 'b' })] }
    buildSite(idx, out)
    const cat = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8'))
    expect(Array.isArray(cat.skills)).toBe(true)
    expect(cat.skills).toHaveLength(0)   // npm view fails → skipped, no crash
    rmSync(out, { recursive: true, force: true })
  }, 60000)
