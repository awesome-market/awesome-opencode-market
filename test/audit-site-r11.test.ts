/** audit #9 (站点发布流 §9, 第 6 轮) — independent re-audit of site.yml +
 *  build.ts against DATA-FLOWS §9. Round 1 fixed the verify-status label
 *  keying on latestVersion===null; this round clears every fixable residual:
 *
 *  1. verifyLabel now surfaces REAL verify outcomes unconditionally —
 *     verified/failed are measurements, not install-path claims (github
 *     plugin-only verifies via `plugin add owner/repo#sha`). 'skipped'
 *     decomposes on CURRENT redFlags (merge.ts skipIfFlagged invariant):
 *     flagged → 'skipped (high risk)'; unflagged → re-queues as 'unverified'
 *     when a target exists, else muted 'nothing to install'. 'unverified'
 *     shows while a verify target exists (hasInstallPath OR hasVerifyTarget:
 *     plugin|skill parts + npm version or pinned github sha).
 *  2. removedPage sort uses atCmp-parity Date.parse + lexical tiebreak —
 *     non-ISO disappearedAt (bare z.string()) can't NaN the comparator.
 *  3. healthGate floor: negative/NaN → 200 (SITE_FLOOR typo can't silently
 *     disable the shrink gate); site.yml parse rejects negatives the same.
 *  4. skills.unpinned counts LANDED github HEAD-fallbacks (planned-but-failed
 *     fetches no longer inflate the disclosure).
 *  5. normalizeSiteUrl upgrades http→https + strips trailing slashes — an
 *     http:// SITE_URL override can't publish a dead skills[] snippet. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyLabel, installHint, detailPage, repoNameOf, removedPage,
  healthGate, normalizeSiteUrl, buildSkillCatalog } from '../pipeline/site/build.ts'
import type { PluginEntry, CatalogIndex, RemovedEntry } from '../src/schema.ts'

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

const ghSkill = (ver: PluginEntry['verification'], over: Partial<PluginEntry> = {}) =>
  mk({ latestVersion: null, type: 'skill', contains: ['skill'],
    source: { kind: 'github', id: 'o/s', repo: 'o/s', version: 'a'.repeat(40) },
    verification: ver, ...over })

const ghPlugin = (ver: PluginEntry['verification'], over: Partial<PluginEntry> = {}) =>
  mk({ latestVersion: null, contains: ['plugin'],
    source: { kind: 'github', id: 'o/r', repo: 'o/r' },
    verification: ver, ...over })

describe('§9 verifyLabel — real outcomes + verify-target awareness', () => {
  it('recorded verified/failed surface even with NO client install path', () => {
    // github plugin-only: client can't install, but `plugin add repo#sha`
    // verify runs are real measurements — AGENTS: failed must say 装不上
    expect(verifyLabel(ghPlugin({ status: 'verified', level: 'install' })).text).toContain('verified')
    expect(verifyLabel(ghPlugin({ status: 'failed' })).cls).toBe('bad')
    // even a path-less npm row with contains:[] shows a recorded outcome
    expect(verifyLabel(mk({ contains: [], verification: { status: 'failed' } })).cls).toBe('bad')
  })
  it('github-kind skill entry shows its REAL verify status', () => {
    expect(verifyLabel(ghSkill({ status: 'failed', level: 'install' })).text).toContain('verification failed')
    expect(verifyLabel(ghSkill({ status: 'verified', level: 'install' })).text).toContain('verified')
    expect(verifyLabel(ghSkill({ status: 'unverified' })).text).toBe('unverified')
  })
  it('github plugin-only with pinned sha + unverified → unverified (verify target exists)', () => {
    const e = ghPlugin({ status: 'unverified' },
      { source: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'b'.repeat(40) } })
    expect(verifyLabel(e).text).toBe('unverified')
  })
  it('github plugin-only WITHOUT sha → nothing to install (no target, no path)', () => {
    expect(verifyLabel(ghPlugin({ status: 'unverified' })).text).toBe('nothing to install')
  })
  it("'skipped' keys on CURRENT redFlags — flagged shows high risk even path-less", () => {
    const e = mk({ contains: [], verification: { status: 'skipped' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    expect(verifyLabel(e).text).toContain('high risk')
  })
  it("unflagged 'skipped' re-queues as unverified when a target exists", () => {
    // stale skip (parts were empty at write, gained payload since) — plan
    // re-enters cleared skips, so 'unverified' is the honest current state
    const e = mk({ contains: ['skill'], latestVersion: '1.0.0',
      verification: { status: 'skipped' } })
    expect(verifyLabel(e).text).toBe('unverified')
  })
  it("unflagged 'skipped' with no path/target → nothing to install", () => {
    const e = mk({ latestVersion: null, verification: { status: 'skipped' } })
    expect(verifyLabel(e).text).toBe('nothing to install')
  })
  it('npm contains:[] + unverified → nothing to install (can never be measured)', () => {
    expect(verifyLabel(mk({ contains: [], verification: { status: 'unverified' } })).text).toBe('nothing to install')
  })
  it('parts-empty type (mcp) with version → nothing to install', () => {
    expect(verifyLabel(mk({ type: 'mcp' })).text).toBe('nothing to install')
  })
  it('detailPage: failed github skill shows failure + install hint, no contradiction', () => {
    const html = detailPage(ghSkill({ status: 'failed', level: 'install', runUrl: 'https://x.dev/r' }))
    expect(html).toContain('verification failed')
    expect(html).toContain('skills catalog')
    expect(html).not.toContain('nothing to install')
    expect(html).not.toContain('没有可安装的包')
  })
})

describe('§9 installHint/installPaths — single installPlan-parity rule', () => {
  it('github + latestVersion + malformed repo + skill → browse only (aligned edge)', () => {
    const e = mk({ latestVersion: '1.0.0', contains: ['skill'],
      source: { kind: 'github', id: 'x', repo: 'not a repo' } })
    expect(installHint(e)).toContain('browse only')
    expect(installHint(e)).not.toContain('skills catalog')
  })
  it('npm skill without version → browse only; with version → catalog link', () => {
    expect(installHint(mk({ contains: ['skill'], latestVersion: null }))).toContain('browse only')
    expect(installHint(mk({ contains: ['skill'], latestVersion: '2.0.0' }))).toContain('skills catalog')
  })
})

describe('§9 repoNameOf / normalizeSiteUrl — Pages path & snippet hygiene', () => {
  it('repoNameOf handles https/.git/scp/ssh/trailing-slash/org-page forms', () => {
    expect(repoNameOf('https://github.com/o/r')).toBe('r')
    expect(repoNameOf('https://github.com/o/r.git')).toBe('r')
    expect(repoNameOf('https://github.com/o/r/')).toBe('r')
    expect(repoNameOf('git@github.com:o/r.git')).toBe('r')
    expect(repoNameOf('ssh://git@github.com/o/r.git')).toBe('r')
    expect(repoNameOf('https://github.com/o/r.git/')).toBe('r')
    expect(repoNameOf('https://gitlab.com/o/r')).toBe('r')
    expect(repoNameOf('')).toBe('')
    expect(repoNameOf('not a url')).toBe('')
  })
  it('normalizeSiteUrl strips trailing slashes + upgrades http→https', () => {
    expect(normalizeSiteUrl('https://o.github.io/r/')).toBe('https://o.github.io/r')
    expect(normalizeSiteUrl('http://o.github.io/r')).toBe('https://o.github.io/r')
    expect(normalizeSiteUrl('HTTP://O.GITHUB.IO/R//')).toBe('https://O.GITHUB.IO/R')
    expect(normalizeSiteUrl('https://o.github.io')).toBe('https://o.github.io')
  })
})

describe('§9 removedPage — non-ISO disappearedAt cannot NaN the sort', () => {
  const rem = (name: string, disappearedAt: string): RemovedEntry => ({
    slug: name, name, disappearedAt, reason: 'manual' })
  const idx = (removed: RemovedEntry[]): CatalogIndex =>
    ({ version: '1', generatedAt: 't', categories: {}, plugins: [], removed })
  it('ISO rows sort newest-first; junk rows sink to bottom in codepoint order', () => {
    const html = removedPage(idx([
      rem('old', '2026-01-01T00:00:00Z'),
      rem('new', '2026-03-01T00:00:00Z'),
      rem('junk-b', 'not-a-date'),
      rem('junk-a', '???'),
    ]))
    const pos = (s: string) => html.indexOf(`>${s}<`)
    expect(pos('new')).toBeGreaterThan(-1)
    expect(pos('new')).toBeLessThan(pos('old'))
    // unparseable → -Infinity: real dates always outrank junk; among junk,
    // descending codepoint puts 'not-a-date'(0x6E) before '???'(0x3F)
    expect(pos('old')).toBeLessThan(pos('junk-b'))
    expect(pos('junk-b')).toBeLessThan(pos('junk-a'))
    // and the whole render is deterministic across calls
    expect(removedPage(idx([
      rem('old', '2026-01-01T00:00:00Z'), rem('new', '2026-03-01T00:00:00Z'),
      rem('junk-b', 'not-a-date'), rem('junk-a', '???')]))).toBe(html)
  })
})

describe('§9 healthGate — floor sanity', () => {
  it('negative floor falls back to 200 — a typo cannot disable the gate', () => {
    expect(healthGate(null, { entries: 50, total: 50 }, -5)).toContain('below floor 200')
    expect(healthGate(null, { entries: 50, total: 50 }, Number.NaN)).toContain('below floor 200')
  })
  it('floor=0 still legitimately disables the floor check', () => {
    expect(healthGate(null, { entries: 0, total: 0 }, 0)).toBeNull()
  })
})

describe('§9 skills.unpinned — landed-count semantics', () => {
  const mkGhTgz = () => {
    const src = mkdtempSync(join(tmpdir(), 'tgz-'))
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
  it('planned-but-failed HEAD fallback is NOT counted — only landed skills disclose', async () => {
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      ghEntry({ name: 'g-dead' }),   // no source.version → HEAD fallback planned…
      ghEntry({ name: 'g-ok', source: { kind: 'github', id: 'o/gh-skill', repo: 'o/gh-skill', version: 'abc123def' } }),
    ], removed: [] }
    // …but every fetch fails → nothing lands → unpinned must be 0 (plan-time
    // counting would have reported 1: g-dead's HEAD fallback was only planned)
    const r = await buildSkillCatalog(idx, out, () => null, undefined, () => null)
    expect(r.unpinned).toBe(0)
    expect(r.landed).toBe(0)
    rmSync(out, { recursive: true, force: true })
  })
  it('landed HEAD fallback counts once — pinned sibling does not', async () => {
    const { src, tgz } = mkGhTgz()
    const out = mkdtempSync(join(tmpdir(), 'site-'))
    const idx: CatalogIndex = { version: '1', generatedAt: 't', categories: {}, plugins: [
      ghEntry({ name: 'g-old' }),
      ghEntry({ name: 'g-new', source: { kind: 'github', id: 'o/gh-skill', repo: 'o/gh-skill', version: 'abc123def' } }),
    ], removed: [] }
    const r = await buildSkillCatalog(idx, out, () => null, undefined, () => `file://${tgz}`)
    expect(r.unpinned).toBe(1)
    expect(r.landed).toBe(2)
    rmSync(out, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true })
  })
})
