/** Thin static site generator — renders index.json to plain HTML. Astro can replace this later without changing data. */
import { writeFileSync, mkdirSync, rmSync, renameSync, readdirSync, cpSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, relative } from 'node:path'
import { CatalogIndex } from '../../src/schema.ts'
import type { PluginEntry } from '../../src/schema.ts'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Honest-status rendering (DEV §2 铁律): each state gets distinct copy — never "safe" for unscanned. */
export function scanLabel(e: PluginEntry): { text: string; cls: string } {
  if (e.capabilities.scannedAt === null) return { text: 'not scanned', cls: 'muted' }
  if (e.capabilities.redFlags.length > 0) return { text: `${e.capabilities.redFlags.length} red flag(s)`, cls: 'bad' }
  if (e.capabilities.findings.length > 0) return { text: `${e.capabilities.findings.length} finding(s)`, cls: 'warn' }
  return { text: 'scanned, no findings', cls: 'ok' }
}
export function verifyLabel(e: PluginEntry): { text: string; cls: string } {
  // version-less entries (github-kind) are constructed as 'skipped' — there is
  // no npm artifact to run, not a high-risk short-circuit. Rendering them
  // "skipped (high risk)" would be a lie (AGENTS.md honest-label rule).
  if (e.latestVersion === null) return { text: 'nothing to install', cls: 'muted' }
  switch (e.verification.status) {
    case 'verified': return { text: `verified (${e.verification.level ?? 'install'})`, cls: 'ok' }
    case 'failed': return { text: 'verification failed', cls: 'bad' }
    case 'skipped': return { text: 'skipped (high risk)', cls: 'warn' }
    default: return { text: 'unverified', cls: 'muted' }
  }
}
/** approval badge — 'legacy' entries predate the review gate; 'approved' needs no badge. */
export function approvalBadge(e: PluginEntry): string {
  return e.approval === 'legacy' ? ' <span class=muted>legacy</span>' : ''
}
/** user-visible entries — pending (under-review) entries never render on the site. */
export const isVisible = (e: PluginEntry): boolean => e.approval !== 'pending'

const CSS = `body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#222}
a{color:#06c;text-decoration:none}code{background:#f4f4f4;padding:1px 4px;border-radius:3px}
.ok{color:#080}.warn{color:#a60}.bad{color:#c00}.muted{color:#999}
.card{border:1px solid #ddd;border-radius:6px;padding:12px;margin:8px 0}
.meta{color:#666;font-size:12px}h1,h2{margin:.5em 0}
@media(prefers-color-scheme:dark){body{background:#141414;color:#ddd}.card{border-color:#333}code{background:#2a2a2a}a{color:#6af}}`

export function page(title: string, body: string): string {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} · opencode market</title><style>${CSS}</style>${body}<footer class=meta><p>Not affiliated with opencode. "Scanned, no findings" does not mean safe. <a href="https://github.com/terry2010/awesome-opencode-market">source</a></p></footer>`
}

export function listPage(index: CatalogIndex): string {
  const visible = index.plugins.filter(isVisible)
  const cats = [...new Set(visible.flatMap(e => e.category))].sort()
  const cards = visible.map(e => {
    const s = scanLabel(e), v = verifyLabel(e)
    return `<div class=card data-cats="${esc(JSON.stringify(e.category))}"><a href="p/${esc(e.slug)}.html"><b>${esc(e.name)}</b></a> <code>${esc(e.type)}</code>${approvalBadge(e)}
      <div>${esc(e.description.en ?? '')}${e.description.zh ? `<div class=meta>${esc(e.description.zh)}</div>` : ''}</div>
      <div class=meta><span class="${s.cls}">${s.text}</span> · <span class="${v.cls}">${v.text}</span>${e.latestVersion ? ` · v${esc(e.latestVersion)}` : ''}</div></div>`
  }).join('\n')
  // F() combines text search + category select; data-cats holds the raw
  // category array (entity-escaped) — substring match on `"slug"` is exact.
  return page('plugins', `<h1>opencode market</h1><p class=meta>${visible.length} entries · generated ${esc(index.generatedAt)} · <a href="skills.html">skills</a> · <a href="removed.html">removed</a></p>
    <input id=q placeholder=search style="width:100%;padding:8px;margin:8px 0" oninput="F()">${cats.length ? `<select id=cat onchange="F()" style="padding:8px;margin:8px 0"><option value="">all categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>` : ''}<script>
    function F(){const q=document.getElementById('q').value.toLowerCase(),c=document.getElementById('cat')?.value||'';document.querySelectorAll('.card').forEach(e=>{e.style.display=(!q||e.textContent.toLowerCase().includes(q))&&(!c||e.dataset.cats.includes('"'+c+'"'))?'':'none'})}
    </script>${cards}`)
}

export function detailPage(e: PluginEntry): string {
  const s = scanLabel(e), v = verifyLabel(e)
  const rows = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')
  // AGENTS: findings/redFlags 默认收起 — collapsed into <details> even on the
  // detail page; red-flag lines get a marker so they stand out when expanded
  const rf = new Set(e.capabilities.redFlags)
  const findings = e.capabilities.findings.length
    ? `<details><summary>findings (${e.capabilities.findings.length}${e.capabilities.redFlags.length ? `, ${e.capabilities.redFlags.length} red flag` : ''})</summary><ul>${e.capabilities.findings.map(f => `<li><code>${esc(f)}</code>${rf.has(f) ? ' <span class=bad>red flag</span>' : ''}</li>`).join('')}</ul></details>` : '<p class=muted>none</p>'
  const underReview = e.pendingUpdate
    ? `<tr><td>next version</td><td><code>v${esc(e.pendingUpdate.version)}</code> <span class=muted>under review — not installable yet</span></td></tr>` : ''
  return page(e.name, `<h1>${esc(e.name)}${approvalBadge(e)}</h1><p>${esc(e.description.en ?? '')}${e.description.zh ? `<br><span class=meta>${esc(e.description.zh)}</span>` : ''}</p>
    <table>${rows({
      type: esc(e.type), slug: `<code>${esc(e.slug)}</code>`,
      license: e.license ? esc(e.license) : 'unknown',
      version: e.latestVersion ? esc(e.latestVersion) : undefined,
      repo: e.source.repo ? `<a href="https://github.com/${esc(e.source.repo)}">${esc(e.source.repo)}</a>` : undefined,
      'npm (30d)': e.metrics.npmDownloads30d?.toLocaleString(),
      stars: e.metrics.stars?.toLocaleString(),
      'first seen': esc(e.firstSeenAt.slice(0, 10)),
      'scan status': `<span class="${s.cls}">${s.text}</span>`,
      'verify status': `<span class="${v.cls}">${v.text}</span>`,
      'opencode ver': e.verification.opencodeVersion ? esc(e.verification.opencodeVersion) : undefined,
      'verify run': e.verification.runUrl ? `<a href="${esc(e.verification.runUrl)}">logs</a>` : undefined,
      deprecated: e.deprecated ? '<span class=bad>deprecated</span>' : undefined,
    })}${underReview}</table>
    <h2>scan findings</h2>${findings}
    ${e.verification.logExcerpt ? `<details><summary><b>failure log</b></summary><pre>${esc(e.verification.logExcerpt)}</pre></details>` : ''}
    <p class=meta><a href="../index.html">← all plugins</a> · install: <code>opencode plugin add ${esc(e.source.id)}${e.latestVersion ? `@${esc(e.latestVersion)}` : ''}</code></p>`)
}

export function buildSite(index: CatalogIndex, outDir: string, cacheDir?: string): void {
  rmSync(outDir, { recursive: true, force: true })   // no stale files from a previous build
  mkdirSync(join(outDir, 'p'), { recursive: true })
  // index.json ships the FULL catalog (pending included) — it is the auditable
  // data plane; every UI/install surface filters pending itself.
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  const visible = { ...index, plugins: index.plugins.filter(isVisible) }
  // index.lite.json — visible-only, hold internals stripped (pendingUpdate is
  // pipeline bookkeeping, not catalog data). Smaller fetch for thin UIs.
  writeFileSync(join(outDir, 'index.lite.json'), JSON.stringify({ ...visible, plugins: visible.plugins.map(({ pendingUpdate: _p, ...e }) => e) }))
  // privacy note + health endpoint (dsh parity)
  writeFileSync(join(outDir, 'privacy.html'), '<html><body><h1>Privacy</h1><p>opencode-market collects nothing. The catalog is static data; installing a plugin runs opencode plugin add locally. Local state (favorites/groups/notes) stays in localStorage on your machine.</p></body></html>')
  const skillStats = buildSkillCatalog(visible, outDir, undefined, cacheDir)
  writeFileSync(join(outDir, 'health.json'), JSON.stringify({ ok: true, entries: visible.plugins.length, skills: skillStats, generatedAt: index.generatedAt }))
  writeFileSync(join(outDir, 'index.html'), listPage(visible))
  writeFileSync(join(outDir, 'skills.html'), skillsPage(skillStats.entries))
  writeFileSync(join(outDir, 'removed.html'), removedPage(index))
  for (const e of visible.plugins) {
    const p = join(outDir, 'p', `${e.slug}.html`)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, detailPage(e))
  }
}

/** Deploy gate (S-3): refuse to publish a catastrophically shrunken catalog —
 *  an empty site is worse than a stale one. site.yml fetches the LIVE
 *  health.json for `prev`; fetch failure → prev=null → absolute floor only. */
export function healthGate(prev: { entries?: number } | null, cur: { entries: number }): string | null {
  if (cur.entries < 200) return `entries=${cur.entries} below floor 200`
  if (typeof prev?.entries === 'number' && prev.entries > 0 && cur.entries < prev.entries * 0.5)
    return `entries ${cur.entries} < 50% of previous deploy ${prev.entries}`
  return null
}

/** skills index → browseable page (files are served as raw .md). */
export function skillsPage(entries: { name: string; version: string; files: string[] }[]): string {
  const cards = entries.map(s =>
    `<div class=card><b>${esc(s.name)}</b> <code>v${esc(s.version)}</code><div class=meta>${s.files.map(f => `<a href="skills/${esc(s.name)}/${esc(f)}">${esc(f)}</a>`).join(' · ') || 'no files'}</div></div>`).join('\n')
  return page('skills', `<h1>skills</h1><p class=meta>${entries.length} skills · <a href="skills/index.json">index.json</a> · <a href="index.html">← all plugins</a></p>${cards}`)
}

/** Recently removed entries — explains the 404s for vanished plugins. */
export function removedPage(index: CatalogIndex): string {
  const rem = [...(index.removed ?? [])].sort((a, b) => b.disappearedAt.localeCompare(a.disappearedAt))
  const cards = rem.slice(0, 300).map(r =>
    `<div class=card><b>${esc(r.name)}</b> <code>${esc(r.slug)}</code><div class=meta>${esc(r.reason)} · removed ${esc(r.disappearedAt.slice(0, 10))}</div></div>`).join('\n')
  return page('removed', `<h1>removed entries</h1><p class=meta>${rem.length} total · latest 300 shown · <a href="index.html">← all plugins</a></p>${cards || '<p class=muted>none</p>'}`)
}

/* v8 ignore next 7 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs')
  // zod-validate: a malformed index should die here with a readable error,
  // not halfway through a build (S-13)
  const idx = CatalogIndex.parse(JSON.parse(readFileSync(process.argv[2] ?? 'index.json', 'utf8')))
  buildSite(idx, process.argv[3] ?? 'dist-site', process.env.SKILL_CACHE)
  console.log('site built')
}

/** HTTP skill catalog (opencode docs/skills): site/skills/index.json + per-skill files
 *  pulled from npm tarballs, so `skills: ["<site>/skills/"]` makes the whole
 *  catalog's skills loadable — files update whenever version bumps. */
export function buildSkillCatalog(index: CatalogIndex, outDir: string,
  tarballOf: (spec: string) => string | null =
    // execFile argv, not a shell string — this job holds pages:write + id-token,
    // so an index-derived spec/URL must never reach a shell (N-4)
    (spec) => {
      try {
        const u = execFileSync('npm', ['view', spec, 'dist.tarball'], { encoding: 'utf8', timeout: 20_000 }).trim()
        // packument-derived URL is registry-controlled in practice but treat as
        // untrusted: https only. Injected tarballOf impls (tests) own their scheme.
        return /^https:\/\//i.test(u) ? u : null
      } catch { return null }
    },
  cacheDir?: string): { candidates: number; landed: number; degraded: boolean; entries: { name: string; version: string; files: string[] }[] } {
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
  const cacheKey = (id: string, ver: string) => encodeURIComponent(`${id}@${ver}`)
  const mdFiles = (root: string): string[] => {
    const out: string[] = []
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name)
        // a '.md'-named symlink member can still land via named extraction —
        // it is a dead link on Pages; delete rather than publish it
        if (ent.isSymbolicLink()) { rmSync(p, { force: true }); continue }
        if (ent.isDirectory() && ent.name !== 'node_modules') walk(p)
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) out.push(p)
      }
    }
    try { walk(root) } catch { /* unreadable dir → empty */ }
    return out.slice(0, 20)
  }
  let candidates = 0
  for (const s of skills) {
    if (!s.latestVersion) continue                    // repo-only skill: no npm artifact
    candidates++
    const base = baseOf(s.name)
    let id = ((counts.get(base) ?? 0) > 1 ? s.name.replace(/^@/, '').replace(/\//g, '--') : base) || s.slug
    while (usedIds.has(id)) id += '-x'                // S-12 deterministic suffix
    usedIds.add(id)
    const ver = s.latestVersion
    const dest = join(dir, id)
    const key = cacheKey(id, ver)
    const hit = cacheDir ? join(cacheDir, key) : null
    // S-1: version-pinned cache — unchanged skills skip npm+curl+tar entirely
    if (hit && existsSync(hit)) {
      rmSync(dest, { recursive: true, force: true })
      cpSync(hit, dest, { recursive: true })
      const files = mdFiles(dest).map((f) => relative(dest, f))
      if (files.length) { entries.push({ name: id, version: ver, files }); keep.add(key); continue }
      rmSync(hit, { recursive: true, force: true })   // poisoned cache → refetch
    }
    const tmp = `${dest}.tmp`
    try {
      // pin to the approved version — `npm view <name>` resolves dist-tags.latest
      // which is the pendingUpdate users must not receive (hold semantics)
      const tb = tarballOf(`${s.name}@${ver}`)
      if (!tb) continue
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      const tgz = join(tmp, 'pkg.tgz')
      execFileSync('curl', ['-fsSL', tb, '-o', tgz], { timeout: 30_000 })
      // two-pass extraction (S-4/S-5): only named .md members are extracted —
      // symlink/hardlink members are never created (no traversal primitive on
      // ANY tar version, not just ≥1.29) and bundled-dep docs under
      // node_modules never touch disk. '--' ends option parsing so a member
      // named like a flag cannot be re-parsed (names are registry input).
      const members = execFileSync('tar', ['tzf', tgz], { encoding: 'utf8', timeout: 30_000 })
        .split('\n').filter((n) => /\.md$/i.test(n) && !n.split('/').includes('node_modules')).slice(0, 50)
      if (members.length)
        execFileSync('tar', ['xzf', tgz, '-C', tmp, '--strip-components=1', '--', ...members], { timeout: 30_000 })
      rmSync(tgz, { force: true })
      if (!members.length) continue
      const files = mdFiles(tmp).map((f) => relative(tmp, f))
      if (!files.length) continue
      rmSync(dest, { recursive: true, force: true })
      renameSync(tmp, dest)
      if (hit) { mkdirSync(cacheDir!, { recursive: true }); rmSync(hit, { recursive: true, force: true }); cpSync(dest, hit, { recursive: true }) }
      keep.add(key)
      entries.push({ name: id, version: ver, files })
    } catch {
      rmSync(tmp, { recursive: true, force: true })
      /* tarball fetch failed — skip skill */
    }
  }
  // prune stale cache dirs (version bumped or skill removed from catalog)
  if (cacheDir && existsSync(cacheDir))
    for (const c of readdirSync(cacheDir)) if (!keep.has(c)) rmSync(join(cacheDir, c), { recursive: true, force: true })
  const landed = entries.length
  // S-2: a near-empty catalog is a fetch outage, not a real state — log loudly
  const degraded = candidates > 0 && landed < candidates / 2
  if (degraded) console.warn(`[site] skills degraded: ${landed}/${candidates} landed`)
  else console.log(`[site] skills ${landed}/${candidates} landed`)
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ skills: entries }))
  return { candidates, landed, degraded, entries }
}
