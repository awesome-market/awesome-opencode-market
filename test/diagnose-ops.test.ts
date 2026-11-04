/** D-series diagnose ops: omlx preflight (D-1), sha fetch dedup (D-2),
 *  chronic-failure attempts → tooling concern (D-3), bounded --limit default
 *  (D-6), digest review-backlog section (D-7). */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as diagnoseMain } from '../pipeline/ai/diagnose.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const held = e({ pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: '2026-01-01T00:00:00Z' } })
const flaggedHeld = e({ name: 'bad', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: ['net:exfil'] }, verification: { status: 'verified' }, heldAt: '2026-01-01T00:00:00Z' } })
const failedHeld = e({ name: 'broken', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'failed', level: 'install', logExcerpt: 'npm 404' }, heldAt: '2026-01-01T00:00:00Z' } })
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '2.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})
const noSha = () => undefined
const cleanL05 = () => new Map([['pkg\0manifest', 0.1]])
const okOrnith = async () => ({ verdict: 'pass' as const, reasonZh: 'ok', reasonEn: 'ok' })

const files = (plugins: PluginEntry[], verdicts: AiVerdict[] = [], state?: string) => {
  const d = mkdtempSync(join(tmpdir(), 'dops-'))
  const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), op = join(d, 'out.jsonl')
  writeFileSync(ip, JSON.stringify(idx(plugins)))
  writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
  const argv = ['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op, ...(state ? ['--state', state] : [])]
  return { argv, op }
}
const outLines = (op: string): AiVerdict[] =>
  readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)

describe('D-1 omlx preflight', () => {
  it('omlx unreachable → no LLM calls; free verdicts + flagged fallback still write', async () => {
    let ornithCalls = 0
    const { argv, op } = files([held, flaggedHeld, failedHeld])
    await diagnoseMain(argv, {
      l05: cleanL05,
      ornith: async () => { ornithCalls++; return okOrnith() },
      sha: noSha,
      ping: async () => false,
    })
    expect(ornithCalls).toBe(0)
    const got = outLines(op)
    expect(got.find(x => x.name === 'broken')?.verdict).toBe('concern')        // verify-fail free verdict
    expect(got.find(x => x.name === 'bad')?.verdict).toBe('concern')          // flagged fallback (no LLM draft)
    expect(got.find(x => x.name === 'pkg')).toBeUndefined()                   // LLM-needed target stays held
  })
  it('ping not consulted when nothing needs the LLM', async () => {
    let pings = 0
    const { argv, op } = files([failedHeld])
    await diagnoseMain(argv, {
      l05: cleanL05, ornith: okOrnith, sha: noSha,
      ping: async () => { pings++; return false },
    })
    expect(pings).toBe(0)
    expect(outLines(op)[0]?.verdict).toBe('concern')
  })
})

describe('D-2 sha fetch dedup', () => {
  it('drift sweep + works build share one lookup per name@version', async () => {
    const calls: string[] = []
    const sha = async (name: string, ver: string | null) => { calls.push(`${name}@${ver}`); return 'sha256-new' }
    // verdicted target with a DIFFERENT recorded sha → drift path + works path
    const { argv } = files([held], [v({ sha: 'sha256-old' })])
    await diagnoseMain(argv, { l05: cleanL05, ornith: okOrnith, sha, ping: async () => true })
    expect(calls.filter(c => c === 'pkg@2.0.0')).toHaveLength(1)
  })
})

describe('D-3 chronic ornith failure → tooling concern', () => {
  it('streak persists across runs; MAX_ATTEMPTS-th writes a concern verdict', async () => {
    const d = mkdtempSync(join(tmpdir(), 'dops-state-'))
    const sp = join(d, 'attempts.json')
    const dead = async () => { throw new Error('garbage output') }
    for (let i = 1; i <= 4; i++) {
      const { argv, op } = files([held], [], sp)
      await diagnoseMain(argv, { l05: cleanL05, ornith: dead, sha: noSha, ping: async () => true })
      expect(outLines(op)).toHaveLength(0)                                   // still held, no verdict
      expect(JSON.parse(readFileSync(sp, 'utf8'))['pkg\x002.0.0'].n).toBe(i)
    }
    const { argv, op } = files([held], [], sp)
    await diagnoseMain(argv, { l05: cleanL05, ornith: dead, sha: noSha, ping: async () => true })
    const got = outLines(op)
    expect(got[0]?.verdict).toBe('concern')
    expect(got[0]?.reason).toContain('连续 5 次失败')
    expect(got[0]?.reasonEn).toContain('tooling error')                       // not a security signal
    expect(JSON.parse(readFileSync(sp, 'utf8'))['pkg\x002.0.0']).toBeUndefined() // streak cleared
  })
  it('skipped calls (ping false) do not count toward the streak', async () => {
    const d = mkdtempSync(join(tmpdir(), 'dops-state-'))
    const sp = join(d, 'attempts.json')
    const { argv } = files([held], [], sp)
    await diagnoseMain(argv, { l05: cleanL05, ornith: async () => { throw new Error('x') }, sha: noSha, ping: async () => false })
    expect(existsSync(sp) ? Object.keys(JSON.parse(readFileSync(sp, 'utf8'))).length : 0).toBe(0)
  })
  it('a later success clears the streak', async () => {
    const d = mkdtempSync(join(tmpdir(), 'dops-state-'))
    const sp = join(d, 'attempts.json')
    writeFileSync(sp, JSON.stringify({ 'pkg\x002.0.0': { n: 3, last: 'err' } }))
    const { argv, op } = files([held], [], sp)
    await diagnoseMain(argv, { l05: cleanL05, ornith: okOrnith, sha: noSha, ping: async () => true })
    expect(outLines(op)[0]?.verdict).toBe('pass')
    expect(JSON.parse(readFileSync(sp, 'utf8'))['pkg\x002.0.0']).toBeUndefined()
  })
})

describe('D-6 bounded defaults', () => {
  it('no --limit → at most 50 candidates per run', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      e({ name: `p${i}`, pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: '2026-01-01T00:00:00Z' } }))
    let calls = 0
    const { argv } = files(many)
    await diagnoseMain(argv, { l05: cleanL05, ornith: async () => { calls++; return okOrnith() }, sha: noSha, ping: async () => true })
    expect(calls).toBe(50)
  })
})

describe('D-7 digest review backlog', () => {
  it('pending-review count, 24h verdict throughput, oldest wait', () => {
    const reviewed = e({ name: 'done', approval: 'pending', latestVersion: '1.0.0' })
    const now = new Date('2026-06-01T21:00:00Z')
    const md = renderDigest({
      index: idx([held, reviewed]),
      verdicts: [v({ name: 'done', version: '1.0.0', at: '2026-06-01T10:00:00Z' })],
      lastDigestAt: '2026-05-31T21:00:00Z',
      now,
    })
    expect(md).toContain('评审积压（pending review — 1）')
    expect(md).toContain('待评审 1')
    expect(md).toContain('近 24h 新判 1')
    expect(md).toContain('最老待审 2026-01-01')
  })
})
