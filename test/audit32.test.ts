import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSkillCatalog, normalizeRepoUrl } from '../pipeline/site/build.ts'
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
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})

describe('siteRepoUrl normalization (public href surface)', () => {
  it('strips userinfo — a token-embedded remote must not leak into page hrefs', () => {
    expect(normalizeRepoUrl('https://x-access-token:ghs_secret@github.com/o/r'))
      .toBe('https://github.com/o/r')
  })
  it('collapses ssh remote forms to https', () => {
    expect(normalizeRepoUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r')
    expect(normalizeRepoUrl('ssh://git@github.com/o/r.git')).toBe('https://github.com/o/r')
  })
  it('upgrades http and strips .git / trailing slashes', () => {
    expect(normalizeRepoUrl('http://gitlab.example.com/o/r.git/')).toBe('https://gitlab.example.com/o/r')
    expect(normalizeRepoUrl('https://github.com/o/r.git')).toBe('https://github.com/o/r')
  })
  it('rejects non-http schemes and garbage — esc() cannot stop scheme injection', () => {
    expect(normalizeRepoUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeRepoUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
    expect(normalizeRepoUrl('not a url')).toBeNull()
  })
})

describe('skill cache-hit enforces the member cap', () => {
  it('an over-cap cached tree refetches — the cap is a publish rule, not write-time only', async () => {
    // a cache entry written before MAX_SKILL_MEMBERS existed (or poisoned)
    // ships >cap files if the hit path only re-checks size/active types
    const src = mkdtempSync(join(tmpdir(), 'a32-tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# ok')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'a32-site-'))
    const cache = mkdtempSync(join(tmpdir(), 'a32-cache-'))
    // cacheKey(id, pin) = encodeURIComponent(`${id}@${pin}`); pin = integrity ?? ver = '1'
    const hit = join(cache, encodeURIComponent('sk@1'))
    mkdirSync(hit, { recursive: true })
    for (let i = 0; i < 101; i++) writeFileSync(join(hit, `f${String(i).padStart(3, '0')}.md`), 'x')
    let fetched = 0
    const r = await buildSkillCatalog(
      idx([mk({ name: 'sk', contains: ['skill'], latestVersion: '1' })]),
      out, () => { fetched++; return `file://${join(src, 's.tgz')}` }, cache)
    expect(fetched).toBe(1)                       // poisoned hit rejected → refetch
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]!.files).toEqual(['SKILL.md'])
    // the refetch rewrites the cache key with the extracted (capped) tree —
    // the over-cap files must be gone from the cache, not just unpublished
    expect(existsSync(join(hit, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(hit, 'f000.md'))).toBe(false)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true })
  })
})
