/** commit-range delta evidence — shared by the docket flag-issue renderer
 *  (pipeline/docket.ts) and the local drift reviewer (pipeline/ai/flag-delta.ts).
 *  Both need the same three things from GitHub's compare API: the commit
 *  list (subjects are the cheapest human signal), per-file stats, and a
 *  mechanical risky/trivial classification — kept here so the two surfaces
 *  can never disagree about what "risky" means.
 *
 *  Everything in a compare payload is UNTRUSTED repo content: commit
 *  messages and patches are rendered into the maintainer's decision
 *  surface, so callers must clean()/bound them exactly like verdict
 *  reasons. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface DeltaCommit { sha: string; msg: string }
export interface DeltaFile {
  path: string
  status: string           // added|modified|removed|renamed|...
  add: number
  del: number
  /** unified diff for this file — GitHub omits it on large files */
  patch?: string
}
export interface DeltaCompare {
  aheadBy: number
  commits: DeltaCommit[]
  files: DeltaFile[]
  /** totals from the API — files/commits arrays are display-capped, these
   *  are the real counts */
  filesTotal: number
  commitsTotal: number
  additions: number
  deletions: number
  /** true when the API payload itself was partial (files>cap fetched or
   *  commits truncated by GitHub) — callers must say "没看全" not imply full */
  truncated: boolean
}

/** file-level risk markers for a drift delta. Conservative on purpose:
 *  package.json/lockfiles/workflows can carry dependency or CI supply-chain
 *  changes; lifecycle-script basenames run at install; binary blobs and
 *  credential-ish paths are never routine. */
const RISKY_FILE_RE = new RegExp([
  '(?:^|/)package\\.json$',
  '(?:^|/)(?:package-lock\\.json|npm-shrinkwrap\\.json|pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?)$',
  '(?:^|/)\\.npmrc$',
  '(?:^|/)\\.github/workflows/',
  '(?:^|/)opencode\\.jsonc?$',
  '(?:^|/)(?:preinstall|postinstall|install)\\.(?:js|cjs|mjs|ts)$',
  '(?:^|/)scripts?/(?:install|setup|postinstall|preinstall)',
  '(?:^|/)(?:setup|install|bootstrap)\\.(?:sh|bash|zsh|js|ts|mjs|cjs)$',
  '(?:^|/)bin/',
  '\\.env(?:\\.|$)',
  '(?:credential|secret|token|\\.pem$|\\.key$|id_rsa)',
  '\\.(?:node|wasm|exe|dll|so|dylib|bin|dat|pack)$',
].join('|'), 'i')

export const isRiskyDeltaPath = (p: string): boolean => RISKY_FILE_RE.test(p)

/** whole-delta "trivially safe" test — EVERY changed file must look like
 *  docs/assets AND none may sit under a code-bearing directory. Markdown is
 *  only inert at the root/docs level: a skills/ or plugin/ .md IS functional
 *  content for an agent marketplace (it gets read as instructions), so
 *  code-bearing dirs veto triviality even for .md files. */
const TRIVIAL_PATH_RE = /^(?:README|CHANGELOG|HISTORY|LICENSE|NOTICE|CHANGELOG-|docs?\/|assets?\/|images?\/|locales?\/|\.github\/(?:ISSUE|PULL)_TEMPLATE)/i
const TRIVIAL_EXT_RE = /\.(?:md|markdown|rst|adoc|txt|png|jpe?g|gif|svg|webp|ico|pdf|mp3|wav|mp4|mov|woff2?)$/i
const CODE_DIR_RE = /(?:^|\/)(?:skills?|plugins?|commands?|agents?|hooks?|mcp|scripts?|bin|workflows?|actions?|tools?|src|lib|test|tests?)\//i

export const isTrivialDeltaPath = (p: string): boolean =>
  !CODE_DIR_RE.test(p) && (TRIVIAL_PATH_RE.test(p) || TRIVIAL_EXT_RE.test(p))

export interface DeltaClass {
  /** every changed file passed isTrivialDeltaPath — mechanical "no
   *  executable surface touched" signal, NOT a safety proof */
  trivial: boolean
  riskyFiles: string[]
}
export function classifyDelta(files: DeltaFile[]): DeltaClass {
  const risky = new Set(files.filter(f => isRiskyDeltaPath(f.path)).map(f => f.path))
  return {
    // risky veto is explicit: a path can look docs-shaped AND match a risky
    // pattern (assets/setup.sh) — trivial must mean "no executable surface",
    // not merely "no code directory"
    trivial: files.length > 0 && files.every(f => isTrivialDeltaPath(f.path) && !risky.has(f.path)),
    riskyFiles: [...risky],
  }
}

/** GitHub compare API payload → bounded DeltaCompare. Commits/files are
 *  display-capped (commits 20 / files 60) while totals stay real; `truncated`
 *  also flips when GitHub itself omitted per-file patches at scale. */
export function parseCompare(raw: unknown, caps: { commits?: number; files?: number } = {}): DeltaCompare | null {
  const c = raw as {
    ahead_by?: number; total_commits?: number
    commits?: { sha?: string; commit?: { message?: string } }[]
    files?: { filename?: string; status?: string; additions?: number; deletions?: number; patch?: string }[]
  } | null
  if (!c || typeof c !== 'object' || !Array.isArray(c.commits) || !Array.isArray(c.files)) return null
  const maxC = caps.commits ?? 20, maxF = caps.files ?? 60
  const commits: DeltaCommit[] = c.commits.slice(0, maxC).map(x => ({
    sha: String(x.sha ?? '').slice(0, 12),
    msg: String(x.commit?.message ?? '').split('\n')[0]?.slice(0, 140) ?? '',
  }))
  const files: DeltaFile[] = c.files.slice(0, maxF).map(x => ({
    path: String(x.filename ?? ''), status: String(x.status ?? ''),
    add: x.additions ?? 0, del: x.deletions ?? 0,
    ...(typeof x.patch === 'string' ? { patch: x.patch } : {}),
  }))
  const additions = c.files.reduce((s, x) => s + (x.additions ?? 0), 0)
  const deletions = c.files.reduce((s, x) => s + (x.deletions ?? 0), 0)
  return {
    aheadBy: c.ahead_by ?? commits.length,
    commits, files,
    filesTotal: c.files.length, commitsTotal: c.total_commits ?? c.commits.length,
    additions, deletions,
    truncated: c.commits.length > maxC || c.files.length > maxF,
  }
}

/** fetch owner/repo compare base...head. `ghFn` is the caller's gh/api
 *  transport (docket injects its gh wrapper for tests; flag-delta passes a
 *  gh-CLI-backed one). Returns null on any failure — drift evidence is
 *  advisory, never worth failing a sync over. */
export async function fetchCompare(
  repo: string, base: string, head: string,
  ghFn: (args: string[]) => Promise<string>,
): Promise<DeltaCompare | null> {
  try {
    const out = await ghFn(['api', `repos/${repo}/compare/${base}...${head}`])
    return parseCompare(JSON.parse(out))
  } catch { return null }
}

/** gh-CLI transport for non-docket callers (local agent): `gh api` carries
 *  the user's auth so public-API rate limits don't apply. Falls back to an
 *  unauthenticated fetch when gh is absent — 60/hr is plenty for the rare
 *  flag-drift population. */
/* v8 ignore next 16 -- transport shim: the gh-CLI leg needs a real gh+network
 *  and the fetch fallback is the same shape; both are exercised in production,
 *  neither is unit-testable without mocking child_process. */
export function ghApiTransport(): (args: string[]) => Promise<string> {
  return async (args: string[]) => {
    try {
      const { stdout } = await execFileP('gh', args, { maxBuffer: 32 * 1024 * 1024 })
      return stdout
    } catch {
      const endpoint = args[1] ?? ''
      const res = await fetch(`https://api.github.com/${endpoint}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'opencode-market-flag-delta' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`github api ${res.status}`)
      return res.text()
    }
  }
}
