/** audit #10 (客户端消费流 §10, 第 5 轮) — fresh independent pass found no
 *  production defect; pinned the load-bearing client contracts that had ZERO
 *  test references (audit round verified each against the implementation):
 *
 *  1. assertApprovedPin — the TTL-window concern guard: a version concern'd
 *     inside the 1h render cache MUST NOT install. Mismatched pin, dropped
 *     entry, AND the bare-name spec (resolves dist-tags.latest = the
 *     unapproved version) all refuse.
 *  2. halfState/halvesToSync — per-half semantics: a missing half is not
 *     resurrected by an update; a current plugin half never masks a stale
 *     skill half; an undeliverable half is never reported "outdated".
 *  3. gitPinRef — lowercase-hex sha pins; absent → HEAD (legacy); a
 *     MALFORMED pin is index corruption and throws (a branch name must not
 *     slide past the scan).
 *  4. integrityMatches — sha512 SRI: match → true, mismatch → false (reject
 *     the bytes), no SRI/no subtle → null (unverifiable, caller decides).
 *  5. verMarker — github skills account the scanned commit sha first,
 *     modifiedAt only for pre-sha rows; npm uses latestVersion.
 *  6. scanSkillKeys/skillInstalledVer — __skill_ inventory shape: dirs with
 *     content, file-skills *.md, hidden/_ staging skipped, plugin key win.
 *  7. writeSkillPermission — unrelated permission entries survive; mode null
 *     removes ONLY that resource's skill rule (clears back to default).
 *  8. siteDetailUrl — nested slug encodes per segment (p/o/r.html), spaces
 *     encode; the canonical path the site actually publishes.
 *  9. enginesSatisfied — picks the opencode clause; evaluates honest ranges;
 *     unparseable → null (never a confident false). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertApprovedPin, halfState, halvesToSync, gitPinRef, integrityMatches,
  verMarker, scanSkillKeys, skillInstalledVer, siteDetailUrl, enginesSatisfied,
  type MarketEntry, type MarketIndex,
} from '../plugins/market/src/catalog.ts'
import { writeSkillPermission } from '../plugins/market/src/hostx.ts'

const entry = (o: Partial<MarketEntry>): MarketEntry => ({
  name: 'pkg', slug: 'pkg', type: 'plugin', category: [], ...o,
})
const idx = (plugins: MarketEntry[]): MarketIndex => ({ version: '1', generatedAt: '', plugins })

describe('assertApprovedPin — the install-time freshness gate', () => {
  const e = entry({ name: 'a', latestVersion: '1.2.3' })
  it('matching pin → the FRESH entry is returned (stale snapshot never re-used)', async () => {
    const got = await assertApprovedPin(async () => idx([e]), 'a', 'a@1.2.3')
    expect(got).toBe(e)
  })
  it('pin ≠ approved version (concern moved the hold inside TTL) → refuse', async () => {
    await expect(assertApprovedPin(async () => idx([e]), 'a', 'a@9.9.9')).rejects.toThrow('catalog moved')
  })
  it('bare-name spec refuses — it resolves dist-tags.latest, the unapproved version', async () => {
    await expect(assertApprovedPin(async () => idx([e]), 'a', 'a')).rejects.toThrow('catalog moved')
  })
  it('entry dropped from the fresh index → refuse (removed/concerned in window)', async () => {
    await expect(assertApprovedPin(async () => idx([]), 'a', 'a@1.2.3')).rejects.toThrow('not in catalog')
  })
})

describe('halfState/halvesToSync — per-half sync semantics', () => {
  const dual = entry({ name: 'd', contains: ['plugin', 'skill'], latestVersion: '2.0.0' })
  it('fresh install → every deliverable half', () => {
    const hs = halfState(dual, {})
    expect(halvesToSync(dual, hs)).toEqual({ plugin: true, skill: true })
  })
  it('installed+outdated half syncs; an absent half is NOT resurrected', () => {
    // plugin half installed at old version; skill half deliberately absent
    const hs = halfState(dual, { d: '1.0.0' })
    expect(halvesToSync(dual, hs)).toEqual({ plugin: true, skill: false })
  })
  it('a current plugin half does NOT mask a stale skill half', () => {
    const hs = halfState(dual, { d: '2.0.0', __skill_d: '1.0.0' })
    expect(hs.pluginOut).toBe(false)
    expect(hs.skillOut).toBe(true)
    expect(halvesToSync(dual, hs)).toEqual({ plugin: false, skill: true })
  })
  it('an undeliverable half is never "outdated" — a github plugin has no update path', () => {
    const gh = entry({ name: 'g', contains: ['plugin'], source: { kind: 'github', repo: 'o/r' }, latestVersion: '1.0.0' })
    const hs = halfState(gh, { g: '0.1.0' })
    expect(hs.pluginOn).toBe(true)
    expect(hs.pluginOut).toBe(false)   // plan.plugin=false → nothing to sync
    expect(halvesToSync(gh, hs)).toEqual({ plugin: false, skill: false })
  })
  it('both halves current → nothing to sync ("all up to date")', () => {
    const hs = halfState(dual, { d: '2.0.0', __skill_d: '2.0.0' })
    expect(halvesToSync(dual, hs)).toEqual({ plugin: false, skill: false })
  })
})

describe('gitPinRef — the github skill byte anchor', () => {
  it('hex sha pins to the reviewed commit', () => {
    expect(gitPinRef('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')
    expect(gitPinRef('a1b2c3d')).toBe('a1b2c3d')   // short sha pins too
  })
  it('absent pin falls back to HEAD — documented legacy behavior', () => {
    expect(gitPinRef(null)).toBe('HEAD')
    expect(gitPinRef('')).toBe('HEAD')
    expect(gitPinRef(undefined)).toBe('HEAD')
  })
  it('a MALFORMED pin is corruption — a branch name must not slide past the scan', () => {
    expect(() => gitPinRef('main')).toThrow('invalid source pin')
    expect(() => gitPinRef('v1.0.0')).toThrow('invalid source pin')
    expect(() => gitPinRef('../../etc')).toThrow('invalid source pin')
  })
})

describe('integrityMatches — sha512 SRI of the reviewed artifact', () => {
  const bytes = new TextEncoder().encode('artifact-bytes')
  it('matching SRI → true', async () => {
    const d = await globalThis.crypto.subtle.digest('SHA-512', bytes as BufferSource)
    let bin = ''
    for (const b of new Uint8Array(d)) bin += String.fromCharCode(b)
    expect(await integrityMatches(bytes, `sha512-${btoa(bin)}`)).toBe(true)
  })
  it('mismatched bytes → false — the caller refuses the install', async () => {
    const d = await globalThis.crypto.subtle.digest('SHA-512', new TextEncoder().encode('other') as BufferSource)
    let bin = ''
    for (const b of new Uint8Array(d)) bin += String.fromCharCode(b)
    expect(await integrityMatches(bytes, `sha512-${btoa(bin)}`)).toBe(false)
  })
  it('no SRI → null (unverifiable — github tarballs ship none); non-sha512 algo → null', async () => {
    expect(await integrityMatches(bytes, null)).toBeNull()
    expect(await integrityMatches(bytes, 'sha256-abc')).toBeNull()
  })
})

describe('verMarker — what "installed version" means per source kind', () => {
  it('npm → latestVersion', () => {
    expect(verMarker(entry({ latestVersion: '1.2.3' }))).toBe('1.2.3')
  })
  it('github → the scanned commit sha first, modifiedAt only for pre-sha rows', () => {
    expect(verMarker(entry({ source: { kind: 'github', version: 'deadbeef' }, modifiedAt: '2024-01-01' }))).toBe('deadbeef')
    expect(verMarker(entry({ source: { kind: 'github' }, modifiedAt: '2024-01-01' }))).toBe('2024-01-01')
  })
  it('github with neither → undefined; non-github versionless → undefined', () => {
    expect(verMarker(entry({ source: { kind: 'github' } }))).toBeUndefined()
    expect(verMarker(entry({}))).toBeUndefined()
  })
})

describe('scanSkillKeys/skillInstalledVer — __skill_ inventory shape', () => {
  it('dirs with content, file-skills, hidden/_ staging skipped', () => {
    const files: Record<string, string[]> = {
      '/root': ['mysk', 'empty', 'bare-dir', '.dot', '.dotfile.md', '_dl', 'flat.md'],
      '/root/mysk': ['SKILL.md'],
      '/root/empty': [],
      '/root/bare-dir': [],
    }
    const keys = scanSkillKeys(['/root'], d => files[d] ?? [], p => p === '/root/empty/SKILL.md')
    // 'empty' counts via the SKILL.md existence probe (no visible files);
    // bare-dir has neither kids nor SKILL.md; .dot/_dl/.dotfile.md skipped
    expect(keys).toEqual({ __skill_mysk: 'local', __skill_flat: 'local', __skill_empty: 'local' })
  })
  it('skillInstalledVer prefers the plugin key, then namespaced/bare dirs, then <id>-* lifts', () => {
    expect(skillInstalledVer({ p: '1.0.0' }, 'p')).toBe('1.0.0')
    expect(skillInstalledVer({ __skill_p: '1.0.0' }, 'p')).toBe('1.0.0')
    expect(skillInstalledVer({ '__skill_a--x': '2.0.0' }, '@a/x')).toBe('2.0.0')
    expect(skillInstalledVer({ __skill_x: '2.0.0' }, '@a/x')).toBe('2.0.0')      // bare basename fallback
    expect(skillInstalledVer({ '__skill_a--x-helper': 'x' }, '@a/x')).toBe('local') // lifted sibling
    expect(skillInstalledVer({ other: '1' }, 'p')).toBeUndefined()
  })
})

describe('writeSkillPermission — preserves the rest of the permissions array', () => {
  let dir = ''
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ocm-perm-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const cfg = () => join(dir, 'opencode.json')

  it('writes a skill rule without touching unrelated entries; null clears just it', async () => {
    writeFileSync(cfg(), JSON.stringify({
      plugins: ['other@1.0.0'],
      permissions: [
        { action: 'bash', resource: '*', effect: 'allow' },
        { action: 'skill', resource: 'other-skill', effect: 'deny' },
      ],
    }))
    const got = await writeSkillPermission(cfg(), 'mysk', 'allow')
    expect(got).toEqual({ 'other-skill': 'deny', mysk: 'allow' })
    const d = JSON.parse(readFileSync(cfg(), 'utf8'))
    expect(d.plugins).toEqual(['other@1.0.0'])
    expect(d.permissions).toContainEqual({ action: 'bash', resource: '*', effect: 'allow' })
    // mode null removes ONLY mysk's rule — other-skill stays denied
    const after = await writeSkillPermission(cfg(), 'mysk', null)
    expect(after).toEqual({ 'other-skill': 'deny' })
    expect(JSON.parse(readFileSync(cfg(), 'utf8')).permissions)
      .toContainEqual({ action: 'skill', resource: 'other-skill', effect: 'deny' })
  })
  it('a non-array permissions field refuses — not a schema we own', async () => {
    writeFileSync(cfg(), JSON.stringify({ permissions: { skill: 'allow' } }))
    await expect(writeSkillPermission(cfg(), 'x', 'allow')).rejects.toThrow('unsupported permissions shape')
  })
})

describe('siteDetailUrl — the audit-plane backlink', () => {
  it('nested slug encodes per segment — p/o/r.html is the real published path', () => {
    expect(siteDetailUrl(entry({ slug: 'o/r' }), 'https://x.dev/index.json'))
      .toBe('https://x.dev/p/o/r.html')
  })
  it('spaces/specials encode inside a segment', () => {
    expect(siteDetailUrl(entry({ slug: 'a b' }), 'https://x.dev/index.json'))
      .toBe('https://x.dev/p/a%20b.html')
  })
})

describe('enginesSatisfied — honest compat evaluation', () => {
  it('picks the opencode clause among several', () => {
    expect(enginesSatisfied('2.2.5', 'node >=18; opencode >=2.0.0')).toBe(true)
    expect(enginesSatisfied('1.0.0', 'node >=18; opencode >=2.0.0')).toBe(false)
  })
  it('a lone bare range reads as opencode', () => {
    expect(enginesSatisfied('2.2.5', '>=2.0.0')).toBe(true)
    expect(enginesSatisfied('2.2.5', '^2.0.0')).toBe(true)
    expect(enginesSatisfied('3.0.0', '^2.0.0')).toBe(false)   // major bump ≠ satisfied
  })
  it('unparseable → null, never a confident false', () => {
    expect(enginesSatisfied('2.2.5', 'latest')).toBeNull()
    expect(enginesSatisfied('2.2.5', 'npm >=9; yarn >=1')).toBeNull()  // no opencode clause
    expect(enginesSatisfied('abc', '>=2.0.0')).toBeNull()              // bad host version
  })
})
