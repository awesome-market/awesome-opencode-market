/** Thin static site generator — renders index.json to plain HTML. Astro can replace this later without changing data. */
import { writeFileSync, mkdirSync, rmSync, renameSync, readdirSync, cpSync, existsSync, statSync, readFileSync } from 'node:fs'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { CatalogIndex } from '../../src/schema.ts'
import type { PluginEntry } from '../../src/schema.ts'

type Caps = PluginEntry['capabilities']
type Ver = PluginEntry['verification']

const execFileP = promisify(execFile)

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Honest-status rendering (DEV §2 铁律): each state gets distinct copy — never "safe" for unscanned. */
const scanState = (c: Caps): { text: string; cls: string } => {
  if (c.scannedAt === null) return { text: 'not scanned', cls: 'muted' }
  if (c.redFlags.length > 0) return { text: `${c.redFlags.length} red flag(s)`, cls: 'bad' }
  if (c.findings.length > 0) return { text: `${c.findings.length} finding(s)`, cls: 'warn' }
  return { text: 'scanned, no findings', cls: 'ok' }
}
export function scanLabel(e: PluginEntry): { text: string; cls: string } {
  return scanState(e.capabilities)
}
const verState = (v: Ver): { text: string; cls: string } => {
  switch (v.status) {
    case 'verified': return { text: `verified (${v.level ?? 'install'})`, cls: 'ok' }
    case 'failed': return { text: `verification failed${v.level ? ` (${v.level})` : ''}`, cls: 'bad' }
    case 'skipped': return { text: 'skipped (high risk)', cls: 'warn' }
    default: return { text: 'unverified', cls: 'muted' }
  }
}
export function verifyLabel(e: PluginEntry): { text: string; cls: string } {
  // version-less entries (github-kind) are constructed as 'skipped' — there is
  // no npm artifact to run, not a high-risk short-circuit. Rendering them
  // "skipped (high risk)" would be a lie (AGENTS.md honest-label rule).
  if (e.latestVersion === null) return { text: 'nothing to install', cls: 'muted' }
  return verState(e.verification)
}
/** approval badge — 'legacy' entries predate the review gate; 'approved' needs no badge. */
export function approvalBadge(e: PluginEntry): string {
  return e.approval === 'legacy' ? ' <span class=muted>legacy</span>' : ''
}
/** user-visible entries — pending (under-review) entries never render on the site. */
export const isVisible = (e: PluginEntry): boolean => e.approval !== 'pending'

/** The installable parts an entry claims. Missing `contains` (legacy entries)
 *  falls back on `type` — an mcp/command/agent entry without declared parts
 *  has no plugin payload to `plugin add`, so it gets no hint. Same rule as
 *  the client's installPlan — the three routing sites must not drift. */
const entryParts = (e: Pick<PluginEntry, 'contains' | 'type'>): string[] =>
  e.contains?.length ? e.contains
    : e.type === 'skill' ? ['skill']
    : e.type === 'plugin' ? ['plugin']
    : []
/** Repo id usable for codeload/skill paths — same validity gate as
 *  buildSkillCatalog and the client installPlan. */
const ghRepoOf = (e: Pick<PluginEntry, 'source'>): string | null =>
  e.source?.kind === 'github' && /^[\w.-]+\/[\w.-]+$/.test(e.source?.repo ?? '')
    ? e.source!.repo! : null

/** Install instruction matching the market client's installPlan rules — a
 *  github plugin has no install path (the client itself refuses), so the
 *  detail page must not print a `plugin add` line that cannot work. Skills
 *  point at the site's own skills catalog; npm plugins pin the approved ver.
 *  `up` is the relative prefix back to site root (depth of the detail page). */
export function installHint(e: PluginEntry, up = '../'): string {
  const gh = e.source?.kind === 'github'
  const ghRepo = ghRepoOf(e)
  const parts = entryParts(e)
  const bits: string[] = []
  if (parts.includes('plugin') && !gh && e.latestVersion)
    bits.push(`plugin: <code>opencode plugin add ${esc(e.name)}@${esc(e.latestVersion)}</code>`)
  if (parts.includes('skill') && (e.latestVersion || ghRepo))
    bits.push(`skill: <a href="${up}skills.html">skills catalog</a>`)
  return bits.length
    ? `<p class=meta>${bits.join(' · ')}</p>`
    : '<p class=meta>no client install path yet — browse only</p>'
}

const CSS = `body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#222}
a{color:#06c;text-decoration:none}code{background:#f4f4f4;padding:1px 4px;border-radius:3px}
.ok{color:#080}.warn{color:#a60}.bad{color:#c00}.muted{color:#999}
.card{border:1px solid #ddd;border-radius:6px;padding:12px;margin:8px 0}
.meta{color:#666;font-size:12px}h1,h2{margin:.5em 0}td{vertical-align:top;padding:1px 8px 1px 0}
@media(prefers-color-scheme:dark){body{background:#141414;color:#ddd}.card{border-color:#333}code{background:#2a2a2a}a{color:#6af}}`

/** Footer repo link — env override, else this repo's own origin remote
 *  (memoized; a rename/transfer must not 404 every page footer). */
let memoRepo: string | null = null
function siteRepoUrl(): string {
  if (memoRepo) return memoRepo
  const env = process.env.MARKET_REPO_URL
  if (env) return (memoRepo = env.replace(/\.git$/, '').replace(/\/$/, ''))
  try {
    const u = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    memoRepo = u.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '')
  } catch {
    memoRepo = 'https://github.com/terry2010/awesome-opencode-market'
  }
  return memoRepo
}

/** Absolute base path for the deployed site ("/<repo>/" on project Pages,
 *  "/" on a user/org page or custom domain). Only 404.html needs absolute
 *  links: Pages serves it at the REQUESTED path, so relative links resolve
 *  against whatever depth the missing URL had. */
let memoBase: string | null = null
function siteBasePath(): string {
  if (memoBase) return memoBase
  const env = process.env.SITE_BASE
  if (env) return (memoBase = env.endsWith('/') ? env : `${env}/`)
  let name = ''
  try {
    const u = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    name = u.replace(/\.git$/, '').split('/').pop() ?? ''
  } catch { /* no remote */ }
  memoBase = name && !name.endsWith('.github.io') ? `/${name}/` : '/'
  return memoBase
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=description content="opencode plugin/skill catalog — scan and install-verify status per entry"><title>${esc(title)} · opencode market</title><style>${CSS}</style>${body}<footer class=meta><p>Not affiliated with opencode. "Scanned, no findings" does not mean safe. <a href="${esc(siteRepoUrl())}">source</a></p></footer></html>`
}

export function listPage(index: CatalogIndex): string {
  const visible = index.plugins.filter(isVisible)
  const cats = [...new Set(visible.flatMap(e => e.category))].sort()
  const catName = (id: string) => {
    const c = index.categories?.[id]
    return c ? c.en + (c.zh ? ` · ${c.zh}` : '') : id
  }
  const cards = visible.map(e => {
    const s = scanLabel(e), v = verifyLabel(e)
    const badges = [
      e.deprecated ? '<span class=bad>deprecated</span>' : '',
      e.pendingUpdate ? '<span class=muted>update under review</span>' : '',
      approvalBadge(e).trim(),
    ].filter(Boolean).join(' · ')
    const aka = e.aliases.length ? `<div class=meta>aka ${e.aliases.map(a => esc(a)).join(', ')}</div>` : ''
    return `<div class=card data-cats="${esc(JSON.stringify(e.category))}"><a href="p/${esc(e.slug)}.html"><b>${esc(e.name)}</b></a> <code>${esc(e.type)}</code>${badges ? ` ${badges}` : ''}
      <div>${esc(e.description.en ?? '')}${e.description.zh ? `<div class=meta>${esc(e.description.zh)}</div>` : ''}</div>${aka}
      <div class=meta><span class="${s.cls}">${s.text}</span> · <span class="${v.cls}">${v.text}</span>${e.latestVersion ? ` · v${esc(e.latestVersion)}` : ''}</div></div>`
  }).join('\n')
  // data-cats holds the raw JSON category array (entity-escaped); the filter
  // parses it back so exact matching can't be fooled by quote/backslash chars.
  const filterJs = `function F(){const q=document.getElementById('q').value.toLowerCase(),c=document.getElementById('cat')?.value||'';document.querySelectorAll('.card').forEach(e=>{let ok=!q||e.textContent.toLowerCase().includes(q);if(ok&&c){try{ok=JSON.parse(e.dataset.cats).includes(c)}catch{ok=false}}e.style.display=ok?'':'none'})}`
  const empty = visible.length ? '' : '<p class=muted>no entries yet — the catalog is empty or still syncing</p>'
  return page('catalog', `<h1>opencode market</h1><p class=meta>${visible.length} entries · generated ${esc(index.generatedAt)} · <a href="skills.html">skills</a> · <a href="removed.html">removed</a></p>
    <input id=q placeholder=search style="width:100%;padding:8px;margin:8px 0" oninput="F()">${cats.length ? `<select id=cat onchange="F()" style="padding:8px;margin:8px 0"><option value="">all categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(catName(c))}</option>`).join('')}</select>` : ''}<script>
    ${filterJs}
    </script>${empty}${cards}`)
}

export function detailPage(e: PluginEntry): string {
  const s = scanLabel(e), v = verifyLabel(e)
  // this page lives at p/<slug>.html — slugs can nest (owner/repo, @scope/name),
  // so links back to site root need one "../" per slug segment
  const up = '../'.repeat(e.slug.split('/').length)
  const rows = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')
  // AGENTS: findings/redFlags 默认收起 — collapsed into <details> even on the
  // detail page; red-flag lines get a marker so they stand out when expanded
  const findingsBlock = (caps: Caps, label: string): string => {
    if (!caps.findings.length) return ''
    const rf = new Set(caps.redFlags)
    return `<details><summary>${label} (${caps.findings.length}${caps.redFlags.length ? `, ${caps.redFlags.length} red flag` : ''})</summary><ul>${caps.findings.map(f => `<li><code>${esc(f)}</code>${rf.has(f) ? ' <span class=bad>red flag</span>' : ''}</li>`).join('')}</ul></details>`
  }
  const findings = e.capabilities.findings.length
    ? findingsBlock(e.capabilities, 'findings')
    : '<p class=muted>none</p>'
  const pu = e.pendingUpdate
  const puScan = pu ? scanState(pu.capabilities) : null
  const puVer = pu ? verState(pu.verification) : null
  const underReview = pu
    ? `<tr><td>next version</td><td><code>v${esc(pu.version)}</code> <span class=muted>under review — not installable yet</span>
      <br><span class=meta>verify: <span class="${puVer!.cls}">${puVer!.text}</span> · scan: <span class="${puScan!.cls}">${puScan!.text}</span>${pu.publishedAt ? ` · published ${esc(pu.publishedAt.slice(0, 10))}` : ''} · held ${esc(pu.heldAt.slice(0, 10))}</span>
      ${pu.reason ? `<br><span class=meta>${esc(pu.reason)}</span>` : ''}${pu.verification.runUrl ? ` <a href="${esc(pu.verification.runUrl)}">verify logs</a>` : ''}</td></tr>` : ''
  const puFindings = pu && pu.capabilities.findings.length
    ? `<h2>next version findings (v${esc(pu.version)})</h2>${findingsBlock(pu.capabilities, 'findings')}` : ''
  const puLog = pu?.verification.logExcerpt
    ? `<details><summary><b>next version failure log</b></summary><pre>${esc(pu.verification.logExcerpt)}</pre></details>` : ''
  const reviewLink = `${siteRepoUrl()}/issues?q=${encodeURIComponent(`is:issue [review] ${e.name}`)}`
  return page(e.name, `<h1>${esc(e.name)}${approvalBadge(e)}${e.deprecated ? ' <span class=bad>deprecated</span>' : ''}</h1><p>${esc(e.description.en ?? '')}${e.description.zh ? `<br><span class=meta>${esc(e.description.zh)}</span>` : ''}</p>
    <table>${rows({
      type: esc(e.type), slug: `<code>${esc(e.slug)}</code>`,
      aliases: e.aliases.length ? e.aliases.map(a => `<code>${esc(a)}</code>`).join(' ') : undefined,
      contains: e.contains?.length ? esc(e.contains.join(', ')) : undefined,
      features: e.features?.length ? esc(e.features.join(', ')) : undefined,
      license: e.license ? esc(e.license) : 'unknown',
      version: e.latestVersion ? esc(e.latestVersion) : undefined,
      published: e.publishedAt ? esc(e.publishedAt.slice(0, 10)) : undefined,
      created: e.createdAt ? esc(e.createdAt.slice(0, 10)) : undefined,
      modified: e.modifiedAt ? esc(e.modifiedAt.slice(0, 10)) : undefined,
      repo: e.source.repo ? `<a href="https://github.com/${esc(e.source.repo)}">${esc(e.source.repo)}</a>` : undefined,
      maintainers: e.maintainers.length ? esc(e.maintainers.join(', ')) : undefined,
      'discovered via': e.discoveredVia.length ? esc(e.discoveredVia.join(', ')) : undefined,
      integrity: e.integrity ? `<code style="word-break:break-all">${esc(e.integrity)}</code>` : undefined,
      'npm (30d)': e.metrics.npmDownloads30d?.toLocaleString(),
      stars: e.metrics.stars?.toLocaleString(),
      'first seen': esc(e.firstSeenAt.slice(0, 10)),
      compat: (e.compat.engines || e.compat.peer) ? esc([e.compat.engines, e.compat.peer].filter(Boolean).join(' · ')) : undefined,
      'scan status': `<span class="${s.cls}">${s.text}</span>`,
      'verify status': `<span class="${v.cls}">${v.text}</span>`,
      'verified at': e.verification.verifiedAt ? esc(e.verification.verifiedAt.slice(0, 10)) : undefined,
      'opencode ver': e.verification.opencodeVersion ? esc(e.verification.opencodeVersion) : undefined,
      'verify run': e.verification.runUrl ? `<a href="${esc(e.verification.runUrl)}">logs</a>` : undefined,
      deprecated: e.deprecated ? '<span class=bad>deprecated</span>' : undefined,
      'deprecated note': e.deprecatedMessage ? esc(e.deprecatedMessage) : undefined,
      replacement: e.replacement ? `<code>${esc(e.replacement)}</code>` : undefined,
      review: `<a href="${esc(reviewLink)}">audit trail</a>`,
    })}${underReview}</table>
    <h2>scan findings</h2>${findings}
    ${puFindings}
    ${e.verification.logExcerpt ? `<details><summary><b>failure log</b></summary><pre>${esc(e.verification.logExcerpt)}</pre></details>` : ''}
    ${puLog}
    <p class=meta><a href="${up}index.html">← all plugins</a></p>${installHint(e, up)}`)
}

export async function buildSite(index: CatalogIndex, outDir: string, cacheDir?: string): Promise<void> {
  rmSync(outDir, { recursive: true, force: true })   // no stale files from a previous build
  mkdirSync(join(outDir, 'p'), { recursive: true })
  // index.json ships the FULL catalog (pending included) — it is the auditable
  // data plane; every UI/install surface filters pending itself.
  const indexJson = JSON.stringify(index)
  writeFileSync(join(outDir, 'index.json'), indexJson)
  const visible = { ...index, plugins: index.plugins.filter(isVisible) }
  // privacy note + health endpoint (dsh parity). sha256 = content hash of the
  // served index.json bytes — clients fetch this manifest first and only pull
  // the multi-MB index when the hash moved, then verify the downloaded bytes
  // (CDN edge staleness can't pin a mismatched hash to old content).
  writeFileSync(join(outDir, 'privacy.html'), '<html><body><h1>Privacy</h1><p>opencode-market collects nothing. The catalog is static data; installing a plugin runs opencode plugin add locally. Local state (favorites/groups/notes) stays in localStorage on your machine.</p></body></html>')
  const skillStats = await buildSkillCatalog(visible, outDir, undefined, cacheDir)
  writeFileSync(join(outDir, 'health.json'), JSON.stringify({ ok: true, entries: visible.plugins.length, skills: skillStats, generatedAt: index.generatedAt, sha256: createHash('sha256').update(indexJson).digest('hex'), bytes: Buffer.byteLength(indexJson) }))
  writeFileSync(join(outDir, 'index.html'), listPage(visible))
  writeFileSync(join(outDir, 'skills.html'), skillsPage(skillStats.entries))
  writeFileSync(join(outDir, 'removed.html'), removedPage(index))
  // Pages serves 404.html at the REQUESTED url — a missing deep link keeps its
  // depth, so relative links would resolve under it. Absolute site-base links
  // ("/<repo>/…" on project Pages) survive any requested depth.
  const base = siteBasePath()
  writeFileSync(join(outDir, '404.html'), page('not found', `<h1>not found</h1><p>The page or plugin you are looking for may have been removed from the catalog, or it is still under review and not published yet.</p><p><a href="${esc(base)}removed.html">recently removed entries</a> · <a href="${esc(base)}index.html">all plugins</a></p>`))
  for (const e of visible.plugins) {
    const p = join(outDir, 'p', `${e.slug}.html`)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, detailPage(e))
  }
}

/** Deploy gate (S-3): refuse to publish a catastrophically shrunken catalog —
 *  an empty site is worse than a stale one. site.yml fetches the LIVE
 *  health.json for `prev`; fetch/parse failure → prev=null → absolute floor
 *  only. A skill-fetch outage is a third axis: `degraded` means over half the
 *  skill tarballs failed — that is an infrastructure problem, not a catalog
 *  state, and publishing would silently un-ship half the skills catalog.
 *  `floor` is SITE_FLOOR-overridable — a small curated catalog must be able
 *  to publish below the default. */
export function healthGate(prev: { entries?: number } | null,
  cur: { entries: number; skills?: { candidates?: number; landed?: number; degraded?: boolean } },
  floor = 200): string | null {
  if (cur.entries < floor) return `entries=${cur.entries} below floor ${floor}`
  if (typeof prev?.entries === 'number' && prev.entries > 0 && cur.entries < prev.entries * 0.5)
    return `entries ${cur.entries} < 50% of previous deploy ${prev.entries}`
  const sk = cur.skills
  if (sk?.degraded && (sk.candidates ?? 0) >= 10)
    return `skills degraded: ${sk.landed}/${sk.candidates} landed`
  return null
}

/** skills index → browseable page (files are served as raw files). Href paths
 *  are encodeURI'd — esc() alone leaves spaces/unicode bare and Pages 404s. */
export function skillsPage(entries: { name: string; version: string; files: string[] }[]): string {
  const cards = entries.map(s => {
    const ver = s.version.length > 12 ? `${s.version.slice(0, 10)}…` : s.version
    return `<div class=card><b>${esc(s.name)}</b> <code>v${esc(ver)}</code> <span class=muted>${s.files.length} file(s)</span><div class=meta>${s.files.map(f => `<a href="skills/${esc(encodeURI(s.name))}/${esc(encodeURI(f))}">${esc(f)}</a>`).join(' · ') || 'no files'}</div></div>`
  }).join('\n')
  const empty = entries.length ? '' : '<p class=muted>no skills published yet — skill files are fetched during the site build and may be temporarily unavailable</p>'
  return page('skills', `<h1>skills</h1><p class=meta>${entries.length} skills · <a href="skills/index.json">index.json</a> · <a href="index.html">← all plugins</a></p>${empty}${cards}`)
}

/** Recently removed entries — explains the 404s for vanished plugins. */
const REMOVED_REASON: Record<string, string> = {
  'npm-404': 'unpublished from npm',
  'repo-404': 'repository deleted',
  filtered: 'filtered out by admission checks',
  capped: 'dropped by catalog cap',
  manual: 'removed by maintainer',
  unknown: 'no longer seen (cause unknown)',
}
export function removedPage(index: CatalogIndex): string {
  const rem = [...(index.removed ?? [])].sort((a, b) => b.disappearedAt.localeCompare(a.disappearedAt))
  const cards = rem.slice(0, 300).map(r => {
    const src = r.lastSource?.repo ? ` · <a href="https://github.com/${esc(r.lastSource.repo)}">${esc(r.lastSource.repo)}</a>`
      : r.lastSource?.id ? ` · <code>${esc(r.lastSource.id)}</code>` : ''
    return `<div class=card><b>${esc(r.name)}</b> <code>${esc(r.slug)}</code><div class=meta>${esc(REMOVED_REASON[r.reason] ?? r.reason)} · removed ${esc(r.disappearedAt.slice(0, 10))}${src}</div></div>`
  }).join('\n')
  return page('removed', `<h1>removed entries</h1><p class=meta>${rem.length} total · latest 300 shown · <a href="index.html">← all plugins</a></p>${cards || '<p class=muted>none</p>'}`)
}

/* v8 ignore next 7 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // no top-level await here — the deploy gate imports this module for
  // healthGate() via `tsx -e`, which require()s it as CJS; a TLA module
  // crashes that load with ERR_REQUIRE_ASYNC_MODULE
  void (async () => {
    // zod-validate: a malformed index should die here with a readable error,
    // not halfway through a build (S-13)
    const idx = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2] ?? 'index.json', 'utf8')))
    await buildSite(idx, process.argv[3] ?? 'dist-site', process.env.SKILL_CACHE)
    console.log('site built')
  })()
}

/** HTTP skill catalog (opencode docs/skills): site/skills/index.json + per-skill files
 *  pulled from npm tarballs / codeload, so `skills: ["<site>/skills/"]` makes the
 *  whole catalog's skills loadable — files update whenever version bumps.
 *  Fetches run in a bounded worker pool (S-14): a cold cache otherwise costs
 *  N × (npm view + curl + tar) serially. */
const SKILL_POOL = 8
const MAX_SKILL_TGZ = 48 * 1024 * 1024   // parity with the client's installSkillTar cap
const MAX_SKILL_MEMBERS = 100            // bounded argv + publish surface
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_TOTAL_BYTES = 20 * 1024 * 1024
/** Publishable skill-payload filenames — everything except control chars and
 *  URL-breaking characters (", ', `, #, %, ?, *, :, <, >, |, \). Unicode fine. */
const SAFE_MEMBER = /^[^\x00-\x1f\x7f"'`#$%?*:<>\|]+$/
export async function buildSkillCatalog(index: CatalogIndex, outDir: string,
  tarballOf: (spec: string) => string | null | Promise<string | null> =
    // execFile argv, not a shell string — this job holds pages:write + id-token,
    // so an index-derived spec/URL must never reach a shell (N-4)
    async (spec) => {
      try {
        const { stdout } = await execFileP('npm', ['view', spec, 'dist.tarball'], { encoding: 'utf8', timeout: 20_000 })
        const u = stdout.trim()
        // packument-derived URL is registry-controlled in practice but treat as
        // untrusted: https only. Injected tarballOf impls (tests) own their scheme.
        return /^https:\/\//i.test(u) ? u : null
      } catch { return null }
    },
  cacheDir?: string,
  ghTarballOf: (repo: string, sha?: string | null) => string | null =
    (repo, sha) => `https://codeload.github.com/${repo}/tar.gz/${sha ?? 'HEAD'}`)
  : Promise<{ candidates: number; landed: number; degraded: boolean; entries: { name: string; version: string; files: string[] }[] }> {
  const skills = index.plugins.filter((p) => p.contains?.includes('skill'))
  const dir = join(outDir, 'skills')
  mkdirSync(dir, { recursive: true })
  const entries: { name: string; version: string; files: string[] }[] = []
  // conditional ids (same rule as market installSkillTar): bare basename for
  // singletons; same-basename packages all get the namespaced `a--test` form
  const baseOf = (n: string) => n.split('/').pop()!.replace(/^@/, '')
  const counts = new Map<string, number>()
  for (const s of skills) { const b = baseOf(s.name); counts.set(b, (counts.get(b) ?? 0) + 1) }
  const usedIds = new Set<string>()   // S-12: collision guard (namespaced a--x vs a real 'a--x' package)
  const keep = new Set<string>()      // cache keys still in use — stale entries get pruned
  const cacheKey = (id: string, pin: string) => encodeURIComponent(`${id}@${pin}`)
  /** Collect publishable files under `root`: drops non-regular members
   *  (symlink/hardlink/fifo/dev — named extraction CAN create them, so the
   *  walk deletes them rather than publish a traversal/dead primitive),
   *  drops over-sized single files, and bails ([]) on an over-budget total. */
  const collectFiles = (root: string): { files: string[]; total: number } => {
    const out: string[] = []
    let total = 0
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        if (ent.isDirectory() && ent.name !== 'node_modules') { walk(p); continue }
        if (!ent.isFile()) { rmSync(p, { force: true }); continue }
        const sz = statSync(p).size
        if (sz > MAX_SKILL_FILE_BYTES) { rmSync(p, { force: true }); continue }
        total += sz
        out.push(p)
      }
    }
    try { walk(root) } catch { /* unreadable dir → empty */ }
    return { files: out, total }
  }
  // plan phase (sync + deterministic): ids are assigned in catalog order so
  // the collision suffix can't shuffle between builds; fetch work is pooled.
  interface Cand { s: PluginEntry; id: string; ver: string; dest: string; key: string; ghRepo: string | null }
  const cands: Cand[] = []
  for (const s of skills) {
    const isGh = s.source?.kind === 'github'
    const ghRepo = isGh ? ghRepoOf(s) : null
    // github version marker = the scanned tree sha (source.version) — codeload
    // pins to it so served bytes equal what the evidence gate + scan saw;
    // pushedAt (modifiedAt) is only the fallback for pre-sha index data.
    const ver = isGh ? (s.source?.version ?? s.modifiedAt) : s.latestVersion
    if (isGh && !ghRepo) continue                     // malformed repo id
    if (!ver) continue                                // npm entry without a version — nothing to serve
    const base = baseOf(s.name)
    let id = ((counts.get(base) ?? 0) > 1 ? s.name.replace(/^@/, '').replace(/\//g, '--') : base) || s.slug
    while (usedIds.has(id)) id += '-x'                // S-12 deterministic suffix
    usedIds.add(id)
    // npm cache pins BY BYTES: dist.integrity identifies the exact tarball the
    // catalog approved — a re-tagged same-version release gets a new key and a
    // refetch, never a stale hit. github/integrity-less entries fall back to ver.
    const pin = isGh ? ver : (s.integrity ?? ver)
    cands.push({ s, id, ver, dest: join(dir, id), key: cacheKey(id, pin), ghRepo })
  }
  const work = async (c: Cand): Promise<void> => {
    keep.add(c.key)   // preserve the pin-keyed cache even if this fetch fails — same pin = same bytes, a transient outage must not evict a good copy
    const hit = cacheDir ? join(cacheDir, c.key) : null
    // S-1: version-pinned cache — unchanged skills skip npm+curl+tar entirely.
    // A corrupt cache entry (truncated copy, not a dir) must fall through to a
    // refetch, not kill the whole catalog build.
    if (hit && existsSync(hit)) try {
      rmSync(c.dest, { recursive: true, force: true })
      cpSync(hit, c.dest, { recursive: true })
      const { files: abs, total } = collectFiles(c.dest)
      const files = abs.map((f) => relative(c.dest, f))
      if (files.length && total <= MAX_SKILL_TOTAL_BYTES) { entries.push({ name: c.id, version: c.ver, files }); return }
      rmSync(hit, { recursive: true, force: true })   // poisoned cache → refetch
    } catch { rmSync(hit, { recursive: true, force: true }) }
    const tmp = `${c.dest}.tmp`
    try {
      // pin to the approved version — `npm view <name>` resolves dist-tags.latest
      // which is the pendingUpdate users must not receive (hold semantics).
      // github: codeload keyed by the scanned tree sha, not HEAD (version
      // marker = the pinned bytes); repo goes through execFile argv, not a shell.
      const tb = c.ghRepo ? ghTarballOf(c.ghRepo, c.s.source?.version) : await tarballOf(`${c.s.name}@${c.ver}`)
      if (!tb) return
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      const tgz = join(tmp, 'pkg.tgz')
      await execFileP('curl', ['-fsSL', '--max-time', '60', tb, '-o', tgz], { timeout: 70_000 })
      // drift check: when the index announces an SRI for this version, the
      // served bytes must equal the reviewed bytes — same fail-closed rule the
      // client applies on skill install (a re-tagged tarball never ships).
      if (statSync(tgz).size > MAX_SKILL_TGZ) { console.warn(`[site] skill ${c.id}: tgz over ${MAX_SKILL_TGZ >> 20}MB — skipped`); return }
      if (!c.ghRepo && c.s.integrity) {
        const dg = createHash('sha512').update(readFileSync(tgz)).digest('base64')
        if (`sha512-${dg}` !== c.s.integrity) { console.warn(`[site] skill ${c.id}: integrity mismatch (re-tag or corrupted artifact) — skipped`); return }
      }
      // two-pass extraction (S-4/S-5): only listed members are extracted, so
      // node_modules and non-skill noise never touch disk. Named members CAN
      // still be symlinks/hardlinks/fifos — collectFiles deletes every
      // non-regular-file entry before publishing. '--' ends option parsing so
      // a member named like a flag cannot be re-parsed (names are registry input).
      const { stdout } = await execFileP('tar', ['tzf', tgz], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 })
      const all = stdout.split('\n').filter((n) => {
        if (!n || n.endsWith('/')) return false
        const segs = n.split('/')
        return !segs.includes('node_modules') && !segs.includes('..') && !segs.includes('.') && SAFE_MEMBER.test(n)
      })
      const members = all.slice(0, MAX_SKILL_MEMBERS)
      if (all.length > MAX_SKILL_MEMBERS) console.warn(`[site] skill ${c.id}: ${all.length} members — capped at ${MAX_SKILL_MEMBERS}`)
      if (members.length)
        await execFileP('tar', ['xzf', tgz, '-C', tmp, '--strip-components=1', '--', ...members], { timeout: 30_000 })
      rmSync(tgz, { force: true })
      if (!members.length) return
      const { files: abs, total } = collectFiles(tmp)
      if (!abs.length) return
      if (total > MAX_SKILL_TOTAL_BYTES) { console.warn(`[site] skill ${c.id}: payload over ${MAX_SKILL_TOTAL_BYTES >> 20}MB — skipped`); return }
      const files = abs.map((f) => relative(tmp, f))
      rmSync(c.dest, { recursive: true, force: true })
      renameSync(tmp, c.dest)
      if (hit) { mkdirSync(cacheDir!, { recursive: true }); rmSync(hit, { recursive: true, force: true }); cpSync(c.dest, hit, { recursive: true }) }
      entries.push({ name: c.id, version: c.ver, files })
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true })
      console.warn(`[site] skill ${c.id} skipped: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`)
    }
  }
  const queue = [...cands]
  await Promise.all(Array.from({ length: Math.min(SKILL_POOL, queue.length) }, async () => {
    for (let c: Cand | undefined; (c = queue.shift()); ) await work(c)
  }))
  // prune stale cache dirs (version bumped or skill removed from catalog)
  if (cacheDir && existsSync(cacheDir))
    for (const c of readdirSync(cacheDir)) if (!keep.has(c)) rmSync(join(cacheDir, c), { recursive: true, force: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))   // deterministic output regardless of pool order
  const landed = entries.length
  // S-2: a near-empty catalog is a fetch outage, not a real state — log loudly
  const degraded = cands.length > 0 && landed < cands.length / 2
  if (degraded) console.warn(`[site] skills degraded: ${landed}/${cands.length} landed`)
  else console.log(`[site] skills ${landed}/${cands.length} landed`)
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ skills: entries }))
  return { candidates: cands.length, landed, degraded, entries }
}
