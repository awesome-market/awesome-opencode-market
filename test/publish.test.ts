import { describe, it, expect } from 'vitest'
import { cacheKey, mergeEntries, corruptionGate, buildIndex } from '../pipeline/publish/merge.ts'
import { slugOf } from '../pipeline/publish/slug.ts'
import type { PluginEntry } from '../src/schema.ts'

const mkEntry = (name: string, v = '1.0.0'): PluginEntry => ({
  name, slug: name, aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  firstSeenAt: '2026-01-01', latestVersion: v, publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
})

describe('publish/merge', () => {
  it('cacheKey = name@version+host', () => {
    expect(cacheKey(mkEntry('a', '1.2.3'), '2.2.5')).toBe('a@1.2.3+2.2.5')
  })
  it('merge preserves scan/verify for unchanged entries', () => {
    const old = { version: '1' as const, generatedAt: 'x', categories: {},
      plugins: [{ ...mkEntry('a'),
        verification: { status: 'verified' as const, level: 'load' as const },
        capabilities: { scannedAt: 't', findings: ['f'], redFlags: [] },
        firstSeenAt: '2025-01-01' }] }
    const merged = mergeEntries([mkEntry('a'), mkEntry('b')], old, '2.2.5')
    expect(merged[0]!.verification.status).toBe('verified')
    expect(merged[0]!.firstSeenAt).toBe('2025-01-01')
    expect(merged[1]!.verification.status).toBe('unverified')
  })
  it('merge re-verifies on version bump (cache key miss)', () => {
    const old = { version: '1' as const, generatedAt: 'x', categories: {},
      plugins: [{ ...mkEntry('a', '1.0.0'), verification: { status: 'verified' as const } }] }
    const merged = mergeEntries([mkEntry('a', '2.0.0')], old, '2.2.5')
    expect(merged[0]!.verification.status).toBe('unverified')
  })
  it('corruption gate: empty refuse, >20% drop refuse, ok pass', () => {
    const old = { version: '1' as const, generatedAt: 'x', categories: {},
      plugins: Array.from({ length: 100 }, (_, i) => mkEntry(`p${i}`)) }
    expect(corruptionGate([], old).ok).toBe(false)
    expect(corruptionGate([mkEntry('a')], old).ok).toBe(false)
    expect(corruptionGate(Array.from({ length: 85 }, (_, i) => mkEntry(`p${i}`)), old).ok).toBe(true)
    expect(corruptionGate([mkEntry('a')], null).ok).toBe(true)
  })
  it('buildIndex outputs valid schema + sorts by slug', () => {
    const { index, gate } = buildIndex([mkEntry('b'), mkEntry('a')], null, { opencodeVersion: '2.2.5', now: 't' })
    expect(gate.ok).toBe(true)
    expect(index.plugins.map(p => p.slug)).toEqual(['a', 'b'])
    expect(index.version).toBe('1')
  })
})

describe('publish/slug', () => {
  it('repo slug, subpath, npm fallback', () => {
    expect(slugOf({ repo: 'O/R' })).toBe('o/r')
    expect(slugOf({ repo: 'o/r', subpath: 'pkgs/a' })).toBe('o/r--pkgs-a')
    expect(slugOf({ npmName: '@s/n' })).toBe('@s/n')
    expect(() => slugOf({})).toThrow()
  })
})
