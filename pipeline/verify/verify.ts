/** Install/activation verification (DEV §4). Runs in a permissions:{} CI job — never sees secrets. */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export type ExecFn = typeof exec

export interface VerifyResult {
  name: string
  /** exact version that was installed — write-back routes on this (DEV §4). */
  version?: string
  status: 'verified' | 'failed'
  level: 'install' | 'load' | 'interactive' | 'render'
  opencodeVersion: string
  verifiedAt: string
  logExcerpt?: string
}

/** Shard input unit (verify.yml plan emits these). Legacy string shards coerce. */
export interface VerifyTarget {
  name: string
  version?: string
  /** features of the version under test — routes optional L2/L3a checks */
  features?: string[]
}

export function coerceTarget(t: VerifyTarget | string): VerifyTarget {
  return typeof t === 'string' ? { name: t } : t
}

const LOG_REL = 'opencode/log/opencode.log'

export function xdgEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CACHE_HOME: join(home, 'cache'),
  }
}

/**
 * Dummy provider config — `opencode run` exits before server start when no provider
 * exists (end-to-end finding, see BLOCKERS.md). A dead localhost endpoint gets past
 * the provider check; plugin loading happens before the model call so no AI is used.
 */
export function writeDummyProvider(home: string): void {
  const dir = join(home, '.config', 'opencode')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      fake: {
        npm: '@ai-sdk/openai-compatible',
        name: 'fake',
        options: { baseURL: 'http://127.0.0.1:9/v1' },
        models: { 'fake-model': { name: 'fake' } },
      },
    },
    model: 'fake/fake-model',
  }))
}

function readLog(home: string): string {
  const p = join(home, 'data', LOG_REL)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/** The A3-verified canary: `msg="loading plugin" id=<name>` in the log file. */
export function loadedSignal(logText: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`loading plugin"\\s+id=${esc}`).test(logText) ||
    logText.includes(`loading plugin id=${name}`)
}

export async function verifyPackage(
  name: string,
  opts: { version?: string; features?: string[]; home?: string; timeoutMs?: number; execFn?: ExecFn } = {},
): Promise<VerifyResult> {
  const run = opts.execFn ?? exec
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'verify-'))
  const env = xdgEnv(home)
  const timeout = opts.timeoutMs ?? 45_000
  const tail = (s: string) => s.slice(-2048)
  const spec = opts.version ? `${name}@${opts.version}` : name
  const base = {
    name,
    ...(opts.version ? { version: opts.version } : {}),
    opencodeVersion: await ocVersion(env, run).catch(() => 'unknown'),
    verifiedAt: new Date().toISOString(),
  }

  // install the PINNED spec (name@version) — the version users would get (DEV §4)
  try {
    await run('opencode', ['plugin', 'add', spec], { env, timeout })
  } catch (e) {
    return {
      ...base, status: 'failed', level: 'install',
      logExcerpt: tail(String((e as { stderr?: string }).stderr ?? (e as Error).message)),
    }
  }

  // activation: plugins load lazily on first API request (evidenced by
  // http.span on `loading plugin` log lines), so: boot `serve` in background,
  // wait for its listening+password lines, hit /api/plugin + /api/session to
  // force the load, then kill. No provider needed; `run`'s service machinery
  // hangs in CI so it isn't used. The dummy provider config is still written —
  // the TUI check below needs it to get past first-run.
  writeDummyProvider(home)
  const boot = [
    `opencode serve --port 0 > serve.out 2>&1 &`,
    `SPID=$!`,
    `for i in $(seq 1 30); do grep -q "server listening" serve.out 2>/dev/null && break; sleep 0.5; done`,
    `PORT=$(sed -n 's/.*127.0.0.1:\\([0-9]*\\).*/\\1/p' serve.out | head -1)`,
    `PW=$(sed -n 's/server password //p' serve.out | head -1)`,
    `[ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null "http://127.0.0.1:$PORT/api/plugin"`,
    `[ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null "http://127.0.0.1:$PORT/api/session"`,
    `sleep 1`,
    `kill $SPID 2>/dev/null; true`,
  ].join('\n')
  try {
    await run('sh', ['-c', boot], { env, cwd: home, timeout: 25_000 })
  } catch {
    // boot/curl failure still leaves whatever log was written — the canary decides
  }
  const log = readLog(home)
  if (!loadedSignal(log, name)) {
    return { ...base, status: 'failed', level: 'load', logExcerpt: tail(log) }
  }

  // feature-routed depth checks (L2/L3a) — level records deepest stage passed
  const feats = opts.features ?? []
  let level: VerifyResult['level'] = 'load'

  if (feats.includes('tui')) {
    const { checkTui } = await import('./tui.ts')
    const tui = await checkTui(env, run)
    if (!tui.ok) return { ...base, status: 'failed', level: 'interactive', logExcerpt: tail(tui.log ?? 'tui check failed') }
    level = 'interactive'
  }

  if (feats.includes('gui')) {
    const { checkGuiBundle, findGuiBundle } = await import('./gui.ts')
    const found = findGuiBundle(home, name)
    if ('error' in found) {
      return { ...base, status: 'failed', level: 'render', logExcerpt: found.error }
    }
    const gui = await checkGuiBundle(found.src)
    if (!gui.ok) {
      return { ...base, status: 'failed', level: 'render', logExcerpt: `gui ${gui.stage}: ${gui.error}` }
    }
    level = 'render'
  }

  return { ...base, status: 'verified', level }
}

async function ocVersion(env: NodeJS.ProcessEnv, run: ExecFn): Promise<string> {
  const { stdout } = await run('opencode', ['--version'], { env, timeout: 15_000 })
  return stdout.trim().replace(/^opencode\s*v?/i, '')
}

/** Shard driver: verify a slice of {name,version,features} targets, write results JSON. */
export async function verifyShard(targets: (VerifyTarget | string)[], outPath: string, opts: { execFn?: ExecFn } = {}): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []
  for (const t of targets) {
    const target = coerceTarget(t)
    results.push(await verifyPackage(target.name, {
      ...opts,
      ...(target.version ? { version: target.version } : {}),
      ...(target.features ? { features: target.features } : {}),
    }))
    console.log(`verify ${target.name}@${target.version ?? 'latest'}: ${results.at(-1)!.status}`)
  }
  mkdirSync(join(outPath, '..'), { recursive: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  return results
}

/* v8 ignore next 9 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const namesFile = process.argv[2]!
  const out = process.argv[3]!
  const names: (VerifyTarget | string)[] = JSON.parse(readFileSync(namesFile, 'utf8'))
  verifyShard(names, out).catch(e => { console.error(e); process.exit(1) })
}
