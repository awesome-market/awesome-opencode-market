/** Shared host-side hardening helpers. Every node access is a lazy dynamic
 *  import so the webview bundle (gui.cjs, platform 'browser') can import this
 *  module safely — requires only run when a host-side function is called. */
import { cleanSpec } from './spec.js'

/** npm package name: first char alnum/_ (never '-' → argv-flag, never '.' →
 *  traversal), charset limited to what npm accepts. Scoped = `@seg/name`. */
const NAME_RE = /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9_][a-zA-Z0-9._-]*$/
const VER_RE = /^[A-Za-z0-9._+~-]+$/

export function assertPkgName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..'))
    throw new Error(`invalid package name: ${String(name).slice(0, 80)}`)
}

/** github repo id — `owner/repo`, same single-segment charset as npm names. */
const REPO_RE = /^[\w.-]+\/[\w.-]+$/

/** Catalog entry id accepted by the skill install path — an npm package name
 *  OR a github `owner/repo` (repo skills ship via codeload). `..` rejected up
 *  front; the basename check in assertSkillId does the rest. */
export function assertEntryId(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.includes('..'))
    throw new Error(`invalid entry id: ${String(name).slice(0, 80)}`)
  if (!NAME_RE.test(name) && !REPO_RE.test(name))
    throw new Error(`invalid entry id: ${name.slice(0, 80)}`)
}

/** install/update spec must be exactly `name` or `name@version` for THIS
 *  package — blocks spec/name mismatch (acting on another plugin), flag
 *  injection (`--registry=`), and non-semver versions. Absent spec = name. */
export function assertSpecForName(name: string, spec: unknown): void {
  // github-kind catalog entries are named `owner/repo` — the npm-only
  // NAME_RE would reject every git install spec at this gate. Entry-id
  // covers both shapes (npm name OR owner/repo); the same `..`/charset
  // guards apply.
  assertEntryId(name)
  if (spec === undefined || spec === null || spec === '') return
  if (typeof spec !== 'string') throw new Error('spec does not match package name')
  const clean = cleanSpec(spec)
  // repo-shaped ids compare case-insensitively — catalog `name` keeps a
  // repo's display case while `source.repo` tracks canonical casing (a
  // case-only rename must not fail the identity check; github resolves
  // owner/repo case-insensitively anyway). npm names stay exact.
  const sameId = REPO_RE.test(name) ? clean.toLowerCase() === name.toLowerCase() : clean === name
  if (!sameId)
    throw new Error('spec does not match package name')
  // an '@' demands a non-empty safe version — 'name@' must not read as
  // 'name' (npm resolves a trailing-empty spec to the unapproved latest)
  if (spec[name.length] === '@' && !VER_RE.test(spec.slice(name.length + 1)))
    throw new Error(`invalid version in spec: ${spec.slice(name.length + 1, name.length + 81)}`)
}

/** Uninstall targets are broader than install ids: catalog names (npm or
 *  owner/repo) AND the raw spec strings opencode records in plugins[] —
 *  https/git/ssh urls, git+ forms, scp syntax (git@host:path), github:
 *  shorthand, local ids. Values are only string-compared against config
 *  entries (never argv, never a path), but kept tight anyway: no
 *  whitespace/control chars, bounded length. */
const UNINSTALL_RE = /^(?:@[\w.-]+\/)?[\w][\w.-]*$|^[\w.-]+\/[\w.-]+$|^(?:https?|ssh|git):\/\/\S+$|^git\+(?:https?|ssh|git):\/\/\S+$|^[\w.-]+@[\w.-]+:[\w./~-]+$|^github:[\w.-]+\/[\w.-]+$/
export function assertUninstallRef(name: unknown): asserts name is string {
  // '/./' '/../' segment guard — [\w.-]+ alone lets '..' through as a "repo"
  if (typeof name !== 'string' || name.length > 500 || /[\x00-\x1f\x7f\s]/.test(name)
    || /(^|\/)\.\.?(\/|$)/.test(name) || !UNINSTALL_RE.test(name))
    throw new Error(`invalid uninstall target: ${String(name).slice(0, 80)}`)
}

/** Namespaced skill dir id — used only when the basename already belongs to a
 *  different package (`@a/test` vs `@b/test` both want `test`). Encoding keeps
 *  a single safe path segment: `@a/test`→`a--test`, `a/test`→`a--test`,
 *  `test`→`test`. */
export function skillId(name: string): string {
  return name.replace(/^@/, '').replace(/\//g, '--')
}

/** Skill dir basename — single safe path segment, validated. Accepts github
 *  `owner/repo` ids too (basename `repo`; namespaced `owner--repo` on collision). */
export function assertSkillId(name: string): string {
  assertEntryId(name)
  const id = name.split('/').pop() ?? ''
  if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) throw new Error(`invalid skill id from ${name}`)
  return id
}

/** Read a JSON object config file — missing → {}; array/scalar/malformed → throw. */
export async function readJson(path: string): Promise<Record<string, unknown>> {
  const { existsSync, readFileSync } = await import('node:fs')
  if (!existsSync(path)) return {}
  const d = JSON.parse(readFileSync(path, 'utf8') || '{}')
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new Error('config is not an object')
  return d as Record<string, unknown>
}

/** `d[field]` must be string[] when present — a malformed non-array value
 *  throws instead of being silently replaced with []. */
export function strArrayField(d: Record<string, unknown>, field: string): string[] {
  const v = d[field]
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new Error(`malformed config: ${field} is not an array`)
  return v.filter((x): x is string => typeof x === 'string')
}

/** tmp-file + rename — a crash mid-write can't truncate the user's config. */
export async function writeJsonAtomic(path: string, obj: unknown): Promise<void> {
  const { writeFileSync, renameSync, mkdirSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(obj, null, 2))
  renameSync(tmp, path)
}

/** Per-user debug log — under the opencode config dir (not a predictable
 *  world-writable /tmp path), rotated at 256KB into a single .old file. */
export async function marketLogPath(): Promise<string> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'opencode', 'market.log')
}

/** Resolve the user's opencode config — `OPENCODE_CONFIG` first (the CLI's own
 *  override), then `XDG_CONFIG_HOME`, then `~/.config`. Spawned `opencode`
 *  commands inherit these vars via restrictedEnv, so direct read-modify-writes
 *  and CLI writes land in the SAME file. */
export async function configPath(): Promise<string> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  if (process.env.OPENCODE_CONFIG) return process.env.OPENCODE_CONFIG
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'opencode', 'opencode.json')
}

/** Serialize config mutations — every opencode.json write is a
 *  read-modify-write, and two concurrent RMWs silently lose whichever
 *  write lands first (update vs uninstall vs skillSource vs permission
 *  toggle, plus the spawned `plugin add` that also writes the file).
 *  A process-wide promise queue is enough: cross-PROCESS races (the
 *  opencode CLI itself, another plugin host) can't see this lock, but
 *  our own writers were the observed data-loss source. */
let configQueue: Promise<void> = Promise.resolve()
export function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = configQueue.then(fn)
  // keep the chain alive past fn's rejection — one failed write must not
  // wedge every later caller behind an already-rejected promise
  configQueue = p.then(() => undefined, () => undefined)
  return p
}

/** Overlay config-pinned versions onto a plugin.list-derived inventory map.
 *  plugin.list reports the RUNNING daemon's loaded version — after a pinned
 *  update the config says `name@new` while the daemon still reports the old
 *  bytes until restart (a "done" update then reads as not-updated, and the
 *  outdated badge resurrects on the next pull). The pin is what the next
 *  start runs, so it wins for entries the daemon actually reports; bare
 *  `name` specs keep the daemon's resolved version (no pin to claim).
 *  Missing names are NOT added — a plugin absent from plugin.list failed to
 *  load; config alone can't claim "installed". */
export async function overlayConfigPins(map: Record<string, string>): Promise<void> {
  try {
    const d = await readJson(await configPath())
    for (const s of strArrayField(d, 'plugins')) {
      const at = s.lastIndexOf('@')
      if (at <= 0) {
        // git spec: owner/repo#<sha> — the pinned commit IS the installed
        // marker (verMarker for github-kind = source.version, same value).
        // Bare 'owner/repo' resolves mutable HEAD — 'local', not a version.
        const hash = s.lastIndexOf('#')
        if (hash > 0) {
          const ref = s.slice(hash + 1)
          if (/^[0-9a-f]{7,64}$/.test(ref)) {
            const name = cleanSpec(s)
            if (map[name] !== undefined) map[name] = ref
          }
        }
        continue                                   // bare name / local path / non-npm ref
      }
      const ver = s.slice(at + 1)
      if (!VER_RE.test(ver)) continue             // git@host:path etc — not a version
      const name = cleanSpec(s)
      if (map[name] !== undefined) map[name] = ver
    }
  } catch { /* config unreadable — the daemon's versions stand */ }
}

/** Skills dir under the same config root as configPath() — when the CLI
 *  runs with OPENCODE_CONFIG pointing at a custom file, its skills live
 *  next to THAT file, not under the default ~/.config root. */
export async function skillsRoot(): Promise<string> {
  const { homedir } = await import('node:os')
  const { join, dirname } = await import('node:path')
  if (process.env.OPENCODE_CONFIG) return join(dirname(process.env.OPENCODE_CONFIG), 'skills')
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'opencode', 'skills')
}

/** Skill permission `{action:'skill', resource:id, effect}` in opencode.json —
 *  shared by GUI main and TUI. mode null removes the entry (back to default). */
export async function writeSkillPermission(
  cfgPath: string, id: string, mode: 'allow' | 'deny' | 'ask' | null,
): Promise<Record<string, string>> {
  if (typeof id !== 'string' || !id || id.length > 200 || /[\\/]/.test(id))
    throw new Error('invalid skill id')
  if (mode !== 'allow' && mode !== 'deny' && mode !== 'ask' && mode !== null)
    throw new Error('invalid permission mode')
  const d = await readJson(cfgPath)
  const raw = d.permissions
  // a non-array permissions value is a schema we don't own — refuse to
  // clobber it, and keep malformed entries in place (dropping them would
  // silently revoke grants we can't even model)
  if (raw != null && !Array.isArray(raw))
    throw new Error('unsupported permissions shape in opencode.json — expected an array')
  const perms = (raw ?? []) as unknown[]
  const rest = perms.filter(r =>
    !(!!r && typeof r === 'object' &&
      (r as { action?: unknown }).action === 'skill' &&
      (r as { resource?: unknown }).resource === id))
  if (mode) rest.push({ action: 'skill', resource: id, effect: mode })
  d.permissions = rest
  await writeJsonAtomic(cfgPath, d)
  return Object.fromEntries(
    (rest as Array<{ action?: unknown; resource?: unknown; effect?: unknown }>)
      .filter(r => !!r && typeof r === 'object' && r.action === 'skill' &&
        typeof r.resource === 'string' && typeof r.effect === 'string')
      .map(r => [r.resource as string, r.effect as string]))
}

const LOG_MAX = 256 * 1024
export async function appendBounded(path: string, line: string): Promise<void> {
  const fs = await import('node:fs')
  const { dirname } = await import('node:path')
  try {
    mkdirSyncSafe(fs, dirname(path))
    if (fs.existsSync(path) && fs.statSync(path).size > LOG_MAX) fs.renameSync(path, `${path}.old`)
    fs.appendFileSync(path, line)
  } catch { /* logging must never break the action it describes */ }
}
function mkdirSyncSafe(fs: typeof import('node:fs'), dir: string): void {
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* exists */ }
}

/** Minimal env for spawning processes that load untrusted plugin code — a
 *  raw process.env spread leaks ambient CI/agent tokens (ACTIONS_*,
 *  *_TOKEN, *_KEY, GH_TOKEN) into code that can write them to its own log.
 *  OPENCODE_* stays: those are the user's own config overrides.
 *  XDG_* and *_PROXY are forwarded — routing/config-location vars that keep
 *  spawned `opencode` commands writing to the same files configPath() reads;
 *  secret credentials still stay out. */
export function restrictedEnv(over: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
    'SystemRoot', 'COMSPEC', 'PATHEXT'])
    if (process.env[k]) out[k] = process.env[k] as string
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('OPENCODE_')) { out[k] = v as string; continue }
    // npm client config via env (private registry, custom cert dirs…) must
    // reach spawned `plugin add` or it silently resolves against public npm —
    // but credential-bearing keys (_authToken, *_TOKEN, *_KEY, …) stay out
    if (/^(?:NPM_CONFIG_|npm_config_)/.test(k) && !/(?:TOKEN|KEY|SECRET|PASS|CREDENTIAL|AUTH)/i.test(k)) out[k] = v as string
  }
  return { ...out, ...over }
}

/** The `loading plugin` canary matcher — same family as pipeline/verify's
 *  loadedSignal: the quoted msg form `loading plugin" id=` AND the bare
 *  `loading plugin id=` variant both count as activation evidence (the old
 *  `plugin."?\s+id=` needed whitespace after an optional quote, so the
 *  unquoted form never matched → false 'not-loaded' verdicts). Exported
 *  for tests — the name is regex-escaped. */
export function pluginLoadRe(name: string): RegExp {
  // trailing boundary: 'id=my-plugin-extra' must not satisfy a probe for
  // 'my-plugin' — the id field ends at whitespace/EOL in logfmt output
  return new RegExp(`loading plugin"?\\s+id=${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s)`)
}

/** Activation probe: spawn `opencode serve` against a throwaway HOME whose
 *  opencode.json lists ONLY the installed spec, create a session (2.2.5
 *  loads plugins lazily on session CREATE — a bare serve never triggers
 *  the load), then grep the daemon log for the plugin id. Shared by GUI
 *  main and TUI. The env pins OPENCODE_CONFIG to the sandbox file:
 *  restrictedEnv forwards every OPENCODE_* var, and the user's own
 *  OPENCODE_CONFIG would make the probe read their REAL config — a false
 *  `activated` when it already carries the plugin, a permanent
 *  `not-loaded` when it doesn't. */
export function probeActivation(name: string, spec: string): Promise<'activated' | 'not-loaded' | 'unknown'> {
  return new Promise(resolve => {
    void (async () => {
      const { execFile } = await import('node:child_process')
      const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } = await import('node:fs')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const home = mkdtempSync(join(tmpdir(), 'ocm-verify-'))
      mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
      writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ plugins: [spec] }))
      // HOME override is load-bearing on macOS: XDG_* alone leaves opencode
      // resolving config/state via the real ~ — the canary would read the
      // user's real config (false activated if the plugin is already in it,
      // permanent not-loaded otherwise). OPENCODE_CONFIG is pinned to the
      // sandbox file for the same reason: restrictedEnv forwards it, and the
      // user's own value would override the sandbox HOME outright.
      const env = restrictedEnv({
        HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
        XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'),
        OPENCODE_CONFIG: join(home, '.config', 'opencode', 'opencode.json'),
      })
      const boot = `opencode serve --port 0 > serve.out 2>&1 & SPID=$!; for i in $(seq 1 20); do grep -q "server listening" serve.out 2>/dev/null && break; sleep 0.5; done; PORT=$(sed -n 's/.*127.0.0.1:\\([0-9]*\\).*/\\1/p' serve.out | head -1); PW=$(sed -n 's/server password //p' serve.out | head -1); [ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null -X POST "http://127.0.0.1:$PORT/api/session" -H 'content-type: application/json' -d '{}'; for i in $(seq 1 16); do grep -q "loading plugin" "$LOG" 2>/dev/null && break; sleep 0.5; done; kill $SPID 2>/dev/null; true`
      const logEnv = { ...env, LOG: join(home, 'data', 'opencode', 'log', 'opencode.log') }
      execFile('sh', ['-c', boot], { env: logEnv, cwd: home, timeout: 25_000 }, (err) => {
        const log = join(home, 'data', 'opencode', 'log', 'opencode.log')
        // every probe leaves a temp home (serve.out + config + logs) —
        // clean it on ALL paths or each install leaks a tmpdir forever
        const finish = (v: 'activated' | 'not-loaded' | 'unknown') => {
          try { rmSync(home, { recursive: true, force: true }) } catch { /* best effort */ }
          resolve(v)
        }
        // 'unknown' when the probe itself couldn't run (no sh on Windows,
        // serve never wrote a log) — callers must not dress uncertainty up
        // as a confident not-loaded diagnosis
        if (err || !existsSync(log)) return finish('unknown')
        // same canary family as pipeline/verify's loadedSignal — see
        // pluginLoadRe for the quoted/unquoted variants it must match
        const ok = pluginLoadRe(name).test(readFileSync(log, 'utf8'))
        finish(ok ? 'activated' : 'not-loaded')
      })
    })().catch(() => resolve('unknown'))
  })
}
