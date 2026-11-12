import { describe, it, expect } from 'vitest'
import { CatalogIndex, PluginEntry } from '../src/schema.ts'

const entry = {
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin',
  discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'p', repo: 'o/p' },
  description: { en: 'd' }, category: [], license: 'MIT',
  deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 1, npmDownloads30d: 10, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01T00:00:00Z' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' },
  compat: {},
}

describe('schema', () => {
  it('parses a valid index', () => {
    const idx = CatalogIndex.parse({ version: '1', generatedAt: 'x', categories: {}, plugins: [entry], removed: [] })
    expect(idx.plugins[0]!.slug).toBe('o/p')
  })
  it('rejects wrong version', () => {
    expect(() => CatalogIndex.parse({ version: '2', generatedAt: 'x', categories: {}, plugins: [], removed: [] })).toThrow()
  })
  it('rejects bad type', () => {
    expect(() => PluginEntry.parse({ ...entry, type: 'wat' })).toThrow()
  })
  it('rejects logExcerpt over 2KB', () => {
    expect(() => PluginEntry.parse({
      ...entry, verification: { status: 'failed', logExcerpt: 'x'.repeat(2049) },
    })).toThrow()
  })
  it('entry defaults fill in', () => {
    const e = PluginEntry.parse({ ...entry, aliases: undefined, contains: undefined, compat: undefined })
    expect(e.aliases).toEqual([])
    expect(e.compat).toEqual({})
  })
  it('scannedAt null vs findings empty are distinct', () => {
    const a = PluginEntry.parse(entry)
    const b = PluginEntry.parse({ ...entry, capabilities: { scannedAt: 't', findings: [], redFlags: [] } })
    expect(a.capabilities.scannedAt).toBeNull()
    expect(b.capabilities.scannedAt).toBe('t')
  })
})
