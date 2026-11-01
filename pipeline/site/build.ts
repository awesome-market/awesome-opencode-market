/** Thin static site generator — renders index.json to plain HTML. Astro can replace this later without changing data. */
import { writeFileSync, mkdirSync } from 'node:fs'
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
  switch (e.verification.status) {
    case 'verified': return { text: `verified (${e.verification.level ?? 'install'})`, cls: 'ok' }
    case 'failed': return { text: 'verification failed', cls: 'bad' }
    case 'skipped': return { text: 'skipped (high risk)', cls: 'warn' }
    default: return { text: 'unverified', cls: 'muted' }
  }
}

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
  const cards = index.plugins.map(e => {
    const s = scanLabel(e), v = verifyLabel(e)
    return `<div class=card><a href="p/${esc(e.slug)}.html"><b>${esc(e.name)}</b></a> <code>${esc(e.type)}</code>
      <div>${esc(e.description.en ?? '')}</div>
      <div class=meta><span class="${s.cls}">${s.text}</span> · <span class="${v.cls}">${v.text}</span>${e.latestVersion ? ` · v${esc(e.latestVersion)}` : ''}</div></div>`
  }).join('\n')
  return page('plugins', `<h1>opencode market</h1><p class=meta>${index.plugins.length} entries · generated ${esc(index.generatedAt)}</p>
    <input id=q placeholder=search style="width:100%;padding:8px;margin:8px 0" oninput="document.querySelectorAll('.card').forEach(c=>c.style.display=c.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none')">${cards}`)
}

export function detailPage(e: PluginEntry): string {
  const s = scanLabel(e), v = verifyLabel(e)
  const rows = (o: Record<string, string | undefined>) =>
    Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')
  const findings = e.capabilities.findings.length
    ? `<ul>${e.capabilities.findings.map(f => `<li><code>${esc(f)}</code>`).join('')}</ul>` : '<p class=muted>none</p>'
  return page(e.name, `<h1>${esc(e.name)}</h1><p>${esc(e.description.en ?? '')}</p>
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
    })}</table>
    <h2>scan findings</h2>${findings}
    ${e.verification.logExcerpt ? `<h2>failure log</h2><pre>${esc(e.verification.logExcerpt)}</pre>` : ''}
    <p class=meta><a href="../index.html">← all plugins</a> · install: <code>opencode plugin add ${esc(e.source.id)}</code></p>`)
}

export function buildSite(index: CatalogIndex, outDir: string): void {
  mkdirSync(join(outDir, 'p'), { recursive: true })
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  writeFileSync(join(outDir, 'index.html'), listPage(index))
  for (const e of index.plugins) {
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
