import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadedSignal, xdgEnv, verifyPackage, type SpawnFn } from '../pipeline/verify/verify.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import type { CatalogIndex } from '../src/schema.ts'

/** serve reports dead on arrival — a test must never boot a real `opencode`
 *  binary (dev boxes may have one installed). A silent serve is now classified
 *  as a HARNESS failure (boot never happened ⇒ plugin never loaded ⇒ the
 *  package can't be at fault) — tests that want the api-poll path use
 *  liveSpawn below. */
const deadSpawn = (() => ({
  stdout: { on: () => {} }, stderr: { on: () => {} },
  on: (_ev: string, cb: (a?: unknown) => void) => { cb() },
  kill: () => {},
})) as unknown as SpawnFn

/** Fake serve that announces a listener — the boot lines verify.ts scrapes —
 *  then idles. Exercises the post-boot api poll path. */
const liveSpawn = (() => ({
  stdout: { on: (_e: 'data', cb: (d: unknown) => void) => {
    cb('server listening on http://127.0.0.1:4567\nserver password pw\n')
  } },
  stderr: { on: () => {} },
  on: () => {},
  kill: () => {},
})) as unknown as SpawnFn

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
      license: null, deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: '1', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {},
      approval: 'approved',
    }, {
      name: 'q', slug: 'o/q', aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: 'q' }, description: { en: '' }, category: [],
      license: null, deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: '1', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {},
      approval: 'approved',
    }],
    removed: [],
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
  it('failure streak counts retries; any non-failed result clears it (V-3)', () => {
    const fail = { name: 'p' as const, version: '1', status: 'failed' as const, level: 'load' as const, opencodeVersion: '2.2.5', verifiedAt: 'v' }
    const once = mergeResults(idx, [fail])
    expect(once.plugins[0]!.verification.retries).toBe(1)                       // first failure
    const twice = mergeResults(once, [fail])
    expect(twice.plugins[0]!.verification.retries).toBe(2)                      // streak grows
    const cleared = mergeResults(twice, [
      { name: 'p', status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: 'v' },
    ])
    expect(cleared.plugins[0]!.verification.retries).toBeUndefined()            // verified clears
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
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('x', { home: vHome(), execFn: fake, spawnFn: deadSpawn })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('install')
    expect(r.opencodeVersion).toBe('2.2.5')
    expect(r.logExcerpt).toContain('404')
  })
  it('api plugin entry present+active → verified/load', async () => {
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'goodpkg' }, state: { status: 'active' } }]))
    const fake = (async (_c: string, args: string[]) =>
      ({ stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('goodpkg', { home, execFn: fake, spawnFn: liveSpawn })
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
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('gone', { home, execFn: fake, spawnFn: liveSpawn, apiWaitMs: 30 })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
    expect(r.logExcerpt).toContain('absent from /api/plugin')
  })
  it('serve boot silence → harness THROW, not a package verdict (G2)', async () => {
    // a serve that never announces a listener means the plugin code never ran
    // — blaming the package fed diagnose's concern short-circuit. Throwing
    // lands it in verifyShard's harness:true lane where merge drops the row.
    const home = vHome()
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    await expect((await import('../pipeline/verify/verify.ts'))
      .verifyPackage('gone', { home, execFn: fake, spawnFn: deadSpawn, bootWaitMs: 30 }))
      .rejects.toThrow('serve did not announce a listener')
  })
  it('server-reported failed state → excerpt says so (V-4 deterministic vs timeout)', async () => {
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'badpkg' }, state: { status: 'failed' } }]))
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('badpkg', { home, execFn: fake, spawnFn: liveSpawn })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
    expect(r.logExcerpt).toContain('serve reports the plugin failed to load')
  })

  it('a forged log line alone does NOT verify — server api evidence required', async () => {
    // V-1: the log file is writable by plugin code; only the /api/plugin
    // response counts. A fake "loading plugin" line without the api entry fails.
    const home = vHome()
    mkdirSync(join(home, 'data', 'opencode', 'log'), { recursive: true })
    writeFileSync(join(home, 'data', 'opencode', 'log', 'opencode.log'),
      'ts level=INFO msg="loading plugin" id=goodpkg entrypoint=file:///x\n')
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('goodpkg', { home, execFn: fake, spawnFn: liveSpawn, apiWaitMs: 30 })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('load')
  })

  it('api entry matching name@version spec → verified', async () => {
    const home = vHome()
    writeFileSync(join(home, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'goodpkg@2.3.4' }, state: { status: 'active' } }]))
    const fake = (async () => ({ stdout: 'opencode v2.2.5', stderr: '' })) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('goodpkg', { version: '2.3.4', home, execFn: fake, spawnFn: liveSpawn })
    expect(r.status).toBe('verified')
  })

  it('ocVersion failure → opencodeVersion "unknown"', async () => {
    const home = vHome()
    const fake = (async (_c: string, args: string[]) => {
      if (args[0] === '--version') throw new Error('no version')
      return { stdout: '', stderr: '' }
    }) as unknown as import('../pipeline/verify/verify.ts').ExecFn
    const r = await (await import('../pipeline/verify/verify.ts')).verifyPackage('p', { home, execFn: fake, spawnFn: liveSpawn, apiWaitMs: 30 })
    expect(r.opencodeVersion).toBe('unknown')
  })
})
