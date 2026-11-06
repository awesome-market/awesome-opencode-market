/** Install/activation verification (DEV §4). Runs in a permissions:{} CI job — never sees secrets.
 *  When `sandboxUser` is set (CI: VERIFY_SANDBOX_USER=nobody), every command that
 *  executes untrusted plugin code runs under that uid via `sudo -n -u` — the
 *  results file stays owned by the runner uid, so plugin code cannot forge its
 *  own 'verified' verdict (V-1). */
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, chmodSync,
  openSync, readSync, fstatSync, closeSync, rmSync } from 'node:fs'
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
  /** npm SRI or git commit sha of the bytes actually measured — merge compares
   *  it against the slot's pinned anchor (re-tag drift check) and reuses
   *  same-bytes results across version slots. Absent on legacy/unpinned runs. */
  integrity?: string
  status: 'verified' | 'failed'
  /** for `failed` = the stage that failed; for `verified` = the deepest stage
   *  that passed (feature-routed targets go past 'load'). `structure` is the
   *  payload check for entries with no plugin artifact — bytes install and
   *  the skill manifest parses, but no code ran. */
  level: 'install' | 'load' | 'interactive' | 'render' | 'structure'
  opencodeVersion: string
  verifiedAt: string
  logExcerpt?: string
  /** true when the shard THREW around the package check (sandbox setup, fs,
   *  spawn) rather than measuring the package — an infrastructure signal,
   *  not a verdict. merge drops these: writing them as 'failed' would burn
   *  retry budget and feed diagnose's verify-failed concern short-circuit
   *  on packages that were never actually tested (the 2025-11-04 incident:
   *  a sandbox perms bug recorded 48 innocent packages as install-failed). */
  harness?: boolean
}

/** Shard input unit (verify.yml plan emits these). Legacy string shards coerce. */
export interface VerifyTarget {
  name: string
  version?: string
  /** github-kind install path: `plugin add <repo>[#<sha>]` — sha is the commit
   *  the catalog pipeline scanned (source.version). Absent on npm targets. */
  git?: { repo: string; sha?: string }
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
  // tolerate a malformed existing config — the sandboxed path already treats
  // unparseable JSON as empty (a throw here would classify a broken config
  // file as a harness failure, inconsistently between the two paths)
  let cfg: Record<string, unknown> = {}
  if (existsSync(cfgPath)) {
    try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8') || '{}') } catch { /* rebuild from empty */ }
  }
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
 *  `names` accepts several candidates: git-installed plugins may report a
 *  target in an unknown shape (spec string, resolved URL, package name), so
 *  plan passes [fullName, basename] for github targets — basename collisions
 *  are harmless because a shard installs one plugin at a time.
 *  Returns the entry's server-reported state.status, or null when the package
 *  is absent from the listing. */
export function apiPluginState(pluginsJson: string, names: string | string[]): string | null {
  const cands = Array.isArray(names) ? names : [names]
  let doc: unknown
  try { doc = JSON.parse(pluginsJson) } catch { return null }
  let found = false
  let status: unknown
  const matches = (t: string): boolean =>
    cands.some(n => t === n || t.startsWith(`${n}@`) || t.startsWith(`${n}#`)
      || t.endsWith(`/${n}`) || t.includes(`/${n}/`))
  const walk = (v: unknown): void => {
    if (found || !v || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    const o = v as Record<string, unknown>
    const src = o.source as Record<string, unknown> | undefined
    const st = o.state as Record<string, unknown> | undefined
    if (src && typeof src === 'object' && src.type === 'package' && typeof src.target === 'string'
        && matches(src.target)) {
      found = true
      status = st?.status
    }
    for (const x of Object.values(o)) walk(x)
  }
  walk(doc)
  if (!found) return null
  return typeof status === 'string' ? status : 'unknown'
}

export function apiLoaded(pluginsJson: string, names: string | string[]): boolean {
  return apiPluginState(pluginsJson, names) === 'active'
}

/** Deterministic load failure: the server saw the plugin and moved it to a
 *  terminal 'failed' state — no point polling the rest of the window (V-4). */
export function apiFailed(pluginsJson: string, names: string | string[]): boolean {
  return apiPluginState(pluginsJson, names) === 'failed'
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

/** Kill leftover processes owned by the sandbox uid that carry THIS target's
 *  XDG_DATA_HOME in their environment — i.e. descendants of our own wrapper.
 *  Scoped matching is what makes intra-shard parallelism safe: two lanes run
 *  under the same nobody uid, so `pkill -u nobody` or `-f 'opencode serve'`
 *  would kill a sibling lane's in-flight serve. /proc is Linux-only; on other
 *  platforms fall back to the uid-wide sweep (macOS/local dev doesn't run the
 *  parallel CI lanes anyway). */
async function sweepSandboxProcs(run: ExecFn, user: string, uh: string): Promise<void> {
  if (!existsSync('/proc')) {
    await run('sudo', ['-n', '-u', user, 'pkill', '-f', 'opencode serve'], { timeout: 10_000 }).catch(() => {})
    return
  }
  const marker = `XDG_DATA_HOME=${join(uh, 'data')}`
  // environ files are 0400 owner-readable — running the scan AS the sandbox
  // uid reads exactly the processes it can kill; other users' are skipped.
  await run('sudo', ['-n', '-u', user, 'sh', '-c',
    'for e in /proc/[0-9]*/environ; do ' +
    `if grep -aqF ${shq(marker)} "$e" 2>/dev/null; then ` +
    'p=${e#/proc/}; kill -TERM "${p%/environ}" 2>/dev/null; fi; done'],
    { timeout: 15_000 }).catch(() => {})
}

/** Scan a package tarball's member list for a LOADABLE skill manifest.
 *  opencode admits any SKILL.md whose frontmatter parses — so the check does
 *  the same: a package may carry docs/SKILL.md beside the real
 *  skills/x/SKILL.md, and checking only the first tar member would let
 *  member ORDERING decide the verdict (a manifest-less file listed first
 *  failed a perfectly valid package). `stripPrefix` removes the archive's
 *  leading directory (npm: `package/`, codeload: `<repo>-<sha>/`). */
export async function checkSkillTgz(
  tgz: string, run: ExecFn, stripPrefix: RegExp, label: string,
): Promise<{ ok: boolean; log?: string }> {
  const list = await run('tar', ['tzf', tgz], { timeout: 30_000 })
  const skillEntries = list.stdout.split('\n').map(p => p.trim())
    .filter(p => /(^|\/)SKILL\.md$/.test(p.replace(stripPrefix, '')))
  if (!skillEntries.length) return { ok: false, log: `no SKILL.md in ${label} tarball` }
  // bound member probes: each candidate costs a full `tar xzf` pass, so a
  // hostile tarball stuffed with thousands of SKILL.md members could burn
  // the shard's whole time budget here. Any parseable manifest passes, so
  // a bounded prefix keeps the verdict semantics — it just stops the bleed.
  const MAX_SKILL_MEMBERS = 64
  const probe = skillEntries.slice(0, MAX_SKILL_MEMBERS)
  const rejected: string[] = []
  for (const entry of probe) {
    const body = (await run('tar', ['xzf', tgz, '-O', entry], { timeout: 30_000 })).stdout
    // tolerate a UTF-8 BOM and trailing spaces on the --- fences — real-world
    // SKILL.md files picked up both from Windows editors; neither changes
    // whether opencode can parse the manifest
    const fm = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/.exec(body)
    if (fm?.[1] && /^name:\s*\S/m.test(fm[1])) return { ok: true }
    rejected.push(entry)
  }
  return { ok: false, log: `no parseable SKILL.md frontmatter in ${label} ` +
    `(checked ${probe.length}${probe.length < skillEntries.length ? ` of ${skillEntries.length} — member list truncated at ${MAX_SKILL_MEMBERS}` : ''}: ${rejected.join(', ')})` }
}

/** npm-sourced skill check: `npm pack` of the pinned spec doubles as the
 *  download+integrity check (pacote validates dist.integrity on the way in).
 *  The same notion of "skill file" as the admission gate (hasSkillPath). */
export async function checkSkillStructure(
  home: string, run: ExecFn, spec: string,
): Promise<{ ok: boolean; log?: string }> {
  try {
    const pack = await run('npm', ['pack', spec, '--pack-destination', home], { timeout: 60_000 })
    const tgzName = pack.stdout.trim().split('\n').at(-1)!
    return await checkSkillTgz(join(home, tgzName), run, /^package\//, spec)
  } catch (e) {
    return { ok: false, log: String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(0, 2000) }
  }
}

/** github-kind equivalent: the codeload tarball of the reviewed commit.
 *  Listing/streaming members executes no repo code, so a hostile tarball can
 *  waste CPU but cannot run — the same exposure `npm pack`'s output gets. */
export async function checkSkillStructureGit(
  home: string, run: ExecFn, repo: string, sha: string | undefined,
): Promise<{ ok: boolean; log?: string }> {
  try {
    const tgz = join(home, 'repo.tar.gz')
    // same hardening as site/build's skill fetch: HTTPS-only redirect,
    // a byte cap (a repo tarball should never approach the 48MB client
    // install cap), bounded retries — -sfL alone would follow an http://
    // redirect and stream an unbounded body.
    await run('curl', ['-sfL', '--proto-redir', '=https', '--max-filesize', String(48 * 1024 * 1024),
      '--max-time', '60', '--retry', '2', '--retry-delay', '1',
      `https://codeload.github.com/${repo}/tar.gz/${sha ?? 'HEAD'}`, '-o', tgz],
      { timeout: 90_000 })
    return await checkSkillTgz(tgz, run, /^[^/]+\//, `${repo}${sha ? `#${sha}` : ''}`)
  } catch (e) {
    return { ok: false, log: String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(0, 2000) }
  }
}

/** Content identity of the bytes this run will install. npm targets ask the
 *  registry for the spec's current dist.integrity — a re-tag between catalog
 *  scan and verify shows up as a different SRI, which merge then flags as
 *  drift rather than rubber-stamping. git targets are pinned by commit sha
 *  already; the sha IS the measured identity. Failures degrade to undefined
 *  (merge skips the anchor compare) rather than blocking the install. */
async function measuredIntegrity(
  run: ExecFn, name: string, opts: { version?: string; git?: VerifyTarget['git'] },
): Promise<string | undefined> {
  if (opts.git) return opts.git.sha
  try {
    const { stdout } = await run('npm', ['view', `${name}@${opts.version ?? 'latest'}`, 'dist.integrity'], { timeout: 15_000 })
    return stdout.trim() || undefined
  } catch { return undefined }
}

export async function verifyPackage(
  name: string,
  opts: { version?: string; git?: VerifyTarget['git']; features?: string[]; parts?: string[]; home?: string; timeoutMs?: number; execFn?: ExecFn;
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
  // `env K=V` args because sudo strips the child env. Keys that collide with
  // the base env are OVERRIDES, not dropped — `env K=V cmd` semantics.
  const urun = ((cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    if (!sb) return run(cmd, args, { env, ...o })
    const { env: oe, ...rest } = o
    const extra = Object.entries((oe ?? {}) as Record<string, unknown>)
      .map(([k, v]) => `${k}=${v ?? ''}`)
    return run(sb.wrapper, ['env', ...extra, cmd, ...args], { env: { PATH: env.PATH }, ...rest })
  }) as ExecFn
  const timeout = opts.timeoutMs ?? 45_000
  const tail = (s: string) => s.slice(-2048)
  // installable spec: npm name@version, or github owner/repo#sha — the sha is
  // the commit the catalog pipeline scanned, so verify exercises the REVIEWED
  // bytes rather than whatever HEAD has drifted to (a bare owner/repo install
  // could pass code the scan never saw)
  const spec = opts.git
    ? (opts.git.sha ? `${opts.git.repo}#${opts.git.sha}` : opts.git.repo)
    : (opts.version ? `${name}@${opts.version}` : name)
  // the bytes this run measures — the anchor merge drift-checks and
  // content-addressed reuse key on. npm: the registry's CURRENT SRI for the
  // pinned spec (moves when the tag does). git: the pinned commit itself.
  // Routed through urun so the sandbox invariant "every non-runner command
  // goes through sb.sh" stays true — npm view is metadata-only either way.
  const integrity = await measuredIntegrity(urun, name, opts)
  // /api/plugin reports targets in an install-spec-dependent shape; git
  // installs get the repo spec, its basename, and lowercase variants as
  // extra candidates so 'O/R#sha', 'o/r#sha', resolved URLs, and tarball-
  // derived names all match (one plugin is installed at a time, so loose
  // candidates can't misattribute). GitHub names are case-insensitive —
  // opencode may normalize either direction.
  const repoBase = opts.git?.repo.split('/').pop()!   // split() always yields ≥1 element
  const apiNames: string[] = opts.git
    ? [name, opts.git.repo, repoBase, opts.git.repo.toLowerCase(), repoBase.toLowerCase()]
      .filter((v, i, a) => a.indexOf(v) === i)
    : [name]
  const base = {
    name,
    ...(opts.version ? { version: opts.version } : {}),
    ...(integrity ? { integrity } : {}),
    opencodeVersion: opts.opencodeVersion ?? await ocVersion(env, urun).catch(() => 'unknown'),
    verifiedAt: new Date().toISOString(),
  }

  // parts routing: an entry with no 'plugin' part has no loadable artifact —
  // `plugin add` + serve would only produce a false 'failed'. Prove the
  // payload the client actually consumes (tarball → SKILL.md). (DEV §4.5)
  const parts = opts.parts ?? ['plugin']
  if (!parts.includes('plugin')) {
    const s = opts.git
      ? await checkSkillStructureGit(uh, urun, opts.git.repo, opts.git.sha)
      : await checkSkillStructure(uh, urun, spec)
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
  // last parsed /api/plugin entry state for OUR candidates — feeds the
  // failure message below (a non-terminal end-state isn't 'absent')
  let apiState: string | null = null
  try {
    let port = '', pw = ''
    // SECURITY ASSUMPTION: the listening+password markers are scraped from
    // serve's own stdout/stderr — trusted only because opencode 2.2.5 loads
    // plugins lazily (no plugin code has run when these lines print). If a
    // future version loads eagerly at boot, plugin output could print a fake
    // "server listening" line pointing at a plugin-owned socket; re-audit
    // this extraction on host upgrades (or switch to a runner-side probe).
    for (const t0 = Date.now(); Date.now() - t0 < (opts.bootWaitMs ?? 15_000) && !dead;) {
      if (/server listening/.test(serveOut)) {
        port = /127\.0\.0\.1:(\d+)/.exec(serveOut)?.[1] ?? ''
        pw = (/server password ([^\r\n]+)/.exec(serveOut)?.[1] ?? '').trim()
        if (port) break
      }
      await sleep(250)
    }
    if (!port) {
      // serve never announced a listener — under 2.2.5's lazy load the plugin
      // code hasn't run at boot, so the package itself can't be the reason
      // the server stayed down: this is harness breakage (runner resources,
      // upstream output drift) and must not be written as a package 'failed'.
      // A thrown error lands in the shard's harness:true lane — merge drops
      // it and diagnose never sees a concern-worthy package verdict.
      throw new Error(`serve did not announce a listener within ${opts.bootWaitMs ?? 15_000}ms` +
        `${dead ? ' (process exited)' : ''}:\n${tail(serveOut)}`)
    }
    {
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
      // a 'core' target. ~20s window like before (V-4); the loop breaks only
      // on a TERMINAL entry state — an intermediate listing state (loading/
      // idle, if a host version reports one) is not a verdict, keep polling.
      // A deterministic load failure still exits in ~1s.
      let lastHttp = ''
      for (const t1 = Date.now(); Date.now() - t1 < (opts.apiWaitMs ?? 20_000);) {
        const res = await run('curl', ['-s', ...auth, '-o', apiPath, '-w', '%{http_code}',
          `${api}/plugin`], { timeout: 15_000 }).catch(() => null)
        if (res?.stdout) lastHttp = res.stdout.trim()
        const body = existsSync(apiPath) ? readFileSync(apiPath, 'utf8') : ''
        const st = apiPluginState(body, apiNames)
        if (st !== null) apiState = st
        if (st === 'active' || st === 'failed') break
        await sleep(500)
      }
      if (apiState === null && (lastHttp === '401' || lastHttp === '403')) {
        // the entry never listed AND the API kept refusing auth — the
        // credentials we scraped are unusable (upstream serve output/auth
        // drift). A package can't 401 the server it runs inside; this is a
        // harness breakage signal, not a 'plugin absent' package verdict.
        throw new Error(`serve API answered ${lastHttp} on every poll — ` +
          `${pw ? 'a password line was scraped but the server rejects it' : 'no password line was scraped'}` +
          ` (upstream output/auth drift, not a package failure):\n${tail(serveOut)}`)
      }
    }
  } finally {
    try { proc?.kill('SIGTERM') } catch { /* already gone */ }
    // the sudo chain can orphan the nobody-uid serve — sweep it. Scoped to
    // THIS target's untrusted home (marker in /proc/<pid>/environ): parallel
    // lanes run under the same nobody uid, so a blanket `pkill -u` or `-f`
    // would murder a sibling lane's mid-flight serve.
    if (sb) await sweepSandboxProcs(run, sb.user, uh)
  }
  // the nobody uid's files may be 700 — open them up for runner-side reads
  if (sb) await run('sudo', ['-n', 'chmod', '-R', 'a+rX', home], { timeout: 30_000 }).catch(() => {})
  const log = readLog(uh)
  const api = existsSync(apiPath) ? readFileSync(apiPath, 'utf8') : ''
  if (!apiLoaded(api, apiNames)) {
    // why: deterministic (server moved the plugin to 'failed') vs a stuck
    // non-terminal state vs the entry never listing at all — the distinction
    // surfaces in the published logExcerpt so a flake is visibly different
    // from a broken plugin (V-4)
    const why = apiFailed(api, apiNames)
      ? 'serve reports the plugin failed to load'
      : apiState !== null
        ? `plugin entry stuck in non-terminal state '${apiState}' after the load window`
        : 'plugin absent from /api/plugin after the load window'
    return { ...base, status: 'failed', level: 'load', logExcerpt: tail(`${why}\n${serveOut}\n${log}\n/api/plugin: ${api}`) }
  }

  try {
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
      // git installs cache under git-<slug>-<hash>, not name@version — pass
      // the spec so the finder can compute that dir
      const found = findGuiBundle(uh, name, opts.git ? spec : undefined)
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
      const s = opts.git
        ? await checkSkillStructureGit(uh, urun, opts.git.repo, opts.git.sha)
        : await checkSkillStructure(uh, urun, spec)
      if (!s.ok) {
        return {
          ...base, status: 'failed', level,
          logExcerpt: tail(`plugin half passed (${level}); skill payload failed:\n${s.log}`),
        }
      }
    }

    return { ...base, status: 'verified', level }
  } finally {
    // L2's tmux session can outlive a wedged TUI check (kill-session is
    // best-effort in tui.ts) — one more scoped sweep catches any nobody-uid
    // leftover before the next target reuses this lane.
    if (sb) await sweepSandboxProcs(run, sb.user, uh)
  }
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
    } else {
      // deep probe: `sudo -u nobody true` succeeding does NOT prove the
      // chown/mkdir/write chain works — the 2025-11-04 incident was exactly
      // that gap (runner-owned 0711 home → nobody EACCES → 48 packages
      // recorded install-failed in ~30s). Rehearse setupSandbox on a
      // throwaway home and prove the sandbox uid can actually write inside
      // uh. Failure here is INFRASTRUCTURE — fail the shard loudly rather
      // than degrade to unconfined execution of untrusted plugin code.
      const ph = mkdtempSync(join(tmpdir(), 'sbprobe-'))
      try {
        await setupSandbox(ph, sandboxUser, probe)
        await probe('sudo', ['-n', '-u', sandboxUser, 'touch', join(ph, 'u', '.probe')],
          { timeout: 10_000 })
      } finally {
        // cleanup is best-effort: `u` was chowned to the sandbox uid, so a
        // runner without group-write on it (umask 022, self-hosted) gets
        // EACCES unlinking nobody's .probe — and a successful probe would
        // fail the shard on cleanup alone. The probe dir lives under /tmp;
        // a leftover is harmless.
        try { rmSync(ph, { recursive: true, force: true }) } catch { /* leave it */ }
      }
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
    // consecutive-throw circuit breaker: verifyPackage RETURNS 'failed' for
    // package problems — a throw means the harness itself broke (fs, sudo,
    // spawn). Three in a row is an outage, not three bad packages: stop
    // burning the remaining targets; they stay unverified for the next run.
    let harnessStreak = 0
    // two lanes, each target in its own runner-owned home+sandbox uid subtree.
    // Isolation points: uh is per-target (mkdtemp), the process sweep is
    // marker-scoped (sweepSandboxProcs), and results/flush are shared in-
    // process state on one event loop — no locks needed. ~2× throughput;
    // serve ports are ephemeral (--port 0) so lanes never collide on a port.
    const LANES = 2
    let cursor = 0
    let aborted = false
    const lane = async (): Promise<void> => {
      for (;;) {
        if (aborted || harnessStreak >= 3) return
        const i = cursor++
        if (i >= targets.length) return
        const target = coerceTarget(targets[i]!)
        try {
          results.push(await verifyPackage(target.name, {
            ...passOpts,
            opencodeVersion: ocVer,
            ...(sandboxUser ? { sandboxUser } : {}),
            ...(target.version ? { version: target.version } : {}),
            ...(target.git ? { git: target.git } : {}),
            ...(target.features ? { features: target.features } : {}),
            ...(target.parts ? { parts: target.parts } : {}),
          }))
          harnessStreak = 0
        } catch (e) {
          harnessStreak++
          // one bad target must not take the shard down — record it, but flag
          // it as a harness error so merge drops it instead of writing a false
          // package 'failed' (burns retries + feeds the diagnose concern
          // short-circuit on packages never actually tested)
          results.push({
            name: target.name,
            ...(target.version ? { version: target.version } : {}),
            status: 'failed', level: 'install',
            opencodeVersion: 'unknown',
            verifiedAt: new Date().toISOString(),
            logExcerpt: `harness error: ${String(e).slice(0, 2000)}`,
            harness: true,
          })
        }
        const r = results.at(-1)!
        console.log(`verify ${target.name}@${target.version ?? target.git?.sha?.slice(0, 12) ?? 'latest'}: ${r.status}`)
        flush()
        if (harnessStreak >= 3 && !aborted) {
          aborted = true
          console.error(`harness failure streak (${harnessStreak} consecutive throws) — aborting shard; ` +
            `${targets.length - results.length} targets left unverified for the next run`)
          return
        }
      }
    }
    await Promise.all(Array.from({ length: LANES }, lane))
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
