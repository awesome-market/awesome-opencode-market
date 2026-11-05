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
  assertPkgName(name)
  if (spec === undefined || spec === null || spec === '') return
  if (typeof spec !== 'string' || cleanSpec(spec) !== name)
    throw new Error('spec does not match package name')
  const v = spec.slice(name.length + 1)
  if (v && !VER_RE.test(v)) throw new Error(`invalid version in spec: ${v.slice(0, 80)}`)
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
  return join(homedir(), '.config', 'opencode', 'market.log')
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
 *  OPENCODE_* stays: those are the user's own config overrides. */
export function restrictedEnv(over: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'TERM', 'TMPDIR', 'TMP', 'TEMP', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
    'SystemRoot', 'COMSPEC', 'PATHEXT'])
    if (process.env[k]) out[k] = process.env[k] as string
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('OPENCODE_')) out[k] = v as string
  return { ...out, ...over }
}
