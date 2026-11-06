/** V-1 sandbox tests: uid-separated execution of untrusted plugin code,
 *  the /api/plugin server-response canary, and shard-level sudo probing. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiLoaded, apiFailed, apiPluginState, verifyPackage, verifyShard, type ExecFn, type SpawnFn } from '../pipeline/verify/verify.ts'
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

describe('apiPluginState / apiFailed (V-4)', () => {
  it('returns the server-reported status; null when the package is absent', () => {
    expect(apiPluginState(API('pkg', 'active'), 'pkg')).toBe('active')
    expect(apiPluginState(API('pkg', 'failed'), 'pkg')).toBe('failed')
    expect(apiPluginState(API('other'), 'pkg')).toBeNull()
    expect(apiPluginState('[]', 'pkg')).toBeNull()
    expect(apiPluginState('not json', 'pkg')).toBeNull()
  })
  it('entry present but status missing → "unknown", not null', () => {
    const noState = JSON.stringify([{ source: { type: 'package', target: 'pkg' } }])
    expect(apiPluginState(noState, 'pkg')).toBe('unknown')
  })
  it('apiFailed only on the terminal failed state', () => {
    expect(apiFailed(API('pkg', 'failed'), 'pkg')).toBe(true)
    expect(apiFailed(API('pkg', 'active'), 'pkg')).toBe(false)
    expect(apiFailed(API('other', 'failed'), 'pkg')).toBe(false)
  })
})

interface Rec { cmd: string; args: string[] }

/** Fake serve spawn — emits the boot lines the harness parses, then idles.
 *  Real `serve` output is piped runner-side now (never file-mediated through
 *  the nobody uid — the pre-plant/interval-rewrite forge hole this closed). */
const serveSpawn = (calls: Rec[], lines = 'server listening on http://127.0.0.1:4567\nserver password pw\n'): SpawnFn =>
  ((cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return {
      stdout: { on: (_e: 'data', cb: (d: unknown) => void) => { cb(lines) } },
      stderr: { on: () => {} },
      on: () => {},
      kill: () => {},
    }
  }) as unknown as SpawnFn

/** serve reports dead on arrival — a test must never boot a real `opencode`
 *  binary (CI/dev boxes may have one installed). */
const deadSpawn = (() => ({
  stdout: { on: () => {} }, stderr: { on: () => {} },
  on: (_ev: string, cb: (a?: unknown) => void) => { cb() },
  kill: () => {},
})) as unknown as SpawnFn

describe('verifyPackage sandboxed (sandboxUser)', () => {
  /** Fake exec that plays the OS: the runner-side curl writes plugins.json
   *  to the -o target (a runner-owned path under home), everything else
   *  succeeds. uh itself is mkdir'd by the runner + chown'd via sudo — the
   *  sandbox uid never creates entries in home (real-runner EACCES fix). */
  const fakeOs = (calls: Rec[], opts: { api?: string } = {}) =>
    (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, opts.api ?? API('pkg'))
      }
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn

  it('routes every untrusted command through the nobody wrapper', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const r = await verifyPackage('pkg', { version: '1.0.0', home, sandboxUser: 'nobody',
      execFn: fakeOs(calls), spawnFn: serveSpawn(calls) })
    expect(r.status).toBe('verified')
    // uh handed to the sandbox uid via chown (nobody can't create inside a
    // 0711 runner-owned home); chmod + process sweep happened
    expect(calls.some(c => c.cmd === 'sudo' && c.args[0] === '-n' && c.args[1] === 'chown'
      && c.args[2] === 'nobody' && c.args[3] === join(home, 'u'))).toBe(true)
    expect(calls.some(c => c.cmd === 'sudo' && c.args.slice(0, 3).join(' ') === '-n -u nobody')).toBe(true)
    expect(calls.some(c => c.cmd === 'sudo' && c.args[1] === 'chmod')).toBe(true)
    // process sweep is platform-dual: Linux uses a scoped /proc/*/environ
    // marker scan (parallel-lane safe — a blanket pkill -u would murder a
    // sibling lane's serve); non-/proc platforms fall back to pkill -f.
    if (existsSync('/proc')) {
      expect(calls.some(c => c.cmd === 'sudo' && c.args.slice(0, 3).join(' ') === '-n -u nobody'
        && c.args.includes('sh') && c.args.some(a => a.includes('/proc/[0-9]*/environ')))).toBe(true)
    } else {
      expect(calls.some(c => c.cmd === 'sudo' && c.args.includes('pkill'))).toBe(true)
    }
    // serve spawned through the wrapper with the binary restored as argv[0]
    expect(calls.some(c => c.cmd.endsWith('sb.sh') && c.args[0] === 'opencode' && c.args[1] === 'serve')).toBe(true)
    // plugin-executing commands (opencode/sh/env/npx/tsx) went through <home>/sb.sh;
    // runner-side harness calls (curl, the version probe) legitimately didn't
    const untrusted = calls.filter(c => c.cmd !== 'sudo' && c.cmd !== 'curl')
    expect(untrusted.length).toBeGreaterThan(0)
    expect(untrusted.every(c => c.cmd.endsWith('sb.sh'))).toBe(true)
    // the api snapshot landed under runner-owned home — NOT the nobody-writable uh
    const apiWrites = calls.filter(c => c.cmd === 'curl').flatMap(c => {
      const o = c.args.indexOf('-o'); return o >= 0 ? [c.args[o + 1]!] : []
    }).filter(p => p !== '/dev/null')
    expect(apiWrites).toEqual([join(home, 'plugins.json')])
    // plugin add spec travelled via: env … opencode plugin add pkg@1.0.0
    const add = calls.find(c => c.args.includes('add'))
    expect(add!.args.join(' ')).toContain('opencode plugin add pkg@1.0.0')
    // wrapper script itself: sudo -n -u nobody env 'K=V'… "$@"
    const wrapper = readFileSync(join(home, 'sb.sh'), 'utf8')
    expect(wrapper).toContain('sudo -n -u nobody env')
    expect(wrapper).toContain(`'HOME=${join(home, 'u')}'`)
  })

  it('a forged plugins.json inside the nobody home is NOT read as evidence (V-A)', async () => {
    // the whole point of the runner-side restructure: plugin code could plant
    // or rewrite <uh>/plugins.json — the verdict must come only from the
    // runner-owned snapshot curl actually fetched
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const uh = join(home, 'u')
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd === 'sudo' && args.includes('chown')) {
        // uh exists by now (runner mkdirSync) — plugin pre-plants a forged
        // "active" listing inside its own home
        writeFileSync(join(uh, 'plugins.json'), API('pkg', 'active'))
      }
      // real curl fetch reports the plugin FAILED — the honest state
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, API('pkg', 'failed'))
      }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake, spawnFn: serveSpawn(calls) })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
    expect(r.logExcerpt).toContain('serve reports the plugin failed to load')
  })

  it('writes the dummy provider config by base64 through the sandbox', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fakeOs(calls), spawnFn: serveSpawn(calls) })
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
      if (cmd === 'sudo' && args.includes('chown')) {
        const dir = join(uh, 'cache', 'opencode', 'npm', 'pkg@1.0.0', '999', 'node_modules', 'pkg')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui-experimental': './g.js' } }))
        writeFileSync(join(dir, 'g.js'), 'module.exports={}')
      }
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, API('pkg'))
      }
      if (cmd.endsWith('sb.sh') && args.includes('tsx'))
        return { stdout: '{"ok":true,"rendered":1}', stderr: '' }
      return { stdout: args.includes('--version') ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', features: ['gui'], home, sandboxUser: 'nobody',
      execFn: fake, spawnFn: serveSpawn(calls) })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('render')
    // wrapper shape: sb.sh env npx tsx <gui.ts> <bundle>
    const guiCall = calls.find(c => c.args.includes('tsx'))
    expect(guiCall!.cmd.endsWith('sb.sh')).toBe(true)
    expect(guiCall!.args.slice(0, 3)).toEqual(['env', 'npx', 'tsx'])
  })

  it('gui subprocess failing → failed/render with the subprocess error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      const uh = join(home, 'u')
      if (cmd === 'sudo' && args.includes('chown')) {
        const dir = join(uh, 'cache', 'opencode', 'npm', 'pkg@1.0.0', '1', 'node_modules', 'pkg')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui-experimental': './g.js' } }))
        writeFileSync(join(dir, 'g.js'), 'module.exports={}')
      }
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, API('pkg'))
      }
      if (cmd.endsWith('sb.sh') && args.includes('tsx')) throw new Error('tsx crashed')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { version: '1.0.0', features: ['gui'], home, sandboxUser: 'nobody',
      execFn: fake, spawnFn: serveSpawn(calls) })
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
      if (cmd === 'sudo' && args.includes('chown')) {
        mkdirSync(join(uh, '.config', 'opencode'), { recursive: true })
        writeFileSync(cfgPath, JSON.stringify({ plugins: ['other@1.0.0'] }))
      }
      if (cmd.endsWith('sb.sh') && args[1] === 'cat') return { stdout: readFileSync(cfgPath, 'utf8'), stderr: '' }
      if (cmd.endsWith('sb.sh') && args.includes('-c')) {
        const m = args.join(' ').match(/base64 -d > '([^']+)'/)
        if (m) writeFileSync(m[1]!, Buffer.from(args.join(' ').match(/printf %s '([A-Za-z0-9+/=]+)'/)![1]!, 'base64').toString('utf8'))
      }
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, API('pkg'))
      }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake, spawnFn: serveSpawn(calls) })
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
      if (cmd === 'curl') {
        const o = args.indexOf('-o')
        if (o >= 0 && args[o + 1] !== '/dev/null') writeFileSync(args[o + 1]!, API('pkg'))
      }
      if (cmd === 'tmux' && args[0] === 'capture-pane') return { stdout: 'x'.repeat(60), stderr: '' }
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', {
      home, sandboxUser: 'nobody', execFn: fake, spawnFn: serveSpawn(calls), features: ['tui'], tuiOpts: { settleMs: 1 },
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
      return { stdout: 'x', stderr: '' }
    }) as unknown as ExecFn
    // serve boots (listening line) but /api/plugin never lists the package —
    // no curl writes plugins.json → absent from api → honest package failure
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake,
      spawnFn: serveSpawn(calls), bootWaitMs: 20, apiWaitMs: 30 })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
    expect(r.logExcerpt).toContain('absent from /api/plugin')
  })

  it('install failure under sandbox names the egress allowlist as a possible cause', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (cmd.endsWith('sb.sh') && args.includes('add')) throw new Error('fetch failed')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const r = await verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake, spawnFn: serveSpawn(calls) })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('install')
    expect(r.logExcerpt).toContain('egress')
  })

  it('serve that never announces a listener throws → shard records harness, not package fail', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-'))
    const calls: Rec[] = []
    const fake = (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      return { stdout: 'x', stderr: '' }
    }) as unknown as ExecFn
    // boot silence can only be a runner/harness fault — plugin code is loaded
    // lazily AFTER serve announces its listener, so the package never even ran
    await expect(verifyPackage('pkg', { home, sandboxUser: 'nobody', execFn: fake,
      spawnFn: serveSpawn(calls, ''), bootWaitMs: 20 }))
      .rejects.toThrow('serve did not announce a listener')
    const results = await verifyShard(['pkg'], join(home, 'r.json'), { execFn: fake,
      spawnFn: serveSpawn(calls, ''), bootWaitMs: 20 })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ name: 'pkg', status: 'failed', harness: true })
    expect(results[0]!.logExcerpt).toContain('harness error')
  })
})

describe('verifyShard sandbox probing', () => {
  it('sudo probe ok → sandboxUser reaches verifyPackage (sb.sh calls)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vsp-'))
    const out = join(home, 'r.json')
    const calls: string[] = []
    const fake = (async (cmd: string) => {
      calls.push(cmd)
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const results = await verifyShard(['p'], out, { home, sandboxUser: 'nobody', execFn: fake, spawnFn: deadSpawn })
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
      { home: notDir, execFn: fake, spawnFn: deadSpawn })
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
    const results = await verifyShard(['p'], out, { home, sandboxUser: 'nobody', execFn: fake, spawnFn: deadSpawn })
    expect(results).toHaveLength(1)
    // degraded: raw commands, no sb.sh wrapper anywhere
    expect(calls.some(c => c.endsWith('sb.sh'))).toBe(false)
    expect(calls).toContain('opencode')
  })

  it('deep probe: sudo ok but chown/write chain broken → shard fails loudly (2025-11-04 regression)', async () => {
    // `sudo -n -u nobody true` passes while the setupSandbox chain is broken —
    // the exact blind spot that wrote 48 false 'failed' verdicts. The deep
    // probe must reject the shard, never degrade to unconfined untrusted exec.
    const home = mkdtempSync(join(tmpdir(), 'vsp-'))
    const out = join(home, 'r.json')
    const fake = (async (cmd: string, args: string[]) => {
      if (cmd === 'sudo' && args.includes('chown')) throw new Error('chown: Operation not permitted')
      if (cmd === 'sudo' && args.includes('touch')) throw new Error('touch: Permission denied')
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    await expect(verifyShard(['p'], out, { home, sandboxUser: 'nobody', execFn: fake, spawnFn: deadSpawn }))
      .rejects.toThrow()
  })
})

describe('shard-level hoists and boundaries', () => {
  it('ocVersion is probed once per shard, not per target', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ocv-'))
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' }
    }) as unknown as ExecFn
    const spawnCalls: Rec[] = []
    const results = await verifyShard(['a', 'b', 'c'], join(home, 'r.json'), { execFn: fake, spawnFn: serveSpawn(spawnCalls), apiWaitMs: 30 })
    expect(results).toHaveLength(3)
    expect(calls.filter(a => a[0] === '--version')).toHaveLength(1)
    expect(results.every(r => r.opencodeVersion === '2.2.5')).toBe(true)
  })

  it('VerifyResultFile drops malformed artifact rows at the merge boundary', async () => {
    const { VerifyResultFile } = await import('../pipeline/verify/merge.ts')
    const ok = { name: 'p', status: 'verified', level: 'load', opencodeVersion: 'x', verifiedAt: '2026-01-02T00:00:00Z' }
    expect(VerifyResultFile.safeParse(ok).success).toBe(true)
    // the poison case: a status string that would hard-fail CatalogIndex.parse
    // downstream if it ever reached verification.status
    for (const bad of [
      { ...ok, status: 'verified-ish' },
      { ...ok, level: 'quantum' },
      { ...ok, verifiedAt: 42 },
      { name: 'p' },
    ]) expect(VerifyResultFile.safeParse(bad).success).toBe(false)
  })

  it('verify.yml derives the opencode install spec from OPENCODE_VERSION (V-H)', async () => {
    const wf = readFileSync(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8')
    // the workflow extracts the version from the source constant — a second
    // literal pin could silently drift and stamp every result host-stale
    expect(wf).toContain('npm i -g "@opencode/cli@$OCV"')
    expect(wf).toContain("OPENCODE_VERSION = '([^']+)'")
    expect(wf).not.toMatch(/npm i -g @opencode\/cli@\d/)
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
