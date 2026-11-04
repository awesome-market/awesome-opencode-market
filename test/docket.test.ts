import { describe, it, expect } from 'vitest'
import { docketTargets, issueTitle } from '../pipeline/docket.ts'
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
})
