/** audit #1 fresh round (catalog-ingestion, round 5):
 *  1. mergeEntries' same-held-version restore took the remote verification
 *     slot wholesale without checking byte anchors: a re-tagged held version
 *     rebuilt via the full path re-anchors pu.integrity to CURRENT registry
 *     bytes while inheriting the OLD bytes' 'verified' — the release gate's
 *     RELEASABLE check would then certify bytes nobody install-tested. The
 *     pin path's puDrift freeze only covers holds that stayed pinned. Restore
 *     now downgrades to 'unverified' when both anchors exist and disagree
 *     (missing anchor → legacy keep, same philosophy as samePinnedBytes).
 *  2. dedupeSlugs assigned --N fallback slugs in pool-completion order —
 *     unstable across runs; two losers contesting the same fallback could
 *     flap slugs/URLs between publishes of identical data. Losers are now
 *     slug-assigned in global name order.
 *  3. scanTarball buffered text files without limit (bufCap=Infinity): one
 *     ~500MB minified bundle meant ~500MB buffer + utf8 decode per worker —
 *     an OOM vector on the 16GB runner. Text is now capped at 32MB/file with
 *     an honest 'text-truncated' medium finding; rules still scan the head. */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { mergeEntries, dedupeSlugs } from '../pipeline/publish/merge.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const pu = (over: Record<string, unknown> = {}) => ({
  version: '2.0.0',
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'unverified' as const },
  heldAt: 't',
  ...over,
}) as PluginEntry['pendingUpdate']

describe('mergeEntries: held-version verification restore requires byte-anchor agreement', () => {
  const held = (puIntegrity: string | null, vIntegrity?: string) => {
    const old = idx([e({
      name: 'pk', slug: 'pk', latestVersion: '1.0.0', integrity: 'sha512-d',
      pendingUpdate: pu({
        integrity: 'sha512-A',
        verification: { status: 'verified', integrity: vIntegrity ?? 'sha512-A', verifiedAt: 't0', level: 'load' },
      }),
      verification: { status: 'verified', integrity: 'sha512-d' },
    })])
    const fresh = e({
      name: 'pk', slug: 'pk', latestVersion: '1.0.0', integrity: 'sha512-d',
      pendingUpdate: pu({ integrity: puIntegrity, verification: { status: 'unverified' } }),
      verification: { status: 'unverified' },
    })
    return { old, fresh }
  }

  it('re-tagged held version (anchor shaB ≠ measured shaA) → unverified, evidence kept', () => {
    const { old, fresh } = held('sha512-B')
    const merged = mergeEntries([fresh], old, '2.2.5', RULESET_VERSION)
    const v = merged[0]!.pendingUpdate!.verification
    expect(v.status).toBe('unverified')
    // audit trail of what WAS measured survives the downgrade
    expect(v.integrity).toBe('sha512-A')
    expect(v.verifiedAt).toBe('t0')
    expect(v.level).toBe('load')
    // the pinned anchor is the NEW bytes — display slot untouched
    expect(merged[0]!.pendingUpdate!.integrity).toBe('sha512-B')
    expect(merged[0]!.verification.status).toBe('verified')
  })

  it('same bytes (anchor === measured) → verified restored as before', () => {
    const { old, fresh } = held('sha512-A')
    const merged = mergeEntries([fresh], old, '2.2.5', RULESET_VERSION)
    expect(merged[0]!.pendingUpdate!.verification.status).toBe('verified')
  })

  it('missing fresh anchor falls back to remote pin → still matches → verified', () => {
    const { old, fresh } = held(null)
    const merged = mergeEntries([fresh], old, '2.2.5', RULESET_VERSION)
    expect(merged[0]!.pendingUpdate!.integrity).toBe('sha512-A')
    expect(merged[0]!.pendingUpdate!.verification.status).toBe('verified')
  })

  it('legacy measurement without integrity anchor → cannot disprove → verified kept', () => {
    const { old, fresh } = held('sha512-B', undefined)
    // strip the measurement anchor entirely (pre-field verify results)
    ;(old.plugins[0]!.pendingUpdate!.verification as Record<string, unknown>).integrity = undefined
    const merged = mergeEntries([fresh], old, '2.2.5', RULESET_VERSION)
    expect(merged[0]!.pendingUpdate!.verification.status).toBe('verified')
  })
})

describe('dedupeSlugs: fallback assignment is input-order independent', () => {
  const mk = (name: string, slug: string): PluginEntry => e({ name, slug })
  // 'x' slug is owned by an unrelated entry; the 'o/r' group holds the
  // canonical repo-named entry plus two losers whose name-slugs contest:
  // 'x' is taken → loser 'x' wants 'x--2', which is ALSO loser 'x--2''s
  // name-slug. Encounter order decided who got 'x--2' vs 'x--3'/'x--2--2'.
  const entries = () => [
    mk('slug-owner', 'x'),
    mk('o/r', 'o/r'),
    mk('x', 'o/r'),
    mk('x--2', 'o/r'),
  ]
  const slugsOf = (list: PluginEntry[]) =>
    Object.fromEntries(list.map(p => [p.name, p.slug]))

  it('same data in different orders → identical slug assignment', () => {
    const a = dedupeSlugs(entries())
    const b = dedupeSlugs([...entries()].reverse())
    expect(slugsOf(a)).toEqual(slugsOf(b))
    // and the assignment is the deterministic name-ordered one:
    // 'x' < 'x--2' → 'x' claims 'x--2' first, 'x--2' falls to 'x--2--2'
    expect(slugsOf(a)).toEqual({
      'slug-owner': 'x', 'o/r': 'o/r', 'x': 'x--2', 'x--2': 'x--2--2',
    })
    // losers keep the collided slug in aliases for URL continuity
    const loser = a.find(p => p.name === 'x')!
    expect(loser.aliases).toContain('o/r')
  })
})

describe('scanTarball: oversized text files are capped and disclosed', () => {
  let tgz: Buffer
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'scanhug-'))
    mkdirSync(join(dir, 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'hugesrc', version: '1.0.0' }))
    // eval() at the head proves rules still scan the buffered prefix;
    // ~33MB of incompressible printable padding pushes the file past the
    // 32MB text cap (compressible filler would trip tar's own 1000:1
    // decompression-ratio guard before our cap is even reached)
    const rand = randomBytes(33 * 1024 * 1024)
    const pad = Buffer.allocUnsafe(rand.length)
    for (let i = 0; i < rand.length; i++) pad[i] = 0x61 + (rand[i]! % 26)
    const body = Buffer.concat([Buffer.from('eval(process.env.X);\n'), pad])
    writeFileSync(join(dir, 'pkg/dist.js'), body)
    const out = join(dir, 'h.tgz')
    execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    tgz = readFileSync(out)
  }, 30000)

  it('text-truncated finding emitted, head still scanned, path still listed', async () => {
    const r = await scanTarball(tgz)
    const trunc = r.findings.find(f => f.rule === 'text-truncated')
    expect(trunc).toBeTruthy()
    expect(trunc!.severity).toBe('medium')
    expect(trunc!.file).toBe('pkg/dist.js')
    // rules ran on the buffered head — eval() was in the first bytes
    expect(r.findings.some(f => f.rule === 'obfuscation' && f.file === 'pkg/dist.js')).toBe(true)
    // path still lands in files[] — entrypoint/evidence detection unaffected
    expect(r.files).toContain('pkg/dist.js')
  }, 30000)
})
