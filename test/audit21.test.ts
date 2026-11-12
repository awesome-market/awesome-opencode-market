/** audit #9 (站点发布流 §9) — regressions:
 *  1. tar member extraction vets TYPES, not just names: a symlink member
 *     followed by 'x/<file>' writes through the link outside tmp during
 *     extraction (GNU tar on CI follows; bsdtar refuses the whole skill).
 *     Only regular files may be extracted — the skill still lands minus
 *     the special members (previously a stray symlink skipped it entirely).
 *  2. Every bail path cleans skills/<id>.tmp AND a stale dest — an early
 *     return used to leave the extracted payload inside outDir, published
 *     to Pages unlisted (over-total-cap payloads especially).
 *  3. unpinned counts only the genuine HEAD fallback (missing/empty
 *     source.version); a malformed non-hex version warns + skips instead of
 *     being counted as "served from HEAD" while never fetching.
 *  4. listPage/skillsPage don't link detail pages that were never written
 *     (unsafe slug) — corrupt data gets a name, not a 404.
 *  5. skill ids get the SAFE_MEMBER charset too — '#' '?' '%' survive
 *     encodeURI and would publish a listed-but-unfetchable tree. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { buildSkillCatalog, listPage } from '../pipeline/site/build.ts'
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
const idx = (plugins: PluginEntry[]): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })

/** minimal ustar writer — members a filesystem `tar` cannot produce (a file
 *  "inside" a symlinked dir) are exactly the cases under test */
const header = (name: string, type: string, size: number, link = ''): Buffer => {
  const h = Buffer.alloc(512)
  h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136)
  h.fill(' ', 148, 156); h.write(type, 156); h.write(link, 157); h.write('ustar', 257)
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}
const tgz = (members: { name: string; type: '0' | '1' | '2' | '5'; data?: Buffer; link?: string }[]): Buffer => {
  const parts: Buffer[] = []
  for (const m of members) {
    const data = m.data ?? Buffer.alloc(0)
    parts.push(header(m.name, m.type, data.length, m.link ?? ''), data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

describe('§9: tar member type filter (symlink write-through)', () => {
  it('symlink + through-member are never extracted; regular files still land', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const src = join(dir, 's.tgz')
    writeFileSync(src, tgz([
      { name: 'package/', type: '5' },
      { name: 'package/ok.txt', type: '0', data: Buffer.from('fine') },
      { name: 'package/x', type: '2', link: join(dir, 'victim') },
      { name: 'package/x/evil.txt', type: '0', data: Buffer.from('escaped') },
      { name: 'package/link2', type: '1', link: 'package/ok.txt' },   // hardlink member
    ]))
    const out = join(dir, 'site')
    const r = await buildSkillCatalog(idx([mk({ name: 'sk-sym', contains: ['skill'] })]),
      out, () => `file://${src}`)
    expect(r.landed).toBe(1)
    const files = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8')).skills[0].files
    // 'x/evil.txt' is a REGULAR member — with the symlink never extracted it
    // lands as an ordinary nested file inside the skill, not through a link.
    // The safety property is that 'x' itself is never a link on disk.
    expect(files.sort()).toEqual(['ok.txt', 'x/evil.txt'])
    expect(existsSync(join(dir, 'victim', 'evil.txt'))).toBe(false)   // nothing escaped
    const { lstatSync } = await import('node:fs')
    expect(lstatSync(join(out, 'skills', 'sk-sym', 'x')).isSymbolicLink()).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('§9: bail cleans tmp + dest — no orphan publish', () => {
  it('over-total payload leaves no skills/<id>.tmp or <id> dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const src = join(dir, 'big.tgz')
    // gzipped zeros shrink the tgz but expand past the 20MB aggregate cap
    writeFileSync(src, tgz([
      { name: 'package/', type: '5' },
      { name: 'package/huge.bin', type: '0', data: Buffer.alloc(21 * 1024 * 1024) },
    ]))
    const out = join(dir, 'site')
    const r = await buildSkillCatalog(idx([mk({ name: 'sk-big', contains: ['skill'] })]),
      out, () => `file://${src}`)
    expect(r.landed).toBe(0)
    expect(existsSync(join(out, 'skills', 'sk-big.tmp'))).toBe(false)
    expect(existsSync(join(out, 'skills', 'sk-big'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
  it('empty-payload tar leaves no .tmp dir either', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const src = join(dir, 'e.tgz')
    writeFileSync(src, tgz([{ name: 'package/', type: '5' }]))
    const out = join(dir, 'site')
    await buildSkillCatalog(idx([mk({ name: 'sk-none', contains: ['skill'] })]),
      out, () => `file://${src}`)
    expect(existsSync(join(out, 'skills', 'sk-none.tmp'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
  it('unresolvable tarball also cleans a stale dest tree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const out = join(dir, 'site')
    // pre-seed a dest the way a dropped cache-hit copy would leave it
    mkdirSync(join(out, 'skills', 'sk-gone'), { recursive: true })
    writeFileSync(join(out, 'skills', 'sk-gone', 'STALE.md'), 'stale')
    await buildSkillCatalog(idx([mk({ name: 'sk-gone', contains: ['skill'] })]),
      out, () => null)
    expect(existsSync(join(out, 'skills', 'sk-gone'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('§9: unpinned honesty + id charset', () => {
  const gh = (name: string, version: string | undefined) => mk({
    name, slug: name, latestVersion: null, modifiedAt: '2026-01-01T00:00:00Z',
    source: { kind: 'github', id: name, repo: name, version }, contains: ['skill'],
  })
  it('missing source.version counts unpinned; malformed version warns + skips without counting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const src = join(dir, 's.tgz')
    writeFileSync(src, tgz([{ name: 'x/', type: '5' }, { name: 'x/SKILL.md', type: '0', data: Buffer.from('# s') }]))
    const out = join(dir, 'site')
    const r = await buildSkillCatalog(idx([
      gh('o/repo1', undefined),              // pre-sha row → HEAD fallback → unpinned
      gh('o/repo2', 'main'),                 // malformed — warns + skipped, not candidacy
      gh('o/repo3', 'abc1234'),              // pinned sha → served, not unpinned
    ]), out, () => null, undefined,
      (repo, sha) => `file://${src}`)       // gh fetch always "succeeds"
    // unpinned = 1 (the genuine HEAD fallback) — 'main' is malformed data,
    // skipped before candidacy, and must not inflate the HEAD-served caveat
    expect(r.unpinned).toBe(1)
    expect(r.landed).toBe(2)                 // unpinned HEAD + pinned sha both served
    rmSync(dir, { recursive: true, force: true })
  })
  it('skill ids with URL-breaking chars are skipped — never listed unfetchable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a21-'))
    const src = join(dir, 's.tgz')
    writeFileSync(src, tgz([{ name: 'p/', type: '5' }, { name: 'p/SKILL.md', type: '0', data: Buffer.from('# s') }]))
    const out = join(dir, 'site')
    const r = await buildSkillCatalog(idx([
      mk({ name: 'evil#id', slug: 'evil-id', contains: ['skill'] }),
      mk({ name: 'evil%25id', slug: 'evil-pct', contains: ['skill'] }),
      mk({ name: 'sk-good', slug: 'sk-good', contains: ['skill'] }),
    ]), out, () => `file://${src}`)
    expect(r.landed).toBe(1)
    const names = JSON.parse(readFileSync(join(out, 'skills', 'index.json'), 'utf8')).skills.map((s: any) => s.name)
    expect(names).toEqual(['sk-good'])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('§9: no dead links to unwritten detail pages', () => {
  it('listPage renders the name without an href for unsafe slugs', () => {
    const html = listPage(idx([mk({ name: 'bad', slug: '../evil' }), mk({ name: 'good', slug: 'o/good' })]))
    expect(html).not.toContain('p/../evil')
    expect(html).not.toContain('evil.html')
    expect(html).toContain('<b>bad</b>')
    expect(html).toContain('p/o/good.html')
  })
})
