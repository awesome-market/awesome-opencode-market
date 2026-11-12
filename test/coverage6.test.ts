/** Branch coverage: ai/diagnose+digest mains, docket main, notify main,
 *  checkTui, verifyPackage feature routes, fetch/github+npm uncovered arms,
 *  run.ts reuse/hold/gone-check branches. */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'
import { main as diagnoseMain, L05_CANARY_BENIGN, L05_CANARY_HOSTILE } from '../pipeline/ai/diagnose.ts'
import { main as digestMain } from '../pipeline/ai/digest.ts'
import { main as docketMain } from '../pipeline/docket.ts'
import { main as notifyMain } from '../pipeline/notify-published.ts'
import { checkTui } from '../pipeline/verify/tui.ts'
import { verifyPackage, type SpawnFn } from '../pipeline/verify/verify.ts'
import { checkGuiBundle, findGuiBundle } from '../pipeline/verify/gui.ts'
import { fetchRepoMeta, fetchRepoTree, fetchRepoPackageName, fetchMarketMeta } from '../pipeline/fetch/github.ts'
import { fetchPackument, fetchTarball, withTimeout } from '../pipeline/fetch/npm.ts'
import { run } from '../pipeline/run.ts'
import { latestVerdicts, applyMatureVerdicts, vkey, akey } from '../pipeline/verdicts.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import { mergeEntries, versionCmp } from '../pipeline/publish/merge.ts'
import { ornithReview } from '../pipeline/ai/diagnose.ts'
import { verifyShard, writeDummyProvider } from '../pipeline/verify/verify.ts'
import { trustFlags } from '../pipeline/publish/merge.ts'
import { parseSubmission } from '../pipeline/submission.ts'
import { renderReview } from '../pipeline/review.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { buildSeedList, repoToNpm } from '../pipeline/discover/seed.ts'
import { detailPage, buildSkillCatalog } from '../pipeline/site/build.ts'
import { detectFeatures } from '../src/features.ts'
import { backfill } from '../pipeline/backfill.ts'

/** serve reports dead on arrival — a test must never boot a real `opencode`
 *  binary (dev boxes may have one installed). Boot silence now throws
 *  (harness lane) — tests exercising post-boot stages use liveSpawn. */
const deadSpawn = (() => ({
  stdout: { on: () => {} }, stderr: { on: () => {} },
  on: (_ev: string, cb: (a?: unknown) => void) => { cb() },
  kill: () => {},
})) as unknown as SpawnFn

/** Fake serve that announces its listener — exercises the post-boot path. */
const liveSpawn = (() => ({
  stdout: { on: (_e: 'data', cb: (d: unknown) => void) => {
    cb('server listening on http://127.0.0.1:4567\nserver password pw\n')
  } },
  stderr: { on: () => {} },
  on: () => {},
  kill: () => {},
})) as unknown as SpawnFn

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
/** canary-aware l05 mock — the batch always carries the two self-check
 *  blocks; a map that omits them trips "classifier untrusted" and every
 *  real score gets dropped (that's the point of the canary). */
const l05Map = (fixed: Record<string, number> = {}) =>
  new Map<string, number>([[L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9], ...Object.entries(fixed)])

describe('ai/diagnose.main', () => {
  const files = (plugins: PluginEntry[], verdicts: AiVerdict[] = []) => {
    const d = tmp('dg-')
    const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), op = join(d, 'out.jsonl')
    writeFileSync(ip, JSON.stringify(idx(plugins)))
    writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
    return { ip, vp, op }
  }
  const argv = (ip: string, vp: string, op: string, extra: string[] = []) =>
    ['tsx', 'diagnose.ts', '--index', ip, '--verdicts', vp, '--out', op, ...extra]
  const held = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' } })

  const noSha = () => undefined
  it('l05 clean + ornith pass → pass verdict written', async () => {
    const { ip, vp, op } = files([held])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map({ 'pkg\0manifest': 0.1 }),
      ornith: async () => ({ verdict: 'pass', reasonZh: '没问题', reasonEn: 'fine' }),
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('pass')
    expect(got.name).toBe('pkg')
    expect(got.version).toBe('2.0.0')
    expect(got.source).toBe('ai')
  })
  it('l05 flag + ornith pass → composite concern (layering wins)', async () => {
    const { ip, vp, op } = files([held])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map({ 'pkg\0manifest': 0.9 }),
      ornith: async () => ({ verdict: 'pass', reasonZh: '没问题', reasonEn: 'fine' }),
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('concern')
    expect(got.reason).toContain('L0.5')
    expect(got.reason).toContain('没问题')
    expect(got.reasonEn).toContain('injection')
    // classifier/judge metadata stays LOCAL — a published score/model pair
    // tells an attacker exactly which judge to evade and how close they got
    expect(got.l05).toBeUndefined()
    expect(got.model).toBeUndefined()
  })
  it('l05 throws → ornith still runs', async () => {
    const { ip, vp, op } = files([held])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => { throw new Error('python gone') },
      ornith: async () => ({ verdict: 'concern', reasonZh: '可疑', reasonEn: 'sus' }),
      sha: noSha,
    })
    expect((JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict).verdict).toBe('concern')
  })
  it('ornith fails + l05 flag → concern still written (fail-closed via L0.5)', async () => {
    const { ip, vp, op } = files([held])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map({ 'pkg\0manifest': 0.99 }),
      ornith: async () => { throw new Error('omlx down') },
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('concern')
    expect(got.reason).toContain('L0.5')
  })
  it('ornith fails + no l05 → NO verdict (stays held, retried next run)', async () => {
    const { ip, vp, op } = files([held])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => { throw new Error('omlx down') },
      sha: noSha,
    })
    expect(readFileSync(op, 'utf8')).toBe('')
  })
  it('verify-failed → direct concern with excerpt, LLM never called', async () => {
    const failed = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'failed', level: 'install', logExcerpt: 'boom on load', retries: 3 }, heldAt: 't' } })
    const { ip, vp, op } = files([failed])
    let called = false
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => { called = true; throw new Error('must not be called') },
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('concern')
    expect(got.reason).toContain('装测失败')
    expect(got.reason).toContain('boom on load')
    expect(got.model).toBeUndefined()
    expect(called).toBe(false)
  })
  it('red-flagged entry → concern draft even when LLM says pass', async () => {
    const flagged = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:exec:a.js'] }, verification: { status: 'skipped' }, heldAt: 't' } })
    const { ip, vp, op } = files([flagged])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => ({ verdict: 'pass', reasonZh: '没问题', reasonEn: 'fine' }),
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('concern')
    expect(got.reason).toContain('草稿')
    expect(got.reason).toContain('没问题')
  })
  it('red-flagged + ornith down → still concern (fail-safe), flags as reason', async () => {
    const flagged = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:exec:a.js'] }, verification: { status: 'skipped' }, heldAt: 't' } })
    const { ip, vp, op } = files([flagged])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => { throw new Error('omlx down') },
      sha: noSha,
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('concern')
    expect(got.reason).toContain('sec:exec:a.js')
  })
  it('same-sha twin verdict reused — no LLM, no L0.5', async () => {
    const { ip, vp, op } = files([held], [v({ name: 'pkg', version: '1.0.0', verdict: 'pass', reason: '之前判过', sha: 'sha512-same' })])
    let called = false
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => { called = true; return new Map() },
      ornith: async () => { called = true; throw new Error('must not be called') },
      sha: () => 'sha512-same',
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('pass')
    expect(got.version).toBe('2.0.0')
    expect(got.reason).toContain('复用')
    expect(got.sha).toBe('sha512-same')
    expect(called).toBe(false)
  })
  it('sha drift on a verdicted version → auto re-review', async () => {
    const { ip, vp, op } = files([held], [v({ name: 'pkg', version: '2.0.0', sha: 'sha512-old' })])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => ({ verdict: 'pass', reasonZh: '重审', reasonEn: 're' }),
      sha: () => 'sha512-new',
    })
    const got = JSON.parse(readFileSync(op, 'utf8').trim()) as AiVerdict
    expect(got.verdict).toBe('pass')
    expect(got.reason).toBe('重审')
    expect(got.sha).toBe('sha512-new')
  })
  it('--budget 0 → LLM never called, candidates stay held', async () => {
    const { ip, vp, op } = files([held])
    let called = false
    await diagnoseMain(argv(ip, vp, op, ['--budget', '0']), {
      l05: () => l05Map(),
      ornith: async () => { called = true; throw new Error('x') },
      sha: noSha,
    })
    expect(readFileSync(op, 'utf8')).toBe('')
    expect(called).toBe(false)
  })
  it('--dry prints instead of writing; --name + --limit narrow candidates', async () => {
    const other = e({ name: 'other', slug: 'o/other' })
    const { ip, vp, op } = files([held, other])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await diagnoseMain(argv(ip, vp, op, ['--dry', '--name', 'pkg']), {
        l05: () => l05Map(),
        ornith: async () => ({ verdict: 'pass', reasonZh: 'z', reasonEn: 'e' }),
        sha: noSha,
      })
      expect(existsSync(op)).toBe(false)
      expect(log.mock.calls.flat().join(' ')).toContain('"name":"pkg"')
      // --limit 1 slices candidates
      await diagnoseMain(argv(ip, vp, op, ['--limit', '1']), {
        l05: () => l05Map(),
        ornith: async () => ({ verdict: 'pass', reasonZh: 'z', reasonEn: 'e' }),
        sha: noSha,
      })
      expect(readFileSync(op, 'utf8').trim().split('\n')).toHaveLength(1)
    } finally { log.mockRestore() }
  })
  it('existing verdict (any source) excludes the target; matching sha = no drift', async () => {
    const { ip, vp, op } = files([held], [v({ name: 'pkg', version: '2.0.0', sha: 'sha512-x' })])
    await diagnoseMain(argv(ip, vp, op), {
      l05: () => l05Map(),
      ornith: async () => ({ verdict: 'pass', reasonZh: 'z', reasonEn: 'e' }),
      sha: () => 'sha512-x',
    })
    expect(readFileSync(op, 'utf8')).toBe('')
  })
})

describe('ai/digest.main', () => {
  it('writes digest/<day>.md + digest-state.json; --date backfills md only', async () => {
    const d = tmp('dig-')
    const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), sp = join(d, 'state.json')
    writeFileSync(ip, JSON.stringify(idx([e()])))
    writeFileSync(vp, JSON.stringify(v({ at: '2026-02-01T00:00:00Z' })) + '\n')
    // --date backfill render: md lands but state stays untouched (see below)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await digestMain(['x', 'digest.ts', '--index', ip, '--verdicts', vp, '--state', sp, '--out-dir', d, '--date', '2026-02-02'])
    } finally { log.mockRestore() }
    const md = readFileSync(join(d, 'digest', '2026-02-02.md'), 'utf8')
    expect(md).toContain('marketplace digest 2026-02-02')
    expect(md).toContain('pkg')
    // the maturity anchor is left alone — a backdated day/dayAnnounced would
    // wedge same-day accumulation, and the skipped announcements re-enter at
    // the next real render anyway
    expect(existsSync(sp)).toBe(false)
    // consequence of md-only backfill: with NO prior state ever written, the
    // next real render sees digest/*.md history + missing state → the
    // state-loss refusal (fail-closed mass-announce guard) fires. A catalog
    // that already has state doesn't hit this — provide it and the render
    // announces the verdict normally
    writeFileSync(sp, JSON.stringify({ lastDigestAt: '2026-02-01T21:00:00Z', announced: [], day: '2026-02-01', dayAnnounced: [] }))
    const log2 = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await digestMain(['x', 'digest.ts', '--index', ip, '--verdicts', vp, '--state', sp, '--out-dir', d])
    } finally { log2.mockRestore() }
    const st = JSON.parse(readFileSync(sp, 'utf8'))
    // real render: anchor is monotonic from prev (never regresses) AND the
    // seen verdict line lands in `announced` — maturity is membership, not
    // the timestamp
    expect(st.lastDigestAt).toBe('2026-02-01T21:00:00Z')
    expect(st.announced).toEqual([akey(v({ at: '2026-02-01T00:00:00Z' }))])
  })
  it('existing state anchors the window; --dry prints without writing', async () => {
    const d = tmp('dig2-')
    const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), sp = join(d, 'state.json')
    writeFileSync(ip, JSON.stringify(idx([e()])))
    writeFileSync(vp, JSON.stringify(v({ at: '2026-02-02T00:00:00Z' })) + '\n')
    writeFileSync(sp, JSON.stringify({ lastDigestAt: '2026-02-01T00:00:00Z' }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await digestMain(['x', 'digest.ts', '--index', ip, '--verdicts', vp, '--state', sp, '--out-dir', d, '--date', '2026-02-03', '--dry'])
      expect(existsSync(join(d, 'digest'))).toBe(false)
      expect(log.mock.calls.flat().join(' ')).toContain('2026-02-01')
    } finally { log.mockRestore() }
  })
})

describe('docket.main', () => {
  afterEach(() => { delete process.env.GH_REPO })
  const files = (plugins: PluginEntry[], verdicts: AiVerdict[]) => {
    const d = tmp('dk-')
    const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl')
    writeFileSync(ip, JSON.stringify(idx(plugins)))
    writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
    return { ip, vp }
  }
  const ghSpy = (open: { number: number; title: string }[]) => {
    const calls: string[][] = []
    const fn = ((args: string[]) => {
      calls.push(args)
      if (args[1] === 'list') return JSON.stringify(open)
      return ''
    }) as unknown as Parameters<typeof docketMain>[1]
    return { calls, fn }
  }
  it('creates issues for ai-verdict targets, closes resolved ones', async () => {
    const { ip, vp } = files([e()], [v({ source: 'ai' })])
    const { calls, fn } = ghSpy([{ number: 7, title: '[review] pkg@1.0.0' }, { number: 9, title: '[review] old@2.0.0' }])
    process.env.GH_REPO = 'o/r'
    await docketMain(['x', 'docket.ts', '--index', ip, '--verdicts', vp], fn)
    // pkg@1.0.0 already open → no create; old@2.0.0 not wanted → comment + close
    expect(calls.some(c => c[1] === 'create')).toBe(false)
    expect(calls.some(c => c[1] === 'comment' && c[4] === '9')).toBe(true)
    expect(calls.some(c => c[1] === 'close' && c[4] === '9')).toBe(true)
  })
  it('creates a missing issue with ai:* label', async () => {
    const { ip, vp } = files([e()], [v({ source: 'ai', verdict: 'concern', reason: '理由', reasonEn: 'why' })])
    const { calls, fn } = ghSpy([])
    process.env.GH_REPO = 'o/r'
    await docketMain(['x', 'docket.ts', '--index', ip, '--verdicts', vp], fn)
    const create = calls.find(c => c[1] === 'create')!
    expect(create.join(' ')).toContain('[review] pkg@1.0.0')
    expect(create.join(' ')).toContain('ai:concern')
  })
  it('--dry lists but never calls gh beyond list', async () => {
    const { ip, vp } = files([e()], [v({ source: 'ai' })])
    const { calls, fn } = ghSpy([])
    process.env.GH_REPO = 'o/r'
    await docketMain(['x', 'docket.ts', '--index', ip, '--verdicts', vp, '--dry'], fn)
    expect(calls.filter(c => c[1] !== 'list')).toHaveLength(0)
  })
})

describe('notify-published.main', () => {
  it('rewrites submissions.txt marking landed entries', async () => {
    const d = tmp('np-')
    const ip = join(d, 'index.json'), sp = join(d, 'submissions.txt')
    writeFileSync(ip, JSON.stringify(idx([e({ approval: 'approved' })])))
    writeFileSync(sp, [
      JSON.stringify({ name: 'pkg', issue: 42, notified: false }),
      JSON.stringify({ name: 'gone', issue: 43, notified: false }),
      'not-json',
    ].join('\n'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      notifyMain(['tsx', 'notify.ts', ip, sp])
      const out = readFileSync(sp, 'utf8').split('\n')
      expect(JSON.parse(out[0]!).notified).toBe(true)
      expect(JSON.parse(out[1]!).notified).toBe(false)
      expect(out[2]).toBe('not-json')
      expect(log.mock.calls.flat().join('')).toBe('42\to/pkg')
    } finally { log.mockRestore() }
  })
})

describe('verify/checkTui', () => {
  const run = (behaviour: Record<string, 'ok' | 'fail' | string>) =>
    (async (_c: string, args: string[]) => {
      // new-session carries a leading `-f /dev/null` (config-sourcing guard) —
      // the subcommand sits at index 2 there, index 0 for the rest
      const key = args[0] === '-f' ? args[2]! : args[0]!
      const b = behaviour[key]
      if (b === 'fail' || b === undefined) throw new Error(`${key} failed`)
      return { stdout: b === 'ok' ? '' : b, stderr: '' }
    }) as never
  const env = {}
  it('tmux spawn failure → fail with reason', async () => {
    const r = await checkTui(env, run({}), { settleMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.log).toContain('tmux spawn failed')
  })
  it('session dead → fail; kill-session always attempted', async () => {
    const calls: string[] = []
    const f = (async (_c: string, args: string[]) => {
      calls.push(args[0]!)
      if (args.includes('new-session')) return { stdout: '', stderr: '' }
      throw new Error('no session')
    }) as never
    const r = await checkTui(env, f, { settleMs: 1 })
    expect(r.ok).toBe(false)
    expect(calls).toContain('kill-session')
  })
  it('alive + real pane content → ok', async () => {
    const pane = 'x'.repeat(200)
    const r = await checkTui(env, run({ 'new-session': 'ok', 'has-session': 'ok', 'capture-pane': pane }), { settleMs: 1 })
    expect(r.ok).toBe(true)
  })
  it('alive + capture fails → pane-empty fail (not crash)', async () => {
    const f = (async (_c: string, args: string[]) => {
      if (args[0] === 'capture-pane') throw new Error('gone')
      return { stdout: '', stderr: '' }
    }) as never
    const r = await checkTui(env, f, { settleMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.log).toContain('pane nearly empty')
  })
})

describe('verifyPackage feature routes', () => {
  const home = () => {
    const h = tmp('vf-')
    writeFileSync(join(h, 'plugins.json'), JSON.stringify(
      [{ source: { type: 'package', target: 'pkg@1.0.0' }, state: { status: 'active' } }]))
    return h
  }
  const okExec = (over: Record<string, 'fail' | string> = {}) =>
    (async (_c: string, args: string[]) => {
      const key = args[0] === '--version' ? '--version' : args[0]!
      const b = over[key]
      if (b === 'fail') throw new Error(`${key} failed`)
      return { stdout: key === '--version' ? 'opencode v2.2.5' : typeof b === 'string' ? b : '', stderr: '' }
    }) as never
  const guiFixture = (h: string) => {
    const dir = join(h, 'cache', 'opencode', 'npm', 'pkg@1.0.0', '1', 'node_modules', 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui': './g.js' } }))
    writeFileSync(join(dir, 'g.js'), `
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'hi'; return d } }))
      } })`)
  }
  it('tui feature: tmux survives → level interactive', async () => {
    const r = await verifyPackage('pkg', { home: home(), execFn: okExec({ 'capture-pane': 'x'.repeat(200) }), spawnFn: liveSpawn, features: ['tui'], tuiOpts: { settleMs: 1 } })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('interactive')
  })
  it('tui feature: session dies → failed/interactive', async () => {
    const r = await verifyPackage('pkg', {
      home: home(), features: ['tui'], tuiOpts: { settleMs: 1 },
      execFn: okExec({ 'has-session': 'fail', 'capture-pane': 'fail' }), spawnFn: liveSpawn,
    })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('interactive')
  })
  it('gui feature: bundle renders → level render', async () => {
    const h = home()
    guiFixture(h)
    const r = await verifyPackage('pkg', { home: h, execFn: okExec(), spawnFn: liveSpawn, features: ['gui'] })
    expect(r.status).toBe('verified')
    expect(r.level).toBe('render')
  })
  it('gui feature: bundle dir missing → failed/render', async () => {
    const r = await verifyPackage('pkg', { home: home(), execFn: okExec(), spawnFn: liveSpawn, features: ['gui'] })
    expect(r.status).toBe('failed')
    expect(r.level).toBe('render')
  })
})

describe('verify/gui remaining branches', () => {
  it('setup(ctx) throwing → setup failure naming the stage', async () => {
    const r = await checkGuiBundle(`
      const { Plugin } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup() { throw new Error('setup boom') } })`)
    expect(r).toMatchObject({ ok: false, stage: 'setup' })
    expect(r.error).toContain('setup boom')
  })
  it('contribution with no render() → render failure', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ setup(ctx) { ctx.add(Panel, () => ({})) } })`)
    expect(r).toMatchObject({ ok: false, stage: 'render' })
  })
  it('findGuiBundle: scoped cache layout + error paths', () => {
    const h = tmp('fg-')
    expect(findGuiBundle(h, 'pkg')).toMatchObject({ error: expect.stringContaining('cache') })
    // package dir exists but package.json unparseable
    const dir = join(h, 'cache', 'opencode', 'npm', 'pkg@9', '1', 'node_modules', 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{bad')
    expect(findGuiBundle(h, 'pkg')).toMatchObject({ error: expect.stringContaining('unreadable') })
    // valid json, no gui export key
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { '.': './s.js' } }))
    expect(findGuiBundle(h, 'pkg')).toMatchObject({ error: expect.stringContaining('no gui export') })
    // gui export pointing at missing file
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui': { default: './g.js' } } }))
    expect(findGuiBundle(h, 'pkg')).toMatchObject({ error: expect.stringContaining('missing') })
    // gui export with object target that resolves
    writeFileSync(join(dir, 'g.js'), 'x=1')
    const found = findGuiBundle(h, 'pkg')
    expect('src' in found && found.src).toBe('x=1')
    // scoped package name resolves via node_modules/@scope/name
    const h2 = tmp('fg2-')
    const d2 = join(h2, 'cache', 'opencode', 'npm', 'p@1', '2', 'node_modules', '@s', 'p')
    mkdirSync(d2, { recursive: true })
    writeFileSync(join(d2, 'package.json'), JSON.stringify({ exports: { './gui': './g.js' } }))
    writeFileSync(join(d2, 'g.js'), 'ok')
    expect('src' in findGuiBundle(h2, '@s/p') && (findGuiBundle(h2, '@s/p') as { src: string }).src).toBe('ok')
    // no package dir found at all
    const h3 = tmp('fg3-')
    mkdirSync(join(h3, 'cache', 'opencode', 'npm', 'other@1', '1'), { recursive: true })
    expect(findGuiBundle(h3, 'pkg')).toMatchObject({ error: expect.stringContaining('not found') })
  })
  it('findGuiBundle: oversize gui entrypoint refused before read (shard OOM guard)', () => {
    const h = tmp('fg-big-')
    const dir = join(h, 'cache', 'opencode', 'npm', 'pkg@9', '1', 'node_modules', 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ exports: { './gui': './g.js' } }))
    const g = join(dir, 'g.js')
    writeFileSync(g, 'x')
    truncateSync(g, 8 * 1024 * 1024 + 1)   // sparse — statSync sees the cap breach
    expect(findGuiBundle(h, 'pkg')).toMatchObject({ error: expect.stringContaining('too large') })
  })
})

describe('fetch/github uncovered arms', () => {
  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers })
  it('rate-limited: 429 and 403+remaining:0 both count', async () => {
    const r429 = await fetchRepoMeta('o/r', { fetchFn: (async () => res(429)) as typeof fetch })
    expect(r429.status).toBe('rate-limited')
    const r403 = await fetchRepoMeta('o/r', { fetchFn: (async () => res(403, {}, { 'x-ratelimit-remaining': '0' })) as typeof fetch })
    expect(r403.status).toBe('rate-limited')
    const plain403 = await fetchRepoMeta('o/r', { fetchFn: (async () => res(403)) as typeof fetch })
    expect(plain403.status).toBe('error')
    const boom = await fetchRepoMeta('o/r', { fetchFn: (async () => { throw new Error('net') }) as typeof fetch })
    expect(boom.status).toBe('error')
  })
  it('fetchRepoTree: 404/409 → not-found; rate-limited; non-ok → error; tree missing → empty set', async () => {
    const f = (s: number, b: unknown = {}) => (async () => res(s, b)) as typeof fetch
    expect((await fetchRepoTree('o/r', 'main', { fetchFn: f(404) })).status).toBe('not-found')
    expect((await fetchRepoTree('o/r', 'main', { fetchFn: f(409) })).status).toBe('not-found')
    expect((await fetchRepoTree('o/r', 'main', { fetchFn: f(429) })).status).toBe('rate-limited')
    expect((await fetchRepoTree('o/r', 'main', { fetchFn: f(500) })).status).toBe('error')
    const ok = await fetchRepoTree('o/r', 'main', { fetchFn: f(200, { tree: [{ path: 'a' }, { nope: 1 }] }) })
    expect([...ok.paths!]).toEqual(['a'])
    const empty = await fetchRepoTree('o/r', 'main', { fetchFn: f(200, {}) })
    expect(empty.paths!.size).toBe(0)
    const neterr = await fetchRepoTree('o/r', 'main', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })
    expect(neterr.status).toBe('error')
  })
  it('fetchRepoPackageName: dir joins path; rate-limited; non-ok; non-string name → null', async () => {
    let seen = ''
    const f = (async (u: RequestInfo | URL) => { seen = String(u); return res(200, { name: 'p' }) }) as typeof fetch
    await fetchRepoPackageName('o/r', { dir: '/packages/x/', fetchFn: f })
    expect(seen).toContain('/packages/x/package.json')
    const rl = await fetchRepoPackageName('o/r', { fetchFn: (async () => res(429)) as typeof fetch })
    expect(rl.status).toBe('rate-limited')
    const err = await fetchRepoPackageName('o/r', { fetchFn: (async () => res(500)) as typeof fetch })
    expect(err.status).toBe('error')
    const noname = await fetchRepoPackageName('o/r', { fetchFn: (async () => res(200, { name: 42 })) as typeof fetch })
    expect(noname.pkgName).toBeNull()
  })
  it('fetchMarketMeta: bad category filtered; desc partial; empty → null; !ok → null', async () => {
    const f = (b: unknown, s = 200) => (async () => res(s, b)) as typeof fetch
    expect(await fetchMarketMeta('o/r', { fetchFn: f({ category: ['ok', 1] }) })).toBeNull()
    const desc = await fetchMarketMeta('o/r', { fetchFn: f({ description: { zh: '中文', en: 5 } }) })
    expect(desc).toEqual({ description: { zh: '中文' } })
    expect(await fetchMarketMeta('o/r', { fetchFn: f({}) })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: f({}, 404) })).toBeNull()
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => { throw new Error('x') }) as typeof fetch })).toBeNull()
  })
})

describe('fetch/npm uncovered arms', () => {
  const res = (body: unknown, s = 200, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: s, headers })
  it('packument: readme non-string → null; maintainer shapes; repo object+directory; license object', async () => {
    const f = (async () => res({
      'dist-tags': { latest: '1.0.0' },
      readme: 42,
      maintainers: ['alice', { name: 'bob' }, { noname: true }],
      versions: { '1.0.0': {
        repository: { url: 'https://github.com/o/r', directory: 'packages/x' },
        license: { type: 'MIT' }, dist: { tarball: 'https://x/t' }, keywords: ['opencode'],
      } },
      time: { '1.0.0': 't', created: 'c', modified: 'm' },
    })) as typeof fetch
    const { pk } = await fetchPackument('p', { fetchFn: f })
    expect(pk!.readme).toBeNull()
    expect(pk!.maintainers).toEqual(['alice', 'bob'])
    expect(pk!.repositoryDir).toBe('packages/x')
    expect(pk!.license).toBe('MIT')
  })
  it('tarball: oversize content-length and oversize body both rejected', async () => {
    await expect(fetchTarball('https://x/t', {
      fetchFn: (async () => res('x', 200, { 'content-length': String(65 << 20) })) as typeof fetch,
    })).rejects.toThrow('too large')
    await expect(fetchTarball('https://x/t', {
      fetchFn: (async () => res('x'.repeat(65 << 20))) as typeof fetch,
    })).rejects.toThrow('too large')
    await expect(fetchTarball('https://x/t', {
      fetchFn: (async () => res('', 500)) as typeof fetch,
    })).rejects.toThrow('500')
  })
  it('withTimeout: caller signal wins over default timeout signal', async () => {
    let got: AbortSignal | undefined
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => { got = init?.signal ?? undefined; return res({}) }) as typeof fetch
    const my = AbortSignal.timeout(1)
    await withTimeout(f, 60_000)('https://x', { signal: my })
    expect(got).toBe(my)
    await withTimeout(f, 60_000)('https://x')
    expect(got).not.toBe(my)
    expect(got).toBeInstanceOf(AbortSignal)
  })
})

describe('run.ts uncovered arms', () => {
  const mkTgz = () => {
    const d = tmp('rt-')
    mkdirSync(join(d, 'pkg'), { recursive: true })
    writeFileSync(join(d, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
    writeFileSync(join(d, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
    const out = join(d, 'p.tgz')
    execFileSync('tar', ['-czf', out, '-C', d, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    return readFileSync(out)
  }
  const packument = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: {}, repository: `https://github.com/o/${name}`, ...extra } },
    time: { '1.0.0': 't' },
  })
  const mkFetch = (tgz: Buffer, over: Record<string, Response | (() => Response)> = {}) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input)
      for (const [k, r] of Object.entries(over)) if (url.includes(k)) return typeof r === 'function' ? r() : r
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
        ] }))
      }
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org/good-pkg')) return new Response(packument('good-pkg'))
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't' }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
      return new Response('', { status: 404 })
    }) as typeof fetch

  it('spam-owner filter: ≥6 near-identical names under one owner are dropped', async () => {
    const tgz = mkTgz()
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
          ...Array.from({ length: 6 }, (_, i) => ({
            package: { name: `spam-p${i}`, version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/evil/x' }, date: 't' },
          })),
        ] }))
      }
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const idx = await run({ outPath: join(tmp('ro-'), 'i.json'), fetchFn: f, now: 't' })
    expect(idx.plugins.map(p => p.name)).toEqual(['good-pkg'])
  })

  it('gone-check: 404 → tombstone; error/undiscovered-but-alive → keep; rejected → filtered', async () => {
    const tgz = mkTgz()
    const d = tmp('rg-')
    // old index carries only the entries that will go missing; the keep-*
    // candidates land fresh — fresh count > old count, gate stays green
    const oldIdx = idx([
      e({ name: 'gone404', slug: 'gone404' }),
      e({ name: 'gone500', slug: 'gone500' }),
      e({ name: 'o/gh', slug: 'o/gh', source: { kind: 'github', id: 'o/gh', repo: 'o/gh' }, latestVersion: null, verification: { status: 'skipped' } }),
      e({ name: 'bad/gh', slug: 'bad/gh', source: { kind: 'github', id: 'bad/gh', repo: 'bad/gh' }, latestVersion: null, verification: { status: 'skipped' } }),
      e({ name: 'z-capped', slug: 'z-capped' }),
      e({ name: 'filtered-pkg', slug: 'filtered-pkg' }),
    ])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const keeps = Array.from({ length: 15 }, (_, i) => ({
      package: { name: `keep-${i}`, version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' },
    }))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
          { package: { name: 'z-capped', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
          { package: { name: 'filtered-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
          ...keeps,
        ] }))
      }
      // discovered but zero installable artifact → evidence gate rejects → filtered
      if (url.includes('registry.npmjs.org/filtered-pkg'))
        return new Response(JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'] } }, time: {} }))
      if (url.includes('api.github.com/search'))
        // bad/gh is discovered but its repo shows no opencode evidence → filtered;
        // o/gh is NOT returned — outside the search surface
        return new Response(JSON.stringify({ items: [{ full_name: 'bad/gh', description: '', archived: false, fork: false, pushed_at: 't', stargazers_count: 1, default_branch: 'main' }] }))
      if (url.includes('registry.npmjs.org/gone404')) return new Response('', { status: 404 })
      if (url.includes('registry.npmjs.org/gone500')) return new Response('', { status: 500 })
      if (url.includes('registry.npmjs.org/')) return new Response(packument('x'))
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't', maxEntries: 16 })
    const names = out.plugins.map(p => p.name)
    expect(names).toContain('gone500')     // transient error keeps the stale entry
    expect(names).toContain('o/gh')        // live repo missed by the search surface → kept, not tombstoned (R-3)
    expect(names).toContain('z-capped')    // existing entry bypasses the cap (C-1)
    expect(names).toContain('good-pkg')
    const reasons = Object.fromEntries(out.removed.map(r => [r.name, r.reason]))
    expect(reasons['gone404']).toBe('npm-404')
    expect(reasons['filtered-pkg']).toBe('filtered')   // discovered AND evidence-rejected → real filter
    expect(reasons['bad/gh']).toBe('filtered')
  })

  it('seed name past the alphabetical cap still gets processed', async () => {
    const tgz = mkTgz()
    const d = tmp('rs-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, 'zz-seed\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'aaa-first', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
          { package: { name: 'zz-seed', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
        ] }))
      }
      if (url.includes('registry.npmjs.org/')) return new Response(packument('x'))
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), seedPath: seed, fetchFn: f, now: 't', maxEntries: 1 })
    expect(out.plugins.map(p => p.name).sort()).toEqual(['aaa-first', 'zz-seed'])
  })

  it('stale-metric reuse refreshes via refreshMeta', async () => {
    const tgz = mkTgz()
    const d = tmp('rs2-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', approval: 'approved', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'good-pkg', repo: 'o/good' },
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2020-01-01T00:00:00Z' }, // stale → refreshMeta
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org/good-pkg')) {
        return new Response(packument('good-pkg', { deprecated: 'use zz-seed instead' }))
      }
      if (url.includes('api.github.com/repos/')) {
        return new Response(JSON.stringify({ id: 777, stargazers_count: 5, archived: false, pushed_at: 't' }))
      }
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-01-01T00:00:00Z' })
    const g = out.plugins.find(p => p.name === 'good-pkg')!
    expect(g.deprecated).toBe(true)                        // refreshMeta repopulated
    expect(g.replacement).toBe('zz-seed')
    expect(g.metrics.checkedAt).toBe('2026-01-01T00:00:00Z')
    expect(g.metrics.stars).toBe(5)
    expect(g.source.repoId).toBe(777)
  })

  it('skill payload in the tarball → contains:[skill]; rate-limited meta tolerated', async () => {
    // install-truth: 'skill' must ship in the published tarball — repo-tree
    // evidence alone doesn't count (V-P). Build a tarball carrying the
    // .opencode/skills layout rather than relying on the repo-tree mock.
    const sd = tmp('rt-skill-')
    mkdirSync(join(sd, 'pkg', '.opencode', 'skills', 'x'), { recursive: true })
    writeFileSync(join(sd, 'pkg', 'package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
    writeFileSync(join(sd, 'pkg', '.opencode', 'skills', 'x', 'SKILL.md'), '---\nname: x\n---\n')
    execFileSync('tar', ['-czf', join(sd, 'p.tgz'), '-C', sd, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const tgz = readFileSync(join(sd, 'p.tgz'))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't', default_branch: 'main' }))
      return mkFetch(tgz, {
        // mkFetch's packument ships dist:{} — a tarball URL is required or the
        // scan (and with it the skill file list) never happens
        'registry.npmjs.org/good-pkg': new Response(packument('good-pkg', { dist: { tarball: 'https://x/t.tgz' } })),
      })(input)
    }) as typeof fetch
    const out = await run({ outPath: join(tmp('rh-'), 'i.json'), fetchFn: f, now: 't' })
    expect(out.plugins[0]!.contains).toContain('skill')
  })

  it('hold surgery: approved prev + version bump → pendingUpdate, display pinned', async () => {
    const tgz = mkTgz()
    const d = tmp('rh2-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', approval: 'approved', latestVersion: '0.9.0',
      source: { kind: 'npm', id: 'good-pkg', repo: 'o/good', version: '0.9.0' },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: mkFetch(tgz), now: 't' })
    const g = out.plugins[0]!
    expect(g.latestVersion).toBe('0.9.0')                 // display stays pinned
    expect(g.pendingUpdate!.version).toBe('1.0.0')        // bump held
    expect(g.approval).toBe('approved')
  })

  it('rate-limited github calls count and warn, do not fail the run', async () => {
    const tgz = mkTgz()
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({}), { status: 429 })
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const out = await run({ outPath: join(tmp('rl-'), 'i.json'), fetchFn: f, now: 't' })
    expect(out.plugins[0]!.metrics.stars).toBeNull()   // meta missing → null stars, entry still built
  })

  it('candidate with no packument → skipped silently', async () => {
    const tgz = mkTgz()
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'ghost-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } },
          { package: { name: 'good-pkg', version: '1.0.0', keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
        ] }))
      }
      return mkFetch(tgz)(input)
    }) as typeof fetch
    const out = await run({ outPath: join(tmp('rk-'), 'i.json'), fetchFn: f, now: 't' })
    expect(out.plugins.map(p => p.name)).toEqual(['good-pkg'])
  })
})

describe('verdicts + merge + misc uncovered arms', () => {
  it('latestVerdicts: equal `at` keeps the later entry', () => {
    const m = latestVerdicts([v({ reason: 'a' }), v({ reason: 'b' })])
    expect(m.get(vkey('pkg', '1.0.0'))!.reason).toBe('b')
  })
  it('applyMatureVerdicts: empty verdicts → no-op early return', () => {
    const r = applyMatureVerdicts(idx([e()]), [], null)
    expect(r.releases).toEqual([])
    expect(r.held).toEqual([])
  })
  it('applyMatureVerdicts: concern with same reason does not double-hold', () => {
    const en = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't', reason: 'bad' } })
    const r = applyMatureVerdicts(idx([en]), [v({ version: '2.0.0', verdict: 'concern', reason: 'bad' })], null)
    expect(r.held).toEqual([])
  })
  it('mergeEntries: flagged + verified → skipped demotion both layers', () => {
    const prev = e({ verification: { status: 'verified' } })
    const fresh = [e({
      approval: 'approved',   // a pendingUpdate only lives on a displayed entry (R-9)
      verification: { status: 'verified' },
      capabilities: { scannedAt: 't', findings: [], redFlags: ['x:y'] },
      pendingUpdate: {
        version: '2.0.0', heldAt: 't',
        capabilities: { scannedAt: 't', findings: [], redFlags: ['z:w'] },
        verification: { status: 'verified' },
      },
    })]
    const m = mergeEntries(fresh, idx([prev]), '2.2.5', 'rs')
    expect(m[0]!.verification.status).toBe('skipped')
    expect(m[0]!.pendingUpdate!.verification.status).toBe('skipped')
  })
  it('versionCmp: numeric segments + length mismatch', () => {
    expect(versionCmp('1.2', '1.2.1')).toBe(-1)
    expect(versionCmp('1.10', '1.2')).toBe(1)
    expect(versionCmp(null, '1')).toBe(0)
    expect(versionCmp('x', '1')).toBe(0)
    expect(versionCmp('1.0', '1.0')).toBe(0)
  })
})

describe('ornithReview (mocked global fetch)', () => {
  const held = e({ approval: 'approved', pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' } })
  beforeAll(() => { process.env.AI_MODEL = 'test/judge' }) // judge id is env-required now
  afterAll(() => { delete process.env.AI_MODEL })
  const withFetch = async (res: () => Response | Promise<Response>, fn: () => Promise<unknown>) => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => res()) as typeof fetch
    try { return await fn() } finally { globalThis.fetch = orig }
  }
  const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }))
  it('!ok response → throws naming the status', async () => {
    await expect(withFetch(() => new Response('', { status: 503 }),
      () => ornithReview(held, []))).rejects.toThrow('503')
  })
  it('verdict block parses; LAST {...} wins over think-text braces', async () => {
    const r = await withFetch(
      () => chat('reasoning { "verdict": "wrong" } more ... {"verdict":"concern","reason_zh":"可疑","reason_en":"sus"}'),
      () => ornithReview(held, [{ id: 'm', text: 'x' }])) as { verdict: string }
    expect(r.verdict).toBe('concern')
  })
  it('no verdict block → unparseable error', async () => {
    await expect(withFetch(() => chat('just prose'),
      () => ornithReview(held, []))).rejects.toThrow('unparseable')
  })
  it('invalid verdict value → unparseable error', async () => {
    await expect(withFetch(() => chat('{"verdict":"maybe","reason_zh":"x"}'),
      () => ornithReview(held, []))).rejects.toThrow('unparseable')
  })
  it('legacy single `reason` field duplicates into zh+en', async () => {
    const r = await withFetch(() => chat('{"verdict":"pass","reason":"legacy"}'),
      () => ornithReview(held, [])) as { reasonZh: string; reasonEn: string }
    expect(r.reasonZh).toBe('legacy')
    expect(r.reasonEn).toBe('legacy')
  })
  it('missing reasons → empty strings', async () => {
    const r = await withFetch(() => chat('{"verdict":"pass"}'),
      () => ornithReview(held, [])) as { reasonZh: string; reasonEn: string }
    expect(r.reasonZh).toBe('')
    expect(r.reasonEn).toBe('')
  })
  it('nested JSON (signals array) parses — the old flat regex could not', async () => {
    const r = await withFetch(
      () => chat('{"verdict":"concern","reason_zh":"嵌套","reason_en":"nested","signals":[{"finding":"x","tp":true}]}'),
      () => ornithReview(held, [])) as { verdict: string }
    expect(r.verdict).toBe('concern')
  })
  it('verdict buried mid-think after other braces → span scan finds it', async () => {
    const r = await withFetch(
      () => chat('thinking {"partial":1} hmm {"verdict":"pass","reason_zh":"可","reason_en":"ok"} done'),
      () => ornithReview(held, [])) as { verdict: string }
    expect(r.verdict).toBe('pass')
  })
  it('code-fenced whole-body response parses', async () => {
    const r = await withFetch(
      () => chat('```json\n{"verdict":"concern","reason_zh":"栏","reason_en":"f"}\n```'),
      () => ornithReview(held, [])) as { verdict: string }
    expect(r.verdict).toBe('concern')
  })
  /** queue-based fetch mock capturing request bodies — the thinking retry
   *  needs to prove the second call dropped the non-thinking kwarg */
  const withFetchQ = async (responses: Response[], fn: () => Promise<unknown>) => {
    const orig = globalThis.fetch
    const calls: { body: Record<string, unknown> }[] = []
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls.push({ body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> })
      return responses.shift() ?? new Response('', { status: 500 })
    }) as typeof fetch
    try { return { out: await fn(), calls } } finally { globalThis.fetch = orig }
  }
  it('degenerate non-thinking output → one retry WITH thinking, then parses', async () => {
    const { out, calls } = await withFetchQ(
      [chat('```json'), chat('{"verdict":"pass","reason_zh":"好","reason_en":"ok"}')],
      () => ornithReview(held, [], { think: false }))
    expect((out as { verdict: string }).verdict).toBe('pass')
    expect(calls).toHaveLength(2)
    const kw0 = calls[0]!.body['chat_template_kwargs'] as { enable_thinking?: boolean } | undefined
    expect(kw0?.enable_thinking).toBe(false)
    expect(calls[1]!.body['chat_template_kwargs']).toBeUndefined()
  })
  it('non-thinking retry also unparseable → throws (attempt streak still applies)', async () => {
    await expect(withFetchQ([chat(''), chat('still prose')],
      () => ornithReview(held, [], { think: false }))
      .then(r => r.out)).rejects.toThrow('unparseable')
  })
  it('parseable non-thinking output → no retry (single call)', async () => {
    const { out, calls } = await withFetchQ(
      [chat('{"verdict":"concern","reason_zh":"嫌","reason_en":"sus"}')],
      () => ornithReview(held, [], { think: false }))
    expect((out as { verdict: string }).verdict).toBe('concern')
    expect(calls).toHaveLength(1)
  })
})

describe('gui deepStub + ctx accessors', () => {
  it('bundle exercising stub accessors + ctx fields → ok', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports.default = Plugin.define({ async setup(ctx) {
        ctx.log('boot')
        ctx.config()
        ctx.sessions.current(); ctx.sessions.all()
        const client = ctx.main({})
        const stub = await client.anything()
        stub.length; stub.size
        for (const _ of stub) {}          // Symbol.iterator
        String(stub); +stub; stub.valueOf()  // toPrimitive/toString/valueOf
        stub.then                          // 'then' getter arm
        'anything' in stub                 // has trap
        stub(1, 2)                         // apply trap
        await client.other()               // proxy get → async fn → deepStub
        ctx.add(Panel, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'x'; return d } }))
        ctx.add({ name: 'CustomKind' }, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'y'; return d } }))
      } })`)
    expect(r.ok).toBe(true)
    expect(r.registrations).toEqual(['Panel', 'CustomKind'])
  })
  it('mod.exports (no .default) still evaluates', async () => {
    const r = await checkGuiBundle(`
      const { Plugin, Panel } = require('@opencode/plugin/gui')
      module.exports = Plugin.define({ setup(ctx) {
        ctx.add(Panel, () => ({ render: () => { const d = document.createElement('div'); d.textContent = 'z'; return d } }))
      } })`)
    expect(r.ok).toBe(true)
  })
})

describe('verifyShard + writeDummyProvider arms', () => {
  it('target without version/features → bare spec install', async () => {
    const d = tmp('vs-')
    const home = join(d, 'home')
    mkdirSync(join(home, 'data', 'opencode', 'log'), { recursive: true })
    writeFileSync(join(home, 'data', 'opencode', 'log', 'opencode.log'), 'msg="loading plugin" id=p')
    const calls: string[][] = []
    const fake = (async (_c: string, args: string[]) => {
      calls.push(args)
      return { stdout: args[0] === '--version' ? 'opencode v2.2.5' : '', stderr: '' }
    }) as never
    const rs = await verifyShard(['p'], join(d, 'res.json'), { execFn: fake, spawnFn: deadSpawn })
    // execFn is shared, but home is mkdtemp — the log above isn't read here;
    // assert the shard wrote results for the bare target
    expect(rs).toHaveLength(1)
    expect(existsSync(join(d, 'res.json'))).toBe(true)
  })
  it('writeDummyProvider merges into an existing opencode.json', () => {
    const h = tmp('wd-')
    const cfgDir = join(h, '.config', 'opencode')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(join(cfgDir, 'opencode.json'), JSON.stringify({ provider: { keep: { name: 'keep' } }, plugin: ['x'] }))
    writeDummyProvider(h)
    const cfg = JSON.parse(readFileSync(join(cfgDir, 'opencode.json'), 'utf8')) as { provider: Record<string, unknown>; plugin: string[] }
    expect(cfg.provider['keep']).toBeTruthy()
    expect(cfg.provider['fake']).toBeTruthy()
    expect(cfg.plugin).toEqual(['x'])
  })
})

describe('run.ts remaining arms', () => {
  const mkTgz = () => {
    const d = tmp('rt2-')
    mkdirSync(join(d, 'pkg'), { recursive: true })
    writeFileSync(join(d, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
    writeFileSync(join(d, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
    const out = join(d, 'p.tgz')
    execFileSync('tar', ['-czf', out, '-C', d, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    return readFileSync(out)
  }
  const search = (names: { name: string; repo?: string }[]) => JSON.stringify({
    objects: names.map(n => ({
      package: { name: n.name, version: '1.0.0', keywords: ['opencode'], links: n.repo ? { repository: `https://github.com/${n.repo}` } : {}, date: 't' },
    })),
  })
  const pack = (extra: Record<string, unknown> = {}) => JSON.stringify({
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { keywords: ['opencode'], main: 'index.js', dist: {}, ...extra } },
    time: { '1.0.0': 't' },
  })
  const base = (tgz: Buffer, over: Record<string, Response>) => (async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [k, r] of Object.entries(over)) if (url.includes(k)) return r
    if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.includes('registry.npmjs.org/')) return new Response(pack({ repository: 'https://github.com/o/good' }))
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [
      { path: '.opencode/plugin/x.ts' }, { path: 'package.json' },
    ] }))
    if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't' }))
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
    return new Response('', { status: 404 })
  }) as typeof fetch

  it('seed: malformed JSON line skipped; declared type/category/desc land', async () => {
    const tgz = mkTgz()
    const d = tmp('sj-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, '{bad json\n' + JSON.stringify({ name: 'declared-pkg', type: 'skill', category: ['其他'], desc: { en: 'mine', zh: '我的' } }) + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org/declared-pkg')) return new Response(pack())
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'declared-pkg')!
    expect(p.type).toBe('skill')
    expect(p.category).toEqual(['other'])   // zh declared label normalized to id at merge
    expect(p.description.en).toBe('mine')
    expect(p.description.zh).toBe('我的')
  })
  it('hold carry: approved prev + npm latest gone → whole display state carried', async () => {
    const tgz = mkTgz()
    const d = tmp('hc-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', approval: 'approved', latestVersion: '0.9.0',
      source: { kind: 'npm', id: 'good-pkg', repo: 'o/good' },   // no version field → 326#1 arm
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },
      pendingUpdate: { version: '1.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
      if (url.includes('registry.npmjs.org/good-pkg')) {
        // no dist-tag at all; evidence comes from the readme-install path
        return new Response(JSON.stringify({ 'dist-tags': {}, versions: {}, time: {}, readme: 'install it via opencode plugin add' }))
      }
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    const g = out.plugins[0]!
    expect(g.latestVersion).toBe('0.9.0')
    expect(g.pendingUpdate!.version).toBe('1.0.0')   // held version survives
    expect(g.approval).toBe('approved')
  })
  it('pending prev → approvalReason resets to awaiting-review', async () => {
    const tgz = mkTgz()
    const d = tmp('pr-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', approval: 'pending', approvalReason: 'concern-x',
      latestVersion: '0.9.0', source: { kind: 'npm', id: 'good-pkg', repo: 'o/good' },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2026-01-01T00:00:00Z' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: base(tgz, {}), now: 't' })
    expect(out.plugins[0]!.approvalReason).toBe('awaiting-review')
  })
  it('refreshMeta: packument 404 → entry unchanged but checkedAt rolls', async () => {
    const tgz = mkTgz()
    const d = tmp('rf-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', approval: 'approved', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'good-pkg', repo: 'o/good' },
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: '2020-01-01T00:00:00Z' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
      if (url.includes('registry.npmjs.org/')) return new Response('', { status: 404 })
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-01-01T00:00:00Z' })
    const g = out.plugins[0]!
    expect(g.deprecated).toBe(false)
    expect(g.metrics.checkedAt).toBe('2026-01-01T00:00:00Z')
  })
  it('rate-limited tree → no hasSkill, warn counted; npm missing-but-found → kept', async () => {
    const tgz = mkTgz()
    const d = tmp('rl2-')
    const oldIdx = idx([e({ name: 'filtered-out', slug: 'filtered-out' })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.github.com') && url.includes('/git/trees/')) return new Response(JSON.stringify({}), { status: 429 })
      if (url.includes('registry.npmjs.org/filtered-out')) return new Response(pack())
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    // 'filtered-out' was never discovered this run and still exists on npm —
    // absence from the search surface is not evidence of filtering (R-3)
    expect(out.plugins.map(p => p.name)).toContain('filtered-out')
    expect(out.removed.find(r => r.name === 'filtered-out')).toBeUndefined()
    expect(out.plugins.find(p => p.name === 'good-pkg')!.contains).toEqual(['plugin'])   // parts list is explicit now
  })
  it('publish gate: mass disappearance → run() throws', async () => {
    const tgz = mkTgz()
    const d = tmp('pg-')
    const oldIdx = idx(Array.from({ length: 10 }, (_, i) => e({ name: `old-${i}`, slug: `old-${i}` })))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    // probes must 404 for the drop to be real — ok responses keep entries now (R-3)
    await expect(run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath,
      fetchFn: base(tgz, { 'registry.npmjs.org/old-': new Response('', { status: 404 }) }), now: 't' }))
      .rejects.toThrow('publish gate')
  })
  it('github-kind via seed repo: zh marketMeta + no repoId arms', async () => {
    const tgz = mkTgz()
    const d = tmp('gk-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, 'github:o/only\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('raw.githubusercontent.com') && url.includes('.opencode-market.json')) {
        return new Response(JSON.stringify({ description: { zh: '只有中文' }, category: ['集成与移动'] }))
      }
      if (url.includes('/-/v1/search')) return new Response(JSON.stringify({ objects: [] }))
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const g = out.plugins.find(p => p.name === 'o/only')!
    expect(g.source.kind).toBe('github')
    expect(g.description.zh).toBe('只有中文')
    expect(g.category).toEqual(['integrations'])   // zh marketMeta label normalized to id at merge
    expect(g.source.repoId).toBeUndefined()
  })
  it('reuse path backfills missing integrity from the packument (R-1)', async () => {
    const tgz = mkTgz()
    const d = tmp('ib-')
    // entry predates the integrity field: reuse-matched (version + ruleset) and
    // metrics fresh → would normally skip the network entirely; needsIntegrity
    // forces one packument fetch to fill the SRI
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good', latestVersion: '1.0.0', integrity: null,
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: 1, npmDownloads30d: 1, checkedAt: 't' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('registry.npmjs.org/good-pkg')) return new Response(pack({ dist: { integrity: 'sha512-BACKFILL' } }))
      return base(tgz, {})(input)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    expect(out.plugins[0]!.integrity).toBe('sha512-BACKFILL')
  })
  it('remerge: remote already released our held version → adopt its display, no resurrected hold (R-8)', () => {
    const ours = e({
      name: 'pkg', latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })
    const remote = e({
      name: 'pkg', latestVersion: '2.0.0', approval: 'approved',
      verification: { status: 'verified' }, integrity: 'sha512-NEW',
    })
    const [out] = mergeEntries([ours], idx([remote]), '2.2.5')
    expect(out!.latestVersion).toBe('2.0.0')          // remote's released display wins
    expect(out!.pendingUpdate).toBeUndefined()         // hold is NOT resurrected
    expect(out!.integrity).toBe('sha512-NEW')
    // symmetric case: remote released a DIFFERENT version → our hold stays
    const remote2 = e({ name: 'pkg', latestVersion: '3.0.0', approval: 'approved' })
    const [out2] = mergeEntries([ours], idx([remote2]), '2.2.5')
    expect(out2!.pendingUpdate?.version).toBe('2.0.0')
    // remote saw the version but is still pending → hold kept (adopt-gate false arm)
    const remote3 = e({ name: 'pkg', latestVersion: '2.0.0', approval: 'pending' })
    const [out3] = mergeEntries([ours], idx([remote3]), '2.2.5')
    expect(out3!.pendingUpdate?.version).toBe('2.0.0')
  })
  it('corrupt blocklist → run() refuses rather than running unprotected (C-4)', async () => {
    const d = tmp('bl-')
    const bl = join(d, 'blocklist.json')
    writeFileSync(bl, 'not-json{')
    await expect(run({ outPath: join(d, 'i.json'), blocklistPath: bl, fetchFn: base(mkTgz(), {}), now: 't' }))
      .rejects.toThrow('blocklist unreadable')
    // absent blocklist file → still optional
    const ok = await run({ outPath: join(d, 'i2.json'), blocklistPath: join(d, 'absent.json'), fetchFn: base(mkTgz(), {}), now: 't' })
    expect(ok.plugins.length).toBeGreaterThan(0)
  })
  it('seed metadata caps: desc ≤4k/lang, category ≤8×80 chars (F-4)', async () => {
    const tgz = mkTgz()
    const d = tmp('sc-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, JSON.stringify({
      name: 'good-pkg',
      category: Array.from({ length: 20 }, (_, i) => `cat-${i}-${'x'.repeat(200)}`),
      desc: { en: 'e'.repeat(5000), zh: '中'.repeat(5000) },
    }))
    const out = await run({ outPath: join(d, 'i.json'), seedPath: seed, fetchFn: base(tgz, {}), now: 't' })
    const p = out.plugins.find(x => x.name === 'good-pkg')!
    expect(p.category!.length).toBeLessThanOrEqual(8)
    expect(p.category!.every(c => c.length <= 80)).toBe(true)
    expect(p.description.en!.length).toBeLessThanOrEqual(4000)
    expect(p.description.zh!.length).toBeLessThanOrEqual(4000)
  })
  it('searchTopic requests fork:false server-side (F-2)', async () => {
    let seen = ''
    const f = (async (input: RequestInfo | URL) => {
      seen = String(input)
      return new Response(JSON.stringify({ items: [] }))
    }) as typeof fetch
    await searchTopic('opencode', { fetchFn: f, maxPages: 1 })
    // q is encoded wholesale (created: slices join it) — assert the
    // qualifier semantically, not its wire encoding
    expect(decodeURIComponent(seen)).toContain('fork:false')
  })

  it('searchTopic: missing optional item fields → null/[] arms', async () => {
    const f = (async () => new Response(JSON.stringify({ items: [
      { full_name: 'o/min', html_url: 'u', description: null, pushed_at: 't', stargazers_count: 0, default_branch: 'main' },
      { full_name: 'o/mit', html_url: 'u', description: 'd', pushed_at: 't', stargazers_count: 1, default_branch: 'main', license: { spdx_id: 'MIT' }, topics: ['opencode-plugin'], id: 9, created_at: 'c' },
    ] }))) as typeof fetch
    const rs = await searchTopic('t', { fetchFn: f, maxPages: 1 })
    expect(rs[0]!.id).toBeNull()
    expect(rs[0]!.license).toBeNull()
    expect(rs[0]!.topics).toEqual([])
    expect(rs[0]!.createdAt).toBeNull()
    expect(rs[1]!.license).toBe('MIT')
    expect(rs[1]!.id).toBe(9)
  })

  it('seed edge cases: non-string desc/category values filtered; repo-only seed; discoveredVia merge', async () => {
    const tgz = mkTgz()
    const d = tmp('se-')
    const seed = join(d, 'seed.txt')
    writeFileSync(seed, [
      JSON.stringify({ name: 'declared-pkg', category: ['tools', 5, 'x'.repeat(100)], desc: { en: '', zh: 5, ok: 'v' } }),
      JSON.stringify({ repo: 'o/seedskill', desc: { zh: '技能' } }),
      JSON.stringify({ name: 'good-pkg' }),
    ].join('\n') + '\n')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org/')) return new Response(pack({ repository: 'https://github.com/o/good' }))
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: '.opencode/skills/x/SKILL.md' }, { path: 'package.json' }], sha: 'abc' }))
      if (url.includes('api.github.com/repos/o/seedskill')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't', id: 7, topics: ['opencode-skill'], license: { spdx_id: 'MIT' } }))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't' }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), seedPath: seed, fetchFn: f, now: 't' })
    const gp = out.plugins.find(p => p.name === 'good-pkg')!
    expect(gp.discoveredVia).toContain('submission')
    const dp = out.plugins.find(p => p.name === 'declared-pkg')!
    // the 80-char claim isn't a canonical taxonomy id — whitelisted out
    expect(dp.category).toEqual(['tools'])
    const gh = out.plugins.find(p => p.name === 'o/seedskill')!
    expect(gh.source.kind).toBe('github')
    expect(gh.source.version).toBe('abc')
  })

  it('stale metrics (>7d) → refreshMeta re-fetch; sparse packument falls back to entry values', async () => {
    const tgz = mkTgz()
    const d = tmp('st-')
    const oldIdx = idx([e({
      name: 'good-pkg', slug: 'o/good',
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: null, npmDownloads30d: 42, checkedAt: '2000-01-01T00:00:00.000Z' },
    })])
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(oldIdx))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org/good-pkg')) return new Response(JSON.stringify({ versions: {}, 'dist-tags': {}, time: {}, maintainers: [] }))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 5, archived: false, pushed_at: 't' }))
      if (url.includes('api.npmjs.org/downloads')) return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-06-01T00:00:00.000Z' })
    const p = out.plugins[0]!
    expect(p.metrics.checkedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(p.metrics.npmDownloads30d).toBe(42)
    expect(p.maintainers).toEqual([])
  })

  it('gh: tree 500 → keep prev (treeTransient); tree 404 → rejected → gone-check filtered; ev-reject arm', async () => {
    const tgz = mkTgz()
    const ghEntry = () => e({ name: 'o/gh', slug: 'o/gh', source: { kind: 'github', id: 'o/gh', repo: 'o/gh' }, latestVersion: null, verification: { status: 'unverified' } })
    const item = JSON.stringify({ items: [{ full_name: 'o/gh', html_url: 'u', description: 'd', pushed_at: 't', stargazers_count: 1, default_branch: 'main', id: 1, created_at: 't', license: null, topics: ['opencode-plugin'] }] })
    const run1 = async (treeRes: Response) => {
      const d = tmp('gt-')
      writeFileSync(join(d, 'old.json'), JSON.stringify(idx([ghEntry()])))
      const b = base(tgz, {})
      const f = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('api.github.com/search')) return new Response(item)
        if (url.includes('git/trees/')) return treeRes.clone()
        return b(input)
      }) as typeof fetch
      return run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    }
    // transient tree error → keep old entry, no tombstone
    let out = await run1(new Response('', { status: 500 }))
    expect(out.plugins.map(p => p.name)).toContain('o/gh')
    expect(out.removed).toHaveLength(0)
    // tree genuinely gone (404) → positive rejection → repo meta ok → 'filtered'
    out = await run1(new Response('', { status: 404 }))
    expect(out.removed.find(r => r.name === 'o/gh')!.reason).toBe('filtered')
    // tree present but no opencode evidence → evidenceRejected → also 'filtered'
    out = await run1(new Response(JSON.stringify({ tree: [{ path: 'README.md' }] })))
    expect(out.removed.find(r => r.name === 'o/gh')!.reason).toBe('filtered')
  })

  it('gh entry rebuild: repoId/sha spreads, zh description, ghPrev approvalReason', async () => {
    const tgz = mkTgz()
    const d = tmp('gr-')
    const prev = e({
      name: 'o/gh', slug: 'o/gh', source: { kind: 'github', id: 'o/gh', repo: 'o/gh' },
      latestVersion: null, verification: { status: 'unverified' },
      approval: 'approved', approvalReason: 'human-ok',
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([prev])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([]))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [
        { full_name: 'o/gh', html_url: 'u', description: 'd', pushed_at: 't', stargazers_count: 1, default_branch: 'main', id: 42, created_at: 't', license: { spdx_id: 'MIT' }, topics: ['opencode-plugin'] },
      ] }))
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: '.opencode/plugin/x.ts' }, { path: 'package.json' }], truncated: true, sha: 'sha9' }))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1, archived: false, pushed_at: 't', topics: ['opencode-plugin'] }))
      if (url.includes('.opencode-market.json')) return new Response(JSON.stringify({ description: { zh: '中文描述' } }))
      if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 404 })
      if (url.includes('codeload.github.com')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins.find(x => x.name === 'o/gh')!
    expect(p.source.repoId).toBe(42)
    expect(p.source.version).toBe('sha9')
    expect(p.approval).toBe('approved')
    expect(p.approvalReason).toBe('human-ok')
    expect(p.description.zh).toBe('中文描述')
  })

  it('run.ts: non-pending prev + version bump → hold surgery carries prev.source.version', async () => {
    const tgz = mkTgz()
    const d = tmp('nl-')
    const prev = e({
      name: 'good-pkg', slug: 'o/good', approval: 'approved', approvalReason: 'ok',
      latestVersion: '0.9.0',
      source: { kind: 'npm', id: 'good-pkg', repo: 'o/good', version: 'v-pin' },
      pendingUpdate: { version: '1.5.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    })
    writeFileSync(join(d, 'old.json'), JSON.stringify(idx([prev])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(search([{ name: 'good-pkg', repo: 'o/good' }]))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org/good-pkg')) return new Response(pack({ repository: 'https://github.com/o/good' }))
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1 }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: join(d, 'old.json'), fetchFn: f, now: 't' })
    const p = out.plugins[0]!
    expect(p.source.version).toBe('v-pin')
    expect(p.latestVersion).toBe('0.9.0')
    // R-1: the live hold's pinned target is not redirected by upstream churn
    expect(p.pendingUpdate?.version).toBe('1.5.0')
  })
})

describe('merge/verdicts/submission/review/notify/discover/site arms', () => {

  it('trustFlags: same-rule delta findings dedup; strong rules go to redFlags', () => {
    const prev = e({ capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: ['net-call:a'], redFlags: [] } })
    const fresh = e({ capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: ['lifecycle-script:b', 'lifecycle-script:c'], redFlags: [] } })
    const tf = trustFlags(prev, fresh)
    expect(tf.redFlags).toEqual(['sec-delta:lifecycle-script'])   // deduped to one, strong → redFlag
    expect(tf.findings).toEqual([])
  })
  it('trustFlags: repoId change → redFlag; createdAt newer → name-reused', () => {
    const prev = e({ source: { kind: 'npm', id: 'p', repoId: 1 }, firstSeenAt: '2026-01-01' })
    const fresh = e({ source: { kind: 'npm', id: 'p', repoId: 2 }, createdAt: '2026-06-01' })
    const tf = trustFlags(prev, fresh)
    expect(tf.redFlags).toContain('sec:repo-recreated')
    expect(tf.redFlags).toContain('sec:name-reused')
  })
  it('mergeEntries: identity redFlag + verified → skipped (honest label)', () => {
    const prev = e({ source: { kind: 'npm', id: 'p', repoId: 1 }, verification: { status: 'verified' } })
    const fresh = e({ source: { kind: 'npm', id: 'p', repoId: 2 }, verification: { status: 'verified' } })
    const m = mergeEntries([fresh], idx([prev]), '2.2.5')
    expect(m[0]!.capabilities.redFlags).toContain('sec:repo-recreated')
    expect(m[0]!.verification.status).toBe('skipped')
  })
  it('mergeEntries: fresh entry missing approval → prev approval fills it', () => {
    const prev = e({ approval: 'approved', approvalReason: 'x' })
    const fresh = { ...e(), approval: undefined, approvalReason: undefined } as unknown as PluginEntry
    const m = mergeEntries([fresh], idx([prev]), '2.2.5')
    expect(m[0]!.approval).toBe('approved')
  })
  it('sec-delta on a held entry attaches to pendingUpdate.capabilities', () => {
    const prev = e({ capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] } })
    const fresh = e({
      approval: 'approved',   // a pendingUpdate only lives on a displayed entry (R-9)
      pendingUpdate: {
        version: '2.0.0', heldAt: 't',
        capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: ['prepare-script:p/package.json'], redFlags: [] },
        verification: { status: 'unverified' },
      },
    })
    const m = mergeEntries([fresh], idx([prev]), '2.2.5')
    expect(m[0]!.pendingUpdate!.capabilities.redFlags).toContain('sec-delta:prepare-script')
    expect(m[0]!.capabilities.redFlags).not.toContain('sec-delta:prepare-script')
  })
  it('applyMatureVerdicts: human concern on DISPLAYED version → approvalReason + held', () => {
    const en = e({ approval: 'approved', approvalReason: undefined, verification: { status: 'verified' } })
    const r = applyMatureVerdicts(idx([en]), [v({ verdict: 'concern', source: 'human', reason: 'bad stuff' })], null)
    expect(r.held).toContain('pkg@1.0.0')
    expect(r.index.plugins[0]!.approvalReason).toBe('bad stuff')
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('parseSubmission: empty body → kind none; unknown type → null', () => {
    expect(parseSubmission('').kind).toBe('none')
    const s = parseSubmission('### Type / 类型\n\nwidget\n\n### 其他语言描述（可选）\n\nzh: 中文\nfr: français')
    expect(s.type).toBeNull()
    expect(s.descOther['zh']).toBe('中文')
    expect(s.descOther['fr']).toBe('français')
  })
  it('markNotified: pending entry → NOT notified (not user-visible)', () => {
    const r = markNotified(idx([e({ approval: 'pending' })]),
      [JSON.stringify({ name: 'pkg', issue: 1, notified: false })])
    expect(r.issues).toEqual([])
  })
  it('renderReview: repo + evidence + unknown downloads arms', () => {
    const md = renderReview({ name: 'p', exists: true, status: 'ok', evidenceOk: true, scanned: true, scanError: null, evidence: ['keyword', 'entry'], downloads30d: null, repo: 'o/r', pkgName: null, createdAt: 'c', findings: [], redFlags: [], version: null, integrity: null })
    expect(md).toContain('repo: o/r')
    expect(md).toContain('keyword, entry')
    expect(md).toContain('unknown')
    expect(md).toContain('verdict: clean')
  })
  it('searchTopic: license null + NOASSERTION arms', async () => {
    const f = (async () => new Response(JSON.stringify({ items: [
      { full_name: 'a/b', description: null, archived: false, fork: false, pushed_at: null, stargazers_count: 1, default_branch: 'm', license: null },
      { full_name: 'c/d', description: 'd', archived: false, fork: false, pushed_at: 't', stargazers_count: 2, default_branch: 'm', license: { spdx_id: 'NOASSERTION' } },
    ] }))) as typeof fetch
    const rs = await searchTopic('opencode', { fetchFn: f, maxPages: 1 })
    expect(rs[0]!.license).toBeNull()
    expect(rs[1]!.license).toBeNull()
    expect(rs[0]!.description).toBe('')
  })
  it('buildSeedList: custom url + repoToNpm json-fail + github: fallback', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('my-list')) return new Response('[x](https://github.com/o/pkg) [y](https://github.com/o/nope)')
      if (url.includes('api.github.com/repos/o/pkg')) return new Response(JSON.stringify({ stargazers_count: 99 }))
      if (url.includes('api.github.com/repos/o/nope')) return new Response(JSON.stringify({ stargazers_count: 1 }))
      if (url.includes('raw.githubusercontent.com/o/pkg/main/package.json')) return new Response(JSON.stringify({ name: 'pkg-npm' }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const names = await buildSeedList({ url: 'https://x/my-list', fetchFn: f })
    expect(names).toEqual(['pkg-npm'])
    expect(await repoToNpm('o/missing', { fetchFn: f })).toBeNull()
  })
  it('detailPage: pendingUpdate row + license/repo/logExcerpt arms', () => {
    const en = e({
      approval: 'approved', license: 'MIT', latestVersion: '1.0.0',
      source: { kind: 'npm', id: 'p', repo: 'o/r' },
      verification: { status: 'failed', logExcerpt: 'boom' },
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    })
    const md = detailPage(en)
    expect(md).toContain('next version')
    expect(md).toContain('under review')
    expect(md).toContain('failure log')
    expect(md).toContain('https://github.com/o/r')
    const noLog = detailPage(e({ approval: 'approved' }))
    expect(noLog).not.toContain('failure log')
  })
  it('buildSkillCatalog: same basename → namespaced ids; tarballOf injected', async () => {
    const d = tmp('sc-')
    const skills = [
      e({ name: 'a/test', slug: 'a/test', contains: ['skill'], latestVersion: '1.0.0' }),
      e({ name: 'b/test', slug: 'b/test', contains: ['skill'], latestVersion: '1.0.0' }),
      e({ name: 'c/solo', slug: 'c/solo', contains: ['skill'], latestVersion: null }),
    ]
    await buildSkillCatalog(idx(skills), d, () => null)   // tarballOf null → skip all
    const out = JSON.parse(readFileSync(join(d, 'skills', 'index.json'), 'utf8')) as { skills: unknown[] }
    expect(out.skills).toEqual([])
  })
  it('detectFeatures: ./tui + rpc export paths', () => {
    expect(detectFeatures({ exports: { '.': './s.js', './tui': 'x.js' } })).toContain('tui')
    expect(detectFeatures({ exports: { './gui-experimental': 'g.cjs' } })).toContain('gui')
    expect(detectFeatures({ exports: { '.': './s.js', './rpc': 'r.js' } })).toContain('rpc')
  })
  it('backfill: fills identity fields; per-entry errors swallowed', async () => {
    const en = e({ createdAt: null, maintainers: [], source: { kind: 'npm', id: 'pkg', repo: 'o/r' } })
    const boom = e({ name: 'boom', slug: 'boom', createdAt: null, maintainers: [] })
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('boom')) throw new Error('net fail')
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ id: 42, stargazers_count: 1 }))
      return new Response(JSON.stringify({ 'dist-tags': {}, versions: {}, time: { created: 'c', modified: 'm' }, maintainers: ['alice'] }))
    }) as typeof fetch
    const out = await backfill(idx([en, boom]), { fetchFn: f })
    const p = out.plugins.find(x => x.name === 'pkg')!
    expect(p.createdAt).toBe('c')
    expect(p.maintainers).toEqual(['alice'])
    expect(p.source.repoId).toBe(42)
  })
})
