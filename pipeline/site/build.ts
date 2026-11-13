/** Thin static site generator — renders index.json to plain HTML. Astro can replace this later without changing data. */
import { writeFileSync, mkdirSync, rmSync, renameSync, readdirSync, cpSync, existsSync, statSync, readFileSync, lstatSync } from 'node:fs'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { CatalogIndex, AiVerdict } from '../../src/schema.ts'
import type { PluginEntry } from '../../src/schema.ts'
import { loadVerdicts, atCmp } from '../verdicts.ts'
import { readJsonCapped } from '../fetch/npm.ts'
import { isMain } from '../main-guard.ts'

type Caps = PluginEntry['capabilities']
type Ver = PluginEntry['verification']

const execFileP = promisify(execFile)

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Bilingual chrome string: English is the rendered default (no-JS safe);
 *  data-en/data-zh let the footer toggle swap textContent. zh wording mirrors
 *  the market client's ZH dict + AGENTS honest-status rules — keep in sync. */
const bi = (en: string, zh: string): string =>
  `<span data-en="${esc(en)}" data-zh="${esc(zh)}">${esc(en)}</span>`
/** Same swap for an element that already carries a class (status labels). */
const lbl = (s: { text: string; cls: string; zh: string }): string =>
  `<span class="${s.cls}" data-en="${esc(s.text)}" data-zh="${esc(s.zh)}">${esc(s.text)}</span>`
/** Only https URLs become links — index.json is untrusted data-plane input
 *  and `javascript:`/`data:` hrefs must never render (esc() stops HTML
 *  injection, not scheme injection). Unsafe values still display as text. */
const safeHref = (u: string | undefined): string | null =>
  u && /^https:\/\//i.test(u) ? u : null
const linkOrText = (u: string | undefined, label: string): string => {
  const h = safeHref(u)
  return h ? `<a href="${esc(h)}">${label}</a>` : esc(u ?? '')
}

/** Footer language toggle — swaps [data-en]/[data-zh] textContent, persists
 *  in localStorage, degrades to English without JS. */
const LANG_JS = `<script>(function(){var K='ocm-lang';function A(l){document.documentElement.lang=l==='zh'?'zh':'en';document.querySelectorAll('[data-en][data-zh]').forEach(function(e){e.textContent=l==='zh'?e.getAttribute('data-zh'):e.getAttribute('data-en')});document.querySelectorAll('[data-en-ph][data-zh-ph]').forEach(function(e){e.placeholder=l==='zh'?e.getAttribute('data-zh-ph'):e.getAttribute('data-en-ph')});document.querySelectorAll('#langsw button').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-l')===l?'true':'false')})}var l='en';try{l=localStorage.getItem(K)||'en'}catch(e){}A(l);document.addEventListener('click',function(ev){var b=ev.target&&ev.target.closest?ev.target.closest('#langsw button'):null;if(!b)return;l=b.getAttribute('data-l');try{localStorage.setItem(K,l)}catch(e){}A(l)})})()</script>`

/** Detail-page href for a slug: per-segment encoding produces the exact
 *  nested file path we write (`o/p` → `p/o/p.html`, `a b` → `p/a%20b.html`).
 *  Whole-slug encodeURIComponent would emit `o%2Fp` — Pages decodes it, but
 *  the nested form is the canonical URL (docket/client use the same rule). */
const detailHref = (slug: string): string =>
  `p/${slug.split('/').map(encodeURIComponent).join('/')}.html`

/** Honest-status rendering (DEV §2 铁律): each state gets distinct copy — never "safe" for unscanned. */
const scanState = (c: Caps): { text: string; cls: string; zh: string } => {
  if (c.scannedAt === null) return { text: 'not scanned', cls: 'muted', zh: '未扫描' }
  if (c.redFlags.length > 0) return { text: `${c.redFlags.length} red flag(s)`, cls: 'bad', zh: `${c.redFlags.length} 个高危信号` }
  if (c.findings.length > 0) return { text: `${c.findings.length} finding(s)`, cls: 'warn', zh: `${c.findings.length} 条扫描提示` }
  return { text: 'scanned, no findings', cls: 'ok', zh: '已扫描·无发现' }
}
export function scanLabel(e: PluginEntry): { text: string; cls: string; zh: string } {
  return scanState(e.capabilities)
}
const verState = (v: Ver): { text: string; cls: string; zh: string } => {
  switch (v.status) {
    case 'verified': return { text: `verified (${v.level ?? 'install'})`, cls: 'ok', zh: `已实测可装可用（${v.level ?? 'install'}）` }
    case 'failed': return { text: `verification failed${v.level ? ` (${v.level})` : ''}`, cls: 'bad', zh: `装不上或加载失败${v.level ? `（${v.level}）` : ''}` }
    case 'skipped': return { text: 'skipped (high risk)', cls: 'warn', zh: '有高危信号没跑' }
    default: return { text: 'unverified', cls: 'muted', zh: '还没验' }
  }
}
export function verifyLabel(e: PluginEntry): { text: string; cls: string; zh: string } {
  const v = e.verification
  // recorded outcomes are real measurements — surface them even when the
  // client has no install button (github plugin-only verifies via
  // `plugin add owner/repo#sha`; AGENTS: failed must say 装不上).
  if (v.status === 'verified' || v.status === 'failed') return verState(v)
  // 'skipped' decomposes (run.ts construction + publish/merge skipIfFlagged):
  // CURRENT red flags → the run was vetoed → high risk; unflagged → the slot
  // was deliberately not run — honest only as the muted no-target label when
  // nothing can ever be measured, else it re-queues as 'unverified'
  // (verifyQueued re-enters cleared skips).
  if (v.status === 'skipped' && e.capabilities.redFlags.length > 0) return verState(v)
  // 'unverified' (and unflagged skips): the status is real while a verify
  // target exists — installable payload parts plus a pinned npm version or
  // github commit sha. With neither, the slot can never be measured.
  if (!hasInstallPath(e) && !hasVerifyTarget(e))
    return { text: 'nothing to install', cls: 'muted', zh: '没有可安装的包' }
  return v.status === 'skipped'
    ? { text: 'unverified', cls: 'muted', zh: '还没验' }
    : verState(v)
}
/** approval badge — 'legacy' entries predate the review gate; 'approved' needs no badge. */
export function approvalBadge(e: PluginEntry): string {
  return e.approval === 'legacy' ? ` <span class=muted data-en="legacy" data-zh="门禁前收录">legacy</span>` : ''
}
/** user-visible entries — pending (under-review) entries never render on the site. */
export const isVisible = (e: PluginEntry): boolean => e.approval !== 'pending'

/** The installable parts an entry claims. An explicit `contains` — including
 *  [] — is authoritative ([] = no installable payload); only a MISSING field
 *  (legacy entries) falls back on `type`. Same rule as the client's
 *  installPlan and verify's verifyPartsOf — the routing sites must not drift:
 *  installHint, the list-page parts filter, AND the skill-catalog candidate
 *  filter all go through this. */
const entryParts = (e: Pick<PluginEntry, 'contains' | 'type'>): string[] =>
  e.contains !== undefined ? e.contains
    : e.type === 'skill' ? ['skill']
    : e.type === 'plugin' ? ['plugin']
    : []
/** Repo id usable for codeload/skill paths — same validity gate as
 *  buildSkillCatalog and the client installPlan. */
const ghRepoOf = (e: Pick<PluginEntry, 'source'>): string | null =>
  e.source?.kind === 'github' && /^[\w.-]+\/[\w.-]+$/.test(e.source?.repo ?? '')
    ? e.source!.repo! : null

/** The two install-path halves, mirroring the market client's installPlan
 *  exactly: 'plugin' needs a pinned spec — npm name@ver or github
 *  owner/repo#sha (the client installs git specs via `plugin add`); 'skill'
 *  resolves npm-tarball or github-codeload. installHint and verifyLabel
 *  both route through this so the label and the hint on the same page can
 *  never disagree. */
const GIT_SHA_SITE = /^[0-9a-f]{7,64}$/
const installPaths = (e: PluginEntry): { plugin: boolean; skill: boolean } => {
  const gh = e.source?.kind === 'github'
  const parts = entryParts(e)
  return {
    plugin: parts.includes('plugin') &&
      (gh ? ghRepoOf(e) !== null && GIT_SHA_SITE.test(e.source?.version ?? '') : !!e.latestVersion),
    skill: parts.includes('skill') && (gh ? ghRepoOf(e) !== null : !!e.latestVersion),
  }
}
const hasInstallPath = (e: PluginEntry): boolean => {
  const p = installPaths(e)
  return p.plugin || p.skill
}
/** A verify measurement is possible when the slot has BOTH an installable
 *  payload for the runner (plugin|skill parts — the set verifyPartsOf
 *  queues) and a pinned target: npm latestVersion or a github commit sha
 *  (verify/plan refuses unpinned git targets). Display-scoped: the label
 *  describes e.verification, the displayed slot — pendingUpdate's candidate
 *  parts live on the hold and are not this label's subject. */
const hasVerifyTarget = (e: PluginEntry): boolean => {
  const parts = entryParts(e)
  if (!parts.includes('plugin') && !parts.includes('skill')) return false
  return !!e.latestVersion
    || (e.source?.kind === 'github' && !!e.source.version)
}

/** Install instruction matching the market client's installPlan rules —
 *  npm plugins pin `name@ver`; github plugins pin `owner/repo#<sha>` (the
 *  reviewed commit — a bare repo would float to unreviewed HEAD). Entries
 *  with no valid pin print no `plugin add` line that cannot work. Skills
 *  point at the site's own skills catalog.
 *  `up` is the relative prefix back to site root (depth of the detail page). */
export function installHint(e: PluginEntry, up = '../', landed?: Set<string>): string {
  const paths = installPaths(e)
  const bits: string[] = []
  if (paths.plugin) {
    // github-kind installs the reviewed commit, not a version: the spec is
    // owner/repo#<sha> — the same bytes scan/AI/verify anchored on (a bare
    // repo ref would float to unreviewed HEAD). paths.plugin already gated
    // repo validity + sha shape, so the emitted spec is always well-formed.
    bits.push(e.source?.kind === 'github'
      ? `${bi('plugin:', '插件：')} <code>opencode plugin add ${esc(e.source!.repo!)}#${esc(e.source!.version!)}</code>`
      : `${bi('plugin:', '插件：')} <code>opencode plugin add ${esc(e.name)}@${esc(e.latestVersion!)}</code>`)
  }
  // landed = slugs whose skill files actually shipped this build — a fetch
  // failure or skip_skills run must not link an empty catalog slot. The npm/
  // codeload install path in the market client is unaffected, so degrade to
  // a note rather than promise a catalog entry that isn't there.
  if (paths.skill)
    bits.push(landed && !landed.has(e.slug)
      ? bi('skill: not yet in this site\'s catalog — the market client still installs it from the pinned source', '技能：尚未进入本站目录——市场客户端仍可从钉定来源安装')
      : `${bi('skill:', '技能：')} <a href="${up}skills.html">${bi('skills catalog', '技能目录')}</a>`)
  return bits.length
    ? `<p class=meta>${bits.join(' · ')}</p>`
    : `<p class=meta>${bi('no client install path yet — browse only', '暂无客户端安装路径——仅可浏览')}</p>`
}

const CSS = `body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#222}
a{color:#06c;text-decoration:none}code{background:#f4f4f4;padding:1px 4px;border-radius:3px;overflow-wrap:anywhere}
.ok{color:#080}.warn{color:#a60}.bad{color:#c00}.muted{color:#999}
.card{border:1px solid #ddd;border-radius:6px;padding:12px;margin:8px 0;overflow-wrap:anywhere}
.meta{color:#666;font-size:12px}h1,h2{margin:.5em 0}td{vertical-align:top;padding:1px 8px 1px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;overflow-x:auto}
@media(prefers-color-scheme:dark){body{background:#141414;color:#ddd}.card{border-color:#333}code{background:#2a2a2a}a{color:#6af}.ok{color:#6d6}.warn{color:#e8b34d}.bad{color:#f77}.meta{color:#999}}`

/** Normalize a repo URL before it lands in PUBLIC hrefs — esc() stops HTML
 *  injection, not scheme/userinfo injection. scp-form 'git@host:o/r' and
 *  'ssh://user@host/o/r' collapse to https; userinfo is stripped (a
 *  token-embedded remote — `https://x-access-token:…@host/o/r` — would
 *  otherwise leak credentials into every page footer and repo link);
 *  http upgrades to https; query/hash/junk paths are dropped; any scheme a
 *  browser should never follow (javascript:, file:, garbage) → null so the
 *  caller falls back instead of publishing a hostile href. */
export function normalizeRepoUrl(u: string): string | null {
  const httpish = u.trim()
    .replace(/^[\w.-]+@([\w.-]+):/, 'https://$1/')      // scp-style 'git@host:path'
    .replace(/^ssh:\/\/[^@/]*@/i, 'https://')           // 'ssh://user@host/path'
  try {
    const p = new URL(httpish)
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return null
    p.username = p.password = ''
    p.protocol = 'https:'
    p.search = p.hash = ''
    return (p.origin + p.pathname).replace(/\/+$/, '').replace(/\.git$/i, '')
  } catch { return null }
}
const DEFAULT_REPO_URL = 'https://github.com/awesome-market/awesome-opencode-market'
/** Footer repo link — env override, else this repo's own origin remote
 *  (memoized; a rename/transfer must not 404 every page footer). */
let memoRepo: string | null = null
function siteRepoUrl(): string {
  if (memoRepo) return memoRepo
  const env = process.env.MARKET_REPO_URL
  if (env) { const n = normalizeRepoUrl(env); if (n) return (memoRepo = n) }
  try {
    const u = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    memoRepo = normalizeRepoUrl(u) ?? DEFAULT_REPO_URL
  } catch {
    memoRepo = DEFAULT_REPO_URL
  }
  return memoRepo
}

/** Repo-name segment for the Pages base path. normalizeRepoUrl first: it
 *  collapses scp/ssh forms, strips .git AND trailing slashes — the old
 *  split('/').pop() returned '' on a trailing-slash remote, silently
 *  degrading a project page to base '/' (every absolute 404 link dead). */
export const repoNameOf = (u: string): string => normalizeRepoUrl(u)?.split('/').pop() ?? ''

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
    name = repoNameOf(u)
  } catch { /* no remote */ }
  memoBase = name && !name.endsWith('.github.io') ? `/${name}/` : '/'
  return memoBase
}

/** SITE_URL env → skills-snippet origin: strip trailing slashes, upgrade
 *  http→https — Pages is always TLS, so an http:// override would publish a
 *  dead config snippet (opencode skills[] wants a fetchable URL). */
export const normalizeSiteUrl = (u: string): string =>
  u.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://')

/** Absolute site origin for copy-paste config (opencode.json skills[] needs a
 *  URL, not a path). SITE_URL env (set by site.yml to the real Pages origin)
 *  wins; otherwise derive owner.github.io/<repo> from the same remote as
 *  siteRepoUrl — a non-GitHub remote yields null and the snippet is omitted. */
let memoSiteUrl: string | null | undefined
function siteOriginUrl(): string | null {
  if (memoSiteUrl !== undefined) return memoSiteUrl
  let u = process.env.SITE_URL ? normalizeSiteUrl(process.env.SITE_URL) || null : null
  if (!u) {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(siteRepoUrl())
    // org/user page repos are named <owner>.github.io and serve from the origin
    if (m) u = m[2]!.endsWith('.github.io') ? `https://${m[2]}` : `https://${m[1]}.github.io/${m[2]}`
  }
  return (memoSiteUrl = u)
}

/** `up` = relative prefix back to site root ('' on root pages, '../'×depth on
 *  detail pages, absolute site base on 404.html) — footer's privacy link uses it. */
export function page(title: string, body: string, up = ''): string {
  return `<!doctype html><html lang="en"><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=description content="opencode plugin/skill catalog — scan and install-verify status per entry"><title>${esc(title)} · opencode market</title><style>${CSS}</style>${body}<footer class=meta><p><span id=langsw><button type=button data-l=en>EN</button> · <button type=button data-l=zh>中文</button></span> · <a href="${esc(up)}privacy.html" data-en="privacy" data-zh="隐私">privacy</a> · <a href="${esc(siteRepoUrl())}" data-en="source" data-zh="源码">source</a></p><p>${bi('Not affiliated with opencode. "Scanned, no findings" does not mean safe.', '与 opencode 无隶属关系。"已扫描·无发现"不等于安全。')}</p></footer>${LANG_JS}</html>`
}

export function listPage(index: CatalogIndex): string {
  const visible = index.plugins.filter(isVisible)
  // same default order as the market client's sortEntries: verified first,
  // then unverified/skipped/failed, red-flagged entries sink below every
  // unflagged one, name asc on ties — the safe choice should be the default.
  const rank = (e: PluginEntry): number => {
    if (e.capabilities.redFlags.length) return 9
    const order: Record<string, number> = { verified: 0, unverified: 1, skipped: 2, failed: 3 }
    return order[e.verification.status] ?? 1
  }
  const ordered = [...visible].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const cats = [...new Set(visible.flatMap(e => e.category))].sort()
  // payload filter — resolved through the same entryParts rule as installHint
  // (explicit contains authoritative, type fallback for legacy rows).
  const partsSeen = [...new Set(visible.flatMap(entryParts))].sort()
  const catName = (id: string) => {
    const c = index.categories?.[id]
    return c ? c.en + (c.zh ? ` · ${c.zh}` : '') : id
  }
  const cards = ordered.map(e => {
    const s = scanLabel(e), v = verifyLabel(e)
    const badges = [
      e.deprecated ? `<span class=bad data-en="deprecated" data-zh="已弃用">deprecated</span>` : '',
      e.pendingUpdate ? `<span class=muted data-en="update under review" data-zh="有更新在审">update under review</span>` : '',
      approvalBadge(e).trim(),
    ].filter(Boolean).join(' · ')
    const aka = e.aliases.length ? `<div class=meta>${bi('aka', '又名')} ${e.aliases.map(a => esc(a)).join(', ')}</div>` : ''
    // unsafe slugs are skipped at write time (see buildSite) — don't link a
    // card to a page that was never written; corrupt data gets a name, not a 404
    const href = slugSafe(e.slug) ? `<a href="${esc(detailHref(e.slug))}">` : ''
    return `<div class=card data-cats="${esc(JSON.stringify(e.category))}" data-parts="${esc(JSON.stringify(entryParts(e)))}">${href}<b>${esc(e.name)}</b>${href ? '</a>' : ''} <code>${esc(e.type)}</code>${badges ? ` ${badges}` : ''}
      <div>${esc(e.description.en ?? '')}${e.description.zh ? `<div class=meta>${esc(e.description.zh)}</div>` : ''}</div>${aka}
      <div class=meta>${lbl(s)} · ${lbl(v)}${e.latestVersion ? ` · v${esc(e.latestVersion)}` : ''}</div></div>`
  }).join('\n')
  // data-cats/data-parts hold the raw JSON arrays (entity-escaped); the filter
  // parses them back so exact matching can't be fooled by quote/backslash chars.
  const filterJs = `function F(){const q=document.getElementById('q').value.toLowerCase(),c=document.getElementById('cat')?.value||'',p=document.getElementById('part')?.value||'';document.querySelectorAll('.card').forEach(e=>{let ok=!q||(e.textContent.toLowerCase().includes(q)||[...e.querySelectorAll('[data-en][data-zh]')].map(x=>x.getAttribute('data-en')+' '+x.getAttribute('data-zh')).join(' ').toLowerCase().includes(q));if(ok&&c){try{ok=JSON.parse(e.dataset.cats).includes(c)}catch{ok=false}}if(ok&&p){try{ok=JSON.parse(e.dataset.parts).includes(p)}catch{ok=false}}e.style.display=ok?'':'none'})}`
  const empty = visible.length ? '' : `<p class=muted>${bi('no entries yet — the catalog is empty or still syncing', '暂无条目——目录为空或仍在同步')}</p>`
  return page('catalog', `<h1>opencode market</h1><p class=meta>${bi(`${visible.length} entries`, `${visible.length} 个条目`)} · ${bi('generated', '生成于')} ${esc(index.generatedAt)} · <a href="skills.html" data-en="skills" data-zh="技能">skills</a> · <a href="removed.html" data-en="removed" data-zh="已移除">removed</a> · <a href="${esc(siteRepoUrl())}/tree/catalog/digest" data-en="digest" data-zh="日报">digest</a></p>
    <input id=q data-en-ph="search" data-zh-ph="搜索名称/描述" placeholder=search style="width:100%;padding:8px;margin:8px 0" oninput="F()">${cats.length ? `<select id=cat onchange="F()" style="padding:8px;margin:8px 0"><option value="" data-en="all categories" data-zh="全部分类">all categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(catName(c))}</option>`).join('')}</select>` : ''}${partsSeen.length > 1 ? `<select id=part onchange="F()" style="padding:8px;margin:8px 0"><option value="" data-en="all parts" data-zh="全部部件">all parts</option>${partsSeen.map(pt => `<option value="${esc(pt)}">${esc(pt)}</option>`).join('')}</select>` : ''}<script>
    ${filterJs}
    </script>${empty}${cards}`)
}

export function detailPage(e: PluginEntry, verdicts?: AiVerdict[], landed?: Set<string>): string {
  const s = scanLabel(e), v = verifyLabel(e)
  // this page lives at p/<slug>.html — slugs can nest (owner/repo, @scope/name),
  // so links back to site root need one "../" per slug segment
  const up = '../'.repeat(e.slug.split('/').length)
  const rows = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')
  // AGENTS: findings/redFlags 默认收起 — collapsed into <details> even on the
  // detail page; red-flag lines get a marker so they stand out when expanded
  const findingsBlock = (caps: Caps, enLabel: string, zhLabel: string): string => {
    if (!caps.findings.length) return ''
    const rf = new Set(caps.redFlags)
    const summary = caps.redFlags.length
      ? `${enLabel} (${caps.findings.length}, ${caps.redFlags.length} red flag)`
      : `${enLabel} (${caps.findings.length})`
    const summaryZh = caps.redFlags.length
      ? `${zhLabel}（${caps.findings.length} 条，其中 ${caps.redFlags.length} 个高危信号）`
      : `${zhLabel}（${caps.findings.length} 条）`
    return `<details><summary>${bi(summary, summaryZh)}</summary><ul>${caps.findings.map(f => `<li><code>${esc(f)}</code>${rf.has(f) ? ` <span class=bad data-en="red flag" data-zh="高危信号">red flag</span>` : ''}</li>`).join('')}</ul></details>`
  }
  // scannedAt:null must not read as "checked, nothing found" — the scan
  // status row carries the label, but the findings block repeating "none"
  // under it would imply a clean scan on its own (AGENTS 没扫到≠安全).
  const findings = e.capabilities.findings.length
    ? findingsBlock(e.capabilities, 'findings', '扫描发现')
    : e.capabilities.scannedAt === null
      ? `<p class=muted>${bi('not scanned — nothing was analyzed; empty here ≠ clean', '未扫描——没有分析过；这里为空≠检净')}</p>`
      : `<p class=muted>${bi('none', '无')}</p>`
  const pu = e.pendingUpdate
  const puScan = pu ? scanState(pu.capabilities) : null
  const puVer = pu ? verState(pu.verification) : null
  const puReason = pu?.reason === 'awaiting-review' ? bi('awaiting review', '等待评审') : pu?.reason ? esc(pu.reason) : ''
  const underReview = pu
    ? `<tr><td>${bi('next version', '候选新版本')}</td><td><code>v${esc(pu.version)}</code> ${bi('under review — not installable yet', '在审——暂不可装')}
      <br><span class=meta>${bi('verify:', '验证：')} ${lbl(puVer!)}${pu.verification.status === 'failed' && pu.verification.retries ? ` (${bi('retry', '重试')} ${pu.verification.retries})` : ''} · ${bi('scan:', '扫描：')} ${lbl(puScan!)}${pu.publishedAt ? ` · ${bi('published', '发布于')} ${esc(pu.publishedAt.slice(0, 10))}` : ''} · ${bi('held', '暂存于')} ${esc(pu.heldAt.slice(0, 10))}</span>
      ${pu.integrity ? `<br><span class=meta>${bi('integrity:', '完整性：')} <code>${esc(pu.integrity)}</code></span>` : ''}
      ${puReason ? `<br><span class=meta>${puReason}</span>` : ''}${pu.verification.runUrl ? ` ${linkOrText(pu.verification.runUrl, bi('verify logs', '验证日志'))}` : ''}</td></tr>` : ''
  const puFindings = pu && pu.capabilities.findings.length
    ? `<h2>${bi(`next version findings (v${pu.version})`, `候选版本扫描发现（v${pu.version}）`)}</h2>${findingsBlock(pu.capabilities, 'findings', '扫描发现')}` : ''
  const puLog = pu?.verification.logExcerpt
    ? `<details><summary><b>${bi('next version failure log', '候选版本失败日志')}</b></summary><pre>${esc(pu.verification.logExcerpt)}</pre></details>` : ''
  const reviewLink = `${siteRepoUrl()}/issues?q=${encodeURIComponent(`is:issue [review] ${e.name}`)}`
  // verdict audit surface (G1): the record itself lives on the catalog branch —
  // surface the recent lines so "why was this braked/released" doesn't require
  // digging through ai-verdicts.jsonl. Collapsed like findings (AGENTS rule):
  // audit detail is there when wanted, not in the main reading path.
  // name matching is case-insensitive — same rule as verdicts.ts vkey():
  // github entries keep canonical 'Owner/Repo' casing while verdict lines
  // arrive typed/lowercased; an exact-match lookup would show an empty audit
  // trail on the public detail page while the pipeline holds the verdict.
  const en = e.name.toLowerCase()
  const mine = (verdicts ?? []).filter(x => x.name.toLowerCase() === en)
    .sort((a, b) => atCmp(b.at, a.at)).slice(0, 10)
  const allMine = verdicts?.filter(x => x.name.toLowerCase() === en).length ?? 0
  // verdict reasons are bilingual in the record: AI lines carry zh in reason
  // and en in reasonEn — route both through bi() like every other label so
  // the en page isn't left reading Chinese (and vice versa). Human lines
  // usually have only reason, which then serves both attributes.
  const trunc = (s: string | undefined) => [...(s ?? '')].slice(0, 200).join('')
  const verdictBlock = mine.length
    ? `<h2>${bi('verdicts', '裁决记录')}</h2><details><summary>${bi(`review record (${mine.length}${allMine > mine.length ? ` of ${allMine}` : ''})`, `评审记录（${mine.length}${allMine > mine.length ? `/${allMine}` : ''}）`)}</summary><table>` +
      mine.map(x => `<tr><td class=meta>${esc(x.at.slice(0, 10))}</td>` +
        `<td><b>${x.verdict}</b>${x.version ? ` <code>@${esc(x.version)}</code>` : ''}</td>` +
        `<td>${esc(x.source)}${x.by ? ` · ${esc(x.by)}` : ''}${x.issue ? ` · <a href="${siteRepoUrl()}/issues/${x.issue}">#${x.issue}</a>` : ''}</td>` +
        `<td>${x.reasonEn ? bi(trunc(x.reasonEn), trunc(x.reason)) : esc(trunc(x.reason))}</td></tr>`).join('') +
      `</table><p class=meta>${bi('full log:', '完整流水：')}<a href="${siteRepoUrl()}/blob/catalog/ai-verdicts.jsonl">ai-verdicts.jsonl</a> · ${bi('maturity digest:', '成熟度公告：')}<a href="${siteRepoUrl()}/tree/catalog/digest">digest</a></p></details>`
    : ''
  return page(e.name, `<h1>${esc(e.name)}${approvalBadge(e)}${e.deprecated ? ` <span class=bad data-en="deprecated" data-zh="已弃用">deprecated</span>` : ''}</h1><p>${esc(e.description.en ?? '')}${e.description.zh ? `<br><span class=meta>${esc(e.description.zh)}</span>` : ''}</p>
    <table>${rows({
      [bi('type', '类型')]: esc(e.type), [bi('slug', '标识')]: `<code>${esc(e.slug)}</code>`,
      [bi('aliases', '别名')]: e.aliases.length ? e.aliases.map(a => `<code>${esc(a)}</code>`).join(' ') : undefined,
      [bi('contains', '包含部件')]: e.contains?.length ? esc(e.contains.join(', ')) : undefined,
      [bi('features', '功能')]: e.features?.length ? esc(e.features.join(', ')) : undefined,
      [bi('license', '许可证')]: e.license ? esc(e.license) : bi('unknown', '未知'),
      [bi('version', '版本')]: e.latestVersion ? esc(e.latestVersion) : undefined,
      [bi('published', '发布时间')]: e.publishedAt ? esc(e.publishedAt.slice(0, 10)) : undefined,
      [bi('created', '创建于')]: e.createdAt ? esc(e.createdAt.slice(0, 10)) : undefined,
      [bi('modified', '更新于')]: e.modifiedAt ? esc(e.modifiedAt.slice(0, 10)) : undefined,
      [bi('repo', '仓库')]: e.source.repo ? `<a href="https://github.com/${esc(e.source.repo)}">${esc(e.source.repo)}</a>` : undefined,
      [bi('npm', 'npm')]: e.source.kind === 'npm' ? `<a href="https://www.npmjs.com/package/${esc(e.name)}">${esc(e.name)}</a>` : undefined,
      [bi('maintainers', '维护者')]: e.maintainers.length ? esc(e.maintainers.join(', ')) : undefined,
      [bi('discovered via', '收录途径')]: e.discoveredVia.length ? esc(e.discoveredVia.join(', ')) : undefined,
      [bi('integrity', '完整性校验')]: e.integrity ? `<code style="word-break:break-all">${esc(e.integrity)}</code>` : undefined,
      [bi('npm (30d)', 'npm 30天下载')]: e.metrics.npmDownloads30d?.toLocaleString(),
      [bi('npm (month)', 'npm 本月下载')]: e.metrics.downloadsMonth?.toLocaleString(),
      [bi('stars', '星标')]: e.metrics.stars?.toLocaleString(),
      [bi('stars (30d)', '30天星标增长')]: e.metrics.starsDelta30d != null ? `${e.metrics.starsDelta30d >= 0 ? '+' : ''}${e.metrics.starsDelta30d.toLocaleString()}` : undefined,
      [bi('first seen', '首次收录')]: esc(e.firstSeenAt.slice(0, 10)),
      [bi('compat', '兼容性')]: (e.compat.engines || e.compat.peer) ? esc([e.compat.engines, e.compat.peer].filter(Boolean).join(' · ')) : undefined,
      [bi('scan status', '扫描状态')]: lbl(s),
      [bi('verify status', '验证状态')]: lbl(v),
      [bi('verified at', '实测时间')]: e.verification.verifiedAt ? esc(e.verification.verifiedAt.slice(0, 10)) : undefined,
      [bi('opencode ver', 'opencode 版本')]: e.verification.opencodeVersion ? esc(e.verification.opencodeVersion) : undefined,
      [bi('verify run', '验证记录')]: e.verification.runUrl ? linkOrText(e.verification.runUrl, bi('logs', '日志')) : undefined,
      [bi('verify retries', '验证重试')]: e.verification.status === 'failed' && e.verification.retries ? esc(String(e.verification.retries)) : undefined,
      // the bytes the verify run actually measured (SRI/commit sha) — distinct
      // from the slot's pinned integrity, which may point elsewhere after a re-tag
      [bi('verify integrity', '实测完整性')]: e.verification.integrity ? `<code style="word-break:break-all">${esc(e.verification.integrity)}</code>` : undefined,
      [bi('deprecated', '已弃用')]: e.deprecated ? `<span class=bad data-en="deprecated" data-zh="已弃用">deprecated</span>` : undefined,
      [bi('deprecated note', '弃用说明')]: e.deprecatedMessage ? esc(e.deprecatedMessage) : undefined,
      [bi('replacement', '替代品')]: e.replacement ? `<code>${esc(e.replacement)}</code>` : undefined,
      [bi('review', '评审')]: `<a href="${esc(reviewLink)}">${bi('audit trail', '评审档案')}</a>`,
    })}${underReview}</table>
    <h2>${bi('scan findings', '扫描发现')}</h2>${findings}
    ${puFindings}
    ${e.verification.logExcerpt ? `<details><summary><b>${bi('failure log', '失败日志')}</b></summary><pre>${esc(e.verification.logExcerpt)}</pre></details>` : ''}
    ${puLog}
    ${verdictBlock}
    <p class=meta><a href="${up}index.html" data-en="← all plugins" data-zh="← 全部插件">← all plugins</a></p>${installHint(e, up, landed)}`, up)
}

/** Slug → filesystem path safety: detail pages write `p/<slug>.html`, so a
 *  crafted index.json slug must never escape `p/` (`..`, empty/`.` segments,
 *  backslashes, control chars). Real slugs are npm names / owner/repo —
 *  this only rejects corrupt data; the entry still ships in index.json. */
const slugSafe = (slug: string): boolean =>
  slug.length <= 400 && slug.split('/').every(seg =>
    seg !== '' && seg !== '.' && seg !== '..' && !/[\\\x00-\x1f\x7f]/.test(seg))

export async function buildSite(index: CatalogIndex, outDir: string, cacheDir?: string, verdictsPath?: string): Promise<void> {
  rmSync(outDir, { recursive: true, force: true })   // no stale files from a previous build
  mkdirSync(join(outDir, 'p'), { recursive: true })
  // the verdicts file feeds the per-page audit trail. Same fail-closed rule
  // the fetch step applies to the FILE (cat-file -e): exists-but-unreadable,
  // or fetched-but-100%-malformed, renders a silently empty audit surface on
  // every detail page — abort the build rather than publish it. Partial
  // corruption stays tolerated: an append-only log tears occasionally, and
  // loadVerdicts already warns the dropped-line count.
  const verdicts = verdictsPath ? (() => {
    const raw = readFileSync(verdictsPath, 'utf8')   // unreadable → throw, not "empty"
    const sink = { bad: 0 }
    const v = loadVerdicts(verdictsPath, sink)
    if (raw.trim() && !v.length && sink.bad)
      throw new Error(`[site] ${verdictsPath}: ${sink.bad} malformed line(s), 0 parseable — refusing to publish an empty verdict audit surface`)
    return v
  })() : undefined
  // group once — per-page filtering over the whole append-only log would be
  // O(entries × verdicts) for no reason; each page gets only its own lines.
  const verdictsByName = new Map<string, AiVerdict[]>()
  for (const v of verdicts ?? []) {
    const k = v.name.toLowerCase()   // vkey() parity — see detailPage
    const l = verdictsByName.get(k)
    if (l) l.push(v); else verdictsByName.set(k, [v])
  }
  // index.json ships the FULL catalog (pending included) — it is the auditable
  // data plane; every UI/install surface filters pending itself.
  const indexJson = JSON.stringify(index)
  writeFileSync(join(outDir, 'index.json'), indexJson)
  const visible = { ...index, plugins: index.plugins.filter(isVisible) }
  // privacy note + health endpoint (dsh parity). sha256 = content hash of the
  // served index.json bytes — clients fetch this manifest first and only pull
  // the multi-MB index when the hash moved, then verify the downloaded bytes
  // (CDN edge staleness can't pin a mismatched hash to old content).
  writeFileSync(join(outDir, 'privacy.html'), page('privacy', `<h1>${bi('Privacy', '隐私')}</h1><p>${bi('opencode-market collects nothing. The catalog is static data; installing a plugin runs opencode plugin add locally. Local state (favorites/groups/notes) stays in localStorage on your machine.', 'opencode-market 不收集任何数据。目录是静态数据；安装插件时 opencode plugin add 在本机运行。收藏/分组/笔记等本地状态只保存在你机器的 localStorage 中。')}</p>`))
  // SKIP_SKILLS=1 (site.yml dispatch input): publish the catalog without
  // fetching skill tarballs — the escape hatch for a registry/CDN outage where
  // a degraded skills catalog would otherwise hold the whole deploy hostage.
  const skipSkills = process.env.SKIP_SKILLS === '1' || process.env.SKIP_SKILLS === 'true'
  const skillStats = skipSkills
    ? { candidates: 0, landed: 0, degraded: false, entries: [] as SkillEntry[], unpinned: 0, membersDropped: 0 }
    : await buildSkillCatalog(visible, outDir, undefined, cacheDir)
  if (skipSkills) {
    mkdirSync(join(outDir, 'skills'), { recursive: true })
    writeFileSync(join(outDir, 'skills', 'index.json'), '{"skills":[]}')
  }
  writeFileSync(join(outDir, 'health.json'), JSON.stringify({
    ok: true,
    // entries = VISIBLE count (info only); total = full catalog incl. pending —
    // healthGate compares totals: a mass brake legitimately collapses visible
    // while the data plane stays intact, and must not freeze the deploy.
    entries: visible.plugins.length,
    total: index.plugins.length,
    // strip the per-skill file lists — health.json is the client's cheap
    // manifest probe (1MB cap → fall back to full index fetch); embedding the
    // catalog here made it ~130KB and growing. skills.html reads the in-memory
    // stats directly, nothing consumes entries via health.json.
    skills: { candidates: skillStats.candidates, landed: skillStats.landed, degraded: skillStats.degraded,
      // disclosure counters — unpinned = LANDED github skills served from
      // codeload HEAD (pre-sha index rows, bytes can drift from the scanned
      // tree); membersDropped = tar members cut by MAX_SKILL_MEMBERS this build.
      unpinned: skillStats.unpinned, membersDropped: skillStats.membersDropped },
    generatedAt: index.generatedAt,
    builtAt: new Date().toISOString(),
    commit: process.env.SITE_COMMIT || undefined,
    sha256: createHash('sha256').update(indexJson).digest('hex'),
    bytes: Buffer.byteLength(indexJson),
  }))
  writeFileSync(join(outDir, 'index.html'), listPage(visible))
  writeFileSync(join(outDir, 'skills.html'), skillsPage(skillStats.entries, siteOriginUrl(), skillStats))
  writeFileSync(join(outDir, 'removed.html'), removedPage(index))
  // Pages serves 404.html at the REQUESTED url — a missing deep link keeps its
  // depth, so relative links would resolve under it. Absolute site-base links
  // ("/<repo>/…" on project Pages) survive any requested depth.
  const base = siteBasePath()
  writeFileSync(join(outDir, '404.html'), page('not found', `<h1>${bi('not found', '页面不存在')}</h1><p>${bi('The page or plugin you are looking for may have been removed from the catalog, or it is still under review and not published yet.', '你要找的页面或插件可能已从目录移除，或仍在评审中未发布。')}</p><p><a href="${esc(base)}removed.html" data-en="recently removed entries" data-zh="最近移除的条目">recently removed entries</a> · <a href="${esc(base)}index.html" data-en="all plugins" data-zh="全部插件">all plugins</a></p>`, base))
  const landedSlugs = new Set(skillStats.entries.flatMap(s => s.slug ? [s.slug] : []))
  for (const e of visible.plugins) {
    if (!slugSafe(e.slug)) { console.warn(`[site] skipping detail page — unsafe slug: ${JSON.stringify(e.slug)}`); continue }
    const p = join(outDir, 'p', `${e.slug}.html`)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, detailPage(e, verdictsByName.get(e.name.toLowerCase()), landedSlugs))
  }
}

/** Deploy gate (S-3): refuse to publish a catastrophically shrunken catalog —
 *  an empty site is worse than a stale one. site.yml fetches the LIVE
 *  health.json for `prev`; fetch/parse failure → prev=null → absolute floor
 *  only. A skill-fetch outage is a third axis: `degraded` means over half the
 *  skill tarballs failed — that is an infrastructure problem, not a catalog
 *  state, and publishing would silently un-ship half the skills catalog.
 *  `floor` is SITE_FLOOR-overridable — a small curated catalog must be able
 *  to publish below the default.
 *  Ratio/floor compare TOTAL catalog size (incl. pending), not the visible
 *  count: a mass brake or tombstone wave legitimately collapses `entries`
 *  while index.json stays intact — gating on visible would freeze the brake
 *  OFF the site (the dangerous packages keep serving). `entries` remains the
 *  fallback for health.json snapshots written before `total` existed. */
export function healthGate(prev: { entries?: number; total?: number } | null,
  cur: { entries: number; total?: number; skills?: { candidates?: number; landed?: number; degraded?: boolean } },
  floor = 200): string | null {
  // a negative floor is invalid config, not "no floor" — '0' already means
  // that legitimately; silently accepting -5 would disable the catastrophic-
  // shrink gate on a typo'd SITE_FLOOR. Non-finite falls back the same way.
  const fl = Number.isFinite(floor) && floor >= 0 ? floor : 200
  const curN = cur.total ?? cur.entries
  const prevN = prev ? (prev.total ?? prev.entries) : undefined
  if (curN < fl) return `entries=${curN} below floor ${fl}`
  if (typeof prevN === 'number' && prevN > 0 && curN < prevN * 0.5)
    return `entries ${curN} < 50% of previous deploy ${prevN}`
  const sk = cur.skills
  if (sk?.degraded && (sk.candidates ?? 0) >= 10)
    return `skills degraded: ${sk.landed}/${sk.candidates} landed`
  return null
}

/** One row of the skills catalog. `slug` is page-only metadata — it carries
 *  the detail-page backlink and is STRIPPED from the published index.json so
 *  the {name,version,files} contract opencode consumes stays unchanged. */
export interface SkillEntry { name: string; version: string; files: string[]; slug?: string }

/** skills index → browseable page (files are served as raw files). Href paths
 *  are encodeURI'd — esc() alone leaves spaces/unicode bare and Pages 404s.
 *  `skillsUrl` = the absolute catalog URL for the copy-paste opencode.json
 *  snippet — without it the page lists files but never says how to USE them
 *  (AGENTS: a functional page owes the reader the next step). */
export function skillsPage(entries: SkillEntry[], skillsUrl?: string | null,
  stats?: { unpinned?: number; membersDropped?: number }): string {
  const usage = skillsUrl
    ? `<div class=card>${bi('add this catalog to', '把本目录加入')} <code>opencode.json</code> ${bi('and every skill below becomes loadable:', '即可加载下列全部技能：')}<pre>"skills": ["${esc(skillsUrl)}"]</pre>${bi('or install individual skills via the market client/plugin — each card links its catalog entry.', '也可以用市场客户端/插件逐个安装——每张卡片链接到对应目录条目。')}</div>`
    : ''
  // honest caveats, only when nonzero: unpinned github skills serve codeload
  // HEAD (bytes may differ from the originally scanned tree); membersDropped
  // means some tar members beyond the per-skill cap were not published.
  const caveats = [
    stats?.unpinned ? bi(`${stats.unpinned} github skill(s) lack a commit-sha pin (pre-anchoring catalog rows fetch the repo's current HEAD — contents may differ from what was originally scanned)`, `${stats.unpinned} 个 github 技能缺少 commit-sha 钉定（早于锚定的目录行抓取仓库当前 HEAD——内容可能与最初扫描时不同）`) : '',
    stats?.membersDropped ? bi(`${stats.membersDropped} tar member(s) exceeded the per-skill file cap and were not published`, `${stats.membersDropped} 个归档成员超出单技能文件数上限，未发布`) : '',
  ].filter(Boolean).join(' · ')
  const cards = entries.map(s => {
    const ver = s.version.length > 12 ? `${s.version.slice(0, 10)}…` : s.version
    const detail = s.slug && slugSafe(s.slug) ? ` · <a href="${esc(detailHref(s.slug))}">${bi('details', '详情')}</a>` : ''
    return `<div class=card><b>${esc(s.name)}</b> <code>v${esc(ver)}</code> ${bi(`${s.files.length} file(s)`, `${s.files.length} 个文件`)}${detail}<div class=meta>${s.files.map(f => `<a href="skills/${esc(encodeURI(s.name))}/${esc(encodeURI(f))}">${esc(f)}</a>`).join(' · ') || bi('no files', '无文件')}</div></div>`
  }).join('\n')
  const empty = entries.length ? '' : `<p class=muted>${bi('no skills published yet — skill files are fetched during the site build and may be temporarily unavailable', '暂无已发布技能——技能文件在站点构建时抓取，可能暂时不可用')}</p>`
  return page('skills', `<h1>${bi('skills', '技能')}</h1><p class=meta>${bi(`${entries.length} skills`, `${entries.length} 个技能`)} · <a href="skills/index.json">index.json</a> · <a href="index.html" data-en="← all plugins" data-zh="← 全部插件">← all plugins</a></p>${usage}${caveats ? `<p class=meta>${caveats}</p>` : ''}${empty}${cards}`)
}

/** Recently removed entries — explains the 404s for vanished plugins. */
const REMOVED_REASON: Record<string, { en: string; zh: string }> = {
  'npm-404': { en: 'unpublished from npm', zh: 'npm 上已消失' },
  'repo-404': { en: 'repository deleted', zh: '仓库已消失' },
  filtered: { en: 'filtered out by admission checks', zh: '被入场过滤移除' },
  capped: { en: 'dropped by catalog cap', zh: '超出目录上限' },
  manual: { en: 'removed by maintainer', zh: '被人工移除' },
  unknown: { en: 'no longer seen (cause unknown)', zh: '原因未知' },
}
export function removedPage(index: CatalogIndex): string {
  // atCmp shape but NaN-safe: disappearedAt is a bare z.string() — an
  // unparseable value must not NaN the comparator into arbitrary order.
  // Unparseable rows sink to the bottom (unknown date ≠ newest) and order
  // lexically among themselves; the tiebreak is codepoint `<`/`>` like
  // atCmp, not localeCompare (locale collation is environment-dependent).
  const ts = (s: string) => { const p = Date.parse(s); return Number.isNaN(p) ? Number.NEGATIVE_INFINITY : p }
  const rem = [...(index.removed ?? [])].sort((a, b) => {
    const d = ts(b.disappearedAt) - ts(a.disappearedAt)
    return (Number.isNaN(d) ? 0 : d) ||
      (b.disappearedAt < a.disappearedAt ? -1 : b.disappearedAt > a.disappearedAt ? 1 : 0)
  })
  const shown = rem.slice(0, 300)
  const cards = shown.map(r => {
    const src = r.lastSource?.repo ? ` · <a href="https://github.com/${esc(r.lastSource.repo)}">${esc(r.lastSource.repo)}</a>`
      : r.lastSource?.id ? ` · <code>${esc(r.lastSource.id)}</code>` : ''
    const reason = REMOVED_REASON[r.reason]
    const reasonHtml = reason ? bi(reason.en, reason.zh) : esc(r.reason)
    return `<div class=card><b>${esc(r.name)}</b> <code>${esc(r.slug)}</code><div class=meta>${reasonHtml} · ${bi('removed', '移除于')} ${esc(r.disappearedAt.slice(0, 10))}${src}</div></div>`
  }).join('\n')
  const note = rem.length > shown.length
    ? ` · ${bi('earlier records remain in index.json → removed[]', '更早记录见 index.json → removed[]')}` : ''
  return page('removed', `<h1>${bi('removed entries', '已移除条目')}</h1><p class=meta>${bi(`${rem.length} total`, `共 ${rem.length} 条`)} · ${bi('latest 300 shown', '显示最新 300 条')}${note} · <a href="index.html" data-en="← all plugins" data-zh="← 全部插件">← all plugins</a></p>${cards || `<p class=muted>${bi('none', '无')}</p>`}`)
}

/** HTTP skill catalog (opencode docs/skills): site/skills/index.json + per-skill files
 *  pulled from npm tarballs / codeload, so `skills: ["<site>/skills/"]` makes the
 *  whole catalog's skills loadable — files update whenever version bumps.
 *  Fetches run in a bounded worker pool (S-14): a cold cache otherwise costs
 *  N × (packument + curl + tar) serially. */
const SKILL_POOL = 8
const MAX_SKILL_TGZ = 48 * 1024 * 1024   // parity with the client's installSkillTar cap
const MAX_SKILL_MEMBERS = 100            // bounded argv + publish surface
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024
const MAX_SKILL_TOTAL_BYTES = 20 * 1024 * 1024
/** Publishable skill-payload filenames — everything except control chars and
 *  URL-breaking characters (", ', `, #, %, ?, *, :, <, >, |, \). Unicode fine. */
const SAFE_MEMBER = /^[^\x00-\x1f\x7f"'`#$%?*:<>\|]+$/
/** Web-active payload types never publish to the market's own github.io
 *  origin: Pages serves .html as text/html and .svg as image/svg+xml, so an
 *  approved skill carrying either could host a phishing page or script on the
 *  catalog domain. The client's own npm-tarball install path still delivers
 *  them — only the HTTP mirror drops them (files[] + on-disk). */
const ACTIVE_CONTENT = /\.(html?|xhtml|shtml|svg|js|mjs|cjs)$/i
/** Subresource-Integrity check across the algos npm actually emits — the
 *  client's integrityMatches only understands sha512 and treats anything else
 *  as unverifiable; the site verifies whatever algo the index announced.
 *  Returns null for an UNPARSEABLE tag — callers must treat null like a
 *  mismatch (fail closed): an announced-but-unverifiable SRI is corrupt index
 *  data, and publishing unverified bytes under it would fake the
 *  served-bytes=reviewed-bytes invariant. (An entry announcing NO integrity
 *  skips the check entirely — there is nothing to verify against.) */
const sriOk = (buf: Buffer, sri: string): boolean | null => {
  const m = /^(sha256|sha384|sha512|sha1)-([A-Za-z0-9+/=]+)$/.exec(sri.trim())
  if (!m?.[1]) return null
  return `${m[1]}-${createHash(m[1]).update(buf).digest('base64')}` === sri.trim()
}
/** Default npm tarball resolver — ONE packument GET per package name carries
 *  every version's dist.tarball; `npm view <spec>` per skill spawned a node
 *  process each and dominated cold builds (~275 spawns). Cache is per-build. */
function npmTarballResolver(): (spec: string) => Promise<string | null> {
  const registry = (process.env.npm_config_registry ?? 'https://registry.npmjs.org/').replace(/\/?$/, '/')
  const cache = new Map<string, Promise<Record<string, any> | null>>()
  const packument = (name: string) => {
    let p = cache.get(name)
    if (!p) {
      p = (async () => {
        try {
          // encodeURIComponent parity with the client's fetchPkgVersionMeta —
          // a crafted catalog name containing '/', '?', '..' must not steer
          // the packument request onto a different registry path (the SRI
          // gate only covers entries that announce integrity)
          const u = `${registry}${encodeURIComponent(name)}`
          const r = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } })
          // bounded read — same 64MB cap fetchPackument uses. An unbounded
          // r.json() lets a hostile/glitched registry OOM the deploy job;
          // oversize → throw → caught → skill skipped, never half-parsed.
          return r.ok ? await readJsonCapped<Record<string, any>>(r, 64 * 1024 * 1024) : null
        } catch { return null }
      })()
      cache.set(name, p)
    }
    return p
  }
  return async (spec) => {
    const i = spec.lastIndexOf('@')
    const name = i > 0 ? spec.slice(0, i) : spec
    const ver = i > 0 ? spec.slice(i + 1) : ''
    const pk = await packument(name)
    const t = pk?.versions?.[ver]?.dist?.tarball
    return typeof t === 'string' && /^https:\/\//i.test(t) ? t : null
  }
}
/** skills/index.json `version` doubles as opencode's cache key — a same-version
 *  re-tag (the exact case SRI pinning exists for) serves NEW bytes under an
 *  unchanged version string, so npm skills bind the version to the approved
 *  artifact's integrity tag. github entries already pin by commit sha. */
const skillVersion = (c: { ver: string; ghRepo: string | null; s: PluginEntry }): string => {
  if (c.ghRepo || !c.s.integrity) return c.ver
  // hex digest of the announced SRI — base64 slices can carry +/= which are
  // not semver-build-metadata chars; the hash is opaque to consumers anyway
  const h = createHash('sha256').update(c.s.integrity).digest('hex').slice(0, 10)
  return `${c.ver}+${h}`
}
export async function buildSkillCatalog(index: CatalogIndex, outDir: string,
  tarballOf?: (spec: string) => string | null | Promise<string | null>,
  cacheDir?: string,
  ghTarballOf: (repo: string, sha?: string | null) => string | null =
    // source.version is the scanned tree sha — validate the pin is hex
    // before it reaches a URL: a malformed ref in a crafted index would
    // otherwise fetch un-scanned bytes (client gitPinRef fails closed too)
    (repo, sha) => {
      if (sha != null && sha !== '' && !/^[0-9a-f]{7,64}$/.test(sha)) return null
      return `https://codeload.github.com/${repo}/tar.gz/${sha ?? 'HEAD'}`
    })
  : Promise<{ candidates: number; landed: number; degraded: boolean; entries: SkillEntry[];
      /** github skills actually SERVED from codeload HEAD because the index
       *  row predates commit-sha anchoring — counted at land time so
       *  health.json/skills.html disclose what users receive, not what was
       *  merely planned during a degraded build. */
      unpinned: number;
      /** tar members dropped by MAX_SKILL_MEMBERS — tar order is
       *  attacker-controlled, so truncation is a completeness caveat worth
       *  surfacing rather than only logging to stderr. */
      membersDropped: number }> {
  // injected impls (tests) own their scheme; the default is https-validated above
  const tbOf = tarballOf ?? npmTarballResolver()
  // entryParts, not raw contains: legacy rows without the field fall back on
  // type — installPlan/installHint/verifyPartsOf already route them as
  // skills, so the HTTP catalog must not silently drop them (4th routing site)
  const skills = index.plugins.filter((p) => entryParts(p).includes('skill'))
  const dir = join(outDir, 'skills')
  mkdirSync(dir, { recursive: true })
  const entries: SkillEntry[] = []
  let membersDropped = 0   // Σ members cut by MAX_SKILL_MEMBERS across fresh fetches
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
   *  drops web-active types (ACTIVE_CONTENT — a poisoned cache must not
   *  resurrect them either), drops over-sized single files, and bails ([]) on
   *  an over-budget total. `dropped` counts every removal so a cache-hit path
   *  can re-sync the cleaned tree back over the poisoned cache entry. */
  const collectFiles = (root: string): { files: string[]; total: number; droppedActive: number; dropped: number } => {
    const out: string[] = []
    let total = 0, droppedActive = 0, dropped = 0
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        // node_modules is deleted, not just skipped — a poisoned cache copy
        // must not leave unlisted files sitting in the published tree
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules') { rmSync(p, { recursive: true, force: true }); dropped++ }
          else walk(p)
          continue
        }
        if (!ent.isFile()) { rmSync(p, { force: true }); dropped++; continue }
        if (ACTIVE_CONTENT.test(ent.name)) { rmSync(p, { force: true }); droppedActive++; dropped++; continue }
        const sz = statSync(p).size
        if (sz > MAX_SKILL_FILE_BYTES) { rmSync(p, { force: true }); dropped++; continue }
        total += sz
        out.push(p)
      }
    }
    try { walk(root) } catch { /* unreadable dir → empty */ }
    return { files: out, total, droppedActive, dropped }
  }
  // plan phase (sync + deterministic): ids are assigned in catalog order so
  // the collision suffix can't shuffle between builds; fetch work is pooled.
  interface Cand { s: PluginEntry; id: string; ver: string; dest: string; key: string; ghRepo: string | null }
  const cands: Cand[] = []
  // counted at LAND time inside work() — a planned HEAD fetch that fails
  // serves nothing, so it must not inflate the disclosure counter
  let landedUnpinned = 0
  for (const s of skills) {
    const isGh = s.source?.kind === 'github'
    const ghRepo = isGh ? ghRepoOf(s) : null
    // github version marker = the resolved commit sha (source.version) —
    // codeload pins to it so served bytes equal what the evidence gate + scan
    // saw; pushedAt (modifiedAt) is only the fallback for pre-sha index data.
    const ver = isGh ? (s.source?.version ?? s.modifiedAt) : s.latestVersion
    // kind=github but no usable repo id is corrupt index data — warn like the
    // sibling skips below instead of dropping the candidate silently
    if (isGh && !ghRepo) {
      console.warn(`[site] skill skipped — github entry without a usable repo id: ${JSON.stringify(s.source?.repo).slice(0, 120)}`)
      continue
    }
    // same observability rule as the sibling skips — a version-less skill row
    // is corrupt-ish index data worth a warn, not a silent catalog absence
    if (!ver) { console.warn(`[site] skill skipped — no version marker: ${JSON.stringify(s.name).slice(0, 120)}`); continue }
    // pre-sha rows fetch codeload HEAD — a moving target, so the served tree
    // can drift from what the (older) scan saw. Dropping them would cut ~30%
    // of github skills from the catalog for a marginal integrity gain; keep
    // serving but COUNT them so health.json/skills.html can disclose it.
    // A PRESENT-but-non-hex source.version is a different shape: ghTarballOf
    // fails closed on it, so the entry never fetches — counting it as
    // "served from HEAD" misleads the caveat; corrupt index data gets a warn.
    if (isGh) {
      const sv = s.source?.version
      if (sv != null && sv !== '' && !/^[0-9a-f]{7,64}$/.test(sv)) {
        console.warn(`[site] skill ${s.slug}: malformed source.version ${JSON.stringify(sv.slice(0, 64))} — skipped`)
        continue
      }
    }
    const base = baseOf(s.name)
    let id = ((counts.get(base) ?? 0) > 1 ? s.name.replace(/^@/, '').replace(/\//g, '--') : base) || s.slug
    while (usedIds.has(id)) id += '-x'                // S-12 deterministic suffix
    // id becomes a filesystem path under skills/ AND a published catalog
    // name — name/slug are unconstrained z.string() in the schema, so apply
    // the same segment guard detail pages get (slugSafe): '..' or a backslash
    // would let rmSync/renameSync escape the skills dir entirely. SAFE_MEMBER
    // adds the URL-safety half: id lands in `skills/<id>/<file>` hrefs via
    // encodeURI, which does NOT encode '#' '?' '%' — a catalog name carrying
    // one would publish a skill tree no URL can reach (listed but unfetchable)
    if (!slugSafe(id) || !SAFE_MEMBER.test(id)) { console.warn(`[site] skill skipped — unsafe catalog id: ${JSON.stringify(id).slice(0, 120)}`); continue }
    usedIds.add(id)
    // npm cache pins BY BYTES: dist.integrity identifies the exact tarball the
    // catalog approved — a re-tagged same-version release gets a new key and a
    // refetch, never a stale hit. github/integrity-less entries fall back to ver.
    const pin = isGh ? ver : (s.integrity ?? ver)
    cands.push({ s, id, ver, dest: join(dir, id), key: cacheKey(id, pin), ghRepo })
  }
  /** Land a fetched skill: publish the catalog entry and count github
   *  HEAD-fallbacks at SERVE time — a planned fetch that failed delivers
   *  nothing, so it must not inflate the disclosure counter. */
  const land = (c: Cand, files: string[]): void => {
    entries.push({ name: c.id, version: skillVersion(c), files, slug: c.s.slug })
    if (c.ghRepo && (c.s.source?.version == null || c.s.source?.version === '')) landedUnpinned++
  }
  const work = async (c: Cand): Promise<void> => {
    keep.add(c.key)   // preserve the pin-keyed cache even if this fetch fails — same pin = same bytes, a transient outage must not evict a good copy
    const hit = cacheDir ? join(cacheDir, c.key) : null
    // S-1: version-pinned cache — unchanged skills skip npm+curl+tar entirely.
    // A corrupt cache entry (truncated copy, not a dir) must fall through to a
    // refetch, not kill the whole catalog build.
    if (hit && existsSync(hit)) try {
      // lstat before trusting the hit: cpSync DEREFERENCES a symlinked cache
      // entry into real files — a tampered cache could materialize out-of-band
      // content into the published tree. (Nested links materialize as regular
      // files and are re-vetted by collectFiles; this covers the entry itself.
      // Cache writes are same-trust-domain, but the guard is cheap.)
      if (!lstatSync(hit).isDirectory() || lstatSync(hit).isSymbolicLink()) throw new Error('cache entry is not a real dir')
      rmSync(c.dest, { recursive: true, force: true })
      cpSync(hit, c.dest, { recursive: true })
      const { files: abs, total, droppedActive, dropped } = collectFiles(c.dest)
      if (droppedActive) console.warn(`[site] skill ${c.id}: ${droppedActive} web-active file(s) withheld from publish`)
      // the cache keeps whatever the walk just removed (rule changes or a
      // poisoned entry) — re-sync the cleaned tree so it isn't re-dropped
      // and re-warned on every future build
      if (dropped) { rmSync(hit, { recursive: true, force: true }); cpSync(c.dest, hit, { recursive: true }) }
      const files = abs.map((f) => relative(c.dest, f)).sort()
      // the member cap is a publish rule like the size cap — a cache entry
      // written before MAX_SKILL_MEMBERS existed (or hand-poisoned) must
      // refetch through the capping extractor, not ship over the bound
      if (files.length && files.length <= MAX_SKILL_MEMBERS && total <= MAX_SKILL_TOTAL_BYTES) { land(c, files); return }
      rmSync(hit, { recursive: true, force: true })   // poisoned cache → refetch
    } catch { rmSync(hit, { recursive: true, force: true }) }
    const tmp = `${c.dest}.tmp`
    // bail() cleans BOTH tmp and dest: tmp sits INSIDE outDir
    // (`skills/<id>.tmp`), so every early return below would otherwise leave
    // the extracted payload in the Pages artifact — published unlisted,
    // defeating the total-bytes cap for the over-budget skill. dest can hold
    // a stale tree when a cache-hit quality check fell through to a refetch
    // that then bails — an unlisted stale publish either way.
    const bail = (): void => {
      rmSync(tmp, { recursive: true, force: true })
      rmSync(c.dest, { recursive: true, force: true })
    }
    try {
      // pin to the approved version — resolving dist-tags.latest would serve
      // the pendingUpdate users must not receive (hold semantics).
      // github: codeload keyed by the resolved commit sha, not HEAD (version
      // marker = the pinned bytes); repo goes through execFile argv, not a shell.
      const tb = c.ghRepo ? ghTarballOf(c.ghRepo, c.s.source?.version) : await tbOf(`${c.s.name}@${c.ver}`)
      if (!tb) { bail(); return }
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      const tgz = join(tmp, 'pkg.tgz')
      // --proto-redir '=https': redirects (codeload→S3, registry mirrors) may
      // never downgrade to http; --max-filesize bounds the download itself,
      // not just the post-hoc statSync; --retry rides out transient blips.
      await execFileP('curl', ['-fsSL', '--proto-redir', '=https', '--max-filesize', String(MAX_SKILL_TGZ), '--max-time', '60', '--retry', '2', '--retry-delay', '1', tb, '-o', tgz], { timeout: 90_000 })
      // drift check: when the index announces an SRI for this version, the
      // served bytes must equal the reviewed bytes — same fail-closed rule the
      // client applies on skill install (a re-tagged tarball never ships).
      // ok !== true (not just === false): an announced-but-unparseable SRI is
      // corrupt index data — publishing unverifiable bytes under it would
      // break the served-bytes=reviewed-bytes invariant, so skip too.
      if (statSync(tgz).size > MAX_SKILL_TGZ) { console.warn(`[site] skill ${c.id}: tgz over ${MAX_SKILL_TGZ >> 20}MB — skipped`); bail(); return }
      if (!c.ghRepo && c.s.integrity) {
        const ok = sriOk(readFileSync(tgz), c.s.integrity)
        if (ok !== true) { console.warn(`[site] skill ${c.id}: integrity ${ok === false ? 'mismatch (re-tag or corrupted artifact)' : 'unverifiable (unparseable SRI)'} — skipped`); bail(); return }
      }
      // two-pass extraction (S-4/S-5): only listed members are extracted, so
      // node_modules and non-skill noise never touch disk. The name filter
      // vets member NAMES but not member TYPES: a symlink member followed by
      // 'x/<file>' writes THROUGH the link outside the temp dir during
      // extraction (bsdtar refuses; GNU tar — the CI tar — follows it). The
      // un-anchored fetch classes (HEAD-fallback github skills, integrity-less
      // npm entries) let a crafted tarball reach this path, so a parallel
      // `tvzf` pass vets types and only regular files are extracted.
      // collectFiles still deletes whatever non-file slips through. '--' ends
      // option parsing so a member named like a flag cannot be re-parsed.
      const [{ stdout }, { stdout: vlist }] = await Promise.all([
        execFileP('tar', ['tzf', tgz], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }),
        execFileP('tar', ['tvzf', tgz], { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }),
      ])
      const names = stdout.split('\n')
      // both listings stream the same archive in the same order → index-zip.
      // A member name containing '\n' desyncs the LISTS the same way in both
      // (each emits the name verbatim), so pairing stays per-line correct:
      // a symlink's own line always carries its 'l'. A count mismatch is
      // corrupt data — fail closed on the skill rather than guess at types.
      const modes = vlist.split('\n').filter(Boolean).map(l => l.trimStart().charAt(0))
      if (names.filter(Boolean).length !== modes.length) {
        console.warn(`[site] skill ${c.id}: tar listing type mismatch — skipped`); bail(); return
      }
      let mi = -1
      const all = names.filter((n) => {
        if (!n) return false
        mi++
        if (n.endsWith('/')) return false
        const segs = n.split('/')
        return !segs.includes('node_modules') && !segs.includes('..') && !segs.includes('.')
          && SAFE_MEMBER.test(n) && !ACTIVE_CONTENT.test(n) && modes[mi] === '-'
      })
      const members = all.slice(0, MAX_SKILL_MEMBERS)
      if (all.length > MAX_SKILL_MEMBERS) {
        membersDropped += all.length - members.length
        console.warn(`[site] skill ${c.id}: ${all.length} members — capped at ${MAX_SKILL_MEMBERS}`)
      }
      if (members.length)
        await execFileP('tar', ['xzf', tgz, '-C', tmp, '--strip-components=1', '--', ...members], { timeout: 30_000 })
      rmSync(tgz, { force: true })
      if (!members.length) { bail(); return }
      const { files: abs, total, droppedActive } = collectFiles(tmp)
      if (droppedActive) console.warn(`[site] skill ${c.id}: ${droppedActive} web-active file(s) withheld from publish`)
      if (!abs.length) { bail(); return }
      if (total > MAX_SKILL_TOTAL_BYTES) { console.warn(`[site] skill ${c.id}: payload over ${MAX_SKILL_TOTAL_BYTES >> 20}MB — skipped`); bail(); return }
      const files = abs.map((f) => relative(tmp, f)).sort()
      rmSync(c.dest, { recursive: true, force: true })
      renameSync(tmp, c.dest)
      // a cache-write failure must not cost the landed skill — bail() would
      // delete the freshly-extracted dest and drop it from the catalog; the
      // only real cost of a lost cache entry is a refetch next build
      if (hit) try { mkdirSync(cacheDir!, { recursive: true }); rmSync(hit, { recursive: true, force: true }); cpSync(c.dest, hit, { recursive: true }) } catch { /* cache is an optimization */ }
      land(c, files)
    } catch (err) {
      bail()
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
  // slug is page-only metadata (detail backlink) — strip it so the published
  // {name,version,files} contract opencode consumes stays unchanged
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ skills: entries.map(({ name, version, files }) => ({ name, version, files })) }))
  return { candidates: cands.length, landed, degraded, entries, unpinned: landedUnpinned, membersDropped }
}

/* v8 ignore next 7 */
if (isMain(import.meta.url)) {
  // the entry guard must come AFTER every const declaration — the void-IIFE
  // runs buildSkillCatalog synchronously up to its first await, and any
  // module-level const the guard preceded is still in TDZ at that point
  // (SAFE_MEMBER crashed the deploy exactly this way; tests import the
  // module after full evaluation so they never saw it).
  // no top-level await here — the deploy gate imports this module for
  // healthGate() via `tsx -e`, which require()s it as CJS; a TLA module
  // crashes that load with ERR_REQUIRE_ASYNC_MODULE
  void (async () => {
    // zod-validate: a malformed index should die here with a readable error,
    // not halfway through a build (S-13)
    const idx = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2] ?? 'index.json', 'utf8')))
    await buildSite(idx, process.argv[3] ?? 'dist-site', process.env.SKILL_CACHE, process.argv[4])
    console.log('site built')
  })()
}
