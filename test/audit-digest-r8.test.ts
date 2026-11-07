/** Audit #6 (fresh pass) — bin/publish-digest.sh single-instance lock.
 *
 *  The stale-lock reclaim was age-only and the EXIT trap rmdir'd the lock
 *  unconditionally: after a >2h reclaim, a wedged-but-alive run's late exit
 *  deleted the NEW owner's lock → a third run could start and share the
 *  $CATDG worktree (mixed staged state, push races). The script now mirrors
 *  bin/ai-diagnose.sh: the lock records the owner pid, reclaim requires the
 *  owner to be dead, and the trap releases only its own lock.
 *
 *  Harness: HOME is a tempdir so the lock path is isolated; MARKET_REPO
 *  points nowhere so the script exits right after the lock section ("no
 *  remote URL") — fast, no clone, no network. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, '..', 'bin', 'publish-digest.sh')

let root: string, home: string, lockDir: string

const run = () => spawnSync('bash', [SCRIPT], {
  env: { ...process.env, HOME: home, MARKET_REPO: join(root, 'no-such-repo'), MARKET_GIT_URL: '' },
  encoding: 'utf8', timeout: 30_000,
})

/** Pre-seed the lock dir. pid: written into $LOCK/pid; ageSec: backdate the
 *  dir mtime past the 2h reclaim threshold. */
const makeLock = (pid?: number | string, ageSec = 0) => {
  mkdirSync(lockDir, { recursive: true })
  if (pid !== undefined) writeFileSync(join(lockDir, 'pid'), `${pid}\n`)
  if (ageSec > 0) {
    const t = new Date(Date.now() - ageSec * 1000)
    utimesSync(lockDir, t, t)
  }
}
const pidFile = () => readFileSync(join(lockDir, 'pid'), 'utf8').trim()

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'pdg-lock-'))
  home = join(root, 'home')
  lockDir = join(home, '.local', 'share', 'opencode-market', 'digest.lock')
  mkdirSync(join(home, '.local', 'share', 'opencode-market'), { recursive: true })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('publish-digest.sh lock — owner-aware stale reclaim', () => {
  it('young lock (even without a pid file) → skip, lock untouched', () => {
    rmSync(lockDir, { recursive: true, force: true })
    makeLock() // pre-pid-era shape, fresh mtime
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('another run in progress')
    expect(existsSync(lockDir)).toBe(true)
    expect(existsSync(join(lockDir, 'pid'))).toBe(false) // skip exits before the pid write
  })

  it('stale lock with a LIVE owner pid → not reclaimed (owner may be wedged, not dead)', () => {
    rmSync(lockDir, { recursive: true, force: true })
    makeLock(process.pid, 3 * 3600) // this vitest worker is alive
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('another run in progress')
    expect(existsSync(lockDir)).toBe(true)
    expect(pidFile()).toBe(String(process.pid))
  })

  it('stale lock with a DEAD owner pid → reclaimed; run proceeds and releases its own lock', () => {
    rmSync(lockDir, { recursive: true, force: true })
    makeLock(999_999, 3 * 3600) // pid above every platform's pid_max → kill -0 fails
    const r = run()
    expect(r.stdout).toContain('reclaimed stale lock')
    // proceeds past the lock, dies at URL resolution (no remote configured)
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toContain('no remote URL')
    // the script's own EXIT trap released the lock it owned
    expect(existsSync(lockDir)).toBe(false)
  })

  it('stale lock with NO pid file (pre-pid-era) → treated dead, reclaimed', () => {
    rmSync(lockDir, { recursive: true, force: true })
    makeLock(undefined, 3 * 3600)
    const r = run()
    expect(r.stdout).toContain('reclaimed stale lock')
    expect(existsSync(lockDir)).toBe(false)
  })

  it('stale lock with a CORRUPT pid file → treated dead, reclaimed', () => {
    rmSync(lockDir, { recursive: true, force: true })
    makeLock('not-a-pid', 3 * 3600)
    const r = run()
    expect(r.stdout).toContain('reclaimed stale lock')
    expect(existsSync(lockDir)).toBe(false)
  })
})
