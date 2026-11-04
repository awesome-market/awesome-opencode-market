/** V-1 sandbox tests: uid-separated execution of untrusted plugin code,
 *  the /api/plugin server-response canary, and shard-level sudo probing. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiLoaded, verifyPackage, verifyShard, type ExecFn } from '../pipeline/verify/verify.ts'
import { checkTui } from '../pipeline/verify/tui.ts'

const API = (target: string, status = 'active') =>
  JSON.stringify([{ id: 'x', source: { type: 'package', target }, state: { status } }])

describe('apiLoaded canary', () => {
  it('active package entry matching the name → loaded', () => {
    expect(apiLoaded(API('pkg'), 'pkg')).toBe(true)
    expect(apiLoaded(API('pkg@1.2.3'), 'pkg')).toBe(true)
    expect(apiLoaded(API('@scope/pkg@1.0'), '@scope/pkg')).toBe(true)
  })
  it('failed/absent/malformed → not loaded', () => {
    expect(apiLoaded(API('pkg', 'failed'), 'pkg')).toBe(false)
    expect(apiLoaded(API('other'), 'pkg')).toBe(false)
    expect(apiLoaded('[]', 'pkg')).toBe(false)
    expect(apiLoaded('not json', 'pkg')).toBe(false)
    expect(apiLoaded('', 'pkg')).toBe(false)
  })
  it('non-package sources and name-as-substring do not count', () => {
    expect(apiLoaded(JSON.stringify([{ source: { type: 'local', path: '/x/pkg' }, state: { status: 'active' } }]), 'pkg')).toBe(false)
    expect(apiLoaded(JSON.stringify([{ source: { type: 'package', target: 'pkgg' }, state: { status: 'active' } }]), 'pkg')).toBe(false)
  })
  it('finds entries nested under a response wrapper', () => {
    const wrapped = JSON.stringify({ data: [{ source: { type: 'package', target: 'pkg' }, state: { status: 'active' } }] })
    expect(apiLoaded(wrapped, 'pkg')).toBe(true)
  })
  it('install-dir style targets match too (…/node_modules/<name>)', () => {
    expect(apiLoaded(API('/cache/opencode/npm/pkg@1.0.0/9/node_modules/pkg'), 'pkg')).toBe(true)
    expect(apiLoaded(API('/x/node_modules/pkg/deep'), 'pkg')).toBe(true)
    expect(apiLoaded(API('/x/node_modules/notpkg'), 'pkg')).toBe(false)
  })
})

describe('verifyPackage sandboxed (sandboxUser)', () => {
  interface Rec { cmd: string; args: string[] }
  /** Fake exec that plays the OS: mkdir actually mkdirs, the boot sh -c writes
   *  plugins.json like the real curl loop would, everything else succeeds. */
  const fakeOs = (home: string, calls: Rec[], opts: { api?: string } = {}) =>
    (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd === 'sudo' && args.includes('mkdir')) mkdirSync(args.at(-1)!, { recursive: true })
      if (cmd.endsWith('sb.sh') && args.includes('-c'))
        writeFileSync(join(home, 'u', 'plugins.json'), opts.api ?? API('pkg'))
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn

  it('routes every untrusted command through the nobody wrapper', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const r = await verifyPackage('pkg', { version: '1.0.0', home, sandboxUser: 'nobody', execFn: fakeOs(home, calls) })
    expect(r.status).toBe('verified')
    // sudo -n -u nobody mkdir + sudo -n chmod happened
    expect(calls.some(c => c.cmd === 'sudo' && c.args.slice(0, 3).join(' ') === '-n -u nobody')).toBe(true)
    expect(calls.some(c => c.cmd === 'sudo' && c.args[1] === 'chmod')).toBe(true)
    // opencode/sh/env all went through <home>/sb.sh — never invoked directly
    const untrusted = calls.filter(c => c.cmd !== 'sudo')
    expect(untrusted.length).toBeGreaterThan(0)
    expect(untrusted.every(c => c.cmd.endsWith('sb.sh'))).toBe(true)
    // plugin add spec travelled via: env … opencode plugin add pkg@1.0.0
    const add = calls.find(c => c.args.includes('add'))
    expect(add!.args.join(' ')).toContain('opencode plugin add pkg@1.0.0')
    // wrapper script itself: sudo -n -u nobody env 'K=V'… "$@"
    const wrapper = readFileSync(join(home, 'sb.sh'), 'utf8')
    expect(wrapper).toContain('sudo -n -u nobody env')
    expect(wrapper).toContain(`'HOME=${join(home, 'u')}'`)
  })

  it('writes the dummy provider config by base64 through the sandbox', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fakeOs(home, calls) })
    const wr = calls.find(c => c.args.some(a => a.includes('base64 -d')))
    expect(wr).toBeTruthy()
    const b64 = wr!.args.join(' ').match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!
    const cfg = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { model?: string }
    expect(cfg.model).toBe('fake/fake-model')
  })

  it('gui feature: bundle evaluated by a nobody subprocess (npx tsx gui.ts)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      const uh = join(home, 'u')
      if (cmd === 'sudo' && args.includes('mkdir')) {
        mkdirSync(uh, { recursive: true })
        const dir = join(uh, 'cache', 'opencode', 'npm', 'pkg@1.0.0', '999', 'node_modules', 'pkg')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui-experimental': './g.js' } }))
        writeFileSync(join(dir, 'g.js'), 'module.exports={}')
      }
      if (cmd.endsWith('sb.sh') && args.includes('-c')) writeFileSync(join(uh, 'plugins.json'), API('pkg'))
      if (cmd.endsWith('sb.sh') && args.includes('tsx'))
        return { stdout: '{"ok":true,"rendered":1}', stderr: '' }
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', features: ['gui'], home, sandboxUser: 'nobody', execFn: fake })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('render')
    // wrapper shape: sb.sh env npx tsx <gui.ts> <bundle>
    const guiCall = calls.find(c => c.args.includes('tsx'))
    expect(guiCall!.cmd.endsWith('sb.sh')).toBe(true)
    expect(guiCall!.args.slice(0, 3)).toEqual(['env', 'npx', 'tsx'])
  })

  it('gui subprocess failing → failed/render with the subprocess error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const fake = (async (cmd: string, args: string[]) => {
      const uh = join(home, 'u')
      if (cmd === 'sudo' && args.includes('mkdir')) {
        mkdirSync(uh, { recursive: true })
        const dir = join(uh, 'cache', 'opencode', 'npm', 'pkg@1.0.0', '1', 'node_modules', 'pkg')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui-experimental': './g.js' } }))
        writeFileSync(join(dir, 'g.js'), 'module.exports={}')
      }
      if (cmd.endsWith('sb.sh') && args.includes('-c')) writeFileSync(join(uh, 'plugins.json'), API('pkg'))
      if (cmd.endsWith('sb.sh') && args.includes('tsx')) throw new Error('tsx crashed')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', features: ['gui'], home, sandboxUser: 'nobody', execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('render')
    expect(r.logExcerpt).toContain('gui subprocess')
  })

  it('provider merge keeps an existing plugin entry (cat → merge → write)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const cfgPath = join(home, 'u', '.config', 'opencode', 'opencode.json')
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      const uh = join(home, 'u')
      if (cmd === 'sudo' && args.includes('mkdir')) {
        mkdirSync(join(uh, '.config', 'opencode'), { recursive: true })
        writeFileSync(cfgPath, JSON.stringify({ plugins: ['other@1.0.0'] }))
      }
      if (cmd.endsWith('sb.sh') && args[1] === 'cat') return { stdout: readFileSync(cfgPath, 'utf8'), stderr: '' }
      if (cmd.endsWith('sb.sh') && args.includes('-c')) {
        const m = args.join(' ').match(/base64 -d > '([^']+)'/)
        if (m) writeFileSync(m[1]!, Buffer.from(args.join(' ').match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!, 'base64').toString('utf8'))
        else writeFileSync(join(uh, 'plugins.json'), API('pkg'))
      }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake })
    expect(r.status).toBe('verified')
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { plugins?: string[]; model?: string }
    expect(cfg.plugins).toEqual(['other@1.0.0'])
    expect(cfg.model).toBe('fake/fake-model')
  })

  it('tui feature under sandbox → tmux session runs the wrapper command', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      const uh = join(home, 'u')
      if (cmd === 'sudo' && args.includes('mkdir')) mkdirSync(uh, { recursive: true })
      if (cmd.endsWith('sb.sh') && args.includes('-c')) writeFileSync(join(uh, 'plugins.json'), API('pkg'))
      if (cmd === 'tmux' && args[0] === 'capture-pane') return { stdout: 'x'.repeat(60), stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', {
      home, sandboxUser: 'nobody', execFn: fake, features: ['tui'], tuiOpts: { settleMs: 1 },
    })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('interactive')
    const sess = calls.find(c => c.cmd === 'tmux' && c.args[0] === 'new-session')!
    expect(sess.args.at(-1)).toBe(`${join(home, 'sb.sh')} opencode`)
  })

  it('api canary absent → failed/load even with the sandbox', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd === 'sudo' && args.includes('mkdir')) mkdirSync(args.at(-1)!, { recursive: true })
      return { stdout: 'x', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
  })
})

describe('verifyShard sandbox probing', () => {
  it('sudo probe ok → sandboxUser reaches verifyPackage (sb.sh calls)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vsp-'))
    const out = join(home, 'r.json')
    const calls: string[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push(cmd)
      if (cmd === 'sudo' && args.includes('mkdir')) mkdirSync(args.at(-1)!, { recursive: true })
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const results = await verifyShard(['p'], out, { home, sandboxUser: 'nobody', execFn: fake })
    expect(results).toHaveLength(1)
    expect(calls.some(c => c.endsWith('sb.sh'))).toBe(true)
  })

  it('a versioned target that throws records failed with its version pinned', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vsp-'))
    const out = join(home, 'r.json')
    const notDir = join(home, 'afile')
    writeFileSync(notDir, 'x')
    const fake = (async () => ({ stdout: '', stderr: '' })) as unknown as ExecFn
    const results = await verifyShard([{ name: 'p', version: '1.2.3', features: ['server'] }], out,
      { home: notDir, execFn: fake })
    expect(results[0]).toMatchObject({ name: 'p', version: '1.2.3', status: 'failed' })
  })

  it('sudo probe failure → degrades to unconfined with a warning', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vsp-'))
    const out = join(home, 'r.json')
    const calls: string[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push(cmd)
      if (cmd === 'sudo') throw new Error('sudo: a password is required')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const results = await verifyShard(['p'], out, { home, sandboxUser: 'nobody', execFn: fake })
    expect(results).toHaveLength(1)
    // degraded: raw commands, no sb.sh wrapper anywhere
    expect(calls.some(c => c.endsWith('sb.sh'))).toBe(false)
    expect(calls).toContain('opencode')
  })
})

describe('checkTui command opt', () => {
  it('uses the provided command for the tmux session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tc-'))
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'has-session') return { stdout: '', stderr: '' }
      return { stdout: args[0] === 'capture-pane' ? 'x'.repeat(50) : '', stderr: '' }
    }) as unknown as ExecFn
    const r = await checkTui({}, fake, { settleMs: 1, command: '/tmp/sb.sh opencode' })
    expect(r.ok).toBe(true)
    const sess = calls.find(a => a[0] === 'new-session')!
    expect(sess.at(-1)).toBe('/tmp/sb.sh opencode')
    void home
  })
})
