/** audit #9 (站点发布流 §9) — regression:
 *  1. verdicts file fail-closed: exists-but-unreadable or non-empty all-corrupt
 *     input must ABORT the build — every detail page would otherwise publish a
 *     silently empty audit surface (the fetch step's cat-file probe applies the
 *     same rule one layer up; partial corruption stays tolerated).
 *  2. github entry without a usable repo id is corrupt index data — the skill
 *     plan loop must WARN like every sibling skip path, not drop silently.
 *  3. a symlinked cache entry must never be dereferenced into the published
 *     tree — lstat the hit; non-dir/link → drop + refetch.
 *  NOTE: verdicts fixtures must live OUTSIDE outDir — buildSite rm -rf's it. */
import { describe, it, expect, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSite, buildSkillCatalog } from '../pipeline/site/build.ts'
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
const idx = (plugins: PluginEntry[]): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })
const goodLine = JSON.stringify({ name: 'p', version: '1.0.0', verdict: 'concern', reason: 'r', at: '2026-01-02T00:00:00Z', source: 'human' })
const vfile = (content: string): string => {
  const d = mkdtempSync(join(tmpdir(), 'v-'))
  writeFileSync(join(d, 'v.jsonl'), content)
  return join(d, 'v.jsonl')
}

describe('audit #9: verdicts file fail-closed at buildSite', () => {
  it('all-corrupt verdicts file aborts the build — nothing is published', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await expect(buildSite(idx([mk()]), out, undefined, vfile('not-json\n{bad:1]\n'))).rejects.toThrow(/malformed|audit surface/i)
    expect(existsSync(join(out, 'index.json'))).toBe(false)
  })
  it('unreadable verdicts path aborts (a directory is present-but-not-a-file)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await expect(buildSite(idx([mk()]), out, undefined, mkdtempSync(join(tmpdir(), 'vdir-')))).rejects.toThrow()
    expect(existsSync(join(out, 'index.json'))).toBe(false)
  })
  it('missing verdicts path aborts — a supplied path that vanished is an operator error', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await expect(buildSite(idx([mk()]), out, undefined, join(mkdtempSync(join(tmpdir(), 'v-')), 'nope.jsonl'))).rejects.toThrow()
  })
  it('partial corruption tolerated — good lines still render, build proceeds', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await buildSite(idx([mk()]), out, undefined, vfile(`garbage-line\n${goodLine}\n`))
    warn.mockRestore()
    const detail = readFileSync(join(out, 'p', 'o', 'p.html'), 'utf8')
    expect(detail).toContain('concern')
    expect(detail).toContain('裁决记录')
  })
  it('empty + whitespace-only verdicts files are legitimate "no verdicts yet"', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    await buildSite(idx([mk()]), out, undefined, vfile('\n\n'))
    expect(existsSync(join(out, 'index.json'))).toBe(true)
    const detail = readFileSync(join(out, 'p', 'o', 'p.html'), 'utf8')
    expect(detail).not.toContain('裁决记录')
  })
})

describe('audit #9: skill-plan corrupt-data observability', () => {
  it('github entry with unusable repo id warns + skips (not silent)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const gh = mk({ name: 'ghs', slug: 'o/ghs', latestVersion: null, contains: ['skill'],
      source: { kind: 'github', id: 'x', repo: 'not a repo at all!!' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const st = await buildSkillCatalog(idx([gh]), out, () => null)
    const calls = warn.mock.calls.map(c => String(c[0])).join('\n')
    warn.mockRestore()
    expect(st.candidates).toBe(0)
    expect(calls).toContain('usable repo')
  })
})

describe('audit #9: cache-hit symlink guard', () => {
  it('a symlinked cache entry is dropped + refetched, not cpSync\'d into publish', async () => {
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
    mkdirSync(join(src, 'package'), { recursive: true })
    writeFileSync(join(src, 'package', 'SKILL.md'), '# good skill')
    execSync(`cd "${src}" && tar czf s.tgz package`)
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    // poison: the pin-keyed cache entry is a SYMLINK to an out-of-band dir
    // containing a payload the build never produced
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    writeFileSync(join(outside, 'SMUGGLED.txt'), 'out-of-band')
    const entry = mk({ name: 'symlinked', slug: 'o/symlinked', contains: ['skill'], latestVersion: '1.0.0', integrity: null })
    const key = encodeURIComponent('symlinked@1.0.0')
    symlinkSync(outside, join(cache, key))
    let fetches = 0
    const st = await buildSkillCatalog(idx([entry]), out, () => { fetches++; return `file://${join(src, 's.tgz')}` }, cache)
    expect(fetches).toBe(1)                       // symlink hit was dropped → real refetch
    expect(st.landed).toBe(1)
    expect(existsSync(join(out, 'skills', 'symlinked', 'SMUGGLED.txt'))).toBe(false)
    expect(existsSync(join(out, 'skills', 'symlinked', 'SKILL.md'))).toBe(true)
    // the dropped link got replaced by a real cached dir after the refetch
    expect(lstatSync(join(cache, key)).isSymbolicLink()).toBe(false)
  })
})
