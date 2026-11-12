/** L2 TUI verification: boot `opencode` interactively under tmux (pty) with the
 *  plugin installed, then assert the process survived plugin load — the
 *  realistic failure mode for tui packages is init-time crash, which either
 *  kills the session or paints an error screen.
 *
 *  Honest boundary (same class as the serve canary): proves the TUI doesn't
 *  die on load; does NOT prove any specific keypath works. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecFn } from './verify.ts'

export interface TuiCheck { ok: boolean; log?: string; harness?: boolean }

/** Pure judge — unit-testable. Pane text + session liveness → pass/fail. */
export function judgeTuiPane(paneText: string, sessionAlive: boolean): TuiCheck {
  if (!sessionAlive) return { ok: false, log: 'tmux session exited during startup' }
  const text = paneText.trim()
  if (text.length < 20) return { ok: false, log: `pane nearly empty (${text.length} chars): ${text.slice(0, 200)}` }
  const crash = text.match(/panic:|SIGSEGV|SIGABRT|fatal error|uncaught exception|plugin .*(crashed|failed to load)/i)
  if (crash) return { ok: false, log: `crash pattern "${crash[0]}" in pane: ${text.slice(-600)}` }
  return { ok: true, log: text.slice(-512) }
}

export async function checkTui(
  env: NodeJS.ProcessEnv,
  run: ExecFn,
  opts: { settleMs?: number; cols?: number; rows?: number; command?: string } = {},
): Promise<TuiCheck> {
  // intra-shard lanes share this process+clock — a same-ms pair would mint
  // identical session names and the second new-session fails 'duplicate'. The
  // random suffix makes a collision (a harness flake) vanishingly rare.
  const sess = `vtui-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`
  const settle = opts.settleMs ?? 8_000
  // The tmux SERVER starts as the runner uid on the first session-creating
  // command and sources the user config at boot — and `env` here is
  // xdgEnv(uh), so HOME/XDG_CONFIG_HOME point INSIDE the plugin-writable
  // sandbox home. A planted uh/.tmux.conf (or $XDG_CONFIG_HOME/tmux/tmux.conf)
  // would run `run-shell` hooks with runner privileges: forge
  // /tmp/results-*.json and break the V-1 verdict-integrity boundary.
  // `-f /dev/null` skips config loading entirely (only new-session can spawn
  // a server — has-session/capture-pane/kill-session just fail to connect),
  // and a private TMUX_TMPDIR guarantees a fresh server per check: no
  // pre-existing/persistent server on a self-hosted runner can carry a stale
  // config in, and the 0700 socket dir stays out of the sandbox uid's reach.
  const sockDir = mkdtempSync(join(tmpdir(), 'vtmux-'))
  const tenv = { ...env, TMUX_TMPDIR: sockDir }
  try {
    try {
      await run('tmux', ['-f', '/dev/null', 'new-session', '-d', '-s', sess, '-x', String(opts.cols ?? 200), '-y', String(opts.rows ?? 50),
        opts.command ?? 'opencode'],
        { env: tenv, timeout: 10_000 })
    } catch (e) {
      // new-session failing means the session was never created — the plugin
      // code inside it never ran, so there is no package evidence to judge.
      // This is infrastructure (tmux outage/resource/collision): harness, not
      // a package 'failed' — same class as the dead-serve throw (V-4).
      return { ok: false, log: `tmux spawn failed: ${(e as Error).message}`, harness: true }
    }
    try {
      await new Promise(r => setTimeout(r, settle))
      let alive = false
      try {
        await run('tmux', ['has-session', '-t', sess], { env: tenv, timeout: 5_000 })
        alive = true
      } catch { alive = false }
      let pane = ''
      try {
        const { stdout } = await run('tmux', ['capture-pane', '-p', '-t', sess], { env: tenv, timeout: 5_000 })
        pane = stdout
      } catch { /* session died between probes — judge reports not-alive */ }
      return judgeTuiPane(pane, alive)
    } finally {
      await run('tmux', ['kill-session', '-t', sess], { env: tenv, timeout: 5_000 }).catch(() => {})
    }
  } finally {
    rmSync(sockDir, { recursive: true, force: true })
  }
}
