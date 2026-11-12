import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'
import {
  main as diagnoseMain, L05_CANARY_BENIGN, L05_CANARY_HOSTILE,
  materialFileName, materialDirOf, readMaterialBundle, type Material,
} from '../pipeline/ai/diagnose.ts'
import { main as materialMain } from '../pipeline/ai/material.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})
const l05Map = (fixed: Record<string, number> = {}) =>
  new Map<string, number>([[L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9], ...Object.entries(fixed)])
/** approved entry holding an unjudged 2.0.0 — the shape every pending update has */
const held = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' } })
const files = (plugins: PluginEntry[], verdicts: AiVerdict[] = []) => {
  const d = tmp('mb-')
  const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), op = join(d, 'out.jsonl')
  writeFileSync(ip, JSON.stringify(idx(plugins)))
  writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
  return { d, ip, vp, op }
}
const argv = (ip: string, vp: string, op: string, extra: string[] = []) =>
  ['tsx', 'diagnose.ts', '--index', ip, '--verdicts', vp, '--out', op, ...extra]
const margv = (ip: string, vp: string, outdir: string, extra: string[] = []) =>
  ['--index', ip, '--verdicts', vp, '--outdir', outdir, ...extra]

const bundle = (sourceSha: string, material: Material[] = [
  { id: 'manifest', text: 'STALE-META' }, // CI-time meta — consumer must replace with live reviewMaterial
  { id: 'content:package/SKILL.md', text: 'BUNDLED-TEXT' },
]) => ({
  name: 'pkg', version: '2.0.0', sourceSha, builtAt: 't', material,
})
const writeBundle = (dir: string, name: string, ver: string, b: unknown) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, materialFileName(name, ver)), typeof b === 'string' ? b : JSON.stringify(b))
}

const passOrnith = (capture: { got?: Material[] }) => async (_e: PluginEntry, m: Material[]) => {
  capture.got = m
  return { verdict: 'pass' as const, reasonZh: '没问题', reasonEn: 'fine' }
}

describe('material bundles — helpers', () => {
  it('filename encodes / as %2F (scoped names cannot traverse paths)', () => {
    expect(materialFileName('@scope/pkg', '1.0.0')).toBe('@scope%2Fpkg@1.0.0.json')
    expect(materialFileName('pkg', '2.0.0')).toBe('pkg@2.0.0.json')
  })
  it('materialDirOf sits next to index.json', () => {
    expect(materialDirOf('/x/y/index.json')).toBe('/x/y/material')
  })
  it('readMaterialBundle: missing/malformed → null; valid → parsed+sanitized', () => {
    const d = tmp('rb-')
    expect(readMaterialBundle(d, 'pkg', '2.0.0')).toBeNull()
    writeBundle(d, 'pkg', '2.0.0', 'not json {')
    expect(readMaterialBundle(d, 'pkg', '2.0.0')).toBeNull()
    writeBundle(d, 'pkg', '2.0.0', { material: 'oops' })
    expect(readMaterialBundle(d, 'pkg', '2.0.0')).toBeNull()
    writeBundle(d, 'pkg', '2.0.0', {
      sourceSha: 's', material: [
        { id: 'manifest', text: 'ok' },
        { id: 42, text: 'bad' }, // non-string id dropped
        { nope: true },
      ],
    })
    const r = readMaterialBundle(d, 'pkg', '2.0.0')
    expect(r?.bundle.sourceSha).toBe('s')
    expect(r?.bundle.material).toEqual([{ id: 'manifest', text: 'ok' }])
  })
})

describe('material bundles — diagnose consumer', () => {
  it('sha-matching bundle: material used verbatim, tarball never fetched, consumed→rm list', async () => {
    const { d, ip, vp, op } = files([held])
    const matdir = materialDirOf(ip)
    writeBundle(matdir, 'pkg', '2.0.0', bundle('sha-X'))
    const rmf = join(d, 'rm.list')
    const cap: { got?: Material[] } = {}
    await diagnoseMain(argv(ip, vp, op, ['--material-rm', rmf]), {
      l05: () => l05Map({ 'pkg\0manifest': 0.1 }),
      ornith: passOrnith(cap),
      sha: async () => 'sha-X',
      tarball: async () => { throw new Error('must not fetch — bundle hit should skip the download') },
    })
    // content block came from the bundle; meta block is LIVE (not the stale snapshot)
    expect(cap.got?.some(b => b.id === 'content:package/SKILL.md' && b.text === 'BUNDLED-TEXT')).toBe(true)
    expect(cap.got?.every(b => b.text !== 'STALE-META')).toBe(true)
    expect(cap.got?.some(b => b.id === 'manifest')).toBe(true)
    expect(readFileSync(rmf, 'utf8')).toContain('pkg@2.0.0.json')
    expect(JSON.parse(readFileSync(op, 'utf8').trim()).verdict).toBe('pass')
  })
  it('sha mismatch → live fallback + stale bundle listed for deletion', async () => {
    const { d, ip, vp, op } = files([held])
    const matdir = materialDirOf(ip)
    writeBundle(matdir, 'pkg', '2.0.0', bundle('sha-OLD'))
    const rmf = join(d, 'rm.list')
    const cap: { got?: Material[] } = {}
    await diagnoseMain(argv(ip, vp, op, ['--material-rm', rmf]), {
      l05: () => l05Map({ 'pkg\0manifest': 0.1 }),
      ornith: passOrnith(cap),
      sha: async () => 'sha-NEW',
      tarball: async () => null, // live path attempted, no tarball url available
    })
    // live-built material, not the staged marker
    expect(cap.got?.every(b => b.text !== 'BUNDLED-TEXT')).toBe(true)
    expect(cap.got?.some(b => b.id === 'manifest')).toBe(true)
    expect(readFileSync(rmf, 'utf8')).toContain('pkg@2.0.0.json')
  })
  it('contentFailed bundle → miss (daemon retries its own fetch), not deleted', async () => {
    const { d, ip, vp } = files([held])
    const matdir = materialDirOf(ip)
    writeBundle(matdir, 'pkg', '2.0.0', {
      ...bundle('sha-X'), contentFailed: true,
    })
    const rmf = join(d, 'rm.list')
    const cap: { got?: Material[] } = {}
    await diagnoseMain(argv(ip, vp, join(d, 'out.jsonl'), ['--material-rm', rmf]), {
      l05: () => l05Map({ 'pkg\0manifest': 0.1 }),
      ornith: passOrnith(cap),
      sha: async () => 'sha-X',
      tarball: async () => null,
    })
    expect(cap.got?.every(b => b.text !== 'BUNDLED-TEXT')).toBe(true)
    if (existsSync(rmf)) expect(readFileSync(rmf, 'utf8')).not.toContain('pkg@2.0.0.json')
  })
  it('malformed bundle → treated as a miss (live path), NOT deleted (key still pending)', async () => {
    const { d, ip, vp } = files([held])
    const matdir = materialDirOf(ip)
    writeBundle(matdir, 'pkg', '2.0.0', 'totally not json')
    const rmf = join(d, 'rm.list')
    const cap: { got?: Material[] } = {}
    await diagnoseMain(argv(ip, vp, join(d, 'out.jsonl'), ['--material-rm', rmf]), {
      l05: () => l05Map({ 'pkg\0manifest': 0.1 }),
      ornith: passOrnith(cap),
      sha: async () => 'sha-X',
      tarball: async () => null,
    })
    expect(cap.got?.every(b => b.text !== 'BUNDLED-TEXT')).toBe(true)
    // rm list either absent or must not name the still-pending bundle —
    // a malformed file gets one more chance (rebuild) before the GC sees it
    if (existsSync(rmf)) expect(readFileSync(rmf, 'utf8')).not.toContain('pkg@2.0.0.json')
  })
  it('orphan bundle (entry already verdicted) → GC lists it for deletion', async () => {
    const { d, ip, vp, op } = files(
      [e({ approval: 'approved' })],
      [v({ name: 'pkg', version: '1.0.0', verdict: 'pass' })],
    )
    const matdir = materialDirOf(ip)
    writeBundle(matdir, 'gone', '9.9.9', { sourceSha: 's', material: [{ id: 'm', text: 'x' }] })
    const rmf = join(d, 'rm.list')
    await diagnoseMain(argv(ip, vp, op, ['--material-rm', rmf]), {
      l05: () => l05Map(),
      ornith: passOrnith({}),
      sha: async () => 'sha-X',
    })
    expect(readFileSync(rmf, 'utf8')).toContain('gone@9.9.9.json')
  })
})

describe('material bundles — CI producer', () => {
  const makeTgz = async (d: string, fs: Record<string, string>) => {
    const src = join(d, 'src', 'package') // npm tarballs wrap members under package/
    mkdirSync(src, { recursive: true })
    for (const [n, c] of Object.entries(fs)) writeFileSync(join(src, n), c)
    const tgz = join(d, 'p.tgz')
    await create({ gzip: true, file: tgz, cwd: join(d, 'src') }, Object.keys(fs).map(f => `package/${f}`))
    return readFileSync(tgz)
  }
  const pkDoc = (ver: string, integrity: string, tarball: string) => ({
    'dist-tags': { latest: ver }, time: {},
    versions: { [ver]: { dist: { integrity, tarball } } },
  })
  const fetchFn = (pk: object, tgz: Buffer) =>
    (async (u: unknown) => String(u).includes('registry.npmjs.org')
      ? new Response(JSON.stringify(pk))
      : new Response(new Uint8Array(tgz))) as unknown as typeof fetch

  it('builds a sha-pinned bundle with manifest + extracted content', async () => {
    const { d, ip, vp } = files([held])
    const matdir = join(d, 'material')
    const tgz = await makeTgz(d, { 'package.json': '{"name":"pkg","version":"2.0.0"}', 'SKILL.md': '# hello' })
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetchFn(pkDoc('2.0.0', 'sha512-AAA', 'https://r.test/p.tgz'), tgz) })
    const f = join(matdir, 'pkg@2.0.0.json')
    expect(existsSync(f)).toBe(true)
    const b = JSON.parse(readFileSync(f, 'utf8'))
    expect(b.sourceSha).toBe('sha512-AAA')
    expect(b.name).toBe('pkg')
    expect(b.version).toBe('2.0.0')
    expect(b.material.some((x: Material) => x.id === 'manifest')).toBe(true)
    expect(b.material.some((x: Material) => x.id.startsWith('content'))).toBe(true)
  })
  it('fresh bundle kept (not rebuilt); stale-sha bundle rebuilt', async () => {
    const { d, ip, vp } = files([held])
    const matdir = join(d, 'material')
    const tgz = await makeTgz(d, { 'package.json': '{}' })
    const fetch = fetchFn(pkDoc('2.0.0', 'sha512-AAA', 'https://r.test/p.tgz'), tgz)
    // fresh: same sha → keep the file as-is
    writeBundle(matdir, 'pkg', '2.0.0', { sourceSha: 'sha512-AAA', material: [{ id: 'manifest', text: 'KEPT-MARKER' }] })
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetch })
    expect(readFileSync(join(matdir, 'pkg@2.0.0.json'), 'utf8')).toContain('KEPT-MARKER')
    // stale: registry moved → rebuilt with the new sha
    writeBundle(matdir, 'pkg', '2.0.0', { sourceSha: 'sha-OLD', material: [{ id: 'manifest', text: 'KEPT-MARKER' }] })
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetch })
    const b = JSON.parse(readFileSync(join(matdir, 'pkg@2.0.0.json'), 'utf8'))
    expect(b.sourceSha).toBe('sha512-AAA')
    expect(JSON.stringify(b.material)).not.toContain('KEPT-MARKER')
  })
  it('decided entry → its bundle file is pruned', async () => {
    const { d, ip, vp } = files(
      [e({ approval: 'approved' })],
      [v({ name: 'pkg', version: '1.0.0', verdict: 'pass' })],
    )
    const matdir = join(d, 'material')
    writeBundle(matdir, 'pkg', '1.0.0', { sourceSha: 's', material: [{ id: 'm', text: 'x' }] })
    const f = join(matdir, 'pkg@1.0.0.json')
    expect(existsSync(f)).toBe(true)
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetchFn(pkDoc('1.0.0', 'x', 'https://r.test/p.tgz'), Buffer.alloc(0)) })
    expect(existsSync(f)).toBe(false)
  })
  it('MATERIAL_TARBALL_CAP env lifts/lowers the producer transport cap', async () => {
    const { d, ip, vp } = files([held])
    const matdir = join(d, 'material')
    const tgz = await makeTgz(d, { 'package.json': '{"name":"pkg"}', 'SKILL.md': '# hello' })
    const fetch = fetchFn(pkDoc('2.0.0', 'sha512-AAA', 'https://r.test/p.tgz'), tgz)
    const f = join(matdir, 'pkg@2.0.0.json')
    // cap below the fixture size → tarball rejected → bundle degrades to a
    // content-error block + contentFailed flag (no real file blocks)
    process.env.MATERIAL_TARBALL_CAP = '10'
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetch })
    let b = JSON.parse(readFileSync(f, 'utf8'))
    expect(b.material.some((x: Material) => x.id.startsWith('content:'))).toBe(false)
    expect(b.material.some((x: Material) => x.id === 'content-error')).toBe(true)
    expect(b.contentFailed).toBe(true)
    // default CI cap (env cleared) → degraded bundle rebuilt, content extracted
    delete process.env.MATERIAL_TARBALL_CAP
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetch })
    b = JSON.parse(readFileSync(f, 'utf8'))
    expect(b.material.some((x: Material) => x.id.startsWith('content:'))).toBe(true)
    expect(b.contentFailed).toBeUndefined()
  })
  it('github-kind entry → no bundle (no npm tarball surface)', async () => {
    const gh = e({ source: { kind: 'github', id: 'o/r' }, approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' } })
    const { d, ip, vp } = files([gh])
    const matdir = join(d, 'material')
    await materialMain(margv(ip, vp, matdir), { fetchFn: fetchFn(pkDoc('2.0.0', 'x', 'https://r.test/p.tgz'), Buffer.alloc(0)) })
    expect(existsSync(join(matdir, 'pkg@2.0.0.json'))).toBe(false)
  })
})
