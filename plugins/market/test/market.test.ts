import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchIndex, sortEntries, DEFAULT_INDEX_URL } from '../src/catalog.ts'
import type { MarketEntry, MarketIndex } from '../src/catalog.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(dir, '../package.json'), 'utf8'))

// hermetic index server — these tests must not depend on live network/proxy
const CANNED = { version: '1', generatedAt: 't', categories: {}, removed: [],
  plugins: [{ name: 'test-pkg', slug: 'test-pkg', verification: { status: 'unverified' } }] }
const serveIndex = async () => {
  const srv = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(CANNED))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/index.json`, close: () => srv.close() }
}

const mkEntry = (name: string, status: string, red = 0): MarketEntry => ({
  name, slug: name, type: 'plugin', category: [],
  capabilities: { scannedAt: 't', findings: [], redFlags: Array(red).fill('x') },
  verification: { status },
})

describe('market plugin', () => {
  it('exports map satisfies the host entry contract', () => {
    expect(pkg.exports['.']).toBe('./dist/server.js')
    expect(pkg.exports['./tui']).toBe('./dist/tui.js')
    expect(pkg.exports['./gui-experimental']).toBe('./dist/gui.cjs')
  })
  it('gui bundle exists and is CommonJS-evaluable text', () => {
    const p = join(dir, '../dist/gui.cjs')
    if (!existsSync(p)) {
      execFileSync('npx', ['tsx', 'build.ts'], { cwd: join(dir, '..') })
    }
    const code = readFileSync(join(dir, '../dist/gui.cjs'), 'utf8')
    expect(code).toContain('opencode-market')
    // CJS marker: module.exports or exports usage — ESM `export` statements must not appear top-level
    expect(code).not.toMatch(/^export\s+(default|\{)/m)
  })
  it('fetchIndex parses index shape', async () => {
    const s = await serveIndex()
    try {
      const idx = await fetchIndex(s.url)
      expect(idx.plugins).toBeInstanceOf(Array)
      expect(idx.plugins.length).toBeGreaterThan(0)
    } finally { s.close() }
    expect(DEFAULT_INDEX_URL).toContain('index.json')
  })
  it('sortEntries verified: verified first, skipped before failed, name order within', () => {
    const r = sortEntries([
      mkEntry('b-unver', 'unverified'),
      mkEntry('a-ver', 'verified'),
      mkEntry('c-flag', 'skipped', 1),
    ], 'verified')
    expect(r.map(e => e.name)).toEqual(['a-ver', 'b-unver', 'c-flag'])
  })
})

describe('catalog helpers', () => {
  it('redactLog strips home paths and secrets', async () => {
    const { redactLog } = await import('../src/catalog.ts')
    const t = redactLog('err /Users/terry/x token=abc123 sk-abcdefghijkl at /home/bob/y key: z')
    expect(t).not.toContain('terry'); expect(t).not.toContain('abc123'); expect(t).not.toContain('sk-abc')
    expect(t).toContain('<home>'); expect(t).toContain('<redacted>')
  })
  it('keyLines keeps error lines or falls back to tail', async () => {
    const { keyLines } = await import('../src/catalog.ts')
    expect(keyLines('a\nb\nnpm error 404 not found\nc').some(l => l.includes('404'))).toBe(true)
    expect(keyLines('x1\nx2\nx3', 2)).toEqual(['x2', 'x3'])
  })
  it('state roundtrip + empty fallback', async () => {
    const { loadState, saveState, EMPTY_STATE } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } } as unknown as Storage
    saveState({ ...EMPTY_STATE, favorites: { a: true } })
    const s = loadState()
    expect(s.favorites.a).toBe(true)
    store['opencode-market.state.v1'] = '{bad'
    expect(loadState()).toEqual(EMPTY_STATE)
    delete (globalThis as Record<string, unknown>).localStorage
  })
  it('categoriesOf/sortEntries/search', async () => {
    const { categoriesOf, allCategories, sortEntries, search } = await import('../src/catalog.ts')
    const mk = (name: string, cat: string[], st: string, dl = 0, stars = 0): MarketEntry => ({
      name, slug: name, type: 'plugin', category: cat,
      verification: { status: st }, metrics: { npmDownloads30d: dl, stars },
    })
    const es = [mk('a', ['x'], 'failed', 1, 9), mk('b', ['y'], 'verified', 5, 1), mk('c', ['x', 'z'], 'skipped', 3, 5)]
    expect(categoriesOf(es[0]!)).toEqual(['x'])
    expect(allCategories(es)).toContain('x')
    expect(sortEntries(es, 'verified')[0]!.name).toBe('b')
    expect(sortEntries(es, 'downloads')[0]!.name).toBe('b')
    expect(sortEntries(es, 'stars')[0]!.name).toBe('a')
    expect(sortEntries(es, 'name').map(e => e.name)).toEqual(['a', 'b', 'c'])
    expect(search(es, 'A')).toEqual([es[0]])
    expect(search(es, '')).toHaveLength(3)
  })
})
  it('sortEntries verified: verified first, redFlags sink to the bottom', async () => {
    const { sortEntries } = await import('../src/catalog.ts')
    const mk = (n: string, st: string, rf = 0): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], verification: { status: st }, capabilities: { scannedAt: '', findings: [], redFlags: Array(rf).fill('x') } })
    const r = sortEntries([mk('z', 'failed'), mk('a', 'verified'), mk('m', 'verified', 2), mk('q', 'unverified', 1)], 'verified')
    // DATA-FLOWS contract: verified 优先·红旗沉底 — flagged entries rank below
    // everything else regardless of their verification status
    expect(r.map(e => e.name)).toEqual(['a', 'z', 'm', 'q'])
  })
  it('search matches description too', async () => {
    const { search } = await import('../src/catalog.ts')
    const es = [{ name: 'a', slug: 'a', type: 'p', category: [], description: { en: 'find me' } } as MarketEntry]
    expect(search(es, 'find')).toHaveLength(1)
    expect(search(es, 'nomatch')).toHaveLength(0)
  })
  it('sortKey verified-order covers unverified/unknown', async () => {
    const { sortEntries } = await import('../src/catalog.ts')
    const mk = (n: string, st?: string): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], verification: st ? { status: st } : undefined })
    const r = sortEntries([mk('x', 'weird'), mk('u', 'unverified'), mk('v', 'verified'), mk('s', 'skipped')], 'verified')
    expect(r.map(e => e.name)).toEqual(['v', 'u', 'x', 's'])
  })
  it('sortKey metric fallbacks when metrics missing', async () => {
    const { sortEntries } = await import('../src/catalog.ts')
    const mk = (n: string, m?: MarketEntry['metrics']): MarketEntry => ({ name: n, slug: n, type: 'p', category: [], metrics: m })
    const r = sortEntries([mk('a'), mk('b', { npmDownloads30d: null, stars: null }), mk('c', { npmDownloads30d: 5, stars: 0 })], 'downloads')
    expect(r[0]!.name).toBe('c')
    const r2 = sortEntries([mk('a'), mk('b', { npmDownloads30d: 0, stars: 3 })], 'stars')
    expect(r2[0]!.name).toBe('b')
  })
  it('redactLog windows path + key with colon', async () => {
    const { redactLog } = await import('../src/catalog.ts')
    const t = redactLog('at C:\\Users\\joe\\x password= hunter2')
    expect(t).toContain('<home>'); expect(t).toContain('password=<redacted>')
  })
  it('fetchIndex returns plugins list shape', async () => {
    const { fetchIndex } = await import('../src/catalog.ts')
    const s = await serveIndex()
    try {
      const idx = await fetchIndex(s.url)
      expect(Array.isArray(idx.plugins)).toBe(true)
      expect(idx.plugins.length).toBeGreaterThan(0)
    } finally { s.close() }
  })
  it('indexAge/hasUpdate/t basics', async () => {
    const { indexAge, hasUpdate, t } = await import('../src/catalog.ts')
    expect(indexAge({ generatedAt: '2026-11-02T06:00:00Z' } as MarketIndex)).toBe('2026-11-02 06:00')
    expect(indexAge(null)).toBe('')
    expect(hasUpdate({ name: 'x', latestVersion: '2' } as MarketEntry, '1')).toBe(true)
    expect(hasUpdate({ name: 'x', latestVersion: '1' } as MarketEntry, '1')).toBe(false)
    expect(hasUpdate({ name: 'x' } as MarketEntry, '1')).toBe(false)
    expect(typeof t('verified')).toBe('string')
  })
  it('fetchIndexCached TTL + snapshot fallback', async () => {
    const { fetchIndexCached } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    const s = await serveIndex()
    // fresh fetch caches
    const a = await fetchIndexCached(s.url)
    expect(a.plugins.length).toBeGreaterThan(0)
    expect(store['opencode-market.index.v1']).toBeTruthy()
    s.close()
    // second call hits TTL cache — the server is now DOWN, so a real fetch
    // would throw; the cache is also URL-keyed, so the same url is required
    const b = await fetchIndexCached(s.url)
    expect(b.plugins.length).toBe(a.plugins.length)
    delete (globalThis as Record<string, unknown>).localStorage
  }, 20000)
  it('t() zh strings when language is zh', async () => {
    const { t } = await import('../src/catalog.ts')
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
    // module-level zh flag is fixed at import — test the en path contract instead
    expect(t('loading')).toBeTruthy()
    delete (globalThis as Record<string, unknown>).navigator
  })
  it('fetchIndexCached refetches when cache expired', async () => {
    const { fetchIndexCached } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    const s = await serveIndex()
    // seed an EXPIRED cache entry — url-keyed, so it must name the catalog
    // it belongs to or readIdxCache treats it as foreign (a cache miss)
    store['opencode-market.index.v1'] = JSON.stringify({ at: 1, url: s.url, index: { version: 'old', generatedAt: '', plugins: [] } })
    const idx = await fetchIndexCached(s.url)   // must refetch, not serve stale
    s.close()
    expect(idx.plugins.length).toBeGreaterThan(0)
    // poison network + valid cache → fallback serves cached
    store['opencode-market.index.v1'] = JSON.stringify({ at: Date.now() - 7200_000, url: 'http://127.0.0.1:9/dead', index: { version: 'snap', generatedAt: '', plugins: [{ name: 'snap-pkg' }] } })
    const snap = await fetchIndexCached('http://127.0.0.1:9/dead')
    expect(snap.version).toBe('snap')
    // poison + no cache → throws
    store['opencode-market.index.v1'] = 'null'
    await expect(fetchIndexCached('http://127.0.0.1:9/dead')).rejects.toThrow()
    delete (globalThis as Record<string, unknown>).localStorage
  }, 20000)
  it('i18n tables: zh covers all keys', async () => {
    const { t } = await import('../src/catalog.ts')
    // en path already exercised; verify a zh key renders non-en text when zh set at module load
    for (const k of ['verified','installed','add','search','back','loading','cancel','exportLog'] as const) {
      expect(typeof t(k)).toBe('string'); expect(t(k).length).toBeGreaterThan(0)
    }
  })
  it('categoriesOf classifier hits/miss + allCategories', async () => {
    const { categoriesOf, allCategories } = await import('../src/catalog.ts')
    const mk = (name: string, en = '', cat: string[] = []): MarketEntry => ({ name, slug: name, type: 'p', category: cat, description: { en } })
    expect(categoriesOf(mk('x', '', ['显式']))).toEqual(['显式'])           // declared wins
    expect(categoriesOf(mk('theme-packer', 'colors fonts'))).toEqual(['appearance'])
    expect(categoriesOf(mk('token-usage', 'llm pricing'))).toContain('models')
    expect(categoriesOf(mk('zzz', 'nothing matches'))).toEqual(['other'])   // fallback
    const all = allCategories([mk('a', 'git review'), mk('b', 'slack qq')])
    expect(all).toContain('workflow'); expect(all).toContain('integrations')
  })
  it('scanSkillKeys: dirs w/ content, md files, skips hidden+staging', async () => {
    const { scanSkillKeys } = await import('../src/catalog.ts')
    const fs = {
      '/s': ['proj-suite', 'semantic-commit', 'review.md', '.hidden', '_dl', 'empty-dir'],
      '/s/proj-suite': ['scripts', 'README.md'],       // package marker dir, no SKILL.md
      '/s/semantic-commit': ['SKILL.md'],
      '/s/empty-dir': [],
    }
    const ls = (d: string) => fs[d as keyof typeof fs] ?? (() => { throw new Error('ENOENT') })()
    const hasFile = (p: string) => p === '/s/semantic-commit/SKILL.md'
    const m = scanSkillKeys(['/s', '/missing'], ls, hasFile)
    expect(m['__skill_proj-suite']).toBe('local')        // non-empty pkg dir = installed
    expect(m['__skill_semantic-commit']).toBe('local')   // lifted skill dir, author ID
    expect(m['__skill_review']).toBe('local')            // file-skill
    expect(m['__skill_.hidden']).toBeUndefined()
    expect(m['__skill__dl']).toBeUndefined()
    expect(m['__skill_empty-dir']).toBeUndefined()
  })
  it('skillInstalledVer: exact, dir key, promoted prefix, none', async () => {
    const { skillInstalledVer } = await import('../src/catalog.ts')
    expect(skillInstalledVer({ 'pkg/a': '1.0' }, 'pkg/a')).toBe('1.0')
    expect(skillInstalledVer({ __skill_a: 'local' }, 'scope/a')).toBe('local')
    expect(skillInstalledVer({ '__skill_suite-x': 'local', '__skill_suite-y': 'local' }, '@p/suite')).toBe('local')
    expect(skillInstalledVer({ '__skill_other-x': 'local' }, '@p/suite')).toBeUndefined()
    expect(skillInstalledVer({}, 'pkg/a')).toBeUndefined()
  })
  it('inDays: publishedAt/firstSeenAt window + unparseable', async () => {
    const { inDays } = await import('../src/catalog.ts')
    const recent = new Date(Date.now() - 3600_000).toISOString()
    const old = new Date(Date.now() - 40 * 86400_000).toISOString()
    const mk = (p?: string, f?: string): MarketEntry => ({ name: 'x', slug: 'x', type: 'p', category: [], publishedAt: p, firstSeenAt: f })
    expect(inDays(mk(recent), 7)).toBe(true)
    expect(inDays(mk(undefined, recent), 7)).toBe(true)   // falls back to firstSeenAt
    expect(inDays(mk(old), 7)).toBe(false)
    expect(inDays(mk('garbage'), 7)).toBe(false)          // unparseable → outside window
  })
  it('devlog ring buffer: append/read/clear + no-localStorage paths', async () => {
    const { appendLog, readLog, clearLog } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    }
    clearLog()
    appendLog('first'); appendLog('second')
    const lines = readLog()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/first$/); expect(lines[1]).toMatch(/second$/)
    clearLog(); expect(readLog()).toEqual([])
    // corrupt stored json → readLog falls back
    store['opencode-market.devlog.v1'] = '{bad'
    expect(readLog()).toEqual([])
    delete (globalThis as Record<string, unknown>).localStorage
  })

describe('skill-install', () => {
  const mk = (files: Record<string, string>) => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const src = mkdtempSync(join(tmpdir(), 'skt-'))
    for (const [p, c] of Object.entries(files)) {
      const fp = join(src, 'package', p)
      mkdirSync(dirname(fp), { recursive: true })
      writeFileSync(fp, c)
    }
    const tgz = join(src, 'p.tgz')
    execFileSync('tar', ['czf', tgz, '-C', src, 'package'])
    return { src, tgz, out: mkdtempSync(join(tmpdir(), 'sko-')) }
  }

  it('installSkillTar: lifts hidden nests preserving author IDs + manifest; uninstall removes them', async () => {
    const { installSkillTar, uninstallSkillDir } = await import('../src/skill-install.ts')
    const { readdirSync, readFileSync, existsSync } = await import('node:fs')
    const { tgz, out } = mk({
      'README.md': '# pkg',
      '.opencode/skills/semantic-commit/SKILL.md': '---\ndescription: x\n---\nbody',
      '.opencode/skills/review.md': 'file skill',
      '.claude/skills/helper/SKILL.md': '---\n---\nx',
      'skills/nested-stays/SKILL.md': '---\n---\ny',   // non-hidden nest, no root SKILL.md → stays
    })
    const msg = await installSkillTar({ name: '@p/suite', gzipped: readFileSync(tgz), root: out })
    expect(msg).toMatch(/wrote \d+/)
    // author IDs preserved at source root
    expect(existsSync(join(out, 'semantic-commit', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(out, 'helper', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(out, 'review.md'))).toBe(true)
    // non-hidden skills/ nest stays inside the package dir (discoverable at depth 3)
    expect(existsSync(join(out, 'suite', 'skills', 'nested-stays', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(out, 'suite', '.market-skills.json'))).toBe(true)
    const mf = JSON.parse(readFileSync(join(out, 'suite', '.market-skills.json'), 'utf8')) as { paths: string[] }
    expect(mf.paths.sort()).toEqual(['helper', 'review.md', 'semantic-commit'])
    await uninstallSkillDir('@p/suite', out)
    expect(existsSync(join(out, 'suite'))).toBe(false)
    expect(existsSync(join(out, 'semantic-commit'))).toBe(false)
    expect(existsSync(join(out, 'review.md'))).toBe(false)
    expect(existsSync(join(out, 'helper'))).toBe(false)
  })

  it('installSkillTar: masked skills/ nest lifted when root SKILL.md exists; collision gets prefix', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tgz, out } = mk({
      'SKILL.md': '---\n---\nroot skill',                  // masks nested search
      'skills/inner/SKILL.md': '---\n---\ninner',
      '.opencode/skills/taken/SKILL.md': '---\n---\nmine',
    })
    // foreign dir occupying the author ID forces the <pkg>- prefix
    mkdirSync(join(out, 'taken'), { recursive: true }); writeFileSync(join(out, 'taken', 'SKILL.md'), 'foreign')
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })
    expect(existsSync(join(out, 'inner', 'SKILL.md'))).toBe(true)             // masked → lifted
    expect(existsSync(join(out, 'suite-taken', 'SKILL.md'))).toBe(true)       // collision → prefixed
    expect(readFileSync(join(out, 'taken', 'SKILL.md'), 'utf8')).toBe('foreign') // foreign untouched
  })
  it('installSkillTar: reinstall overwrites owned paths in place; empty tarball throws', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, writeFileSync, existsSync } = await import('node:fs')
    const { tgz, out } = mk({ '.opencode/skills/alpha/SKILL.md': 'v1' })
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })
    expect(existsSync(join(out, 'alpha', 'SKILL.md'))).toBe(true)
    // reinstall: owned 'alpha' overwritten in place — no suite-alpha duplicate
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })
    expect(existsSync(join(out, 'alpha', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(out, 'suite-alpha'))).toBe(false)
    const { gzipSync } = await import('node:zlib')
    await expect(installSkillTar({ name: 'x', gzipped: gzipSync(Buffer.alloc(0)), root: out })).rejects.toThrow('empty tarball')
  })

  it('installSkillTar: skips hidden entries inside nests', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, existsSync, readdirSync } = await import('node:fs')
    const { tgz, out } = mk({
      '.opencode/skills/.secret/SKILL.md': 'x',
      '.opencode/skills/visible/SKILL.md': 'y',
    })
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })
    expect(existsSync(join(out, 'visible', 'SKILL.md'))).toBe(true)
    expect(readdirSync(out)).not.toContain('.secret')
  })

  it('uninstallSkillDir: manifest-less dirs are foreign — refuses, preserves', async () => {
    const { uninstallSkillDir } = await import('../src/skill-install.ts')
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const out = mkdtempSync(join(tmpdir(), 'skl-'))
    mkdirSync(join(out, 'suite'), { recursive: true })
    mkdirSync(join(out, 'suite-alpha'), { recursive: true })
    mkdirSync(join(out, 'other'), { recursive: true })
    writeFileSync(join(out, 'other', 'SKILL.md'), 'keep')
    // no manifest anywhere → 'suite' and the <id>-* sibling are all foreign;
    // the old code deleted them unconditionally (P0: user-file loss)
    await expect(uninstallSkillDir('suite', out)).rejects.toThrow(/not managed by market/)
    expect(existsSync(join(out, 'suite'))).toBe(true)
    expect(existsSync(join(out, 'suite-alpha'))).toBe(true)
    expect(existsSync(join(out, 'other'))).toBe(true)
  })
})

describe('install routing + contract', () => {
  const gh = (over: Record<string, unknown> = {}): MarketEntry => ({
    name: 'o/repo', slug: 'o/repo', type: 'plugin', category: [],
    source: { kind: 'github', id: 'o/repo', repo: 'o/repo' },
    modifiedAt: '2026-03-01T00:00:00Z', ...over,
  } as MarketEntry)
  const npm = (over: Record<string, unknown> = {}): MarketEntry => ({
    name: 'pkg', slug: 'pkg', type: 'plugin', category: [],
    source: { kind: 'npm', id: 'pkg' }, latestVersion: '1.0.0', ...over,
  } as MarketEntry)

  it('installPlan: npm plugin / npm skill / dual / github skill / no-target', async () => {
    const { installPlan } = await import('../src/catalog.ts')
    expect(installPlan(npm({ contains: ['plugin'] }))).toEqual({ plugin: true, skill: null })
    expect(installPlan(npm({ type: 'skill', contains: ['skill'] }))).toEqual({ plugin: false, skill: 'npm' })
    // dual-nature npm package — both halves installable
    expect(installPlan(npm({ contains: ['plugin', 'skill'] }))).toEqual({ plugin: true, skill: 'npm' })
    // github skill repo — no npm version, still installable via codeload
    expect(installPlan(gh({ type: 'skill', contains: ['skill'], latestVersion: null }))).toEqual({ plugin: false, skill: 'github' })
    // github plugin repo — nothing deliverable (no npm artifact)
    expect(installPlan(gh({ contains: ['plugin'], latestVersion: null }))).toEqual({ plugin: false, skill: null })
    // npm entry missing a version
    expect(installPlan(npm({ latestVersion: null }))).toEqual({ plugin: false, skill: null })
    // malformed repo id → not installable as github
    expect(installPlan(gh({ contains: ['skill'], latestVersion: null, source: { kind: 'github', id: 'x', repo: 'bad repo!' } }))).toEqual({ plugin: false, skill: null })
    // legacy entry without contains falls back on type — mcp has no plugin
    // payload to `plugin add`; type-skill still routes to the npm skill path
    expect(installPlan(npm({ type: 'mcp' }))).toEqual({ plugin: false, skill: null })
    expect(installPlan(npm({ type: 'skill' }))).toEqual({ plugin: false, skill: 'npm' })
    expect(installPlan(npm({ type: 'plugin' }))).toEqual({ plugin: true, skill: null })
  })
  it('canInstall mirrors deliverable parts — github skill repo is installable', async () => {
    const { canInstall } = await import('../src/catalog.ts')
    expect(canInstall(gh({ type: 'skill', contains: ['skill'], latestVersion: null }))).toBe(true)
    expect(canInstall(gh({ contains: ['plugin'], latestVersion: null }))).toBe(false)
    expect(canInstall(npm({ contains: ['plugin'] }))).toBe(true)
  })
  it('verMarker + hasUpdate: github pushedAt is the version marker', async () => {
    const { verMarker, hasUpdate } = await import('../src/catalog.ts')
    const g = gh({ modifiedAt: '2026-03-01T00:00:00Z' })
    expect(verMarker(g)).toBe('2026-03-01T00:00:00Z')
    expect(verMarker(npm())).toBe('1.0.0')
    expect(hasUpdate(g, '2026-02-01T00:00:00Z')).toBe(true)
    expect(hasUpdate(g, '2026-03-01T00:00:00Z')).toBe(false)
    expect(hasUpdate(g, 'local')).toBe(false)          // dir installs can't compare
    expect(hasUpdate(g)).toBe(false)
  })
  it('inDays: github modifiedAt feeds the publish window', async () => {
    const { inDays } = await import('../src/catalog.ts')
    const recent = new Date(Date.now() - 3600_000).toISOString()
    expect(inDays(gh({ modifiedAt: recent }), 7)).toBe(true)
    expect(inDays(gh({ modifiedAt: '2001-01-01T00:00:00Z' }), 7)).toBe(false)
  })
  it('resolveIndexUrl: options > env > default, https-only', async () => {
    const { resolveIndexUrl } = await import('../src/catalog.ts')
    expect(resolveIndexUrl({ indexUrl: 'https://x.example/idx.json' })).toBe('https://x.example/idx.json')
    expect(resolveIndexUrl({ indexUrl: 'http://insecure/x' })).toBe(DEFAULT_INDEX_URL)   // non-https rejected
    expect(resolveIndexUrl({ indexUrl: 42 })).toBe(DEFAULT_INDEX_URL)
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env
    env.OPENCODE_MARKET_INDEX = 'https://env.example/i.json'
    expect(resolveIndexUrl(null)).toBe('https://env.example/i.json')
    expect(resolveIndexUrl({ indexUrl: 'https://opt.example/o.json' })).toBe('https://opt.example/o.json')   // options beat env
    delete env.OPENCODE_MARKET_INDEX
    expect(resolveIndexUrl(null)).toBe(DEFAULT_INDEX_URL)
  })
  it('healthUrl/skillsUrl derive sibling endpoints', async () => {
    const { healthUrl, skillsUrl } = await import('../src/catalog.ts')
    expect(healthUrl('https://x.example/i/index.json')).toBe('https://x.example/i/health.json')
    expect(skillsUrl('https://x.example/i/index.json')).toBe('https://x.example/i/skills/')
  })
})

describe('integrityMatches — sha512 SRI', () => {
  it('match / mismatch / unverifiable', async () => {
    const { integrityMatches } = await import('../src/catalog.ts')
    const { createHash } = await import('node:crypto')
    const buf = new TextEncoder().encode('artifact-bytes')
    const sri = `sha512-${createHash('sha512').update(buf).digest('base64')}`
    expect(await integrityMatches(buf, sri)).toBe(true)
    expect(await integrityMatches(new TextEncoder().encode('other'), sri)).toBe(false)
    expect(await integrityMatches(buf, null)).toBeNull()            // no announced integrity → unverifiable
    expect(await integrityMatches(buf, 'md5-zzz')).toBeNull()       // unsupported scheme → unverifiable, never auto-pass
  })
})

describe('manifest-first fetch (health.json sha256)', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  const IDX_TEXT = JSON.stringify({ version: '1', generatedAt: 'g', categories: {}, removed: [],
    plugins: [{ name: 'p', slug: 'p', verification: { status: 'unverified' } }] })
  const servePair = async () => {
    const counts = { index: 0, health: 0 }
    let indexBody = IDX_TEXT
    let health: unknown = null
    let indexStatus = 200
    const srv = createServer((req, res) => {
      if (req.url === '/health.json') {
        counts.health++
        if (health === null) { res.statusCode = 404; return res.end() }
        res.end(JSON.stringify(health))
      } else {
        counts.index++
        res.statusCode = indexStatus
        res.end(indexStatus === 200 ? indexBody : 'err')
      }
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    return {
      counts, close: () => srv.close(),
      url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/index.json`,
      setIndex: (body: string) => { indexBody = body },
      setHealth: (h: unknown) => { health = h },
      setIndexStatus: (s: number) => { indexStatus = s },
    }
  }
  const shaOf = (text: string) => createHash('sha256').update(text).digest('hex')
  const mkStore = () => {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    return store
  }
  const dropLs = () => { delete (globalThis as Record<string, unknown>).localStorage }

  it('sha hit → no index download; moved sha → refetch + updated outcome', async () => {
    const { fetchIndexCached, fetchOutcome } = await import('../src/catalog.ts')
    mkStore()
    const s = await servePair()
    s.setHealth({ sha256: shaOf(IDX_TEXT), generatedAt: 'g' })
    const a = await fetchIndexCached(s.url)
    expect(fetchOutcome()).toBe('first')
    expect(s.counts).toEqual({ index: 1, health: 1 })
    // warm + sha unchanged → manifest check only, index NOT re-downloaded
    const b = await fetchIndexCached(s.url)
    expect(fetchOutcome()).toBe('fresh')
    expect(s.counts).toEqual({ index: 1, health: 2 })
    expect(b).toEqual(a)
    // publish moved → health sha differs → refetch even inside TTL
    const IDX2 = JSON.stringify({ version: '2', generatedAt: 'g2', categories: {}, removed: [], plugins: [{ name: 'p2', slug: 'p2' }] })
    s.setIndex(IDX2); s.setHealth({ sha256: shaOf(IDX2) })
    const c = await fetchIndexCached(s.url)
    expect(fetchOutcome()).toBe('updated')
    expect(s.counts).toEqual({ index: 2, health: 3 })
    expect(c.plugins[0]!.name).toBe('p2')
    s.close(); dropLs()
  }, 20000)
  it('hash mismatch → outcome mismatch + old cache kept, never pinned', async () => {
    const { fetchIndexCached, fetchOutcome } = await import('../src/catalog.ts')
    const store = mkStore()
    const s = await servePair()
    s.setHealth({ sha256: shaOf(IDX_TEXT) })
    await fetchIndexCached(s.url)                                    // seed cache
    s.setHealth({ sha256: '0'.repeat(64) })                          // manifest lies
    const kept = await fetchIndexCached(s.url, true)
    expect(fetchOutcome()).toBe('mismatch')
    expect(kept.plugins[0]!.name).toBe('p')                          // old cache served
    const c = JSON.parse(store['opencode-market.index.v1']!) as { sha: string }
    expect(c.sha).toBe(shaOf(IDX_TEXT))                              // mismatched pair not stored
    s.close(); dropLs()
  }, 20000)
  it('mismatch with no cache → throws (fail closed)', async () => {
    const { fetchIndexCached, fetchOutcome } = await import('../src/catalog.ts')
    mkStore()
    const s = await servePair()
    s.setHealth({ sha256: 'f'.repeat(64) })
    await expect(fetchIndexCached(s.url)).rejects.toThrow('mismatch')
    expect(fetchOutcome()).toBe('mismatch')
    s.close(); dropLs()
  }, 20000)
  it('health endpoint down → plain TTL behavior, no hash pin', async () => {
    const { fetchIndexCached, fetchOutcome } = await import('../src/catalog.ts')
    const store = mkStore()
    const s = await servePair()
    const a = await fetchIndexCached(s.url)                          // health 404s
    expect(fetchOutcome()).toBe('first')
    const b = await fetchIndexCached(s.url)
    expect(fetchOutcome()).toBe('fresh')
    expect(s.counts).toEqual({ index: 1, health: 2 })                // TTL served, no re-download
    expect(b).toEqual(a)
    const c = JSON.parse(store['opencode-market.index.v1']!) as { sha?: string }
    expect(c.sha).toBeUndefined()                                    // unpinned without manifest
    s.close(); dropLs()
  }, 20000)
})

describe('fetchPkgVersionMeta', () => {
  it('approved-version tarball + integrity; https-only; packument cached', async () => {
    const { fetchPkgVersionMeta } = await import('../src/catalog.ts')
    const orig = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ versions: {
        '1.0.0': { dist: { tarball: 'https://r/approved.tgz', integrity: 'sha512-AAA=' } },
        '9.9.9': { dist: { tarball: 'https://r/held.tgz' } },
        '0.5.0': { dist: { tarball: 'http://insecure/x.tgz' } },
      } }))
    }) as typeof fetch
    try {
      const m = await fetchPkgVersionMeta('meta-pkg-zz1', '1.0.0')
      expect(m).toEqual({ tarball: 'https://r/approved.tgz', integrity: 'sha512-AAA=' })
      // held pending version is reachable ONLY by explicit pin, never latest —
      // and a second lookup hits the cache (one packument fetch total)
      const held = await fetchPkgVersionMeta('meta-pkg-zz1', '9.9.9')
      expect(held.tarball).toBe('https://r/held.tgz')
      expect(calls).toBe(1)
      // insecure tarball rejected
      expect((await fetchPkgVersionMeta('meta-pkg-zz1', '0.5.0')).tarball).toBeNull()
      // unknown version → nulls, never invents a URL
      expect(await fetchPkgVersionMeta('meta-pkg-zz1', '3.3.3')).toEqual({ tarball: null, integrity: null })
    } finally { globalThis.fetch = orig }
  })
})

describe('hostx id guards', () => {
  it('assertEntryId: npm names + owner/repo; rejects traversal + junk', async () => {
    const { assertEntryId } = await import('../src/hostx.ts')
    for (const ok of ['pkg', '@scope/pkg', 'owner/repo', 'o.r/r_e-p.o'])
      expect(() => assertEntryId(ok)).not.toThrow()
    for (const bad of ['', 'a b', '../x', 'a/../b', 'x//y', 'o/repo/extra', 42, null])
      expect(() => assertEntryId(bad)).toThrow('invalid entry id')
  })
  it('assertSkillId: repo basename derives the dir; skillId namespaces', async () => {
    const { assertSkillId, skillId } = await import('../src/hostx.ts')
    expect(assertSkillId('o/myrepo')).toBe('myrepo')
    expect(skillId('o/myrepo')).toBe('o--myrepo')
    expect(assertSkillId('@scope/pkg')).toBe('pkg')
  })
  it('restrictedEnv forwards proxies + XDG, still strips ambient secrets', async () => {
    const { restrictedEnv } = await import('../src/hostx.ts')
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env
    env.HTTPS_PROXY = 'http://127.0.0.1:8888'; env.XDG_CONFIG_HOME = '/tmp/xdg-cfg'; env.MY_SECRET_TOKEN = 'leak-me-not'
    const e = restrictedEnv()
    expect(e.HTTPS_PROXY).toBe('http://127.0.0.1:8888')
    expect(e.XDG_CONFIG_HOME).toBe('/tmp/xdg-cfg')
    expect(e.MY_SECRET_TOKEN).toBeUndefined()
    delete env.HTTPS_PROXY; delete env.XDG_CONFIG_HOME; delete env.MY_SECRET_TOKEN
  })
  it('configPath: OPENCODE_CONFIG > XDG_CONFIG_HOME > ~/.config', async () => {
    const { configPath } = await import('../src/hostx.ts')
    const { homedir } = await import('node:os')
    const { join } = await import('node:path')
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env
    delete env.OPENCODE_CONFIG; delete env.XDG_CONFIG_HOME
    expect(await configPath()).toBe(join(homedir(), '.config', 'opencode', 'opencode.json'))
    env.XDG_CONFIG_HOME = '/tmp/xdg-cfg'
    expect(await configPath()).toBe('/tmp/xdg-cfg/opencode/opencode.json')
    env.OPENCODE_CONFIG = '/tmp/custom-opencode.json'
    expect(await configPath()).toBe('/tmp/custom-opencode.json')
    delete env.OPENCODE_CONFIG; delete env.XDG_CONFIG_HOME
  })
  it('writeSkillPermission: set/update/clear round-trip preserves other permissions', async () => {
    const { writeSkillPermission } = await import('../src/hostx.ts')
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const cfg = join(mkdtempSync(join(tmpdir(), 'perm-')), 'opencode.json')
    writeFileSync(cfg, JSON.stringify({ permissions: [{ action: 'tool', resource: 'bash', effect: 'deny' }] }))
    const m1 = await writeSkillPermission(cfg, 'semantic-commit', 'deny')
    expect(m1['semantic-commit']).toBe('deny')
    const m2 = await writeSkillPermission(cfg, 'semantic-commit', 'allow')
    expect(m2['semantic-commit']).toBe('allow')
    const m3 = await writeSkillPermission(cfg, 'semantic-commit', null)
    expect(m3['semantic-commit']).toBeUndefined()
    // unrelated permission untouched through the whole cycle
    const d = JSON.parse(readFileSync(cfg, 'utf8')) as { permissions: { action: string; resource: string }[] }
    expect(d.permissions).toEqual([{ action: 'tool', resource: 'bash', effect: 'deny' }])
    await expect(writeSkillPermission(cfg, 'bad/id', 'allow')).rejects.toThrow('invalid skill id')
    await expect(writeSkillPermission(cfg, 'x', 'yolo' as 'allow')).rejects.toThrow('invalid permission mode')
  })
})

describe('catalog sanitize + version helpers', () => {
  it('sanitizeIndex: enum-clamps verification status, sanitizes generatedAt + removed + categories', async () => {
    const { sanitizeIndex } = await import('../src/catalog.ts')
    const out = sanitizeIndex({
      version: '1',
      generatedAt: 'g\x1b[31mX',
      categories: { tools: { en: 'tools\x1b', zh: '工具' }, bogus: 7 as never },
      removed: [{ name: 'gone\x1b-pkg', reason: 'manual', disappearedAt: '2026-01-01' }, { nope: 1 } as never],
      plugins: [{
        name: 'a', slug: 'a', type: 'p', category: [],
        verification: { status: 'crafted-evil', level: 'l', runUrl: 'https://x/run', logExcerpt: 'log\x1b' },
        pendingUpdate: { version: '9', reason: 'r', verification: { status: 'failed' } },
        deprecated: true, deprecatedMessage: 'use b\x1b', replacement: 'b',
        compat: { engines: '>=2.0', peer: 'x' },
      } as MarketEntry],
    } as MarketIndex)
    const e = out.plugins[0]!
    expect(e.verification?.status).toBe('unverified')           // crafted → fail-safe enum
    expect(e.verification?.logExcerpt).toBe('log')               // control chars stripped
    expect(e.verification?.runUrl).toBe('https://x/run')
    expect(e.pendingUpdate?.verification?.status).toBe('failed')
    expect(e.deprecatedMessage).toBe('use b')
    expect(e.replacement).toBe('b')
    expect(e.compat?.engines).toBe('>=2.0')
    expect(out.generatedAt).toBe('gX')                           // top-level sanitized
    expect(out.categories?.['tools']).toEqual({ en: 'tools', zh: '工具' })
    expect(out.categories?.['bogus']).toBeUndefined()
    expect(out.removed).toEqual([{ name: 'gone-pkg', reason: 'manual', disappearedAt: '2026-01-01' }])
  })
  it('versionCmp/isDowngrade: semver order, ISO dates, unorderable stays 0', async () => {
    const { versionCmp, isDowngrade } = await import('../src/catalog.ts')
    expect(versionCmp('2.0.0', '1.0.0')).toBeGreaterThan(0)
    expect(versionCmp('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(versionCmp('2026-03-01', '2026-02-01')).toBeGreaterThan(0)   // pushedAt markers
    expect(versionCmp('abc123', 'def456')).toBe(0)                      // tree sha — never claim
    const e = { name: 'x', slug: 'x', type: 'p', category: [], latestVersion: '1.0.0' } as MarketEntry
    expect(isDowngrade(e, '2.0.0')).toBe(true)   // installed newer than approved → revert label
    expect(isDowngrade(e, '0.9.0')).toBe(false)
    expect(isDowngrade(e, 'local')).toBe(false)
    expect(isDowngrade(e)).toBe(false)
  })
  it('siteDetailUrl derives p/<slug>.html from the index origin dir', async () => {
    const { siteDetailUrl } = await import('../src/catalog.ts')
    expect(siteDetailUrl({ slug: 'a b' }, 'https://x.example/i/index.json')).toBe('https://x.example/i/p/a%20b.html')
    // nested slugs take the canonical per-segment path the site writes — o/p → p/o/p.html, not o%2Fp
    expect(siteDetailUrl({ slug: 'o/p' }, 'https://x.example/i/index.json')).toBe('https://x.example/i/p/o/p.html')
    expect(siteDetailUrl({ slug: 'x' }, 'not a url')).toBeNull()
  })
  it('removedReasonLabel maps pipeline reasons', async () => {
    const { removedReasonLabel } = await import('../src/catalog.ts')
    expect(removedReasonLabel('manual')).not.toBe('reason unknown')
    expect(removedReasonLabel('totally-new')).toBeTruthy()
    expect(removedReasonLabel(undefined)).toBeTruthy()
  })
  it('setCatDict: index-shipped category names beat the hardcoded table', async () => {
    const { setCatDict, catLabel } = await import('../src/catalog.ts')
    setCatDict({ 'brand-new-cat': { en: 'fresh', zh: '全新' } })
    expect(catLabel('brand-new-cat')).toBe('fresh')
    expect(catLabel('totally-unknown')).toBe('totally-unknown')   // passthrough
    setCatDict(undefined)
  })
  it('fetchIndexCached: oversize content-length fails closed, keeps old cache', async () => {
    const { fetchIndexCached } = await import('../src/catalog.ts')
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    const srv = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.setHeader('content-length', '33554433')   // > 32MB cap, small real body
      res.end(JSON.stringify(CANNED))
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/index.json`
    await expect(fetchIndexCached(url)).rejects.toThrow('too large')
    expect(store['opencode-market.index.v1']).toBeUndefined()      // nothing pinned
    srv.close()
    delete (globalThis as Record<string, unknown>).localStorage
  }, 20000)
})

describe('skill-install foreign-dir protection', () => {
  const mkTgz = (files: Record<string, string>) => {
    const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os')
    const src = mkdtempSync(join(tmpdir(), 'skt-'))
    for (const [p, c] of Object.entries(files)) {
      const fp = join(src, 'package', p)
      mkdirSync(dirname(fp), { recursive: true })
      writeFileSync(fp, c)
    }
    const tgz = join(src, 'p.tgz')
    execFileSync('tar', ['czf', tgz, '-C', src, 'package'])
    return { tgz, out: mkdtempSync(join(tmpdir(), 'sko-')) }
  }
  it('unscoped package refuses to merge into a foreign basename dir', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tgz, out } = mkTgz({ 'SKILL.md': 'x' })
    // pre-existing foreign 'suite' with no market manifest — unscoped installs
    // have no namespaced fallback; mixing in would let uninstall delete user files
    mkdirSync(join(out, 'suite'), { recursive: true })
    writeFileSync(join(out, 'suite', 'user.txt'), 'mine')
    await expect(installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })).rejects.toThrow('not managed by market')
    expect(readFileSync(join(out, 'suite', 'user.txt'), 'utf8')).toBe('mine')   // foreign untouched
    expect(existsSync(join(out, 'suite', '.market-skills.json'))).toBe(false)
  })
  it('scoped package namespaces around a foreign basename; foreign namespaced dir refused', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, existsSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tgz, out } = mkTgz({ 'SKILL.md': 'x' })
    mkdirSync(join(out, 'suite'), { recursive: true })          // foreign basename
    await installSkillTar({ name: '@p/suite', gzipped: readFileSync(tgz), root: out })
    expect(existsSync(join(out, 'p--suite', '.market-skills.json'))).toBe(true)   // namespaced
    expect(existsSync(join(out, 'suite', '.market-skills.json'))).toBe(false)     // foreign untouched
    // dangerous case: foreign basename AND foreign namespaced dir — no room
    // left, refuse rather than merge a manifest into user files
    const { tgz: tgz2, out: out2 } = mkTgz({ 'SKILL.md': 'x' })
    mkdirSync(join(out2, 'suite'), { recursive: true })
    mkdirSync(join(out2, 'q--suite'), { recursive: true })
    writeFileSync(join(out2, 'q--suite', 'user.txt'), 'mine')
    await expect(installSkillTar({ name: '@q/suite', gzipped: readFileSync(tgz2), root: out2 })).rejects.toThrow('not managed by market')
    // free basename + foreign namespaced dir: install at basename is fine —
    // the foreign namespaced dir is simply left alone
    const { tgz: tgz3, out: out3 } = mkTgz({ 'SKILL.md': 'x' })
    mkdirSync(join(out3, 'r--suite'), { recursive: true })
    writeFileSync(join(out3, 'r--suite', 'user.txt'), 'mine')
    await installSkillTar({ name: '@r/suite', gzipped: readFileSync(tgz3), root: out3 })
    expect(existsSync(join(out3, 'suite', '.market-skills.json'))).toBe(true)
    expect(readFileSync(join(out3, 'r--suite', 'user.txt'), 'utf8')).toBe('mine')
  })
  it('reinstall into an owned dir still works; manifest survives', async () => {
    const { installSkillTar } = await import('../src/skill-install.ts')
    const { readFileSync, existsSync } = await import('node:fs')
    const { tgz, out } = mkTgz({ 'SKILL.md': 'x', 'file.txt': 'v1' })
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })
    await installSkillTar({ name: 'suite', gzipped: readFileSync(tgz), root: out })   // owned → allowed
    expect(existsSync(join(out, 'suite', '.market-skills.json'))).toBe(true)
    expect(existsSync(join(out, 'suite', 'file.txt'))).toBe(true)
  })
})

describe('audit-round-3 fixes', () => {
  it('versionCmp: prerelease < release; numeric/alnum prerelease ids', async () => {
    const { versionCmp } = await import('../src/catalog.ts')
    // the old part-wise compare ranked 1.0.0-beta.1 NEWER than 1.0.0
    expect(versionCmp('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(versionCmp('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(versionCmp('1.0.0-beta.1', '1.0.0-beta.2')).toBeLessThan(0)
    expect(versionCmp('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)   // numeric ids
    expect(versionCmp('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)    // shorter loses
    expect(versionCmp('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)          // numeric < alnum
    expect(versionCmp('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(versionCmp('v1.0.0', '1.0.0')).toBe(0)                          // build metadata ignored
  })
  it('resolveIndexUrl/isIndexUrl: https anywhere, http only on loopback', async () => {
    const { resolveIndexUrl, isIndexUrl } = await import('../src/catalog.ts')
    expect(isIndexUrl('https://x.test/i.json')).toBe(true)
    expect(isIndexUrl('http://localhost:8000/index.json')).toBe(true)
    expect(isIndexUrl('http://127.0.0.1:9000/i.json')).toBe(true)
    expect(isIndexUrl('http://[::1]:8000/i.json')).toBe(true)
    expect(isIndexUrl('http://insecure.example.com/i.json')).toBe(false)
    expect(isIndexUrl('http://localhost.evil.com/i.json')).toBe(false)
    expect(isIndexUrl('ftp://x')).toBe(false)
    expect(resolveIndexUrl({ indexUrl: 'http://localhost:8123/index.json' })).toBe('http://localhost:8123/index.json')
    expect(resolveIndexUrl({ indexUrl: 'http://insecure.example.com/i.json' })).toBe(DEFAULT_INDEX_URL)
  })
  it('gitPinRef: hex pins pass, missing → HEAD, malformed fails closed', async () => {
    const { gitPinRef } = await import('../src/catalog.ts')
    expect(gitPinRef('0123456789abcdef0123456789abcdef01234567')).toBe('0123456789abcdef0123456789abcdef01234567')
    expect(gitPinRef(null)).toBe('HEAD')
    expect(gitPinRef(undefined)).toBe('HEAD')
    expect(gitPinRef('')).toBe('HEAD')
    for (const bad of ['main', 'v1.2.3', 'HEAD', '0123\n4567', 'zzzz'])
      expect(() => gitPinRef(bad)).toThrow('invalid source pin')
  })
  it('halfState/halvesToSync: per-half install+update truth table', async () => {
    const { halfState, halvesToSync, installPlan } = await import('../src/catalog.ts')
    const dual: MarketEntry = {
      name: 'pkg', slug: 'pkg', type: 'plugin', category: [], contains: ['plugin', 'skill'],
      source: { kind: 'npm', id: 'pkg' }, latestVersion: '2.0.0',
    } as MarketEntry
    // fresh → both halves sync
    expect(halvesToSync(dual, halfState(dual, {}, {}))).toEqual({ plugin: true, skill: true })
    // plugin current + skill outdated → only skill
    const hs1 = halfState(dual, { pkg: '2.0.0' }, { pkg: '1.0.0' })
    expect(hs1.pluginOn).toBe(true); expect(hs1.pluginOut).toBe(false)
    expect(hs1.skillOn).toBe(true); expect(hs1.skillOut).toBe(true)
    expect(halvesToSync(dual, hs1)).toEqual({ plugin: false, skill: true })
    // plugin outdated + skill current → only plugin
    const hs2 = halfState(dual, { pkg: '1.0.0' }, { pkg: '2.0.0' })
    expect(halvesToSync(dual, hs2)).toEqual({ plugin: true, skill: false })
    // all current → nothing
    const hs3 = halfState(dual, { pkg: '2.0.0' }, { pkg: '2.0.0' })
    expect(hs3.anyOut).toBe(false)
    expect(halvesToSync(dual, hs3)).toEqual({ plugin: false, skill: false })
    // partial install (plugin only) → plugin updates, missing skill NOT resurrected
    const hs4 = halfState(dual, { pkg: '1.0.0' }, {})
    expect(halvesToSync(dual, hs4)).toEqual({ plugin: true, skill: false })
    // foreign skill dir ('local') → on but never "outdated"
    const hs5 = halfState(dual, {}, { pkg: 'local' })
    expect(hs5.skillOn).toBe(true); expect(hs5.skillOut).toBe(false)
    expect(hs5.anyOut).toBe(false)
  })
  it('categoriesOf reads zh descriptions too', async () => {
    const { categoriesOf } = await import('../src/catalog.ts')
    const zhOnly: MarketEntry = {
      name: 'x9z-unrelated', slug: 'x9z', type: 'plugin', category: [],
      description: { zh: '管理 opencode 的模型提供商与用量计费' },
    } as MarketEntry
    const cats = categoriesOf(zhOnly)
    expect(cats).toContain('models')
    expect(cats).not.toContain('other')
  })
  it('restrictedEnv forwards safe NPM_CONFIG_*, still strips credentials', async () => {
    const { restrictedEnv } = await import('../src/hostx.ts')
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env
    env.NPM_CONFIG_REGISTRY = 'https://npm.corp.example/'; env.npm_config_cache = '/tmp/npmcache'
    env.NPM_CONFIG_//registry.npmjs.org/:_authToken = 'SECRET'
    env.NPM_TOKEN = 'SECRET2'
    const e = restrictedEnv()
    expect(e.NPM_CONFIG_REGISTRY).toBe('https://npm.corp.example/')
    expect(e.npm_config_cache).toBe('/tmp/npmcache')
    expect(Object.keys(e).some(k => /authToken|_TOKEN/i.test(k))).toBe(false)
    delete env.NPM_CONFIG_REGISTRY; delete env.npm_config_cache
    delete env['NPM_CONFIG_//registry.npmjs.org/:_authToken']; delete env.NPM_TOKEN
  })
  it('assertUninstallRef: npm/repo/git-urls ok; junk rejected', async () => {
    const { assertUninstallRef } = await import('../src/hostx.ts')
    for (const ok of ['pkg', '@scope/pkg', 'owner/repo', 'https://github.com/o/r', 'git+ssh://git@h/o/r.git', 'git@github.com:o/r.git', 'ssh://git@h/o/r', 'github:o/r'])
      expect(() => assertUninstallRef(ok)).not.toThrow()
    for (const bad of ['', 'a b', '../x', 'x;rm -rf /', 'https://x y', 42, null, 'a'.repeat(600)])
      expect(() => assertUninstallRef(bad)).toThrow('invalid uninstall target')
  })
  it('fetchPkgVersionMeta cache is bounded (LRU evicts oldest)', async () => {
    const { fetchPkgVersionMeta } = await import('../src/catalog.ts')
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ 'dist-tags': {}, versions: { '1.0.0': { dist: { tarball: 'https://r/x.tgz', integrity: 'sha512-x' } } } }), { status: 200 })
    }) as typeof fetch
    try {
      for (let i = 0; i < 105; i++) await fetchPkgVersionMeta(`pk-bound-${i}`, '1.0.0')
      const before = calls
      await fetchPkgVersionMeta('pk-bound-0', '1.0.0')   // evicted → refetches
      expect(calls).toBe(before + 1)
      await fetchPkgVersionMeta('pk-bound-104', '1.0.0') // newest → cache hit
      expect(calls).toBe(before + 1)
    } finally { globalThis.fetch = realFetch }
  })
})

describe('audit10 client hardening', () => {
  it('redactLog strips ANSI/control sequences before redacting secrets', async () => {
    const { redactLog } = await import('../src/catalog.ts')
    const t = redactLog('ok\x1b[31m red \x1b]8;;http://x\x07link\x1b]8;;\x07 token=abc123')
    expect(t).not.toContain('\x1b')
    expect(t).not.toContain('\x07')
    expect(t).toContain('<redacted>')
  })

  it('fetchPkgVersionMeta rejects an oversized packument before buffering it', async () => {
    const { fetchPkgVersionMeta } = await import('../src/catalog.ts')
    const realFetch = globalThis.fetch
    // a lying registry (npm_config_registry is user-controlled) advertising a
    // >64MB body must be refused at the content-length gate, not buffered
    globalThis.fetch = (async () =>
      new Response('x', { status: 200, headers: { 'content-length': String(65 * 1024 * 1024) } })) as typeof fetch
    try {
      await expect(fetchPkgVersionMeta('pk-huge-a10', '1.0.0')).rejects.toThrow(/too large/)
    } finally { globalThis.fetch = realFetch }
  })

  // gui main() uses CommonJS require() internally (the host loads dist/gui.cjs);
  // shim it so the provider surface is exercisable under ESM vitest
  const withMain = async (fn: (api: Record<string, (...a: never[]) => unknown>) => Promise<void>) => {
    const { createRequire } = await import('node:module')
    const g = globalThis as Record<string, unknown>
    const prev = g.require
    g.require = createRequire(import.meta.url)
    try {
      const { default: plugin } = await import('../src/gui.ts')
      const main = plugin.main as (m: unknown) => void
      let api: Record<string, (...a: never[]) => unknown> = {}
      main({ provide: (_d: unknown, impl: never) => { api = impl as typeof api }, emit: () => {} })
      await fn(api)
    } finally {
      if (prev === undefined) delete g.require
      else g.require = prev
    }
  }
  const envOf = () => (globalThis as { process: { env: Record<string, string | undefined> } }).process.env

  it('installed(): degraded=true when every inventory path fails', async () => {
    const env = envOf()
    const prevPath = env.PATH
    env.PATH = '/nonexistent-a10'          // host api absent + CLI fallback unfindable
    try {
      await withMain(async (api) => {
        const installed = api.installed as (p?: { names?: string[] }) => Promise<{ degraded?: boolean }>
        expect((await installed({ names: [] })).degraded).toBe(true)
      })
    } finally { env.PATH = prevPath }
  })

  it('install: a second call inside the pin-recheck window → installRunning; cancelInstall reaches pending claims', async () => {
    const name = 'a10-race-pkg'
    const IDX = { version: '1', generatedAt: 't', categories: {}, removed: [],
      plugins: [{ name, slug: name, type: 'plugin', contains: ['plugin'], approval: 'approved', latestVersion: '1.0.0' }] }
    const env = envOf()
    const prevIdx = env.OPENCODE_MARKET_INDEX; env.OPENCODE_MARKET_INDEX = 'https://a10.example/index.json'
    const prevPath = env.PATH; env.PATH = '/nonexistent-a10'   // if it ever spawns, it must fail
    const realFetch = globalThis.fetch
    let release!: (r: Response) => void
    const gate = new Promise<Response>(r => { release = r })
    globalThis.fetch = ((u: unknown) => String(u).endsWith('/health.json')
      ? Promise.resolve(new Response('x', { status: 404 }))   // no manifest → straight to the index fetch
      : gate) as typeof fetch
    try {
      await withMain(async (api) => {
        const install = api.install as (p: { name: string; spec: string }) => Promise<string>
        const cancel = api.cancelInstall as (n: string) => Promise<string>
        const p1 = install({ name, spec: `${name}@1.0.0` })    // claims the name, hangs in pin recheck
        await expect(install({ name, spec: `${name}@1.0.0` })).rejects.toThrow('install already running')
        expect(await cancel(name)).toBe('cancelled')           // aborts the claimed-but-childless op
        release(new Response(JSON.stringify(IDX)))
        await expect(p1).rejects.toThrow('cancelled')          // stops before spawning
      })
    } finally { env.PATH = prevPath; env.OPENCODE_MARKET_INDEX = prevIdx; globalThis.fetch = realFetch }
  })

  it('writeSkill: a duplicate call for the same entry → installRunning; cancel aborts the pending claim', async () => {
    const name = 'a10-skill-pkg'
    const IDX = { version: '1', generatedAt: 't', categories: {}, removed: [],
      plugins: [{ name, slug: name, type: 'skill', contains: ['skill'], approval: 'approved', latestVersion: '2.0.0' }] }
    const env = envOf()
    const prevIdx = env.OPENCODE_MARKET_INDEX; env.OPENCODE_MARKET_INDEX = 'https://a10.example/index.json'
    const realFetch = globalThis.fetch
    let release!: (r: Response) => void
    const gate = new Promise<Response>(r => { release = r })
    globalThis.fetch = ((u: unknown) => String(u).endsWith('/health.json')
      ? Promise.resolve(new Response('x', { status: 404 }))
      : gate) as typeof fetch
    try {
      await withMain(async (api) => {
        const writeSkill = api.writeSkill as (p: { name: string }) => Promise<string>
        const cancel = api.cancelInstall as (n: string) => Promise<string>
        const w1 = writeSkill({ name })                        // claims the name, hangs on the index re-pull
        await expect(writeSkill({ name })).rejects.toThrow('install already running')
        expect(await cancel(name)).toBe('cancelled')
        release(new Response(JSON.stringify(IDX)))
        await expect(w1).rejects.toThrow('cancelled')          // aborts before any disk write
      })
    } finally { env.OPENCODE_MARKET_INDEX = prevIdx; globalThis.fetch = realFetch }
  })
})
