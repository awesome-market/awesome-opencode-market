/** audit #3 fresh round (verification-flow), round 10:
 *  checkTui ran `tmux` with env = xdgEnv(uh) — HOME and XDG_CONFIG_HOME both
 *  inside the plugin-WRITABLE sandbox home. The first tmux command in a
 *  shard job starts the tmux server AS THE RUNNER UID, and the server sources
 *  the user config at boot ($XDG_CONFIG_HOME/tmux/tmux.conf or ~/.tmux.conf —
 *  verified on tmux 3.8: both execute `run-shell`). A plugin could plant
 *  either file during its nobody-phase install/serve and get arbitrary
 *  runner-uid execution — enough to rewrite /tmp/results-*.json and forge a
 *  'verified' verdict, breaking the V-1 verdict-integrity boundary the whole
 *  sandbox exists for.
 *  Fix: `tmux -f /dev/null new-session` (only the session-creating command
 *  can spawn a server — has-session/capture-pane/kill-session merely fail to
 *  connect) plus a private per-call TMUX_TMPDIR, so every check gets a fresh
 *  config-less server that no pre-existing/persistent server can contaminate. */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { checkTui } from '../pipeline/verify/tui.ts'
import type { ExecFn } from '../pipeline/verify/verify.ts'

interface Call { cmd: string; args: string[]; env: NodeJS.ProcessEnv | undefined }

const fakeTmux = (calls: Call[], pane = 'x'.repeat(60)): ExecFn =>
  (async (cmd: string, args: string[], o?: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: o?.env })
    if (args.includes('has-session')) throw new Error('dead')
    if (args.includes('capture-pane')) return { stdout: pane, stderr: '' }
    return { stdout: '', stderr: '' }
  }) as unknown as ExecFn

describe('checkTui — tmux server can never source plugin-controlled config', () => {
  it('new-session carries `-f /dev/null` ahead of the subcommand', async () => {
    const calls: Call[] = []
    await checkTui({}, fakeTmux(calls), { settleMs: 1 })
    const ns = calls.find(c => c.args.includes('new-session'))!
    expect(ns.args.slice(0, 3)).toEqual(['-f', '/dev/null', 'new-session'])
  })

  it('every tmux call runs under a private TMUX_TMPDIR, distinct per check', async () => {
    const calls: Call[] = []
    await checkTui({}, fakeTmux(calls), { settleMs: 1 })
    const dirs = new Set(calls.filter(c => c.cmd === 'tmux').map(c => c.env?.TMUX_TMPDIR))
    expect(dirs.size).toBe(1)
    const [dir] = [...dirs]
    expect(dir).toBeTruthy()
    expect(dir).toMatch(/vtmux-/)
    // cleaned up after the check — no socket-dir litter
    expect(existsSync(dir!)).toBe(false)
    // a second check mints a DIFFERENT server dir (fresh server, no reuse)
    const calls2: Call[] = []
    await checkTui({}, fakeTmux(calls2), { settleMs: 1 })
    const dir2 = calls2.find(c => c.cmd === 'tmux')!.env!.TMUX_TMPDIR!
    expect(dir2).not.toBe(dir)
    expect(existsSync(dir2)).toBe(false)
  })

  it('caller env still flows through — the pane keeps its sandbox home', async () => {
    const calls: Call[] = []
    const env = { HOME: '/tmp/fake-uh', XDG_CONFIG_HOME: '/tmp/fake-uh/.config', PATH: '/usr/bin' }
    await checkTui(env, fakeTmux(calls), { settleMs: 1 })
    for (const c of calls.filter(c => c.cmd === 'tmux')) {
      expect(c.env?.HOME).toBe('/tmp/fake-uh')
      expect(c.env?.XDG_CONFIG_HOME).toBe('/tmp/fake-uh/.config')
      expect(c.env?.PATH).toBe('/usr/bin')
    }
  })
})
