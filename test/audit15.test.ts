/** Audit #3 (verify flow) regressions:
 *  1. gui whitelist must give bundles the REAL 'solid-js/store' module —
 *     mapping it to the reactive root leaves createStore/produce/... undefined
 *     and a legit store-using bundle fails setup() on a harness mistake.
 *  2. findGuiBundle must resolve conditional exports to a runnable file —
 *     "types"-first objects resolve to a .d.ts (guaranteed vm compile
 *     failure), nested condition objects used to crash path.join outright
 *     (thrown → harness-dropped → the slot re-queues forever).
 *  3. tmux spawn failure is infrastructure (the plugin never ran) — marked
 *     harness:true so merge drops it instead of a false package 'failed';
 *     session names carry a random suffix so intra-shard lanes can't collide.
 *  4. verify.yml derives the opencode install spec from OPENCODE_VERSION and
 *     fetches the catalog branch shallow+forced-refspec everywhere. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkGuiBundle, findGuiBundle, resolveExportTarget } from '../pipeline/verify/gui.ts'
import { checkTui } from '../pipeline/verify/tui.ts'
import { verifyPackage, verifyShard, type ExecFn, type SpawnFn } from '../pipeline/verify/verify.ts'

const WF = '.github/workflows/verify.yml'

const GUI_BUNDLE_OK = `
const { createStore } = require('solid-js/store')
const { Panel } = require('@opencode/plugin/gui')
module.exports.default = { setup(ctx) {
  const [state, setState] = createStore({ n: 0 })
  setState('n', 1)
  if (state.n !== 1) throw new Error('store broken')
  ctx.add(Panel, () => ({ render: () => {
    const el = document.createElement('div'); el.textContent = 'hi'; return el
  } }))
} }`

describe('gui whitelist — solid-js/store is the real store module', () => {
  it('a bundle using createStore passes (root module lacks it)', async () => {
    const r = await checkGuiBundle(GUI_BUNDLE_OK)
    expect(r.ok).toBe(true)
    expect(r.registrations).toContain('Panel')
  })
})

describe('resolveExportTarget', () => {
  it('string target returns as-is; .d.ts leaves are refused', () => {
    expect(resolveExportTarget('./g.js')).toBe('./g.js')
    expect(resolveExportTarget('./g.d.ts')).toBeNull()
    expect(resolveExportTarget('./g.d.mts')).toBeNull()
  })
  it('prefers runtime conditions over "types"-first objects', () => {
    expect(resolveExportTarget({ types: './g.d.ts', import: './g.mjs', default: './g.js' }))
      .toBe('./g.mjs')
    expect(resolveExportTarget({ types: './g.d.ts', require: './g.cjs' })).toBe('./g.cjs')
  })
  it('recurses into nested condition objects (the old pick crashed path.join)', () => {
    expect(resolveExportTarget({ import: { types: './g.d.ts', default: './g.js' } })).toBe('./g.js')
    expect(resolveExportTarget({ node: { import: { default: './g.mjs' } } })).toBe('./g.mjs')
  })
  it('handles fallback arrays and gives up on types-only targets', () => {
    expect(resolveExportTarget(['./a.d.ts', './b.js'])).toBe('./b.js')
    expect(resolveExportTarget({ types: './g.d.ts' })).toBeNull()
    expect(resolveExportTarget({})).toBeNull()
  })
})

describe('findGuiBundle export resolution', () => {
  const pkgCache = (home: string, exportsMap: Record<string, unknown>, files: Record<string, string>) => {
    const dir = join(home, 'cache', 'opencode', 'npm', 'pkg@1.2.3', '999', 'node_modules', 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: exportsMap }))
    for (const [p, src] of Object.entries(files)) {
      mkdirSync(join(dir, p, '..'), { recursive: true })
      writeFileSync(join(dir, p), src)
    }
    return dir
  }
  it('"types"-first exports resolve the .js bundle, not the .d.ts', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh15-'))
    pkgCache(home,
      { './gui': { types: './dist/gui.d.ts', default: './dist/gui.js' } },
      { 'dist/gui.d.ts': 'export {}', 'dist/gui.js': 'module.exports={}' })
    const found = findGuiBundle(home, 'pkg')
    expect('src' in found && found.src).toBe('module.exports={}')
  })
  it('nested condition objects resolve to the inner leaf', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh15b-'))
    pkgCache(home,
      { './gui': { import: { types: './dist/gui.d.ts', default: './dist/gui.js' } } },
      { 'dist/gui.js': 'module.exports={}' })
    const found = findGuiBundle(home, 'pkg')
    expect('src' in found && found.src).toBe('module.exports={}')
  })
  it('a "../" export target is refused instead of reading outside the package', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh15c-'))
    pkgCache(home, { './gui': '../escape.js' }, { 'x.js': 'x' })
    writeFileSync(join(home, 'cache', 'opencode', 'npm', 'pkg@1.2.3', '999', 'node_modules', 'escape.js'), 'x')
    expect(findGuiBundle(home, 'pkg')).toMatchObject({ error: expect.stringContaining('escapes') })
  })
})

describe('checkTui harness classification', () => {
  it('new-session failure → harness:true (no package evidence ever existed)', async () => {
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === 'new-session') throw new Error('duplicate session')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await checkTui({}, fake, { settleMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.harness).toBe(true)
  })
  it('concurrent lanes mint distinct session names', async () => {
    const names: string[] = []
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === 'new-session') names.push(args[args.indexOf('-s') + 1]!)
      if (args[0] === 'has-session') throw new Error('dead')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    await Promise.all([checkTui({}, fake, { settleMs: 1 }), checkTui({}, fake, { settleMs: 1 })])
    expect(names.length).toBe(2)
    expect(new Set(names).size).toBe(2)
  })
})

describe('verifyPackage tui harness propagation', () => {
  const liveSpawn = (() => ({
    stdout: { on: (_e: 'data', cb: (d: unknown) => void) => {
      cb('server listening on http://127.0.0.1:4567\nserver password pw\n')
    } },
    stderr: { on: () => {} },
    on: () => {},
    kill: () => {},
  })) as unknown as SpawnFn
  const api = (name: string) => JSON.stringify([{ source: { type: 'package', target: name },
    state: { status: 'active' } }])

  it('tmux spawn failure throws (harness) instead of a package failed', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vt15-'))
    const fake = (async (cmd: string, args: string[]) => {
      if (cmd === 'tmux' && args[0] === 'new-session') throw new Error('tmux server gone')
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, api('pkg'))
      }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    await expect(verifyPackage('pkg', { home, execFn: fake, spawnFn: liveSpawn,
      features: ['tui'], tuiOpts: { settleMs: 1 }, bootWaitMs: 30, apiWaitMs: 30 }))
      .rejects.toThrow(/tui check infrastructure/)
  })

  it('verifyShard lands the throw in the harness:true lane (merge drops it)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vs15-'))
    const out = join(home, 'r.json')
    const fake = (async (cmd: string, args: string[]) => {
      if (cmd === 'tmux' && args[0] === 'new-session') throw new Error('tmux server gone')
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, api('pkg'))
      }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const results = await verifyShard([{ name: 'pkg', features: ['tui'] }], out,
      { execFn: fake, spawnFn: liveSpawn, tuiOpts: { settleMs: 1 }, bootWaitMs: 30, apiWaitMs: 30 })
    expect(results[0]).toMatchObject({ name: 'pkg', status: 'failed', harness: true })
  })
})

describe('verify.yml structural guards', () => {
  const wf = readFileSync(WF, 'utf8')
  it('every catalog fetch is shallow + forced-refspec', () => {
    const fetches = wf.match(/git fetch [^\n]+catalog[^\n]*/g) ?? []
    expect(fetches.length).toBeGreaterThanOrEqual(3)
    for (const f of fetches) {
      expect(f).toContain('--depth=1')
      expect(f).toContain('+refs/heads/catalog:refs/remotes/origin/catalog')
    }
    expect(wf).not.toContain('git fetch origin catalog')
  })
  it('the opencode install spec is derived from OPENCODE_VERSION, not a second literal', () => {
    expect(wf).toContain('npm i -g "@opencode/cli@$OCV"')
    expect(wf).toContain("OPENCODE_VERSION = '([^']+)'")
    expect(wf).not.toMatch(/npm i -g @opencode\/cli@\d/)
  })
})
