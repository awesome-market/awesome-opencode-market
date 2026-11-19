import { describe, it, expect } from 'vitest'
import { detectFeatures, looksLikePluginModule } from '../src/features.ts'

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
  it('string exports is the root entry — counts as server', () => {
    expect(detectFeatures({ exports: './dist/index.js' })).toEqual(['server'])
  })
  it('loop-recover shape: ./server + ./gui-experimental + unrelated subpaths', () => {
    const out = detectFeatures({
      exports: { '.': './dist/server.js', './server': './dist/server.js', './gui-experimental': './dist/gui-experimental.cjs', './detect/detector': './d.js' },
    })
    expect(out).toEqual(['server', 'gui'])
  })
})

describe('looksLikePluginModule (module.ts load-contract shapes)', () => {
  it('literal default-export definition', () => {
    expect(looksLikePluginModule('export default { id: "p", async setup(ctx) {} }')).toBe(true)
    expect(looksLikePluginModule('export default { id: "p", effect() {} }')).toBe(true)
  })
  it('SDK helpers count without a literal id', () => {
    expect(looksLikePluginModule('import { Plugin } from "@opencode/plugin"\nconst p = Plugin.define({ id: pluginId, setup(c) {} })')).toBe(true)
    expect(looksLikePluginModule('const r = Rpc.define({ id: "x", methods: {} })')).toBe(true)
  })
  it('split definition — const plugin object re-exported as default', () => {
    // the defining file carries no default-export marker; the id-first
    // object + surface key still marks it plugin-shaped
    expect(looksLikePluginModule('export const plugin = { id: "x", setup(ctx) { return 1 } }')).toBe(true)
  })
  it('TUI shorthand and RPC literal shapes', () => {
    expect(looksLikePluginModule('var plugin = { id: "opencode.voice-input", tui }; export { plugin as default }')).toBe(true)
    expect(looksLikePluginModule('export default { id: "x", methods: { ping() {} } }')).toBe(true)
  })
  it('CJS module.exports definition', () => {
    expect(looksLikePluginModule('module.exports = { id: "p", setup: async (ctx) => {} }')).toBe(true)
  })
  it('computed id still counts when a surface key sits in object-literal context', () => {
    expect(looksLikePluginModule('export default { id: pkg.name, setup(ctx) {} }')).toBe(true)
  })
  it('rejects OpenAI-compatible API shapes — template-literal ids are not plugin ids', () => {
    // opencode-api-node: express app returning chatcmpl-* response objects
    expect(looksLikePluginModule('return res.json({ id: `chatcmpl-${randomUUID()}`, object: "chat.completion" })')).toBe(false)
    expect(looksLikePluginModule('const app = express(); app.get("/v1/x", (req, res) => res.json({ id: sessionId })); module.exports = app')).toBe(false)
  })
  it('rejects plain modules and incidental id fields', () => {
    expect(looksLikePluginModule('export default { id: "user-1", name: "sess" }')).toBe(false)
    expect(looksLikePluginModule('module.exports = () => console.log("cli")')).toBe(false)
    expect(looksLikePluginModule('const s = { id: "abc-123", created: Date.now() }; module.exports = s')).toBe(false)
  })
})
