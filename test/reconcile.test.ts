import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../pipeline/ai/reconcile.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' },
  description: { en: 'lints things' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: 5, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:lib/x.js — L3: fetch(u)'] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending',
  ...over,
})

const idxJson = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

function setup(plugins: PluginEntry[], verdicts: object[], ctxs: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'recon-'))
  const idx = join(dir, 'index.json'), vd = join(dir, 'v.jsonl')
  const cd = join(dir, 'c.jsonl'), spool = join(dir, 's.jsonl')
  writeFileSync(idx, JSON.stringify(idxJson(plugins)))
  writeFileSync(vd, verdicts.map(v => JSON.stringify(v)).join('\n') + (verdicts.length ? '\n' : ''))
  writeFileSync(cd, ctxs.map(v => JSON.stringify(v)).join('\n') + (ctxs.length ? '\n' : ''))
  return { dir, idx, vd, cd, spool }
}
const args = (s: ReturnType<typeof setup>) => ['--index', s.idx, '--verdicts', s.vd, '--contexts', s.cd, '--spool', s.spool]
const V = (verdict: string, reason = 'AI 判 concern：可疑') => ({
  name: 'pkg', version: '1.0.0', verdict, reason, at: '2026-01-01T00:00:00Z', source: 'ai',
})
const C = (verdict = 'pass') => ({
  name: 'pkg', version: '1.0.0', flag: 'network-call:lib/x.js — L3: fetch(u)', rule: 'network-call',
  path: 'lib/x.js', line: 3, at: '2026-01-01T00:00:00Z',
  ai: { verdict, reasonZh: '本地回环', reasonEn: 'loopback' },
})
const judge = (verdict: 'pass' | 'concern') => async () => ({ verdict, reasonZh: '对账理由', reasonEn: 'recon' })

describe('reconcile — concern vs all-pass flag evidence', () => {
  it('overturns to pass when the judge rules the evidence covers it — flagsReviewed set', async () => {
    const s = setup([entry()], [{ ...V('concern'), sha: 'sha512-abc' }], [{ ...C(), call: { line: 7, text: 'fetch(cfg.endpoint)' } }])
    await main(args(s), { judge: judge('pass') })
    const out = readFileSync(s.spool, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(out).toHaveLength(1)
    expect(out[0]!.verdict).toBe('pass')
    expect(out[0]!.flagsReviewed).toBe(true)
    expect(out[0]!.sha).toBe('sha512-abc')
    expect(out[0]!.reason).toMatch(/^对账：/)
  })
  it('upheld concern still writes a 对账-prefixed record so the slot stops re-queueing', async () => {
    const s = setup([entry()], [V('concern')], [C()])
    await main(args(s), { judge: judge('concern') })
    const out = JSON.parse(readFileSync(s.spool, 'utf8').trim())
    expect(out.verdict).toBe('concern')
    expect(out.flagsReviewed).toBeUndefined()
    // second run: 对账-prefixed latest verdict → not re-selected
    const s2 = setup([entry()], [V('concern'), out], [C()])
    await main([...args(s2), '--spool', s2.spool], { judge: judge('pass') })
    expect(() => readFileSync(s2.spool, 'utf8')).toThrow()
  })
  it('a single non-pass pre-read keeps the slot out of reconciliation', async () => {
    const s = setup([entry()], [V('concern')], [C('pass'), { ...C('concern'), flag: 'obfuscation:lib/y.js — L9: atob(x)' }])
    await main(args(s), { judge: judge('pass') })
    expect(() => readFileSync(s.spool, 'utf8')).toThrow()
  })
  it('no flag contexts → untouched (nothing to reconcile against)', async () => {
    const s = setup([entry()], [V('concern')], [])
    await main(args(s), { judge: judge('pass') })
    expect(() => readFileSync(s.spool, 'utf8')).toThrow()
  })
  it('human/mechanical verdicts and ai:pass slots are not candidates', async () => {
    const s = setup([entry()], [V('pass'), { ...V('concern'), source: 'human' }], [C()])
    await main(args(s), { judge: judge('pass') })
    expect(() => readFileSync(s.spool, 'utf8')).toThrow()
  })
})

describe('reconcile — failure and dry-run paths', () => {
  it('judge failure is logged, not fatal — candidate simply skipped', async () => {
    const s = setup([entry()], [V('concern')], [C()])
    await main(args(s), { judge: async () => { throw new Error('omlx down') } })
    expect(() => readFileSync(s.spool, 'utf8')).toThrow()   // nothing written
  })
  it('--dry prints the record instead of appending the spool', async () => {
    const s = setup([entry()], [V('concern')], [C()])
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => { lines.push(String(a[0])) }
    try { await main([...args(s), '--dry'], { judge: judge('pass') }) }
    finally { console.log = orig }
    expect(lines.some(l => l.includes('"verdict":"pass"') && l.includes('flagsReviewed'))).toBe(true)
    expect(() => readFileSync(s.spool, 'utf8')).toThrow()
  })
})

describe('reconcile — CLI arg mapping', () => {
  it('-m devin:<m> maps to AI_BACKEND/DEVIN_REVIEW_MODEL; -m <name> maps to AI_MODEL; -p installs proxy', async () => {
    const s = setup([entry()], [V('concern')], [C()])
    const env = process.env
    delete env.AI_MODEL; delete env.AI_BACKEND; delete env.DEVIN_REVIEW_MODEL; delete env.MARKET_PROXY
    await main([...args(s), '-m', 'devin:test-model'], { judge: judge('pass') })
    expect(env.AI_BACKEND).toBe('devin')
    expect(env.DEVIN_REVIEW_MODEL).toBe('test-model')
    const s2 = setup([entry()], [V('concern')], [C()])
    await main([...args(s2), '-m', 'local-model', '-p', '1080'], { judge: judge('pass') })
    expect(env.AI_MODEL).toBe('local-model')
    delete env.AI_MODEL; delete env.AI_BACKEND; delete env.DEVIN_REVIEW_MODEL; delete env.MARKET_PROXY
  })
})
