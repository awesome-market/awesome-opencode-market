/** Install/activation verification (DEV §4). Runs in a permissions:{} CI job — never sees secrets.
 *  When `sandboxUser` is set (CI: VERIFY_SANDBOX_USER=nobody), every command that
 *  executes untrusted plugin code runs under that uid via `sudo -n -u` — the
 *  results file stays owned by the runner uid, so plugin code cannot forge its
 *  own 'verified' verdict (V-1). */
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync,
  openSync, readSync, fstatSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export type ExecFn = typeof exec

/** Minimal child-process surface the activation phase needs — kept tiny so
 *  tests can fake it without a real opencode binary. */
export interface SpawnedLike {
  stdout: { on(ev: 'data', cb: (d: unknown) => void): unknown }
  stderr: { on(ev: 'data', cb: (d: unknown) => void): unknown }
  on(ev: 'error' | 'exit', cb: (a?: unknown) => void): unknown
  kill(sig?: string): unknown
}
export type SpawnFn = (cmd: string, args: string[], o: { env?: NodeJS.ProcessEnv; cwd?: string }) => SpawnedLike
const defaultSpawn: SpawnFn = (cmd, args, o) =>
  spawn(cmd, args, { env: o.env, cwd: o.cwd }) as unknown as SpawnedLike

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export interface VerifyResult {
  name: string
  /** exact version that was installed — write-back routes on this (DEV §4). */
  version?: string
  status: 'verified' | 'failed'
  /** for `failed` = the stage that failed; for `verified` = the deepest stage
   *  that passed (feature-routed targets go past 'load'). `structure` is the
   *  payload check for entries with no plugin artifact — bytes install and
   *  the skill manifest parses, but no code ran. */
  level: 'install' | 'load' | 'interactive' | 'render' | 'structure'
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
  /** installable parts the plan normalized from the entry's `contains`
   *  (absent = legacy plugin-shaped). No 'plugin' part → the install/serve
   *  chain is skipped for a payload-structure check instead. */
  parts?: string[]
}

export function coerceTarget(t: VerifyTarget | string): VerifyTarget {
  return typeof t === 'string' ? { name: t } : t
}

const LOG_REL = 'opencode/log/opencode.log'

/** Env allowlist for the verify sandbox — NOT a process.env spread. The
 *  spawned opencode process loads UNTRUSTED plugin code; ambient CI/agent
 *  tokens (ACTIONS_*, *_TOKEN, GH_TOKEN, npm_*) must not reach it — anything
 *  it writes into its own log can be captured by logExcerpt and published. */
export function xdgEnv(home: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
    'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
    'SystemRoot', 'COMSPEC', 'PATHEXT'])
    if (process.env[k]) out[k] = process.env[k]
  return {
    ...out,
    // HOME override is load-bearing on macOS: XDG_* alone leaves opencode
    // resolving plugin config/state via the real ~ (E2E rehearsal: XDG-only
    // never loaded the pinned plugin). Full sandbox needs all four.
    HOME: home,
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
export function dummyProviderConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...cfg,
    $schema: 'https://opencode.ai/config.json',
    provider: {
      ...(cfg.provider as Record<string, unknown> ?? {}),
      fake: {
        npm: '@ai-sdk/openai-compatible',
        name: 'fake',
        options: { baseURL: 'http://127.0.0.1:9/v1' },
        models: { 'fake-model': { name: 'fake' } },
      },
    },
    model: 'fake/fake-model',
  }
}

export function writeDummyProvider(home: string): void {
  const dir = join(home, '.config', 'opencode')
  mkdirSync(dir, { recursive: true })
  // MERGE, don't overwrite — this runs after `plugin add` wrote the pinned
  // spec into `plugins`; a blind writeFileSync erases it and the load check
  // can never see the plugin (E2E rehearsal found this)
  const cfgPath = join(dir, 'opencode.json')
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8') || '{}') as Record<string, unknown> : {}
  writeFileSync(cfgPath, JSON.stringify(dummyProviderConfig(cfg)))
}

function readLog(home: string): string {
  const p = join(home, 'data', LOG_REL)
  try {
    const fd = openSync(p, 'r')
    try {
      // tail-only read — plugin code owns this log and can fill it to OOM the
      // runner; the excerpt only ever surfaces the last KB anyway
      const size = fstatSync(fd).size
      const start = Math.max(0, size - 256 * 1024)
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally { closeSync(fd) }
  } catch { return '' }
}

/** The A3-verified canary: `msg="loading plugin" id=<name>` in the log file.
 *  Superseded by apiLoaded as the pass/fail signal — kept for diagnostics only:
 *  plugin code shares the fs with the log file, so this line is forgeable (V-1). */
export function loadedSignal(logText: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`loading plugin"\\s+id=${esc}`).test(logText) ||
    logText.includes(`loading plugin id=${name}`)
}

/** Forge-resistant load canary: the serve /api/plugin response lists an entry
 *  whose server-side `source` is `type:'package'` with a target matching the
 *  spec we installed. Unlike the log file, the response is built by opencode's
 *  own handler — plugin code cannot fabricate it by writing files. (Residual:
 *  in-process runtime patching of the handler is out of scope; the uid sandbox
 *  covers the fs-level attack.)
 *  Returns the entry's server-reported state.status, or null when the package
 *  is absent from the listing. */
export function apiPluginState(pluginsJson: string, name: string): string | null {
  let doc: unknown
  try { doc = JSON.parse(pluginsJson) } catch { return null }
  let found = false
  let status: unknown
  const walk = (v: unknown): void => {
    if (found || !v || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    const o = v as Record<string, unknown>
    const src = o.source as Record<string, unknown> | undefined
    const st = o.state as Record<string, unknown> | undefined
    if (src && typeof src === 'object' && src.type === 'package' && typeof src.target === 'string') {
      const t = src.target
      if (t === name || t.startsWith(`${name}@`) || t.endsWith(`/${name}`) || t.includes(`/${name}/`)) {
        found = true
        status = st?.status
      }
    }
    for (const x of Object.values(o)) walk(x)
  }
  walk(doc)
  if (!found) return null
  return typeof status === 'string' ? status : 'unknown'
}

export function apiLoaded(pluginsJson: string, name: string): boolean {
  return apiPluginState(pluginsJson, name) === 'active'
}

/** Deterministic load failure: the server saw the plugin and moved it to a
 *  terminal 'failed' state — no point polling the rest of the window (V-4). */
export function apiFailed(pluginsJson: string, name: string): boolean {
  return apiPluginState(pluginsJson, name) === 'failed'
}

interface Sandbox { user: string; wrapper: string; uh: string }

/** Quote a value for single-quoted shell use inside the wrapper script. */
const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

/** Carve out a nobody-owned home inside the runner-owned verify home, then emit
 *  a wrapper that re-runs any command under `sudo -n -u <user>` with the scrubbed
 *  XDG env. Untrusted plugin code (install hooks, serve handlers, the TUI, gui
 *  bundles) then runs as a uid that CANNOT write the shard's results file nor
 *  read the shard process env. */
async function setupSandbox(home: string, user: string, run: ExecFn): Promise<Sandbox> {
  chmodSync(home, 0o711)
  const uh = join(home, 'u')
  // home stays 0711 runner-owned — nobody can traverse but NOT create entries
  // (the runner-owned plugins.json evidence lives beside uh). Making uh as
  // nobody (`sudo -u mkdir`) therefore EACCESes on a real runner: create it
  // as the runner, then hand ownership to the sandbox uid.
  mkdirSync(uh, { recursive: true })
  await run('sudo', ['-n', 'chown', user, uh], { timeout: 10_000 })
  const env = xdgEnv(uh)
  const kvs = Object.entries(env).map(([k, v]) => shq(`${k}=${v ?? ''}`)).join(' ')
  const wrapper = join(home, 'sb.sh')
  writeFileSync(wrapper, `#!/bin/sh\nexec sudo -n -u ${user} env ${kvs} "$@"\n`, { mode: 0o755 })
  return { user, wrapper, uh }
}

/** Skill-payload verification — what skill-only (and the skill half of
 *  dual-nature) packages actually ship to users. `npm pack` of the pinned
 *  spec doubles as the download+integrity check (pacote validates
 *  dist.integrity on the way in); the tarball must then carry a SKILL.md
 *  with a frontmatter `name:` — opencode discovers skills via frontmatter,
 *  so a bare markdown file is not a loadable skill. The same notion of
 *  "skill file" as the admission gate (hasSkillPath): tarballs just carry
 *  a `package/` prefix the repo-tree paths lack. */
export async function checkSkillStructure(
  home: string, run: ExecFn, spec: string,
): Promise<{ ok: boolean; log?: string }> {
  try {
    const pack = await run('npm', ['pack', spec, '--pack-destination', home], { timeout: 60_000 })
    const tgzName = pack.stdout.trim().split('\n').at(-1) ?? ''
    const tgz = join(home, tgzName)
    const list = await run('tar', ['tzf', tgz], { timeout: 30_000 })
    const skillEntry = list.stdout.split('\n').map(p => p.trim())
      .find(p => /(^|\/)SKILL\.md$/.test(p.replace(/^package\//, '')))
    if (!skillEntry) return { ok: false, log: `no SKILL.md in ${spec} tarball` }
    const body = (await run('tar', ['xzf', tgz, '-O', skillEntry], { timeout: 30_000 })).stdout
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body)
    if (!fm?.[1] || !/^name:\s*\S/m.test(fm[1])) {
      return { ok: false, log: `SKILL.md in ${spec} lacks a frontmatter block with a name field` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, log: String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(0, 2000) }
  }
}

export async function verifyPackage(
  name: string,
  opts: { version?: string; features?: string[]; parts?: string[]; home?: string; timeoutMs?: number; execFn?: ExecFn;
    sandboxUser?: string; spawnFn?: SpawnFn; opencodeVersion?: string;
    bootWaitMs?: number; apiWaitMs?: number;
    tuiOpts?: { settleMs?: number; cols?: number; rows?: number } } = {},
): Promise<VerifyResult> {
  const run = opts.execFn ?? exec
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'verify-'))
  const sb = opts.sandboxUser ? await setupSandbox(home, opts.sandboxUser, run) : null
  // uh = the untrusted home. Sandboxed: nobody-owned <home>/u; otherwise home itself.
  const uh = sb?.uh ?? home
  const env = xdgEnv(uh)
  // urun runs commands that may execute untrusted plugin code. Sandboxed, they
  // go through the nobody-uid wrapper; extra opts.env keys are re-injected as
  // `env K=V` args because sudo strips the child env.
  const urun = ((cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    if (!sb) return run(cmd, args, { env, ...o })
    const { env: oe, ...rest } = o
    const extra = Object.entries((oe ?? {}) as Record<string, unknown>)
      .filter(([k]) => !(k in env)).map(([k, v]) => `${k}=${v ?? ''}`)
    return run(sb.wrapper, ['env', ...extra, cmd, ...args], { env: { PATH: env.PATH }, ...rest })
  }) as ExecFn
  const timeout = opts.timeoutMs ?? 45_000
  const tail = (s: string) => s.slice(-2048)
  const spec = opts.version ? `${name}@${opts.version}` : name
  const base = {
    name,
    ...(opts.version ? { version: opts.version } : {}),
    opencodeVersion: opts.opencodeVersion ?? await ocVersion(env, urun).catch(() => 'unknown'),
    verifiedAt: new Date().toISOString(),
  }

  // parts routing: an entry with no 'plugin' part has no loadable artifact —
  // `plugin add` + serve would only produce a false 'failed'. Prove the
  // payload the client actually consumes (tarball → SKILL.md). (DEV §4.5)
  const parts = opts.parts ?? ['plugin']
  if (!parts.includes('plugin')) {
    const s = await checkSkillStructure(uh, urun, spec)
    return {
      ...base, status: s.ok ? 'verified' : 'failed', level: 'structure',
      ...(s.ok ? {} : { logExcerpt: tail(s.log ?? 'skill structure check failed') }),
    }
  }

  // install the PINNED spec (name@version) — the version users would get (DEV §4)
  try {
    await urun('opencode', ['plugin', 'add', spec], { env, timeout })
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    return {
      ...base, status: 'failed', level: 'install',
      // the sandbox's egress allowlist means a fetch failure here can be
      // network policy, not a broken package — say so in the published excerpt
      logExcerpt: tail(sb
        ? `${why}\n[sandboxed egress is allow-listed — an install fetch failure can be network policy, not a broken package]`
        : why),
    }
  }

  // activation: plugins load lazily on first API request, so: boot `serve` in
  // background, wait for its listening+password lines, POST a session to force
  // the load, then poll /api/plugin for the package entry. No provider needed;
  // `run`'s service machinery hangs in CI so it isn't used. The dummy provider
  // config is still written — the TUI check below needs it past first-run.
  if (sb) {
    const cfgPath = join(uh, '.config', 'opencode', 'opencode.json')
    const existing = await urun('cat', [cfgPath], { timeout: 10_000 }).then(r => r.stdout).catch(() => '')
    let cfg: Record<string, unknown> = {}
    try { cfg = JSON.parse(existing || '{}') } catch { /* treat as empty */ }
    const b64 = Buffer.from(JSON.stringify(dummyProviderConfig(cfg))).toString('base64')
    await urun('sh', ['-c',
      `mkdir -p ${shq(join(cfgPath, '..'))} && printf %s ${shq(b64)} | base64 -d > ${shq(cfgPath)}`], { timeout: 10_000 })
  } else {
    writeDummyProvider(uh)
  }
  // activation: `serve` loads plugin code → it stays under the sandbox uid.
  // Every byte the VERDICT depends on lives under runner-owned `home` — a
  // nobody-writable plugins.json was forgeable (pre-plant or interval-rewrite
  // between the last curl and our read), and a forged serve.out could redirect
  // PORT/PW to a plugin-controlled listener. That was V-1's remaining hole:
  // the apiLoaded canary is only trustworthy if the file it parses is outside
  // the plugin's uid. serve output is piped to THIS process instead.
  const spawnFn = opts.spawnFn ?? defaultSpawn
  let serveOut = ''
  let dead = false
  let proc: SpawnedLike | null = null
  try {
    proc = spawnFn(
      sb ? sb.wrapper : 'opencode',
      sb ? ['opencode', 'serve', '--port', '0'] : ['serve', '--port', '0'],
      { env: sb ? { PATH: env.PATH } : env, cwd: uh })
    const onData = (d: unknown) => { serveOut = (serveOut + String(d)).slice(-65_536) }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', () => { dead = true })
    proc.on('exit', () => { dead = true })
  } catch {
    dead = true   // spawn refused outright (bad cwd/argv) — no serve, no evidence
  }
  const apiPath = join(home, 'plugins.json')   // runner-owned — nobody can't write here
  try {
    let port = '', pw = ''
    for (const t0 = Date.now(); Date.now() - t0 < (opts.bootWaitMs ?? 15_000) && !dead;) {
      if (/server listening/.test(serveOut)) {
        port = /127\.0\.0\.1:(\d+)/.exec(serveOut)?.[1] ?? ''
        pw = (/server password ([^\r\n]+)/.exec(serveOut)?.[1] ?? '').trim()
        if (port) break
      }
      await sleep(250)
    }
    if (port) {
      const auth = ['-u', `opencode:${pw}`]
      const api = `http://127.0.0.1:${port}/api`
      // 2.2.5 loads plugins lazily on session CREATE — a GET alone never
      // triggers the load, so POST one (E2E rehearsal: GET-only left
      // /api/plugin empty)
      await run('curl', ['-s', ...auth, '-o', '/dev/null', `${api}/session`], { timeout: 15_000 }).catch(() => {})
      await run('curl', ['-s', ...auth, '-o', '/dev/null', '-X', 'POST',
        `${api}/session`, '-H', 'content-type: application/json', '-d', '{}'], { timeout: 15_000 }).catch(() => {})
      // poll the SERVER's plugin inventory — judged on the PARSED entry
      // (apiPluginState), not a name substring, so '"core-x"' can't early-exit
      // a 'core' target. ~20s window like before (V-4); the loop breaks as
      // soon as OUR entry lands in the listing — active OR terminal-failed —
      // so a deterministic load failure exits in ~1s.
      for (const t1 = Date.now(); Date.now() - t1 < (opts.apiWaitMs ?? 20_000);) {
        await run('curl', ['-s', ...auth, '-o', apiPath, `${api}/plugin`], { timeout: 15_000 }).catch(() => {})
        const body = existsSync(apiPath) ? readFileSync(apiPath, 'utf8') : ''
        if (apiPluginState(body, name) !== null) break
        await sleep(500)
      }
    }
  } finally {
    try { proc?.kill('SIGTERM') } catch { /* already gone */ }
    // the sudo chain can orphan the nobody-uid serve — sweep it (same-uid
    // pkill, can't touch runner processes)
    if (sb) await run('sudo', ['-n', '-u', sb.user, 'pkill', '-f', 'opencode serve'], { timeout: 10_000 }).catch(() => {})
  }
  // the nobody uid's files may be 700 — open them up for runner-side reads
  if (sb) await run('sudo', ['-n', 'chmod', '-R', 'a+rX', home], { timeout: 30_000 }).catch(() => {})
  const log = readLog(uh)
  const api = existsSync(apiPath) ? readFileSync(apiPath, 'utf8') : ''
  if (!apiLoaded(api, name)) {
    // why: deterministic (server moved the plugin to 'failed') vs timeout (the
    // entry never showed up) — the distinction surfaces in the published
    // logExcerpt so a flake is visibly different from a broken plugin (V-4)
    const why = apiFailed(api, name)
      ? 'serve reports the plugin failed to load'
      : 'plugin absent from /api/plugin after the load window'
    return { ...base, status: 'failed', level: 'load', logExcerpt: tail(`${why}\n${serveOut}\n${log}\n/api/plugin: ${api}`) }
  }

  // feature-routed depth checks (L2/L3a) — level records deepest stage passed
  const feats = opts.features ?? []
  let level: VerifyResult['level'] = 'load'

  if (feats.includes('tui')) {
    const { checkTui } = await import('./tui.ts')
    const tui = await checkTui(env, run, { ...opts.tuiOpts, ...(sb ? { command: `${sb.wrapper} opencode` } : {}) })
    if (!tui.ok) return { ...base, status: 'failed', level: 'interactive', logExcerpt: tail(tui.log ?? 'tui check failed') }
    level = 'interactive'
  }

  if (feats.includes('gui')) {
    const { checkGuiBundle, findGuiBundle } = await import('./gui.ts')
    const found = findGuiBundle(uh, name)
    if ('error' in found) {
      return { ...base, status: 'failed', level: 'render', logExcerpt: found.error }
    }
    let gui: { ok: boolean; stage?: string; error?: string }
    if (sb) {
      // evaluate the bundle OUTSIDE the shard process: a vm-realm escape then
      // lands on the nobody uid, which still cannot touch the results file
      const guiEntry = fileURLToPath(new URL('./gui.ts', import.meta.url))
      try {
        const { stdout } = await urun('npx', ['tsx', guiEntry, found.path],
          { cwd: process.cwd(), timeout: 90_000 })
        gui = JSON.parse(stdout.trim().split('\n').at(-1)!) as typeof gui
      } catch (e) {
        gui = { ok: false, stage: 'evaluate', error: `gui subprocess: ${String(e).slice(0, 500)}` }
      }
    } else {
      gui = await checkGuiBundle(found.src)
    }
    if (!gui.ok) {
      return { ...base, status: 'failed', level: 'render', logExcerpt: `gui ${gui.stage}: ${gui.error}` }
    }
    level = 'render'
  }

  // dual-nature (plugin + skill): the plugin half just proved itself — check
  // the skill payload too so 'verified' honestly covers both advertised parts
  if (parts.includes('skill')) {
    const s = await checkSkillStructure(uh, urun, spec)
    if (!s.ok) {
      return {
        ...base, status: 'failed', level,
        logExcerpt: tail(`plugin half passed (${level}); skill payload failed:\n${s.log}`),
      }
    }
  }

  return { ...base, status: 'verified', level }
}

export async function ocVersion(env: NodeJS.ProcessEnv, run: ExecFn): Promise<string> {
  const { stdout } = await run('opencode', ['--version'], { env, timeout: 15_000 })
  return stdout.trim().replace(/^opencode\s*v?/i, '') || 'unknown'
}

/** Shard driver: verify a slice of {name,version,features} targets, write results JSON. */
export async function verifyShard(targets: (VerifyTarget | string)[], outPath: string,
  opts: { execFn?: ExecFn; home?: string; timeoutMs?: number; sandboxUser?: string;
    spawnFn?: SpawnFn; opencodeVersion?: string; bootWaitMs?: number; apiWaitMs?: number;
    tuiOpts?: { settleMs?: number; cols?: number; rows?: number } } = {}): Promise<VerifyResult[]> {
  // one sudo probe per shard — if `sudo -n` is unavailable (local dev), degrade
  // to in-process verification rather than failing every target. verify.yml
  // hard-gates on the probe before this runs, so CI never hits the fallback.
  let sandboxUser = opts.sandboxUser
  if (sandboxUser) {
    const probe = opts.execFn ?? exec
    const ok = await probe('sudo', ['-n', '-u', sandboxUser, 'true'], { timeout: 10_000 })
      .then(() => true).catch(() => false)
    if (!ok) {
      console.warn(`sandbox user '${sandboxUser}' unavailable — running unconfined`)
      sandboxUser = undefined
    }
  }
  // Untrusted code runs inside this process (L3a gui bundles). A fire-and-forget
  // rejection (e.g. a bare `import()` the vm sandbox refuses) must not crash the
  // shard and take every result with it — Node's fatal-on-unhandled policy is
  // the wrong default for a sacrificial sandbox, so swallow with a log line.
  const onRej = (reason: unknown) => console.error('stray unhandled rejection (ignored):', reason)
  process.on('unhandledRejection', onRej)
  try {
    const results: VerifyResult[] = []
    mkdirSync(join(outPath, '..'), { recursive: true })
    // incremental flush — a hard crash (OOM/job timeout) mid-shard loses only
    // the in-flight target; merge collects whatever completed
    const flush = () => {
      const tmp = `${outPath}.tmp`
      writeFileSync(tmp, JSON.stringify(results, null, 2))
      renameSync(tmp, outPath)
    }
    const { sandboxUser: _raw, ...passOpts } = opts   // probe result wins, not the raw opt
    // one version probe per shard — the binary can't change between targets.
    // Runner-side on purpose: `opencode --version` executes no plugin code.
    const ocVer = passOpts.opencodeVersion ??
      await ocVersion({ PATH: process.env.PATH }, opts.execFn ?? exec).catch(() => 'unknown')
    for (const t of targets) {
      const target = coerceTarget(t)
      try {
        results.push(await verifyPackage(target.name, {
          ...passOpts,
          opencodeVersion: ocVer,
          ...(sandboxUser ? { sandboxUser } : {}),
          ...(target.version ? { version: target.version } : {}),
          ...(target.features ? { features: target.features } : {}),
          ...(target.parts ? { parts: target.parts } : {}),
        }))
      } catch (e) {
        // one bad target must not take the shard down — record it as failed
        results.push({
          name: target.name,
          ...(target.version ? { version: target.version } : {}),
          status: 'failed', level: 'install',
          opencodeVersion: 'unknown',
          verifiedAt: new Date().toISOString(),
          logExcerpt: `harness error: ${String(e).slice(0, 2000)}`,
        })
      }
      console.log(`verify ${target.name}@${target.version ?? 'latest'}: ${results.at(-1)!.status}`)
      flush()
    }
    return results
  } finally {
    process.off('unhandledRejection', onRej)
  }
}

/* v8 ignore next 11 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const namesFile = process.argv[2]!
  const out = process.argv[3]!
  const names: (VerifyTarget | string)[] = JSON.parse(readFileSync(namesFile, 'utf8'))
  verifyShard(names, out, {
    ...(process.env.VERIFY_SANDBOX_USER ? { sandboxUser: process.env.VERIFY_SANDBOX_USER } : {}),
  }).catch(e => { console.error(e); process.exit(1) })
}
