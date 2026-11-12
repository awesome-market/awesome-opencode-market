/** Module-mocked coverage: l05Score (python shim) + docket's gh wrapper.
 *  Kept in its own file — vi.mock('node:child_process') must not leak into
 *  the verify tests that rely on the real execFile. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execCalls: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv | undefined; input?: string | undefined }[] = []
vi.mock('node:child_process', () => ({
  execFileSync: (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}) => {
    execCalls.push({ cmd, args, env: opts.env, input: opts.input })
    if (cmd === 'python3') return JSON.stringify([{ id: 'a', score: 0.5 }, { id: 'b', score: 0.9 }])
    if (cmd === 'gh') return '[]'
    if (cmd === 'npm' && args.some(a => a.includes('missing-pkg'))) throw new Error('E404')
    if (cmd === 'npm') return 'sha512-abc\n'
    throw new Error(`unexpected exec ${cmd}`)
  },
  execFile: (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv },
    cb: (err: Error | null, result?: { stdout: string; stderr?: string }) => void) => {
    // docket's gh wrapper is async execFile (promisify) — record it the same
    // way so the env-mapping assertion keeps covering the real call shape.
    // The mock has no promisify.custom, so default-promisify resolves the
    // callback's 2nd arg verbatim — hand it the {stdout} shape gh expects.
    execCalls.push({ cmd, args, env: opts.env })
    if (cmd === 'gh') cb(null, { stdout: '[]' })
    else cb(new Error(`unexpected exec ${cmd}`))
  },
}))

import { l05Score, makeIntegrityOf } from '../pipeline/ai/diagnose.ts'
import { main as docketMain } from '../pipeline/docket.ts'
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
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})

describe('l05Score', () => {
  it('pipes materials to python and maps id→score', () => {
    const m = l05Score([{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }])
    expect(m.get('a')).toBe(0.5)
    expect(m.get('b')).toBe(0.9)
    const call = execCalls.find(c => c.cmd === 'python3')!
    expect(call.args[0]).toContain('l05_score.py')
    expect(JSON.parse(call.input!)).toHaveLength(2)
  })
})

describe('makeIntegrityOf (D-10 packument-backed)', () => {
  it('one packument fetch per name covers every version; lookups share the cache', async () => {
    let fetches = 0
    const fetchFn = (async () => {
      fetches++
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { dist: { integrity: 'sha512-aaa' } },
          '2.0.0': { dist: { integrity: 'sha512-bbb' } },
        },
      }))
    }) as unknown as typeof fetch
    const io = makeIntegrityOf(fetchFn)
    expect(await io('pkg', '1.0.0')).toBe('sha512-aaa')
    expect(await io('pkg', '2.0.0')).toBe('sha512-bbb')
    expect(await io('pkg', '9.9.9')).toBeUndefined()
    expect(fetches).toBe(1)
  })
  it('null version → no fetch at all (github-kind); registry error → undefined', async () => {
    let fetches = 0
    const fetchFn = (async () => { fetches++; return new Response('x', { status: 500 }) }) as unknown as typeof fetch
    const io = makeIntegrityOf(fetchFn)
    expect(await io('o/r', null)).toBeUndefined()
    expect(fetches).toBe(0)
    expect(await io('gone', '1.0.0')).toBeUndefined()
    expect(fetches).toBe(1)
  })
})

describe('docket gh wrapper via main', () => {
  afterEach(() => { delete process.env.GH_REPO; delete process.env.GITHUB_TOKEN; delete process.env.GH_TOKEN })
  it('gh runs with GITHUB_TOKEN→GH_TOKEN env mapping', async () => {
    const d = mkdtempSync(join(tmpdir(), 'dk2-'))
    const ip = join(d, 'i.json'), vp = join(d, 'v.jsonl')
    writeFileSync(ip, JSON.stringify(idx([e()])))
    writeFileSync(vp, JSON.stringify(v()) + '\n')
    process.env.GH_REPO = 'o/r'
    process.env.GITHUB_TOKEN = 'tok-123'
    await docketMain(['x', 'docket.ts', '--index', ip, '--verdicts', vp])
    const call = execCalls.find(c => c.cmd === 'gh')!
    expect(call.args).toContain('issue')
    expect(call.env?.GH_TOKEN).toBe('tok-123')
  })
})
