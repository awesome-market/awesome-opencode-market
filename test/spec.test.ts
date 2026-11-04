import { describe, it, expect } from 'vitest'
import { cleanSpec, dedupeToSpec, removeSpec, featuresMap, buildExtras } from '../plugins/market/src/spec.ts'

describe('cleanSpec', () => {
  it('keeps scoped names (leading @ is scope, not version)', () => {
    expect(cleanSpec('@1930dev/opencode-usage')).toBe('@1930dev/opencode-usage')
    expect(cleanSpec('@scope/name')).toBe('@scope/name')
  })
  it('strips pinned versions', () => {
    expect(cleanSpec('@1930dev/opencode-usage@0.4.1')).toBe('@1930dev/opencode-usage')
    expect(cleanSpec('name@1.2')).toBe('name')
  })
  it('passes paths and bare names through', () => {
    expect(cleanSpec('name')).toBe('name')
    expect(cleanSpec('/Volumes/2t/code/x')).toBe('/Volumes/2t/code/x')
  })
})

describe('dedupeToSpec', () => {
  it('collapses pinned + bare duplicates, keeping the pin', () => {
    expect(dedupeToSpec(['@x/y@0.4.1', '@x/y'], '@x/y@0.5.0')).toEqual(['@x/y@0.5.0'])
  })
  it('keeps unrelated specs', () => {
    expect(dedupeToSpec(['a', '@x/y@0.4.1', 'b'], '@x/y@0.4.1')).toEqual(['a', 'b', '@x/y@0.4.1'])
  })
})

describe('removeSpec', () => {
  it('removes by clean spec, raw name, and plugin id', () => {
    const list = ['@x/y@0.4.1', 'other']
    expect(removeSpec(list, '@x/y', {})).toEqual(['other'])
    expect(removeSpec(list, '@x/y@0.4.1', {})).toEqual(['other'])
    expect(removeSpec(['@x/y@0.4.1'], 'x.server', { '@x/y': 'x.server' })).toEqual([])
  })
  it('throws when nothing matches', () => {
    expect(() => removeSpec(['a'], 'b', {})).toThrow('not found')
  })
})

describe('featuresMap', () => {
  it('keys features by spec AND id', () => {
    const m = featuresMap([{ id: 'oh-my-openagent', source: { type: 'package', target: 'oh-my-opencode' }, features: { server: true } }])
    expect(m['oh-my-opencode']).toEqual({ server: true })
    expect(m['oh-my-openagent']).toEqual({ server: true })
  })
  it('skips items without features', () => {
    expect(featuresMap([{ id: 'x', source: { type: 'local' } }])).toEqual({})
  })
})

describe('buildExtras', () => {
  it('returns uncataloged installs with id display names', () => {
    const ex = buildExtras({ 'oh-my-opencode': 'oh-my-opencode', '@1930dev/opencode-usage': '@1930dev/opencode-usage' },
      { 'oh-my-opencode': 'oh-my-openagent' }, { 'oh-my-opencode': '5.1.57' }, new Set(['@1930dev/opencode-usage']))
    expect(ex).toEqual([{ name: 'oh-my-openagent', version: '5.1.57' }])
  })
})
