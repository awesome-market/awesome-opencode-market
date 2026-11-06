// audit #4 (ai-diagnose flow, fresh round): every pendingUpdate read must go
// through candidateSlot — a pending entry's candidate is the ENTRY itself
// (candidateVer's B3 rule). The inverted pending+pu state would otherwise
// stamp verdicts on the stale hold's version key (real candidate re-queues
// forever), describe the hold's scan/verify state to the reviewer, and
// mis-clock the 48h defer.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  main as diagnoseMain, reviewMaterial, verdictRecord, unreviewedTargets,
  candidateHeldAt, L05_CANARY_BENIGN, L05_CANARY_HOSTILE,
} from '../pipeline/ai/diagnose.ts'
import { candidateSlot } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const caps = (findings: string[] = [], redFlags: string[] = [], scannedAt: string | null = 't') =>
  ({ scannedAt, findings, redFlags })
const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2020-01-01T00:00:00Z', latestVersion: '2.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: caps(), verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const inverted = () => e({
  approval: 'pending', latestVersion: '2.0.0',
  capabilities: caps(['entry-scan-finding']),
  verification: { status: 'verified' },
  pendingUpdate: {
    version: '9.9.9', heldAt: '2019-01-01T00:00:00Z',
    capabilities: caps(['hold-scan-finding']),
    verification: { status: 'verified' },
  } as never,
})

describe('audit#4 — candidateSlot predicate', () => {
  it('pending → null (entry is the candidate); approved → the hold', () => {
    expect(candidateSlot(e())).toBeNull()
    const held = e({ approval: 'approved', pendingUpdate: { version: '9.9.9' } as never })
    expect(candidateSlot(held)?.version).toBe('9.9.9')
    expect(candidateSlot(e({ approval: 'approved' }))).toBeNull()
  })
})

describe('audit#4 — verdictRecord keys on the reviewed version', () => {
  it('pending+pu stamps latestVersion, not the stale hold version', () => {
    const v = verdictRecord(inverted(), 'pass', 'ok')
    expect(v.version).toBe('2.0.0')
    expect(v.version).not.toBe('9.9.9')
  })
  it('approved+hold still stamps the held version', () => {
    const held = e({ approval: 'approved', latestVersion: '1.0.0',
      pendingUpdate: { version: '2.0.0' } as never })
    expect(verdictRecord(held, 'pass', 'ok').version).toBe('2.0.0')
  })
})

describe('audit#4 — reviewMaterial describes the candidate, not the hold', () => {
  it('pending+pu: entry findings surface, hold findings/pending-block absent', () => {
    const m = reviewMaterial(inverted())
    const text = m.map(b => `${b.id}\n${b.text}`).join('\n')
    expect(text).toContain('entry-scan-finding')
    expect(text).not.toContain('hold-scan-finding')
    expect(m.some(b => b.id === 'pending')).toBe(false)
    expect(m.some(b => b.id === 'prev-findings')).toBe(false)
  })
  it('approved+hold: hold findings + pending block still emitted', () => {
    const held = e({ approval: 'approved', latestVersion: '1.0.0',
      capabilities: caps(['displayed-finding']),
      pendingUpdate: {
        version: '2.0.0', heldAt: 't', capabilities: caps(['hold-finding']),
        verification: { status: 'verified' },
      } as never })
    const m = reviewMaterial(held)
    const text = m.map(b => `${b.id}\n${b.text}`).join('\n')
    expect(text).toContain('hold-finding')
    expect(m.some(b => b.id === 'pending' && b.text.includes('2.0.0'))).toBe(true)
  })
})

describe('audit#4 — defer clock reads the candidate slot', () => {
  it('pending+pu: entry unverified+fresh defers even though the hold is verified', () => {
    const fresh = new Date().toISOString()
    const t = inverted()
    t.verification = { status: 'unverified' }
    t.capabilities = caps([], [], fresh)   // scannedAt=now → held <48h
    t.pendingUpdate = { version: '9.9.9', heldAt: '2019-01-01T00:00:00Z',
      capabilities: caps([], [], '2019-01-01T00:00:00Z'),
      verification: { status: 'verified' } } as never
    expect(unreviewedTargets(idx([t]), [])).toHaveLength(0)
    // same entry with a STALE hold clock would have been reviewed pre-fix
    // (hold verification was 'verified' → no defer at all)
  })
  it('candidateHeldAt ignores the hold heldAt on pending entries', () => {
    const t = inverted()   // pu.heldAt=2019, e.capabilities.scannedAt='t'(NaN) → firstSeenAt
    // scannedAt 't' is NaN → falls to firstSeenAt 2020 — NOT pu.heldAt 2019
    expect(candidateHeldAt(t)).toBe(Date.parse('2020-01-01T00:00:00Z'))
  })
})

describe('audit#4 — end-to-end: verdict lands on the candidate key', () => {
  it('main() on pending+pu writes version=latestVersion', async () => {
    const d = mkdtempSync(join(tmpdir(), 'd4-'))
    const ip = join(d, 'i.json'), vp = join(d, 'v.jsonl'), op = join(d, 'o.jsonl')
    writeFileSync(ip, JSON.stringify(idx([inverted()])))
    writeFileSync(vp, '')
    const cleanL05 = () => new Map<string, number>([
      [L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9]])
    await diagnoseMain(['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op], {
      l05: cleanL05,
      ornith: async () => ({ verdict: 'pass', reasonZh: 'ok', reasonEn: 'ok' }),
      sha: () => undefined,
      tarball: () => null,
      ping: async () => true,
    })
    const lines = readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.name).toBe('pkg')
    expect(lines[0]!.version).toBe('2.0.0')   // the candidate — was '9.9.9' pre-fix
  })
})
