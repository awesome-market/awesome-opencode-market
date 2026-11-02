import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { run, loadOldIndex } from '../pipeline/run.ts'

function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'runtgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

/** Mock fetch routing by URL substring. */
function mkFetch(tgz: Buffer) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search')) {
      return new Response(JSON.stringify({ objects: [
        { package: { name: 'good-pkg', version: '1.0.0', description: 'd',
          keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
        { package: { name: 'kw-only', version: '1.0.0', description: '',
          keywords: ['opencode'], links: {}, date: 't' } },
      ] }))
    }
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.includes('registry.npmjs.org') && url.includes('good-pkg')) {
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { repository: 'https://github.com/o/good', license: 'MIT',
          dist: { tarball: 'https://x/t.tgz' }, keywords: ['opencode'], main: 'index.js' } },
        time: { '1.0.0': 't' },
      }))
    }
    if (url.includes('registry.npmjs.org') && url.includes('kw-only')) {
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { keywords: ['opencode'], dist: {} } },
        time: {},
      }))
    }
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 3, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } }))
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
    if (url.includes('/contents/')) return new Response('', { status: 404 })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('pipeline/run', () => {
  it('end-to-end: candidate → evidence gate → scan → index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'))
    const out = join(dir, 'index.json')
    const idx = await run({ outPath: out, fetchFn: mkFetch(mkTgz()), now: '2026-11-02T00:00:00Z' })
    expect(idx.plugins).toHaveLength(1)
    const e = idx.plugins[0]!
    expect(e.name).toBe('good-pkg')
    expect(e.slug).toBe('o/good')
    expect(e.capabilities.scannedAt).toBe('2026-11-02T00:00:00Z')
    expect(e.verification.status).toBe('unverified')
    expect(e.metrics.stars).toBe(3)
    expect(e.metrics.npmDownloads30d).toBe(7)
    const written = JSON.parse(readFileSync(out, 'utf8'))
    expect(written.version).toBe('1')
  })
  it('loadOldIndex: valid, invalid, missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'old-'))
    expect(loadOldIndex()).toBeNull()
    expect(loadOldIndex(join(dir, 'nope.json'))).toBeNull()
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: [] }))
    expect(loadOldIndex(good)!.plugins).toEqual([])
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"version":"9"}')
    expect(loadOldIndex(bad)).toBeNull()
  })
})

describe('pipeline/run seed injection', () => {
  it('--seed injects npm names + skips github: lines, dedups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runseed-'))
    const seed = join(dir, 'seed.txt')
    writeFileSync(seed, 'seed-pkg\ngithub:o/r\ngood-pkg\n\n')
    const out = join(dir, 'index.json')
    const idx = await run({ outPath: out, seedPath: seed, fetchFn: mkFetch(mkTgz()), now: '2026-11-02T00:00:00Z' })
    // good-pkg was already a discovered candidate — seed must not double-count; still 1 entry
    expect(idx.plugins.map(p => p.name)).toEqual(['good-pkg'])
  })
})

describe('classify', () => {
  it('assigns categories by keywords, declared fallback 其他', async () => {
    const { classify } = await import('../src/categories.ts')
    expect(classify('theme-x', 'x', 'colors and fonts')).toContain('主题与外观')
    expect(classify('x', 'x', 'git commit review')).toContain('开发流程')
    expect(classify('x', 'x', 'zzz nothing')).toEqual(['其他'])
    expect(classify('tok', 'x', 'llm pricing token').length).toBeLessThanOrEqual(2)
  })
})
