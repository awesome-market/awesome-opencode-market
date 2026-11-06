/** audit #9 (站点发布流 §9) — regression:
 *  The site consumes the post-merge index where pending entries are already
 *  normalized, and every user-facing surface filters isVisible
 *  (approval !== 'pending') BEFORE any slot read — so the B3 inverted state
 *  (pending + leftover pendingUpdate) cannot leak hold bytes onto pages.
 *  These tests pin that invariant: a pending+hold skill/plugin must produce
 *  no card, no detail page, and no skill-catalog candidate; an approved+hold
 *  entry keeps serving its DISPLAYED version (hold semantics). */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSite, listPage, isVisible } from '../pipeline/site/build.ts'
import type { PluginEntry, CatalogIndex } from '../src/schema.ts'

const mk = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: { en: 'desc' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 5, npmDownloads30d: 100, checkedAt: 't' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })
const pu = {
  version: '2.0.0', heldAt: '2026-01-05T00:00:00Z',
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' as const },
}

describe('§9: pending+hold never reaches a user-facing surface', () => {
  it('isVisible filters the inverted entry; listPage renders no card for it', () => {
    const inv = mk({ name: 'inv', slug: 'o/inv', pendingUpdate: pu as never })
    const ok = mk({ name: 'ok', slug: 'o/ok', approval: 'approved' })
    expect(isVisible(inv)).toBe(false)
    const html = listPage(idx([inv, ok]))
    expect(html).not.toContain('o/inv')
    expect(html).toContain('o/ok')
  })

  it('buildSite writes index.json (audit plane) but NO detail page for pending+hold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a33-'))
    const inv = mk({ name: 'inv', slug: 'o/inv', pendingUpdate: pu as never })
    const ok = mk({ name: 'ok', slug: 'o/ok', approval: 'approved' })
    await buildSite(idx([inv, ok]), join(dir, 'site'), undefined, join(dir, 'no-verdicts.jsonl'))
    // full catalog still ships for audit — pending rows included
    const shipped = JSON.parse(readFileSync(join(dir, 'site', 'index.json'), 'utf8'))
    expect(shipped.plugins.map((p: PluginEntry) => p.name)).toContain('inv')
    // but the detail page for the pending entry was never written
    expect(existsSync(join(dir, 'site', 'p', 'o', 'inv.html'))).toBe(false)
    expect(existsSync(join(dir, 'site', 'p', 'o', 'ok.html'))).toBe(true)
  })

  it('approved+hold serves the DISPLAYED version, not the held candidate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a33b-'))
    const held = mk({
      name: 'sk', slug: 'o/sk', approval: 'approved',
      contains: ['skill'], latestVersion: '1.0.0',
      pendingUpdate: { ...pu, version: '2.0.0' } as never,
    })
    // tarball resolver returns null → skill can't land; what matters is the
    // CANDIDATE selection: latestVersion '1.0.0' is what would be fetched —
    // assert via the catalog plan indirectly: a null fetch still records the
    // candidate in `candidates` count only when a version exists
    const r = await (await import('../pipeline/site/build.ts')).buildSkillCatalog(
      idx([held]), join(dir, 'site'), () => null)
    expect(r.candidates).toBe(1)   // visible + has a version → candidate exists
    // and the pinned spec it WOULD fetch is name@1.0.0 (displayed), never 2.0.0
    const seen: string[] = []
    await (await import('../pipeline/site/build.ts')).buildSkillCatalog(
      idx([held]), join(dir, 'site2'), (spec: string) => { seen.push(spec); return null })
    expect(seen).toEqual(['sk@1.0.0'])
  })
})
