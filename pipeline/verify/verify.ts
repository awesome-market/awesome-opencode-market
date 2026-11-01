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
  status: 'verified' | 'failed'
  level: 'install' | 'load'
  opencodeVersion: string
  verifiedAt: string
  logExcerpt?: string
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
  return logText.includes(`msg="loading plugin" id=${name}`) ||
    new RegExp(`loading plugin" id=${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(logText)
}

export async function verifyPackage(
  name: string,
  opts: { home?: string; timeoutMs?: number; execFn?: ExecFn } = {},
): Promise<VerifyResult> {
  const run = opts.execFn ?? exec
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'verify-'))
  writeDummyProvider(home)
  const env = xdgEnv(home)
  const timeout = opts.timeoutMs ?? 45_000
  const tail = (s: string) => s.slice(-2048)

  // install (plugin add writes config + fetches package)
  try {
    await run('opencode', ['plugin', 'add', name], { env, timeout })
  } catch (e) {
    return {
      name, status: 'failed', level: 'install',
      opencodeVersion: await ocVersion(env, run).catch(() => 'unknown'),
      verifiedAt: new Date().toISOString(),
      logExcerpt: tail(String((e as { stderr?: string }).stderr ?? (e as Error).message)),
    }
  }

  // activation: run spins up the server which loads plugins at boot (A3 evidence)
  try {
    await run('opencode', ['run', 'hi'], { env, timeout })
  } catch {
    // model failure is fine — plugin loading happens before model resolution
  }
  const log = readLog(home)
  const ok = loadedSignal(log, name)
  return {
    name,
    status: ok ? 'verified' : 'failed',
    level: 'load',
    opencodeVersion: await ocVersion(env, run).catch(() => 'unknown'),
    verifiedAt: new Date().toISOString(),
    ...(ok ? {} : { logExcerpt: tail(log) }),
  }
}

async function ocVersion(env: NodeJS.ProcessEnv, run: ExecFn): Promise<string> {
  const { stdout } = await run('opencode', ['--version'], { env, timeout: 15_000 })
  return stdout.trim().replace(/^opencode\s*v?/i, '')
}

/** Shard driver: verify a slice of names, write results JSON. */
export async function verifyShard(names: string[], outPath: string, opts: { execFn?: ExecFn } = {}): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []
  for (const n of names) {
    results.push(await verifyPackage(n, opts))
    console.log(`verify ${n}: ${results.at(-1)!.status}`)
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
  const names: string[] = JSON.parse(readFileSync(namesFile, 'utf8'))
  verifyShard(names, out).catch(e => { console.error(e); process.exit(1) })
}
