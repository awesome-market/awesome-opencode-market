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
  execFile: () => { throw new Error('unused') },
}))

import { l05Score, integrityOf } from '../pipeline/ai/diagnose.ts'
import { main as docketMain } from '../pipeline/docket.ts'
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
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: 't', source: 'ai', ...over,
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

describe('integrityOf', () => {
  it('null version → undefined (github-kind, no npm call)', () => {
    const before = execCalls.filter(c => c.cmd === 'npm').length
    expect(integrityOf('o/r', null)).toBeUndefined()
    expect(execCalls.filter(c => c.cmd === 'npm').length).toBe(before)
  })
  it('returns trimmed dist.integrity; registry error → undefined', () => {
    expect(integrityOf('pkg', '1.0.0')).toBe('sha512-abc')
    expect(integrityOf('missing-pkg', '1.0.0')).toBeUndefined()
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
