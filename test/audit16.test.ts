/** audit #4 re-do (fresh pass): L0.5 must not score machine-generated blocks
 *  ('pending' version line, self-written 'content-coverage' note) — an FP on
 *  text the package never authored would write a mechanical concern; and the
 *  sha-drift sweep stamp must only record FULL sweeps, or a targeted --name
 *  run suppresses the next real sweep for hours. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  main as diagnoseMain,
  L05_CANARY_BENIGN, L05_CANARY_HOSTILE,
} from '../pipeline/ai/diagnose.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

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
const held = (over: Record<string, unknown> = {}, name = 'pkg') =>
  e({ name, pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: '2025-01-01T00:00:00Z', ...over } })

const files = (plugins: PluginEntry[], verdicts: AiVerdict[] = [], extraArgs: string[] = []) => {
  const d = mkdtempSync(join(tmpdir(), 'a16-'))
  const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), op = join(d, 'out.jsonl')
  writeFileSync(ip, JSON.stringify(idx(plugins)))
  writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
  const argv = ['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op, ...extraArgs]
  return { argv, op, d }
}
const outLines = (op: string): AiVerdict[] =>
  readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)
const l05Map = () =>
  new Map<string, number>([[L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9]])
const okOrnith = async () => ({ verdict: 'pass' as const, reasonZh: 'ok', reasonEn: 'ok' })
const ping = async () => true
const noSha = () => undefined

describe('L0.5 machine-block skip — self-authored text can never flag', () => {
  it("'pending' version line is excluded from the L0.5 batch input", async () => {
    let batch: { id: string; text: string }[] = []
    const { argv } = files([held()])
    await diagnoseMain(argv, {
      l05: (items: { id: string; text: string }[]) => { batch = items; return l05Map() },
      ornith: okOrnith, sha: noSha, ping,
    })
    // a pendingUpdate entry emits a 'pending' review block — pure machine
    // prose ('candidate v2.0.0'). It must not reach the classifier at all.
    expect(batch.map(x => x.id)).not.toContain('pkg\x00pending')
    expect(batch.map(x => x.id)).toContain('pkg\x00manifest') // real prose still scored
  })

  it("'content-coverage' self-note is excluded even when the budget overflows", async () => {
    // one binary (NUL-containing) .md counts as dropped → omitted>0 → the
    // coverage block is emitted into the material — and must stay OUT of L0.5
    const { create } = await import('tar')
    const dir = mkdtempSync(join(tmpdir(), 'a16-cov-'))
    mkdirSync(join(dir, 'package'), { recursive: true })
    writeFileSync(join(dir, 'package/README.md'), '# benign readme')
    writeFileSync(join(dir, 'package/bin.md'), Buffer.from([0x00, 0x01, 0x02]))
    const tgz = join(dir, 'p.tgz')
    await create({ gzip: true, file: tgz, cwd: dir }, ['package/README.md', 'package/bin.md'])
    const fetchFn = (async () => new Response(readFileSync(tgz))) as unknown as typeof fetch
    const { contentMaterial } = await import('../pipeline/ai/diagnose.ts')
    const material = await contentMaterial('pkg', '1.0.0', 'https://r.test/p.tgz', fetchFn)
    expect(material.map(x => x.id)).toContain('content-coverage') // note IS emitted…

    // …and must stay out of the classifier — end-to-end through main()'s
    // works build (fetchFn injection lets the content path run offline)
    let batch: { id: string; text: string }[] = []
    const { argv } = files([held()])
    await diagnoseMain(argv, {
      l05: (items: { id: string; text: string }[]) => { batch = items; return l05Map() },
      ornith: okOrnith, sha: noSha, ping,
      tarball: async () => 'https://r.test/p.tgz', fetchFn,
    })
    expect(batch.map(x => x.id)).not.toContain('pkg\x00content-coverage')
    expect(batch.map(x => x.id)).toContain('pkg\x00content:README.md') // real content scored
  })

  it('a high score parked ON a skipped machine block cannot flag the entry', async () => {
    // belt-and-braces: even if a future block type leaks a machine id into
    // the batch, l05Top only collects non-skipped ids — so 'pending' and
    // 'content-coverage' scores are structurally unreachable.
    const { argv, op } = files([held()])
    await diagnoseMain(argv, {
      l05: () => new Map<string, number>([
        [L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9],
        ['pkg\x00pending', 0.99], ['pkg\x00content-coverage', 0.99], // would flag if collected
      ]),
      ornith: okOrnith, sha: noSha, ping,
    })
    const got = outLines(op)[0]
    expect(got?.verdict).toBe('pass')     // machine-block scores can't flag
    expect(got?.l05?.score).not.toBe(0.99)
  })
})

describe('sha-drift sweep stamp — partial sweeps must not satisfy the throttle', () => {
  const seedDrift = async (sweepPath: string, extraArgs: string[] = []) => {
    // an entry WITH a sha-bearing verdict whose registry sha has moved → the
    // sweep runs and finds drift whenever it actually executes
    const v: AiVerdict = {
      name: 'pkg', version: '2.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z',
      source: 'ai', sha: 'sha256-old',
    }
    const { argv, d } = files([held()], [v], ['--sweep-state', sweepPath, ...extraArgs])
    await diagnoseMain(argv, {
      l05: () => l05Map(), ornith: okOrnith, sha: async () => 'sha256-new', ping,
    })
    return { argv, d }
  }

  it('a full run writes the stamp', async () => {
    const d = mkdtempSync(join(tmpdir(), 'a16-sw-'))
    const sp = join(d, 'sweep.stamp')
    await seedDrift(sp)
    expect(existsSync(sp)).toBe(true)
  })

  it('a --name run does NOT write the stamp — the full sweep stays due', async () => {
    const d = mkdtempSync(join(tmpdir(), 'a16-sw-'))
    const sp = join(d, 'sweep.stamp')
    await seedDrift(sp, ['--name', 'pkg'])
    expect(existsSync(sp)).toBe(false)
  })

  it('a --force run does NOT write the stamp either', async () => {
    const d = mkdtempSync(join(tmpdir(), 'a16-sw-'))
    const sp = join(d, 'sweep.stamp')
    await seedDrift(sp, ['--name', 'pkg', '--force'])
    expect(existsSync(sp)).toBe(false)
  })
})
