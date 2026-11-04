/** L2 TUI verification: boot `opencode` interactively under tmux (pty) with the
 *  plugin installed, then assert the process survived plugin load — the
 *  realistic failure mode for tui packages is init-time crash, which either
 *  kills the session or paints an error screen.
 *
 *  Honest boundary (same class as the serve canary): proves the TUI doesn't
 *  die on load; does NOT prove any specific keypath works. */
import type { ExecFn } from './verify.ts'

export interface TuiCheck { ok: boolean; log?: string }

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
  const sess = `vtui-${process.pid}-${Date.now().toString(36)}`
  const settle = opts.settleMs ?? 8_000
  try {
    await run('tmux', ['new-session', '-d', '-s', sess, '-x', String(opts.cols ?? 200), '-y', String(opts.rows ?? 50),
      opts.command ?? 'opencode'],
      { env, timeout: 10_000 })
  } catch (e) {
    return { ok: false, log: `tmux spawn failed: ${(e as Error).message}` }
  }
  try {
    await new Promise(r => setTimeout(r, settle))
    let alive = false
    try {
      await run('tmux', ['has-session', '-t', sess], { env, timeout: 5_000 })
      alive = true
    } catch { alive = false }
    let pane = ''
    try {
      const { stdout } = await run('tmux', ['capture-pane', '-p', '-t', sess], { env, timeout: 5_000 })
      pane = stdout
    } catch { /* session died between probes — judge reports not-alive */ }
    return judgeTuiPane(pane, alive)
  } finally {
    await run('tmux', ['kill-session', '-t', sess], { env, timeout: 5_000 }).catch(() => {})
  }
}
