/** Thin static site generator — renders index.json to plain HTML. Astro can replace this later without changing data. */
import { writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import type { CatalogIndex, PluginEntry } from '../../src/schema.ts'

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
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} · opencode market</title><style>${CSS}</style>${body}<footer class=meta><p>Not affiliated with opencode. "Scanned, no findings" does not mean safe. <a href="https://github.com/terry2010/opencode-market-spike">source</a></p></footer>`
}

export function listPage(index: CatalogIndex): string {
  const visible = index.plugins.filter(isVisible)
  const cards = visible.map(e => {
    const s = scanLabel(e), v = verifyLabel(e)
    return `<div class=card><a href="p/${esc(e.slug)}.html"><b>${esc(e.name)}</b></a> <code>${esc(e.type)}</code>${approvalBadge(e)}
      <div>${esc(e.description.en ?? '')}</div>
      <div class=meta><span class="${s.cls}">${s.text}</span> · <span class="${v.cls}">${v.text}</span>${e.latestVersion ? ` · v${esc(e.latestVersion)}` : ''}</div></div>`
  }).join('\n')
  return page('plugins', `<h1>opencode market</h1><p class=meta>${visible.length} entries · generated ${esc(index.generatedAt)}</p>
    <input id=q placeholder=search style="width:100%;padding:8px;margin:8px 0" oninput="document.querySelectorAll('.card').forEach(c=>c.style.display=c.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">${cards}`)
}

export function detailPage(e: PluginEntry): string {
  const s = scanLabel(e), v = verifyLabel(e)
  const rows = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')
  const findings = e.capabilities.findings.length
    ? `<ul>${e.capabilities.findings.map(f => `<li><code>${esc(f)}</code>`).join('')}</ul>` : '<p class=muted>none</p>'
  const underReview = e.pendingUpdate
    ? `<tr><td>next version</td><td><code>v${esc(e.pendingUpdate.version)}</code> <span class=muted>under review — not installable yet</span></td></tr>` : ''
  return page(e.name, `<h1>${esc(e.name)}${approvalBadge(e)}</h1><p>${esc(e.description.en ?? '')}</p>
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
    ${e.verification.logExcerpt ? `<h2>failure log</h2><pre>${esc(e.verification.logExcerpt)}</pre>` : ''}
    <p class=meta><a href="../index.html">← all plugins</a> · install: <code>opencode plugin add ${esc(e.source.id)}${e.latestVersion ? `@${esc(e.latestVersion)}` : ''}</code></p>`)
}

export function buildSite(index: CatalogIndex, outDir: string): void {
  mkdirSync(join(outDir, 'p'), { recursive: true })
  // index.json ships the FULL catalog (pending included) — it is the auditable
  // data plane; every UI/install surface filters pending itself.
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  const visible = { ...index, plugins: index.plugins.filter(isVisible) }
  // privacy note + health endpoint (dsh parity)
  writeFileSync(join(outDir, 'privacy.html'), '<html><body><h1>Privacy</h1><p>opencode-market collects nothing. The catalog is static data; installing a plugin runs opencode plugin add locally. Local state (favorites/groups/notes) stays in localStorage on your machine.</p></body></html>')
  writeFileSync(join(outDir, 'health.json'), JSON.stringify({ ok: true, entries: visible.plugins.length, generatedAt: index.generatedAt }))
  buildSkillCatalog(visible, outDir)
  writeFileSync(join(outDir, 'index.html'), listPage(visible))
  for (const e of visible.plugins) {
    const p = join(outDir, 'p', `${e.slug}.html`)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, detailPage(e))
  }
}

/* v8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs')
  const idx = JSON.parse(readFileSync(process.argv[2] ?? 'index.json', 'utf8'))
  buildSite(idx, process.argv[3] ?? 'dist-site')
  console.log('site built')
}

/** HTTP skill catalog (opencode docs/skills): site/skills/index.json + per-skill files
 *  pulled from npm tarballs, so `skills: ["<site>/skills/"]` makes the whole
 *  catalog's skills loadable — files update whenever version bumps. */
export function buildSkillCatalog(index: CatalogIndex, outDir: string,
  tarballOf: (spec: string) => string | null =
    (spec) => { try { return execSync(`npm view "${spec}" dist.tarball`, { encoding: 'utf8', timeout: 20_000 }).trim() || null } catch { return null } }): void {
  const skills = index.plugins.filter((p) => p.contains?.includes('skill'))
  const dir = join(outDir, 'skills')
  mkdirSync(dir, { recursive: true })
  const entries: { name: string; version: string; files: string[] }[] = []
  // conditional ids (same rule as market installSkillTar): bare basename for
  // singletons; same-basename packages all get the namespaced `a--test` form
  const baseOf = (n: string) => n.split('/').pop()!.replace(/^@/, '')
  const counts = new Map<string, number>()
  for (const s of skills) { const b = baseOf(s.name); counts.set(b, (counts.get(b) ?? 0) + 1) }
  for (const s of skills) {
    const base = baseOf(s.name)
    const id = ((counts.get(base) ?? 0) > 1 ? s.name.replace(/^@/, '').replace(/\//g, '--') : base) || s.slug
    const dest = join(dir, id)
    try {
      // pin to the approved version — `npm view <name>` resolves dist-tags.latest
      // which is the pendingUpdate users must not receive (hold semantics)
      const tb = s.latestVersion ? tarballOf(`${s.name}@${s.latestVersion}`) : null
      if (!tb) continue
      const res = execSync(
        `rm -rf "${dest}.tmp" && mkdir -p "${dest}.tmp" && curl -fsSL "${tb.replace(/'/g, "'\''")}" | tar xz -C "${dest}.tmp" --strip-components=1 2>/dev/null; ` +
        `find "${dest}.tmp" -name 'SKILL.md' -o -name '*.md' | head -20`,
        { encoding: 'utf8', timeout: 30_000 })
      const files = res.split('\n').filter(Boolean).map((f) => f.replace(`${dest}.tmp/`, ''))
      if (!files.length) continue
      rmSync(dest, { recursive: true, force: true })
      renameSync(`${dest}.tmp`, dest)
      const stripped = files.map((f) => f.replace(/^package\//, ''))
      entries.push({ name: id, version: s.latestVersion ?? '1', files: stripped })
    } catch { /* tarball fetch failed — skip skill */ }
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ skills: entries }))
}
