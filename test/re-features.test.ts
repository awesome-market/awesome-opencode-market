import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as reFeatures } from '../pipeline/re-features.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const mkRes = (b: unknown, status = 200) =>
  new Response(typeof b === 'string' ? b : JSON.stringify(b), { status })

const packument = (vers: Record<string, unknown>) => mkRes({ versions: vers })

describe('re-features main', () => {
  it('github-kind features → []; npm slot recomputed from packument exports', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    const gh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r' }, features: ['server'], latestVersion: null })
    const npm = mkEntry('pkg-a', { features: [] })
    writeFileSync(f, JSON.stringify(mkIndex([gh, npm])))
    const fetchFn = (async () => packument({ '1.0.0': { exports: { './tui': './t.js' } } })) as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    expect(r.githubCleared).toBe(1)
    const idx = JSON.parse(readFileSync(f, 'utf8')) as CatalogIndex
    // dry → file untouched (still the old features)
    expect(idx.plugins[0]!.features).toEqual(['server'])
    expect(r.changed.some(c => c.startsWith('pkg-a@1.0.0'))).toBe(true)
  })
  it('writes corrected features when not --dry + covers pendingUpdate slot', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    const e = mkEntry('pkg-b', {
      features: ['server'],
      pendingUpdate: { version: '2.0.0', features: [], capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    })
    writeFileSync(f, JSON.stringify(mkIndex([e])))
    const fetchFn = (async () => packument({
      '1.0.0': { exports: { './tui': './t.js' } },
      '2.0.0': { exports: { '.': './m.js', './gui-experimental': './g.js' } },
    })) as typeof fetch
    await reFeatures(f, { fetchFn })
    const idx = JSON.parse(readFileSync(f, 'utf8')) as CatalogIndex
    expect(idx.plugins[0]!.features).toEqual(['tui'])
    expect(idx.plugins[0]!.pendingUpdate?.features).toEqual(['server', 'gui'])
  })
  it('missing version doc → failed; fetch throw → failed, no crash', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([
      mkEntry('gone', { latestVersion: '9.9.9' }),
      mkEntry('netfail'),
    ])))
    const fetchFn = (async (input: RequestInfo | URL) =>
      String(input).includes('netfail') ? Promise.reject(new Error('net')) : packument({ '1.0.0': { main: 'm.js' } })) as unknown as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    expect(r.failed).toContain('gone@9.9.9')
    expect(r.failed).toContain('netfail@1.0.0')
  })
  it('pendingUpdate version absent from packument → skipped, not failed', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    const e = mkEntry('pkg-p', {
      features: [],
      pendingUpdate: { version: '9.9.9', features: [], capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    })
    writeFileSync(f, JSON.stringify(mkIndex([e])))
    const fetchFn = (async () => packument({ '1.0.0': { main: 'm.js' } })) as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    // display slot recomputed fine; the held slot's missing doc just skips —
    // it must NOT land in failed (that's display-slot-only)
    expect(r.failed).toHaveLength(0)
  })
  it('>15 failed entries → overflow log path', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex(
      Array.from({ length: 18 }, (_, i) => mkEntry(`g${i}`, { latestVersion: '9.9.9' })))))
    const fetchFn = (async () => packument({ '1.0.0': { main: 'm.js' } })) as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    expect(r.failed).toHaveLength(18)
  })
  it('packument fetch !ok → doc null → recorded failed', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([mkEntry('gone2')])))
    const fetchFn = (async () => mkRes('not found', 404)) as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    expect(r.failed).toContain('gone2@1.0.0')
  })
  it('same-set reorder counts as reorderOnly, not changed', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([mkEntry('pkg-c', { features: ['tui', 'server'] })])))
    const fetchFn = (async () => packument({ '1.0.0': { exports: { '.': './m.js', './tui': './t.js' } } })) as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    // detectFeatures ordering may differ from the stored order → normalized
    expect(r.changed).toHaveLength(0)
  })
})

describe('re-features main — tarball fallback', () => {
  it('no exports+main → one tarball fetch supplies the file listing', async () => {
    const { mkdirSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    const dir = mkdtempSync(join(tmpdir(), 'rft-'))
    mkdirSync(join(dir, 'package'), { recursive: true })
    writeFileSync(join(dir, 'package', 'package.json'), '{}')
    writeFileSync(join(dir, 'package', 'gui-experimental.cjs'), 'module.exports={}')
    const tgzPath = join(dir, 'p.tgz')
    execFileSync('tar', ['-czf', tgzPath, '-C', dir, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const tgz = readFileSync(tgzPath)
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([mkEntry('pkg-d', { features: [] })])))
    const fetchFn = (async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u === 'https://x/p.tgz') return new Response(tgz)
      return packument({ '1.0.0': { dist: { tarball: 'https://x/p.tgz' } } })   // no exports, no main
    }) as typeof fetch
    const r = await reFeatures(f, { fetchFn })
    const idx = JSON.parse(readFileSync(f, 'utf8')) as CatalogIndex
    expect(idx.plugins[0]!.features).toEqual(['gui'])
    expect(r.changed.some(c => c.startsWith('pkg-d@1.0.0'))).toBe(true)
  })
  it('tarball fetch throwing → whole entry recorded failed', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'rf-')), 'index.json')
    writeFileSync(f, JSON.stringify(mkIndex([mkEntry('pkg-e')])))
    const fetchFn = (async (input: RequestInfo | URL) =>
      String(input) === 'https://x/dead.tgz'
        ? Promise.reject(new Error('tgz fetch died'))
        : packument({ '1.0.0': { dist: { tarball: 'https://x/dead.tgz' } } })) as unknown as typeof fetch
    const r = await reFeatures(f, { dry: true, fetchFn })
    expect(r.failed).toContain('pkg-e')
  })
})
