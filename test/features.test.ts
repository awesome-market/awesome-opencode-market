import { describe, it, expect } from 'vitest'
import { detectFeatures } from '../src/features.ts'

// mirrors opencode's official Host.resolve entrypoint rules
describe('detectFeatures (Host.resolve parity)', () => {
  it('root entry counts as the server part', () => {
    expect(detectFeatures({ exports: { '.': './dist/server.js', './tui': './dist/tui.js' } }))
      .toEqual(['server', 'tui'])
  })
  it('explicit ./server also counts', () => {
    expect(detectFeatures({ exports: { './server': './s.js' } })).toEqual(['server'])
  })
  it('gui resolves ONLY via ./gui-experimental, not any key containing "gui"', () => {
    expect(detectFeatures({ exports: { './gui': './g.cjs' } })).toEqual([])
    expect(detectFeatures({ exports: { '.': './s.js', './gui-experimental': './dist/gui.cjs' } }))
      .toEqual(['server', 'gui'])
  })
  it('gui bundle must end .cjs/.js — ts and mjs do not count', () => {
    expect(detectFeatures({ exports: { './gui-experimental': './dist/gui.ts' } })).toEqual([])
    expect(detectFeatures({ exports: { './gui-experimental': { import: './dist/gui.mjs' } } })).toEqual([])
    expect(detectFeatures({ exports: { './gui-experimental': { require: './dist/gui.cjs' } } })).toEqual(['gui'])
  })
  it('rpc counts only together with a server entry', () => {
    expect(detectFeatures({ exports: { './rpc': './r.js' } })).toEqual([])
    expect(detectFeatures({ exports: { '.': './s.js', './rpc': './r.js' } })).toEqual(['server', 'rpc'])
  })
  it('no exports → conventional root filenames resolve the same parts', () => {
    expect(detectFeatures({ files: ['package/tui.js', 'package/index.js'] })).toEqual(['server', 'tui'])
    expect(detectFeatures({ files: ['package/gui-experimental.cjs'] })).toEqual(['gui'])
    expect(detectFeatures({ files: ['package/rpc/index.js', 'package/index.js'] }))
      .toEqual(['server', 'rpc'])
  })
  it('a main field is a server entry even without exports', () => {
    expect(detectFeatures({ main: 'dist/server.js', files: [] })).toEqual(['server'])
  })
  it('GUI-only package ships NO server tag (official: nothing to run here)', () => {
    expect(detectFeatures({ exports: { './gui-experimental': './g.cjs' } })).toEqual(['gui'])
    expect(detectFeatures({})).toEqual([])
  })
  it('loop-recover shape: ./server + ./gui-experimental + unrelated subpaths', () => {
    const out = detectFeatures({
      exports: { '.': './dist/server.js', './server': './dist/server.js', './gui-experimental': './dist/gui-experimental.cjs', './detect/detector': './d.js' },
    })
    expect(out).toEqual(['server', 'gui'])
  })
})
