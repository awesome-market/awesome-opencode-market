import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as flagCtxMain, loadFlagContexts, latestFlagContexts, type FlagContext } from '../pipeline/ai/flag-context.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' },
  description: { en: 'lints things' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: 5, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending',
  ...over,
})

const idxJson = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const FLAG = 'credential-read:package/lib/cloud.mjs — L3: const k = read("id_rsa")'
const FILE = ['l1', 'l2', 'const k = read("id_rsa")', 'l4', 'l5'].join('\n')

function setup(plugins: PluginEntry[], verdicts: object[] = [], ctxLines: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'flagctx-'))
  const idx = join(dir, 'index.json'), vd = join(dir, 'verdicts.jsonl')
  const cd = join(dir, 'ctx.jsonl'), spool = join(dir, 'spool.jsonl')
  writeFileSync(idx, JSON.stringify(idxJson(plugins)))
  writeFileSync(vd, verdicts.map(v => JSON.stringify(v)).join('\n') + (verdicts.length ? '\n' : ''))
  writeFileSync(cd, ctxLines.join('\n') + (ctxLines.length ? '\n' : ''))
  return { dir, idx, vd, cd, spool }
}
const args = (s: ReturnType<typeof setup>) =>
  ['--index', s.idx, '--verdicts', s.vd, '--contexts', s.cd, '--spool', s.spool]

const okJudge = async () => ({ verdict: 'pass' as const, reasonZh: '本地使用', reasonEn: 'local use' })
const fetchFile = (text: string | null) => async () => text

describe('flag-context main', () => {
  it('fetches the flagged line window, judges it, appends to spool', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    const seen: string[] = []
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async url => { seen.push(url); return FILE },
      judge: okJudge,
    })
    expect(seen[0]).toBe('https://unpkg.com/pkg@1.0.0/lib/cloud.mjs')  // package/ stripped
    const out = loadFlagContexts(s.spool)
    expect(out).toHaveLength(1)
    expect(out[0]!.ai?.verdict).toBe('pass')
    expect(out[0]!.line).toBe(3)
  })

  it('already-judged flag is not re-fetched; ai:null retries', async () => {
    const done: FlagContext = { name: 'pkg', version: '1.0.0', flag: FLAG, rule: 'credential-read', path: 'package/lib/cloud.mjs', line: 3, at: '2026-01-02T00:00:00Z', ai: { verdict: 'pass', reasonZh: '', reasonEn: '' } }
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })], [], [JSON.stringify(done)])
    let fetches = 0
    await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async () => { fetches++; return FILE }, judge: okJudge })
    expect(fetches).toBe(0)  // ai!=null line suppresses the work
  })

  it('human pass on the slot retires the flag — nothing queued', async () => {
    const hp = { name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-02T00:00:00Z', source: 'human' }
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })], [hp])
    let fetches = 0
    await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async () => { fetches++; return FILE }, judge: okJudge })
    expect(fetches).toBe(0)
    expect(loadFlagContexts(s.spool)).toHaveLength(0)
  })

  it('sec:* identity flags are skipped — flag-delta owns those', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-moved-since-release:abc123', FLAG] } })])
    const out = [] as string[]
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async () => FILE,
      judge: async m => { out.push(m.summary); return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    expect(out).toHaveLength(1)  // only the scan flag, not the sec:* one
  })

  it('fetch failure records ai:null + retryable aiNote — never burns the judge', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    let judged = 0
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: fetchFile(null),
      judge: async () => { judged++; return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    expect(judged).toBe(0)
    const out = loadFlagContexts(s.spool)
    expect(out[0]!.ai).toBeNull()
    expect(out[0]!.aiNote).toBe('context-fetch-failed')
  })

  it('github entries fetch raw.githubusercontent at the pinned sha', async () => {
    const gh = entry({
      name: 'o/r', slug: 'o/r', latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'o/r', version: 'deadbeef12' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:src/x.ts — L2: fetch(u)'] },
    })
    const s = setup([gh])
    const seen: string[] = []
    await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async u => { seen.push(u); return FILE }, judge: okJudge })
    expect(seen[0]).toBe('https://raw.githubusercontent.com/o/r/deadbeef12/src/x.ts')
  })

  it('judge throw records ai:null + judge-error note — the flag retries, never blocks the queue', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async () => FILE,
      judge: async () => { throw new Error('omlx 500') },
    })
    const out = loadFlagContexts(s.spool)
    expect(out[0]!.ai).toBeNull()
    expect(out[0]!.aiNote).toBe('judge-error: omlx 500')
  })

  it('no judge configured → judge-unavailable note, context still recorded for the retry', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    const keep = { M: process.env.AI_MODEL, B: process.env.AI_BACKEND }
    delete process.env.AI_MODEL; delete process.env.AI_BACKEND
    try {
      await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async () => FILE })
    } finally {
      if (keep.M !== undefined) process.env.AI_MODEL = keep.M
      if (keep.B !== undefined) process.env.AI_BACKEND = keep.B
    }
    const out = loadFlagContexts(s.spool)
    expect(out[0]!.ai).toBeNull()
    expect(out[0]!.aiNote).toBe('judge-unavailable')
  })

  it('oversize bundles and missing source urls get their own retry notes', async () => {
    const s = setup([
      entry({ capabilities: { scannedAt: 't', findings: [], redFlags: ['binary-blob:package/big.js — L1: x'] } }),
      entry({ name: 'ghost', slug: 'ghost', latestVersion: null,
        source: { kind: 'npm', id: 'ghost' },
        capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:lib/g.js — L2: fetch(u)'] } }),
    ])
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async () => 'TOO-LARGE',
      judge: okJudge,
    })
    const out = loadFlagContexts(s.spool)
    expect(out.find(a => a.name === 'pkg')!.aiNote).toBe('context-too-large')
    expect(out.find(a => a.name === 'ghost')!.aiNote).toBe('no-source-url')
  })

  it('mega-lines crop the window around the hit instead of eating the whole cap', async () => {
    const big = 'x'.repeat(5000)
    const file = Array.from({ length: 40 }, (_, i) => i === 35 ? big : `line${i}`).join('\n')
    const s = setup([entry({ description: {},
      capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:package/a.js — L36: hit'] } })])
    let window = '', summary = ''
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async () => file,
      judge: async m => { window = m.patches; summary = m.summary; return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    expect(window.length).toBeLessThanOrEqual(4000)
    expect(window).toContain('L36:')  // the hit line's tail still made the cut
    expect(summary).toContain('(no description)')
  })

  it('flag line beyond EOF in a still-oversize window crops to an empty hit tail', async () => {
    // 40 lines × 1200 chars: a flag at L70 slices the last 6 lines (>4K) →
    // crop path runs but lines[69] is undefined — the `?? ''` tail
    const file = Array.from({ length: 40 }, (_, i) => `l${i}-` + 'y'.repeat(1200)).join('\n')
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:package/a.js — L70: hit'] } })])
    let window = ''
    await flagCtxMain([...args(s), '--limit', '5'], {
      fetchFn: async () => file,
      judge: async m => { window = m.patches; return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    expect(window.length).toBeLessThanOrEqual(4000)
    expect(window).toContain('L70: ')
  })

  it('FLAGS_PER_ENTRY caps one noisy entry at 12 so it cannot starve the run', async () => {
    const flags = Array.from({ length: 15 }, (_, i) => `network-call:package/f${i}.js — L2: fetch(${i})`)
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: flags } })])
    await flagCtxMain([...args(s), '--limit', '20'], { fetchFn: async () => FILE, judge: okJudge })
    expect(loadFlagContexts(s.spool)).toHaveLength(12)
  })

  it('--dry writes nothing to the spool', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    await flagCtxMain([...args(s), '--limit', '5', '--dry'], { fetchFn: async () => FILE, judge: okJudge })
    expect(loadFlagContexts(s.spool)).toHaveLength(0)
  })

  it('env-assembled omlx judge carries the flag prompt, not the delta one', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    const keep = { M: process.env.AI_MODEL, B: process.env.AI_BASE_URL, K: process.env.AI_API_KEY, BK: process.env.AI_BACKEND }
    process.env.AI_MODEL = 'm'; process.env.AI_BASE_URL = 'http://judge.local/v1'; process.env.AI_API_KEY = 'k'
    delete process.env.AI_BACKEND
    const origFetch = globalThis.fetch
    const bodies: { messages: { role: string; content: string }[] }[] = []
    globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
      if (String(u).includes('chat/completions')) {
        bodies.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"pass","reason_zh":"本地","reason_en":"local"}' } }] }))
      }
      return new Response(FILE)
    }) as typeof fetch
    try {
      await flagCtxMain([...args(s), '--limit', '5'])
    } finally {
      globalThis.fetch = origFetch
      for (const [k, v] of Object.entries({ AI_MODEL: keep.M, AI_BASE_URL: keep.B, AI_API_KEY: keep.K, AI_BACKEND: keep.BK }))
        v === undefined ? delete process.env[k] : process.env[k] = v
    }
    const sys = bodies[0]!.messages.find(m => m.role === 'system')!.content
    const usr = bodies[0]!.messages.find(m => m.role === 'user')!.content
    expect(sys).toContain('flagged ONE LINE')
    expect(usr).toContain('Flagged line material')
    expect(loadFlagContexts(s.spool)[0]!.ai?.verdict).toBe('pass')
  })

  it('latestFlagContexts: newest at wins per name\\0version\\0flag — stale never overwrites', () => {
    const a: FlagContext = { name: 'pkg', version: '1.0.0', flag: FLAG, rule: 'r', path: 'p', line: 3, at: '2026-01-01T00:00:00Z', ai: null }
    const b = { ...a, at: '2026-01-03T00:00:00Z', ai: { verdict: 'pass' as const, reasonZh: '', reasonEn: '' } }
    const c = { ...a, at: '2026-01-02T00:00:00Z' }  // earlier than b — loses
    const m = latestFlagContexts([a, b, c])
    expect(m.get('pkg\0' + '1.0.0' + '\0' + FLAG)!.ai?.verdict).toBe('pass')
  })

  it('loader tolerance: missing path/file, malformed and field-less lines', () => {
    expect(loadFlagContexts()).toEqual([])
    expect(loadFlagContexts('/nonexistent/x.jsonl')).toEqual([])
    const s = setup([], [], ['not json', '{"name":1,"flag":"f","at":"t"}', '{"name":"a","flag":"f","at":"t"}'])
    expect(loadFlagContexts(s.cd)).toHaveLength(1)
  })

  it('source edges: npm pinned by source.version, github without repo uses name', async () => {
    const s = setup([
      entry({ latestVersion: null, source: { kind: 'npm', id: 'pkg', version: '9.9.9' },
        capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } }),
      entry({ name: 'o/r2', slug: 'o/r2', latestVersion: null,
        source: { kind: 'github', id: 'o/r2', version: 'sha999' },
        capabilities: { scannedAt: 't', findings: [], redFlags: ['network-call:a.ts — L2: f()'] } }),
    ])
    const seen: string[] = []
    await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async u => { seen.push(u); return FILE }, judge: okJudge })
    expect(seen).toContain('https://unpkg.com/pkg@9.9.9/lib/cloud.mjs')
    expect(seen).toContain('https://raw.githubusercontent.com/o/r2/sha999/a.ts')
  })

  it('real fetchContext: !ok / reject → fetch-failed, oversize → too-large', async () => {
    const mk = (flag: string) => entry({ name: `e${flag.length}`, slug: `e${flag.length}`,
      capabilities: { scannedAt: 't', findings: [], redFlags: [flag] } })
    const s = setup([
      mk('network-call:package/a.js — L1: x'),          // fetch 404 → fetch-failed
      mk('network-call:package/b.js — L2: y'),          // fetch rejects → fetch-failed
      mk('network-call:package/c.js — L3: z'),          // >256KB → too-large
    ])
    const origFetch = globalThis.fetch
    let n = 0
    globalThis.fetch = (async () => {
      n++
      if (n === 1) return new Response('nope', { status: 404 })
      if (n === 2) throw new Error('dns')
      return new Response('y'.repeat(300_000))
    }) as typeof fetch
    let judged = 0
    try {
      await flagCtxMain([...args(s), '--limit', '5'], { judge: async () => { judged++; return { verdict: 'pass' as const, reasonZh: '', reasonEn: '' } } })
    } finally { globalThis.fetch = origFetch }
    const out = loadFlagContexts(s.spool)
    expect(out.map(a => a.aiNote).sort()).toEqual(['context-fetch-failed', 'context-fetch-failed', 'context-too-large'])
    expect(judged).toBe(0)
  })

  it('AI_BACKEND=devin assembles the devin judge — uninvoked when fetch fails', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    const keep = process.env.AI_BACKEND
    process.env.AI_BACKEND = 'devin'
    try {
      // fetch fails BEFORE judge() would run — the factory is built, never invoked
      await flagCtxMain([...args(s), '--limit', '5'], { fetchFn: async () => null })
    } finally { keep === undefined ? delete process.env.AI_BACKEND : process.env.AI_BACKEND = keep }
    expect(loadFlagContexts(s.spool)[0]!.aiNote).toBe('context-fetch-failed')
  })

  it('non-Error judge throw and missing --spool stay non-fatal', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    await flagCtxMain([...args(s)], { fetchFn: async () => FILE, judge: async () => { throw 'string-fail' } })
    const out = loadFlagContexts(s.spool)
    expect(out[0]!.ai).toBeNull()
    expect(out[0]!.aiNote).toContain('judge-error')
    // no --spool → lines computed but nowhere to append; must not throw
    const s2 = setup([entry({ capabilities: { scannedAt: 't', findings: [], redFlags: [FLAG] } })])
    await flagCtxMain(['--index', s2.idx, '--verdicts', s2.vd, '--contexts', s2.cd], { fetchFn: async () => FILE, judge: okJudge })
  })
})

describe('finding-level pre-reads — the 风险文件 rows get judged too', () => {
  const F1 = 'child-process:package/scripts/check.mjs — L86: const { execFileSync } = await import("node:child_process")'
  const F2 = 'network-call:package/scripts/check.mjs — L40: fetch(u)'
  const F3 = 'obfuscation:package/dist/bundle.js — L9: atob(x)'
  const WITH_FINDINGS = () => entry({
    capabilities: { scannedAt: 't', findings: [F1, F2, F3], redFlags: [] },
  })

  it('findings behind hotFile rows are fetched, judged, and keyed by the finding string', async () => {
    const s = setup([WITH_FINDINGS()])
    const urls: string[] = []
    await flagCtxMain([...args(s), '--limit', '20'], {
      fetchFn: async u => { urls.push(u); return FILE }, judge: okJudge,
    })
    const out = loadFlagContexts(s.spool)
    expect(out).toHaveLength(3)
    expect(out.map(a => a.flag).sort()).toEqual([F1, F2, F3].sort())
    // same file fetched once via the shared cache
    expect(new Set(urls).size).toBe(2)
  })

  it('findings already in redFlags are not re-judged — the flag pass owns them', async () => {
    const s = setup([entry({ capabilities: { scannedAt: 't',
      findings: [F1, F3], redFlags: [F1] } })])
    const out: string[] = []
    await flagCtxMain([...args(s), '--limit', '20'], {
      fetchFn: async () => FILE,
      judge: async m => { out.push(m.summary); return { verdict: 'pass', reasonZh: '', reasonEn: '' } },
    })
    const spool = loadFlagContexts(s.spool)
    expect(spool.map(a => a.flag).sort()).toEqual([F1, F3].sort())  // F1 once, as the flag
  })

  it('top-10 hotFile bound: findings outside the rendered rows wait', async () => {
    // 11 files × 1 finding each — only the first 10 files' findings queue
    const findings = Array.from({ length: 11 }, (_, i) => `network-call:package/f${String(i).padStart(2, '0')}.js — L2: fetch(${i})`)
    const s = setup([entry({ capabilities: { scannedAt: 't', findings, redFlags: [] } })])
    await flagCtxMain([...args(s), '--limit', '20'], { fetchFn: async () => FILE, judge: okJudge })
    expect(loadFlagContexts(s.spool)).toHaveLength(10)
  })
})
