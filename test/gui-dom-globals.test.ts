// domGlobals:true is the subprocess path's globalThis DOM install — the
// subprocess's own coverage can't merge, so exercise it in-process here.
// This file gets its own vitest worker, so polluting globalThis with jsdom
// window/document is contained. Node 22's getter-only globals (navigator)
// exercise the assignment-fail → defineProperty fallback automatically.
import { describe, it, expect } from 'vitest'
import { checkGuiBundle } from '../pipeline/verify/gui.ts'

describe('checkGuiBundle domGlobals', () => {
  it('installs jsdom DOM globals onto globalThis and still verifies', async () => {
    const hadWindow = 'window' in globalThis
    const src = `module.exports = { default: { setup(ctx) {
      // inside the vm realm the injected globals still apply
      ctx.add({ cname: 'Panel', name: 'Panel' }, () => ({
        render: () => { const e = document.createElement('div'); e.textContent = 'ok'; return e }
      }))
    } } }`
    const r = await checkGuiBundle(src, { domGlobals: true })
    expect(r.ok).toBe(true)
    // the globalThis mutation happened (production subprocess path)
    if (!hadWindow) expect((globalThis as Record<string, unknown>).window).toBeDefined()
  })
})
