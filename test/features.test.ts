import { describe, it, expect } from 'vitest'
import { detectFeatures } from '../src/features.ts'

describe('detectFeatures', () => {
  it('reads exports subpaths', () => {
    expect(detectFeatures({ '.': './dist/server.js', './tui': './dist/tui.js', './gui': './dist/gui.cjs' }, []))
      .toEqual(expect.arrayContaining(['server', 'tui', 'gui']))
  })
  it('falls back to scan paths', () => {
    expect(detectFeatures(null, ['network-call:package/dist/tui.js', 'child-process:package/dist/cli.js']))
      .toEqual(expect.arrayContaining(['server', 'tui']))
  })
  it('defaults to server with no evidence', () => {
    expect(detectFeatures(undefined, [])).toEqual(['server'])
  })
  it('detects rpc', () => {
    expect(detectFeatures({ './rpc': './x.js' }, [])).toContain('rpc')
  })
  it('ignores string exports', () => {
    expect(detectFeatures('./dist/index.js', [])).toEqual(['server'])
  })
  it('handles findings without a colon', () => {
    expect(detectFeatures(null, ['nogui-here'])).toEqual(['server'])
  })
  it('covers every exports key pattern', () => {
    const out = detectFeatures({ './server': './s.js', './rpc': './r.js' }, ['x:package/gui.tsx'])
    expect(out).toEqual(expect.arrayContaining(['server', 'rpc', 'gui']))
  })
})
