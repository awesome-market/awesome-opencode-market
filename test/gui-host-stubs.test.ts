// gui host-module stubs: the real @opencode/plugin/gui surface is far larger
// than the modeled contract — unmodeled exports must degrade to callable
// contrib stubs (ctx.add still registers) instead of dying 'cname of
// undefined', and '@opencode/plugin/rpc' / '@opencode/client/solid' are real
// host modules gui bundles legitimately require.
import { describe, it, expect } from 'vitest'
import { checkGuiBundle } from '../pipeline/verify/gui.ts'

const wrap = (body: string) => `module.exports = { default: { setup(ctx) { ${body} } } }`

describe('gui host-module fallback stubs', () => {
  it('an unmodeled @opencode/plugin/gui export registers via contribStub', async () => {
    const src = wrap(`
      const { Panel, FileTree } = require('@opencode/plugin/gui')
      ctx.add(Panel, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'p'; return e } }))
      ctx.add(FileTree, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 't'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['Panel', 'FileTree'])
    expect(r.rendered).toBe(2)
  })

  it('@opencode/plugin/rpc provides Rpc.define identity', async () => {
    const src = wrap(`
      const { Rpc } = require('@opencode/plugin/rpc')
      const d = Rpc.define({ id: 'x.y' })
      if (!d || d.id !== 'x.y') throw new Error('Rpc.define did not return the descriptor')
      ctx.add({ cname: 'Cmd', name: 'Cmd' }, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'c'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
  })

  it('@opencode/client/solid resolves to callable stubs', async () => {
    const src = wrap(`
      const client = require('@opencode/client/solid')
      client.createOpencodeClient?.()
      client.anythingAtAll?.()
      ctx.add({ cname: 'Tab', name: 'Tab' }, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 't'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
  })

  it('awaiting the host module does not hang (then stays undefined)', async () => {
    const src = `module.exports = { default: { async setup(ctx) {
      const gui = require('@opencode/plugin/gui')
      await gui
      ctx.add(gui.Command, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'c'; return e } }))
    } } }`
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
  })

  it('ctx.add tolerates an undefined kind instead of crashing', async () => {
    const src = wrap(`
      ctx.add(undefined, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'u'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['unknown'])
  })

  it('contribStub survives every access shape a bundle might use', async () => {
    const src = wrap(`
      const { FileTree } = require('@opencode/plugin/gui')
      const kind = FileTree
      // property access paths that used to crash on undefined exports
      if (kind.cname !== 'FileTree') throw new Error('cname wrong: ' + kind.cname)
      if (kind.length !== 0) throw new Error('length wrong')
      for (const _ of kind) { throw new Error('must not iterate') }
      const inst = new kind()
      if (inst === undefined) throw new Error('construct returned undefined')
      if (!('anything' in kind)) throw new Error('has trap broken')
      String(kind) // toPrimitive → name
      kind()       // callable → deepStub
      kind.deep.chain.of.calls().everywhere // chained access
      ctx.add(kind, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 't'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['FileTree'])
  })

  it('ctx.add accepts both object and factory forms (real overloaded signature)', async () => {
    const src = wrap(`
      const { Panel, Command } = require('@opencode/plugin/gui')
      // object form: ctx.add(Command, { id, title, run })
      ctx.add(Command, { id: 'c1', run: () => {} })
      // factory form: ctx.add(Panel, () => ({ render }))
      ctx.add(Panel, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'p'; return e } }))
      // factory returning undefined: conditional registration — must not crash
      ctx.add(Command, () => undefined)
      // returns a Cleanup like the host
      const cleanup = ctx.add(Command, () => ({ id: 'c2' }))
      cleanup()
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['Command', 'Panel', 'Command', 'Command'])
  })

  it('@opencode/plugin root and deeper real subpaths resolve', async () => {
    const src = wrap(`
      const plugin = require('@opencode/plugin')
      const review = require('@opencode/plugin/gui/review')
      const runtime = require('@opencode/plugin/runtime')
      plugin.anything?.(); review.Anything?.(); runtime.whatever?.()
      ctx.add({ cname: 'P', name: 'P' }, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'p'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
  })

  it('@opencode/plugin/gui/* paths the host null-blocks still fail the whitelist', async () => {
    const src = `require('@opencode/plugin/gui/host')
module.exports = { default: { setup(ctx) { ctx.add({ cname: 'P', name: 'P' }, () => ({})) } } }`
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('whitelist')
    expect(r.error).toContain('@opencode/plugin/gui/host')
  })

  it('unmodeled ctx properties resolve as stubs instead of crashing setup', async () => {
    const src = wrap(`
      ctx.layout.open('panel:main')
      ctx.toasts.show('hi')
      const label = ctx.t('some.key')
      ctx.storage.get('k')
      ctx.add({ cname: 'P', name: 'P' }, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'p'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
  })

  it('host globals that ARE modeled still win over the fallback', async () => {
    const src = wrap(`
      const gui = require('@opencode/plugin/gui')
      if (typeof gui.Plugin.define !== 'function') throw new Error('Plugin.define missing')
      if (typeof gui.SettingsPage !== 'function') throw new Error('SettingsPage class missing')
      if (typeof gui.MenuItem !== 'function') throw new Error('MenuItem class missing')
      ctx.add(gui.SettingsPage, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 's'; return e } }))
      ctx.add(gui.MenuItem, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'm'; return e } }))
    `)
    const r = await checkGuiBundle(src)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['SettingsPage', 'MenuItem'])
  })
})
