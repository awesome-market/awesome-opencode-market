import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadedSignal, xdgEnv, verifyPackage } from '../pipeline/verify/verify.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import type { CatalogIndex } from '../src/schema.ts'

describe('verify', () => {
  it('loadedSignal matches the A3-verified log format', () => {
    const log = 'ts level=INFO msg="loading plugin" id=oh-my-opencode entrypoint=file:///x/dist/index.js\n' +
      'ts level=INFO msg="loading plugin" id=opencode-loop-recover entrypoint=file:///y/dist/server.js'
    expect(loadedSignal(log, 'oh-my-opencode')).toBe(true)
    expect(loadedSignal(log, 'opencode-loop-recover')).toBe(true)
    expect(loadedSignal(log, 'not-there')).toBe(false)
    expect(loadedSignal('', 'x')).toBe(false)
  })
  it('loadedSignal escapes regex chars in names', () => {
    const log = 'msg="loading plugin" id=@scope/pkg-v2.0 entrypoint=x'
    expect(loadedSignal(log, '@scope/pkg-v2.0')).toBe(true)
    expect(loadedSignal(log, '@scope/pkg-v2X0')).toBe(false)
  })
  it('xdgEnv sets the three XDG vars under home', () => {
    const e = xdgEnv('/h')
    expect(e.XDG_CONFIG_HOME).toBe('/h/.config')
    expect(e.XDG_DATA_HOME).toBe('/h/data')
    expect(e.XDG_CACHE_HOME).toBe('/h/cache')
  })
})

describe('verify/merge', () => {
  const idx: CatalogIndex = {
    version: '1', generatedAt: 'x', categories: {},
    plugins: [{
      name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
      source: { kind: 'npm', id: 'p' }, description: { en: '' }, category: [],
      license: null, deprecated: false, replacement: null,
      firstSeenAt: 't', latestVersion: '1', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {},
    }, {
      name: 'q', slug: 'o/q', aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: 'q' }, description: { en: '' }, category: [],
      license: null, deprecated: false, replacement: null,
      firstSeenAt: 't', latestVersion: '1', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {},
    }],
  }
  it('merges results into matching entries only', () => {
    const merged = mergeResults(idx, [
      { name: 'p', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ], 'https://run/1')
    expect(merged.plugins[0]!.verification).toMatchObject({
      status: 'verified', level: 'load', opencodeVersion: '2.2.5', runUrl: 'https://run/1',
    })
    expect(merged.plugins[1]!.verification.status).toBe('unverified')
  })
  it('failed results carry logExcerpt', () => {
    const merged = mergeResults(idx, [
      { name: 'p', status: 'failed', level: 'install', opencodeVersion: '2.2.5', verifiedAt: 'v', logExcerpt: 'boom' },
    ])
    expect(merged.plugins[0]!.verification.logExcerpt).toBe('boom')
    expect(merged.plugins[0]!.verification.runUrl).toBeUndefined()
  })
})

describe('verifyPackage (injected exec)', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vh-'))
  it('install failure → failed/install with excerpt', async () => {
    const fake = (async (cmd: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'opencode v2.2.5\n', stderr: '' }
      if (args[1] === 'add') throw Object.assign(new Error('boom'), { stderr: 'NpmInstallFailedError 404' })
      return { stdout: '', stderr: '' }
    }) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('x', { home: vHome(), execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('install')
    expect(r.opencodeVersion).toBe('2.2.5')
    expect(r.logExcerpt).toContain('404')
  })
  it('load signal present → verified/load', async () => {
    const home = vHome()
    mkdirSync(join(home, 'data', 'opencode', 'log'), { recursive: true })
    writeFileSync(join(home, 'data', 'opencode', 'log', 'opencode.log'),
      'ts INFO msg="loading plugin" id=goodpkg entrypoint=file:///x')
    const fake = (async (_c: string, args: string[]) =>
      ({ stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('goodpkg', { home, execFn: fake })
    expect(r.status).toBe('verified')
    expect(r.logExcerpt).toBeUndefined()
  })
  it('no load signal → failed/load with log tail', async () => {
    const home = vHome()
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'opencode v2.2.5', stderr: '' }
      if (args[0] === '-c') throw new Error('serve boot failed') // tolerated
      return { stdout: '', stderr: '' }
    }) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('gone', { home, execFn: fake })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
  })
})
