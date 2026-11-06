/** Shell-level integration tests for bin/ai-diagnose.sh — the audit found
 *  ZERO coverage of the wrapper's reliability paths (lock, spool replay,
 *  comm dedup, push retry, schema gate, pause/resume, health publish).
 *
 *  Harness: a local bare repo plays "origin" (main = this repo's committed
 *  HEAD, catalog = minimal data branch). $CODE is a real clone whose
 *  node_modules is a symlink farm into the real repo's, except .bin/tsx
 *  which is a SHIM: it stubs `tsx pipeline/ai/diagnose.ts` (canned verdicts
 *  via CANNED_* env) and delegates everything else — including the real
 *  `tsx -e` schema gate — to the genuine tsx. .deps-stamp is pre-seeded so
 *  npm ci is skipped. Nothing touches the real repo or network. */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const SCRIPT = join(REPO, 'bin', 'ai-diagnose.sh')
const REAL_TSX = join(REPO, 'node_modules', '.bin', 'tsx')

let root: string, remote: string, home: string, code: string, cat: string, stated: string

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()

function catalogFile(name: string): string {
  try { return execFileSync('git', ['-C', remote, 'show', `catalog:${name}`], { encoding: 'utf8' }) }
  catch { return '' }
}

function runScript(...args: string[]): { code: number; out: string } {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: { ...process.env, HOME: home, MARKET_GIT_URL: remote, ...((globalThis as any).__canned ?? {}) },
    encoding: 'utf8', timeout: 240_000,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const withCanned = (env: Record<string, string>, fn: () => void) => {
  ;(globalThis as any).__canned = env
  try { fn() } finally { delete (globalThis as any).__canned }
}

const VERDICT_A = JSON.stringify({ name: 'pkg-a', version: '1.0.0', verdict: 'pass', at: '2025-06-01T00:00:00Z', source: 'ai' })
const VERDICT_B = JSON.stringify({ name: 'pkg-b', version: '2.0.0', verdict: 'concern', reason: 'test', at: '2025-06-01T00:00:01Z', source: 'ai' })
const freshHealth = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: new Date().toISOString(), wrote: 1, l05: 'ok', omlx: 'ok', ...extra })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aid-'))
  remote = join(root, 'remote.git')
  home = join(root, 'home')
  code = join(home, '.local', 'share', 'opencode-market-code')
  cat = join(home, '.local', 'share', 'opencode-market-catalog')
  stated = join(home, '.local', 'share', 'opencode-market')
  mkdirSync(stated, { recursive: true })
  mkdirSync(join(home, '.config', 'opencode-market'), { recursive: true })
  writeFileSync(join(home, '.config', 'opencode-market', 'ai.env'), 'AI_BASE_URL=http://localhost:1/v1\n')

  // bare "origin": main = committed HEAD of this repo; catalog = data branch
  execFileSync('git', ['init', '--bare', '-q', remote])
  execFileSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  execFileSync('git', ['-C', REPO, 'push', '-q', remote, 'HEAD:refs/heads/main'])
  const seed = join(root, 'seed')
  execFileSync('git', ['clone', '-q', remote, seed])
  execFileSync('git', ['-C', seed, 'checkout', '-q', '--orphan', 'catalog'])
  execFileSync('git', ['-C', seed, 'rm', '-rfq', '.'])
  writeFileSync(join(seed, 'index.json'), '{}\n')
  writeFileSync(join(seed, 'ai-verdicts.jsonl'), '')
  git(seed, 'add', '-A')
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'catalog')

  // $CODE: real clone of main + node_modules symlink farm + tsx shim +
  // pre-seeded .deps-stamp so the wrapper skips npm ci entirely
  execFileSync('git', ['clone', '-q', remote, code])
  const nm = join(code, 'node_modules')
  mkdirSync(join(nm, '.bin'), { recursive: true })
  const realNm = join(REPO, 'node_modules')
  for (const e of execFileSync('bash', ['-c', `ls -A "${realNm}"`], { encoding: 'utf8' }).trim().split('\n')) {
    if (e === '.bin') continue
    symlinkSync(join(realNm, e), join(nm, e))
  }
  writeFileSync(join(nm, '.bin', 'tsx'), `#!/bin/bash
# test shim — stub the diagnose run, delegate everything else to real tsx
if [ "\${1:-}" = "pipeline/ai/diagnose.ts" ]; then
  OUT=""; HEALTH=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) OUT="$2"; shift 2 ;;
      --health) HEALTH="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  [ -n "$OUT" ] && printf '%s' "\${CANNED_VERDICTS:-}" > "$OUT"
  if [ -n "$HEALTH" ]; then
    if [ -n "\${CANNED_HEALTH_JSON:-}" ]; then
      printf '%s\\n' "$CANNED_HEALTH_JSON" > "$HEALTH"
    else
      printf '{"at":"%s","wrote":0,"l05":"ok","omlx":"ok"}\\n' "$(date -u +%FT%TZ)" > "$HEALTH"
    fi
  fi
  exit "\${CANNED_RC:-0}"
fi
exec "${REAL_TSX}" "$@"
`, { mode: 0o755 })
  const lockhash = execFileSync('shasum', ['-a', '256', join(code, 'package-lock.json')], { encoding: 'utf8' }).split(' ')[0]!
  writeFileSync(join(code, '.deps-stamp'), lockhash + '\n')
}, 120_000)

describe('ai-diagnose.sh — pause/resume', () => {
  it('pause writes diagnose.paused to catalog; a paused run skips; resume clears', () => {
    withCanned({}, () => {
      expect(runScript('pause').code).toBe(0)
      expect(catalogFile('diagnose.paused')).toContain('diagnose paused')
      const r = runScript()
      expect(r.code).toBe(0)
      expect(r.out).toContain('declared pause')
      expect(runScript('resume').code).toBe(0)
      expect(catalogFile('diagnose.paused')).toBe('')
    })
  }, 60_000)
})

describe('ai-diagnose.sh — single-instance lock', () => {
  it('fresh lock → skip; stale (>2h) lock → reclaimed and run proceeds', () => {
    withCanned({ CANNED_VERDICTS: `${VERDICT_A}\n`, CANNED_HEALTH_JSON: freshHealth() }, () => {
      mkdirSync(join(stated, 'diagnose.lock'))
      const skip = runScript()
      expect(skip.code).toBe(0)
      expect(skip.out).toContain('another run in progress')
      // age the lock past the 2h reclaim window (touch -t: YYYYMMDDhhmm)
      const old = new Date(Date.now() - 3 * 3600 * 1000)
      const stamp = old.toISOString().replace(/[-:T]/g, '').slice(0, 12)
      execFileSync('touch', ['-t', stamp, join(stated, 'diagnose.lock')])
      const run = runScript()
      expect(run.out).not.toContain('another run in progress')
      expect(catalogFile('ai-verdicts.jsonl')).toContain('pkg-a')
      expect(existsSync(join(stated, 'diagnose.lock'))).toBe(false) // released on exit
    })
  }, 120_000)
})

describe('ai-diagnose.sh — verdict push + health publish', () => {
  it('canned verdicts land on catalog once; degraded health stamp is published', () => {
    withCanned({ CANNED_VERDICTS: `${VERDICT_B}\n`, CANNED_HEALTH_JSON: freshHealth({ l05: 'failed' }) }, () => {
      const before = catalogFile('ai-verdicts.jsonl')
      const r = runScript()
      expect(r.code).toBe(0)
      const after = catalogFile('ai-verdicts.jsonl')
      expect(after.split('\n').filter(l => l.includes('pkg-b'))).toHaveLength(1)
      expect(after.length).toBeGreaterThan(before.length)
      const health = JSON.parse(catalogFile('diagnose-health.json'))
      expect(health.l05).toBe('failed')
      expect(health.at).toBeTruthy()
    })
  }, 120_000)
})

describe('ai-diagnose.sh — already-landed replay', () => {
  it('payload fully on the branch → remote-content check exits clean, no dup append', () => {
    // the "already landed" decision reads origin/catalog's file — NOT the
    // local staged diff (a concurrent reset --hard on this shared worktree
    // could fake an empty diff and silently drop the payload + spool)
    const verdictE = VERDICT_A.replace('pkg-a', 'pkg-e')
    withCanned({ CANNED_VERDICTS: `${verdictE}\n`, CANNED_HEALTH_JSON: freshHealth() }, () => {
      expect(runScript().code).toBe(0)                       // first run lands it
      const r = runScript()                                  // identical payload again
      expect(r.code).toBe(0)
      expect(r.out).toContain('already on origin/catalog')
      const landed = catalogFile('ai-verdicts.jsonl')
      expect(landed.split('\n').filter(l => l.includes('"pkg-e"'))).toHaveLength(1)
    })
  }, 240_000)
})

describe('ai-diagnose.sh — schema gate', () => {
  it('malformed payload lines are dropped; only schema-valid verdicts land', () => {
    const bad1 = '{"name":"broken",'
    const bad2 = '{"verdict":"pass"}' // missing name/at/source
    const good = VERDICT_A.replace('pkg-a', 'pkg-schema')
    withCanned({ CANNED_VERDICTS: `${bad1}\n${bad2}\n${good}\n`, CANNED_HEALTH_JSON: freshHealth() }, () => {
      const r = runScript()
      expect(r.code).toBe(0)
      expect(r.out).toContain('dropped 2 malformed payload line(s)')
      const landed = catalogFile('ai-verdicts.jsonl')
      expect(landed).toContain('pkg-schema')
      expect(landed).not.toContain('"broken"')
      expect(landed.split('\n').filter(l => l.includes('pkg-schema'))).toHaveLength(1)
    })
  }, 120_000)

  it('malformed spool lines are purged from the replay file — not carried forever', () => {
    // spool holds ONLY a corrupt line: the gate drops it from PAY, and the
    // spool sync must drop it from SPOOL too — otherwise it re-enters every
    // run, gets dropped every run, and never lands nor clears
    writeFileSync(join(stated, 'pending-verdicts.jsonl'), '{"name":"broken",\n')
    withCanned({ CANNED_VERDICTS: '', CANNED_HEALTH_JSON: freshHealth() }, () => {
      const r = runScript()
      expect(r.code).toBe(0)
      expect(r.out).toContain('no new verdicts')
      expect(readFileSync(join(stated, 'pending-verdicts.jsonl'), 'utf8')).toBe('')
    })
    rmSync(join(stated, 'pending-verdicts.jsonl'), { force: true })
  }, 120_000)
})

describe('ai-diagnose.sh — spool replay dedup', () => {
  it('lines already on the branch are not appended twice; spool+payload dedup via sort -u', () => {
    // seed: branch already has VERDICT_A; spool holds A+B; this run emits A+B+C
    const verdictC = VERDICT_B.replace('pkg-b', 'pkg-c')
    const seed2 = join(root, 'seed2')
    execFileSync('git', ['clone', '-q', '-b', 'catalog', remote, seed2])
    writeFileSync(join(seed2, 'ai-verdicts.jsonl'), `${VERDICT_A}\n`)
    git(seed2, 'add', 'ai-verdicts.jsonl')
    git(seed2, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed A')
    git(seed2, 'push', '-q', 'origin', 'catalog')
    rmSync(seed2, { recursive: true, force: true })
    writeFileSync(join(stated, 'pending-verdicts.jsonl'), `${VERDICT_A}\n${VERDICT_B}\n`)
    withCanned({ CANNED_VERDICTS: `${VERDICT_A}\n${VERDICT_B}\n${verdictC}\n`, CANNED_HEALTH_JSON: freshHealth() }, () => {
      const r = runScript()
      expect(r.code).toBe(0)
      const landed = catalogFile('ai-verdicts.jsonl')
      // A already on branch → comm -13 drops it; B (spool∩payload) dedups
      // via sort -u; C is new → exactly one copy of each on the branch
      expect(landed.split('\n').filter(l => l.includes('"pkg-a"'))).toHaveLength(1)
      expect(landed.split('\n').filter(l => l.includes('"pkg-b"'))).toHaveLength(1)
      expect(landed.split('\n').filter(l => l.includes('"pkg-c"'))).toHaveLength(1)
    })
  }, 120_000)
})

describe('ai-diagnose.sh — push failure spools for replay', () => {
  it('unwritable remote → verdicts spooled + exit 1; restored → next run replays them', () => {
    const verdictD = VERDICT_A.replace('pkg-a', 'pkg-d')
    chmodSync(remote, 0o555)
    chmodSync(join(remote, 'objects'), 0o555)
    chmodSync(join(remote, 'refs'), 0o555)
    try {
      withCanned({ CANNED_VERDICTS: `${verdictD}\n`, CANNED_HEALTH_JSON: freshHealth() }, () => {
        const r = runScript()
        expect(r.code).toBe(1)
        expect(r.out).toContain('NOT pushed')
        expect(readFileSync(join(stated, 'pending-verdicts.jsonl'), 'utf8')).toContain('pkg-d')
      })
    } finally {
      chmodSync(join(remote, 'refs'), 0o755)
      chmodSync(join(remote, 'objects'), 0o755)
      chmodSync(remote, 0o755)
    }
    // remote writable again → next run replays the spool (canned emits nothing)
    withCanned({ CANNED_VERDICTS: '', CANNED_HEALTH_JSON: freshHealth() }, () => {
      const r = runScript()
      expect(r.code).toBe(0)
      expect(catalogFile('ai-verdicts.jsonl')).toContain('pkg-d')
      // successful push truncates the spool (`: > SPOOL`) — file exists but empty
      expect(readFileSync(join(stated, 'pending-verdicts.jsonl'), 'utf8')).toBe('')
    })
  }, 240_000)
})
