import { describe, it, expect } from 'vitest'
import { docketTargets, issueTitle, issueBody } from '../pipeline/docket.ts'
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
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})

describe('docketTargets', () => {
  it('pending entry + ai pass → open decision', () => {
    const t = docketTargets(idx([e()]), [v()])
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified' }])
  })
  it('ai concern on pendingUpdate → open decision for THAT version', () => {
    const t = docketTargets(idx([e({
      approval: 'approved',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })]), [v({ version: '2.0.0', verdict: 'concern' })])
    expect(t).toEqual([{ name: 'pkg', version: '2.0.0', verdict: 'concern', verification: 'verified' }])
  })
  it('human verdict already rules → no docket entry', () => {
    expect(docketTargets(idx([e()]), [v({ source: 'human' })])).toEqual([])
  })
  it('released entry → no docket entry', () => {
    expect(docketTargets(idx([e({ approval: 'approved' })]), [v()])).toEqual([])
  })
  it('no verdict yet → AI queue will handle, no human ask', () => {
    expect(docketTargets(idx([e()]), [])).toEqual([])
  })
  it('repo-only pending (latestVersion null, no verdict) → standing human review issue', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]), [])
    expect(t).toEqual([{ name: 'pkg', version: null, verdict: 'none', verification: 'verified' }])
  })
  it('repo-only pending WITH a human verdict → decided, no standing issue', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]),
      [v({ version: null, source: 'human', verdict: 'pass' })])
    expect(t).toEqual([])
  })
  it('non-pending repo entry → nothing to decide', () => {
    expect(docketTargets(idx([e({ latestVersion: null, approval: 'approved' })]), [])).toEqual([])
  })
  it('latest wins: ai pass then human concern → excluded', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'concern', source: 'human' }),
    ])
    expect(t).toEqual([])
  })
  it('issueTitle: versioned and version-less', () => {
    expect(issueTitle({ name: 'pkg', version: '1.0.0' })).toBe('[review] pkg@1.0.0')
    expect(issueTitle({ name: '@s/p', version: '2.0.0' })).toBe('[review] @s/p@2.0.0')
    expect(issueTitle({ name: 'o/r', version: null })).toBe('[review] o/r')
  })
  it('ai pass over a standing human concern → re-review target carries the brake context (K-3)', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z', verdict: 'concern', source: 'human', reason: 'manual brake' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'pass', source: 'ai' }),
    ])
    expect(t[0]!.verdict).toBe('pass')
    expect(t[0]!.humanVerdict?.verdict).toBe('concern')
    expect(t[0]!.humanVerdict?.reason).toBe('manual brake')
  })
})

describe('issueBody', () => {
  it('human concern under a newer ai pass is shown as a standing brake, not silent', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass',
      humanVerdict: v({ verdict: 'concern', source: 'human', reason: 'brake' }),
    })
    expect(body).toContain('在押刹车')
    expect(body).toContain('人工判词：**concern**')
  })
  it('no human verdict → no human line; body is deterministic', () => {
    const t = { name: 'pkg', version: '1.0.0', verdict: 'pass' as const, verification: 'verified' }
    expect(issueBody(t)).toBe(issueBody(t))
    expect(issueBody(t)).not.toContain('人工判词')
  })
})

describe('docket main', () => {
  it('creates a label-free-of-ai verdict issue for repo-only pendings + closes decided ones', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ latestVersion: null })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{ number: 9, title: '[review] stale/x' }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    expect(create).toBeTruthy()
    expect(create!.join(' ')).toContain('[review] pkg')
    // 'none' verdicts carry no ai: label — the body itself says "AI 不审"
    expect(create!.join(' ')).not.toContain('ai:')
    expect(calls.some(c => c.includes('close') && c.includes('9'))).toBe(true)
  })

  it('re-syncs a stale ai:* label and body when the verdict flipped (K-2)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk2-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v({ verdict: 'concern' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 7, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }],
        body: '## 审核单 pkg@1.0.0\n- 当前 AI 判定：**pass** — stale',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label ai:pass')
    expect(edits).toContain('--add-label ai:concern')
    expect(edits).toContain('--body')
    expect(edits).toContain('当前 AI 判定：**concern**')
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('a wanted issue stripped of review:pending is re-labeled — title-keyed sync (K-5)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    // pre-compute the wanted body so only the label drifts
    const wantBody = issueBody({ name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 3, title: '[review] pkg@1.0.0',
        labels: [{ name: 'ai:pass' }],   // review:pending stripped by hand
        body: wantBody,
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--add-label review:pending')
    expect(edits).not.toContain('--body')
  })
})
