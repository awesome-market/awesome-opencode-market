// gui.ts subprocess entry (--conditions=browser + domGlobals): the production
// sandbox path evaluates ONE bundle per process with solid-js's BROWSER
// build — in-process tests can't cover the export-condition resolution or
// the globalThis DOM install, so spawn the real entry like verify.ts does.
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileP = promisify(execFile)
const guiTs = fileURLToPath(new URL('../pipeline/verify/gui.ts', import.meta.url))

const BUNDLE = `
const { Plugin, Panel, FileTree } = require('@opencode/plugin/gui')
const { Rpc } = require('@opencode/plugin/rpc')
const { createSignal } = require('solid-js')
const { render } = require('solid-js/web')
module.exports = Plugin.define({
  setup(ctx) {
    ctx.add(Panel, () => ({
      render() {
        const el = document.createElement('div')
        const [n] = createSignal(40)
        render(() => { el.textContent = 'answer ' + (n() + 2) }, el)
        return el
      }
    }))
    ctx.add(FileTree, () => ({ render: () => { const e = document.createElement('div'); e.textContent = 'tree'; return e } }))
    Rpc.define({ id: 'smoke.rpc' })
  }
})
`

describe('gui.ts subprocess (browser conditions + dom globals)', () => {
  it('evaluates a solid-js bundle end-to-end and reports ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guisub-'))
    const bundle = join(dir, 'bundle.cjs')
    writeFileSync(bundle, BUNDLE)
    const { stdout } = await execFileP('node',
      ['--conditions=browser', '--import', 'tsx', guiTs, bundle],
      { cwd: process.cwd(), timeout: 60_000 })
    const r = JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      ok: boolean; stage?: string; error?: string; registrations?: string[]; rendered?: number
    }
    expect(r.ok, `stage=${r.stage} error=${r.error}`).toBe(true)
    expect(r.registrations).toEqual(['Panel', 'FileTree'])
    expect(r.rendered).toBe(2)
  }, 90_000)
})
