/** L2 TUI verification: boot `opencode` interactively under tmux (pty) with the
 *  plugin installed, then assert the process survived plugin load — the
 *  realistic failure mode for tui packages is init-time crash, which either
 *  kills the session or paints an error screen.
 *
 *  Honest boundary (same class as the serve canary): proves the TUI doesn't
 *  die on load; does NOT prove any specific keypath works. */
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecFn } from './verify.ts'

export interface TuiCheck { ok: boolean; log?: string; diag?: string; harness?: boolean }

/** Bounded tail-read — pane.log can grow unboundedly under a repainting TUI,
 *  and readFileSync would pull all of it into memory. */
function readTail(path: string, max: number): string {
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      const start = Math.max(0, size - max)
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally { closeSync(fd) }
  } catch { return '' }
}

/** Pure judge — unit-testable. Pane text + session liveness → pass/fail.
 *  `paneText` is the best available rendering: live capture-pane output when
 *  the session survives, otherwise the pipe-pane log tail — whatever the TUI
 *  painted before dying. */
export function judgeTuiPane(paneText: string, sessionAlive: boolean): TuiCheck {
  const text = paneText.trim()
  if (!sessionAlive) {
    // a dead session's scrollback dies with it — surface the last painted
    // output so the failure carries evidence instead of a bare verdict
    const tail = text ? `; last pane output:\n${text.slice(-1400)}` : ''
    return { ok: false, log: `tmux session exited during startup${tail}` }
  }
  if (text.length < 20) return { ok: false, log: `pane nearly empty (${text.length} chars): ${text.slice(0, 200)}` }
  const crash = text.match(/panic:|SIGSEGV|SIGABRT|fatal error|uncaught exception|plugin .*(crashed|failed to load)/i)
  if (crash) return { ok: false, log: `crash pattern "${crash[0]}" in pane: ${text.slice(-600)}` }
  return { ok: true, log: text.slice(-512) }
}

export async function checkTui(
  env: NodeJS.ProcessEnv,
  run: ExecFn,
  opts: { settleMs?: number; cols?: number; rows?: number; command?: string; cwd?: string } = {},
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
      // -c pins the pane cwd: without it the session inherits the shard's cwd
      // (the repo checkout) — a nobody-uid TUI then EACCES-stat'ing the
      // checkout's .git/.hg crashes opencode itself, minting false package
      // failures (the 2026-11-15 pane-evidence wave). The caller passes the
      // sandbox home, same cwd the serve check uses.
      await run('tmux', ['-f', '/dev/null', 'new-session', '-d', '-s', sess,
        ...(opts.cwd ? ['-c', opts.cwd] : []),
        '-x', String(opts.cols ?? 200), '-y', String(opts.rows ?? 50),
        opts.command ?? 'opencode'],
        { env: tenv, timeout: 10_000 })
    } catch (e) {
      // new-session failing means the session was never created — the plugin
      // code inside it never ran, so there is no package evidence to judge.
      // This is infrastructure (tmux outage/resource/collision): harness, not
      // a package 'failed' — same class as the dead-serve throw (V-4).
      return { ok: false, log: `tmux spawn failed: ${(e as Error).message}`, harness: true }
    }
    // pipe-pane streams the raw pane output into a file that OUTLIVES the
    // session — capture-pane cannot read a dead session's scrollback, so
    // without this a crashed TUI leaves only "exited during startup" and the
    // reviewer gets zero diagnostic content. Set before the settle wait so
    // boot output is captured too; failure is non-fatal (falls back to the
    // old evidence-free verdict).
    const paneLog = join(sockDir, 'pane.log')
    await run('tmux', ['pipe-pane', '-t', sess, `cat > ${paneLog}`], { env: tenv, timeout: 5_000 }).catch(() => {})
    try {
      await new Promise(r => setTimeout(r, settle))
      let alive = false
      try {
        await run('tmux', ['has-session', '-t', sess], { env: tenv, timeout: 5_000 })
        alive = true
      } catch { alive = false }
      // the pipe-pane file is the only pane record that survives session
      // death — read its tail once for BOTH the judgment fallback and the
      // reviewer-facing diag dump (raw stream incl. scrollback, escapes intact)
      const paneRaw = readTail(paneLog, 65_536)
      let pane = ''
      let captured = false
      try {
        const { stdout } = await run('tmux', ['capture-pane', '-p', '-t', sess], { env: tenv, timeout: 5_000 })
        pane = stdout
        captured = true
      } catch { /* session died between probes — the pane log is the fallback */ }
      if (!captured && paneRaw) pane = paneRaw.slice(-16_384)
      // diag rides along whenever the stream produced anything — verify.ts
      // publishes it as the per-target artifact for failed checks
      return { ...judgeTuiPane(pane, alive), ...(paneRaw.trim() ? { diag: paneRaw } : {}) }
    } finally {
      await run('tmux', ['kill-session', '-t', sess], { env: tenv, timeout: 5_000 }).catch(() => {})
    }
  } finally {
    rmSync(sockDir, { recursive: true, force: true })
  }
}
