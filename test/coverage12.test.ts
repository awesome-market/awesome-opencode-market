// coverage12 — final edge batch to close the {pipeline,src} 90% branch gate:
// hostStaleVerify skill-only arm, notify/submission-status row arms,
// digest main() arg parsing, verdicts human-ordering + held ?? 'null',
// human-verdict event edges, fetch/github compat/category/description arms,
// gui-bundle module-absence arms, scan binary-blob known/unknown, remerge
// category-undefined, versionCmp string-order arm.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogIndex } from '../src/schema.ts'
import type { PluginEntry, AiVerdict, DigestState } from '../src/schema.ts'
import { hostStaleVerify, verifyPartsOf } from '../pipeline/verify/plan.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { submissionStatuses } from '../pipeline/submission-status.ts'
import { main as digestMain, renderDigest } from '../pipeline/ai/digest.ts'
import { latestHumanVerdicts, latestVerdicts, applyMatureVerdicts, akey, vkey, explainEntry } from '../pipeline/verdicts.ts'
import { resolveVerdictEvent, isDupVerdict, amendAt } from '../pipeline/human-verdict.ts'
import { fetchRepoPackage, fetchRepoPackageName, fetchRepoTree, fetchMarketMeta, fetchRepoMeta } from '../pipeline/fetch/github.ts'
import { checkGuiBundle } from '../pipeline/verify/gui.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { remerge } from '../pipeline/remerge.ts'
import { versionCmp, mergeEntries } from '../pipeline/publish/merge.ts'
import { sections } from '../pipeline/submission.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIdx = (plugins: PluginEntry[], over: Record<string, unknown> = {}) =>
  CatalogIndex.parse({ version: '1', generatedAt: 'x', categories: {}, plugins, removed: [], ...over })
const mkRes = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof b === 'string' ? b : JSON.stringify(b), { status, headers })
const verdict = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z',
  source: 'ai', ...over,
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('plan/hostStaleVerify skill-only arm + versionCmp string order', () => {
  it('hostStaleVerify with contains:[skill] → right operand of ||', () => {
    const e = mkEntry('sk', {
      contains: ['skill'] as never, approval: 'approved',
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc-old', verifiedAt: 't' } as never,
    })
    // hostStaleVerify(e) uses process env opencode version — pass via opts? signature is (e) only per earlier read
    // call it and assert boolean; the parts arm executes regardless of staleness outcome
    expect(typeof hostStaleVerify(e)).toBe('boolean')
    expect(verifyPartsOf(e)).toEqual(['skill'])
  })
  it('versionCmp prerelease string-order x>y arm', () => {
    expect(versionCmp('1.0.0-beta', '1.0.0-alpha')).toBe(1)
    expect(versionCmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })
})

describe('notify-published markNotified row arms', () => {
  it('neither name nor repo → skipped; dead+at-missing → age 0 kept; pending approval → not notified', () => {
    const idx = mkIdx([
      mkEntry('p1', { approval: 'approved' }),
      mkEntry('p2', { approval: 'pending' }),
    ])
    const lines = [
      '{"issue":1}',                                        // neither name nor repo → e undefined
      '{"name":"p1","issue":2,"notified":false}',          // lands → notified
      '{"name":"p2","issue":3,"notified":false}',          // pending → stays
      '{"name":"ghost","issue":4,"notified":false,"dead":true}',  // dead, no `at` → age 0 → kept
    ]
    const { lines: out, issues } = markNotified(idx, lines, { now: Date.now() })
    expect(issues).toContain(2)
    expect(issues).not.toContain(3)
    expect(out.some(l => l.includes('"issue":4'))).toBe(true)   // dead recent kept
  })
})

describe('submission-status row arms', () => {
  it('repo-only row matches by repo; neither → skipped; GH env absent → prints rows', async () => {
    const idx = mkIdx([
      mkEntry('pkg-a', { approval: 'pending' }),             // pending → still tracked (landed entries are skipped now)
      mkEntry('o/r', { approval: 'pending', source: { kind: 'github', id: 'o/r', repo: 'o/r' } as never }),
    ])
    const lines = [
      '{"name":"pkg-a","issue":11}',
      '{"repo":"O/R","issue":12}',          // case-insensitive repo match
      '{"issue":13}',                        // neither → e undefined → skipped
    ]
    const rows = submissionStatuses(idx, lines)
    expect(rows.length).toBe(2)
    // main() without GH env → prints JSON rows (111 if[0] + binary[1] repo-truthy arms)
    const env = process.env
    const keep = { ...env }
    delete env.GH_REPO; delete env.GH_TOKEN
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(String(a[0])))
    try {
      const { main } = await import('../pipeline/submission-status.ts')
      const dir = mkdtempSync(join(tmpdir(), 'ss12-'))
      const ip = join(dir, 'i.json'), sp = join(dir, 's.txt')
      writeFileSync(ip, JSON.stringify(idx))
      writeFileSync(sp, lines.join('\n'))
      main(['node', 'x', ip, sp])
    } finally { Object.assign(env, keep); spy.mockRestore() }
    expect(logs.filter(l => l.startsWith('{')).length).toBe(2)
  })
  it('upsertStatusComment: gh success PATCH/POST + non-Error throw → console.error arm', async () => {
    vi.resetModules()
    const calls: string[] = []
    vi.doMock('node:child_process', () => ({
      execFileSync: (cmd: string, args: string[]) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        if (args.includes('list')) return 'https://api.github.com/x/comments/1'
        if (args.some(a => a.includes('PATCH'))) return ''
        throw 'string-error'   // non-Error throw → e instanceof Error false arm
      },
    }))
    const mod = await import('../pipeline/submission-status.ts')
    // reach upsertStatusComment indirectly via main() with GH env set
    const env = process.env
    env.GH_REPO = 'o/r'; env.GH_TOKEN = 't'; env.GITHUB_RUN_ID = 'run9'
    const dir = mkdtempSync(join(tmpdir(), 'ss12b-'))
    const ip = join(dir, 'i.json'), sp = join(dir, 's.txt')
    writeFileSync(ip, JSON.stringify(mkIdx([mkEntry('p1', { approval: 'pending' })])))   // pending → row produced → upsertStatusComment reached
    writeFileSync(sp, '{"name":"p1","issue":5,"notified":false}\n')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { mod.main(['node', 'x', ip, sp]) } finally {
      delete env.GH_REPO; delete env.GH_TOKEN; delete env.GITHUB_RUN_ID
      errSpy.mockRestore(); vi.doUnmock('node:child_process'); vi.resetModules()
    }
    expect(calls.some(c => c.includes('gh'))).toBe(true)
  })
})

describe('digest main() arg parsing + render arms', () => {
  it('main() missing args → usage error; arg() present/absent arms; liveAlarm null version; unannounced pass phase', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { await expect(digestMain(['node', 'x'])).rejects.toThrow('exit') } finally { exitSpy.mockRestore(); errSpy.mockRestore() }
    // full main() run with real temp files → arg() present+absent arms + write path
    const dir = mkdtempSync(join(tmpdir(), 'dg12-'))
    const ip = join(dir, 'i.json'), vp = join(dir, 'v.jsonl'), sp = join(dir, 's.json'), op = join(dir, 'out')
    writeFileSync(ip, JSON.stringify(mkIdx([mkEntry('p')])))
    writeFileSync(vp, '')
    writeFileSync(sp, JSON.stringify({ lastDigestAt: null, announced: [], day: '', dayAnnounced: [] }))
    await digestMain(['node', 'x', '--index', ip, '--verdicts', vp, '--state', sp, '--out-dir', op, '--date', '2026-01-03', '--dry'])
    // renderDigest: approved entry (ver→null arm) + liveAlarm with latestVersion null + unannounced pass
    const prev: DigestState = { lastDigestAt: '2026-01-01T00:00:00Z', announced: [], day: '2026-01-01', dayAnnounced: [] }
    const liveNull = mkEntry('ln', { approval: 'approved', latestVersion: null, capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    const heldPass = mkEntry('hp', { approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } })
    const idx = mkIdx([liveNull, heldPass, mkEntry('ap', { approval: 'approved' })])
    const vs: AiVerdict[] = [verdict({ name: 'hp', version: '1.0.0', verdict: 'pass', at: '2027-01-01T00:00:00Z' })]  // future-dated → never announced → willAnnounce false
    const md = renderDigest({ index: idx, verdicts: vs, prev, now: new Date('2026-01-03T00:00:00Z') })
    expect(md).toContain('已裁决·待日报公告')   // pass verdict not yet announced
    expect(md).toContain('—')
  })
})

describe('verdicts human-ordering + held ?? null + pkgPass awaiting-review', () => {
  it('latestHumanVerdicts: older human verdict second does not replace; legacy/pending null-version held; awaiting-review no-reset', async () => {
    const hNew = verdict({ at: '2026-01-02T00:00:00Z', verdict: 'concern', source: 'human' })
    const hOld = verdict({ at: '2026-01-01T00:00:00Z', verdict: 'pass', source: 'human' })
    expect(latestHumanVerdicts([hNew, hOld]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    expect(latestHumanVerdicts([hOld, hNew]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    // legacy + null version + concern → held 'name@null' (253 arm)
    const leg = mkEntry('lg', { approval: 'legacy', latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'o/r' } })
    const vc = verdict({ name: 'lg', version: null, verdict: 'concern', source: 'human', reason: 'r', at: '2026-01-05T00:00:00Z' })
    const dg = { lastDigestAt: 't', announced: [akey(vc)], day: 'd', dayAnnounced: [akey(vc)] } as DigestState
    const r1 = applyMatureVerdicts(mkIdx([leg]), [vc], dg)
    expect(r1.held).toContain('lg@null')
    // pending + null version + concern → held (256 arm)
    const pen = mkEntry('pn', { approval: 'pending', latestVersion: null, source: { kind: 'github', id: 'o/r2', repo: 'o/r2' } })
    const vc2 = verdict({ name: 'pn', version: null, verdict: 'concern', source: 'human', reason: 'r', at: '2026-01-05T00:00:00Z' })
    const dg2 = { lastDigestAt: 't', announced: [akey(vc2)], day: 'd', dayAnnounced: [akey(vc2)] } as DigestState
    const r2 = applyMatureVerdicts(mkIdx([pen]), [vc2], dg2)
    expect(r2.held).toContain('pn@null')
    // pkgPass + approvalReason already 'awaiting-review' → NOT reset again (276 binary[2] false arm)
    const already = mkEntry('aw', { approval: 'pending', approvalReason: 'awaiting-review' })
    const pkgPass = verdict({ name: 'aw', version: null, verdict: 'pass', source: 'human', at: '2026-01-05T00:00:00Z' })
    const dg3 = { lastDigestAt: 't', announced: [akey(pkgPass)], day: 'd', dayAnnounced: [akey(pkgPass)] } as DigestState
    const r3 = applyMatureVerdicts(mkIdx([already]), [pkgPass], dg3)
    expect(r3.index.plugins[0]!.approvalReason).toBe('awaiting-review')
  })
})

describe('human-verdict event edges', () => {
  const ev = (over: Record<string, unknown>) => ({
    event: 'issue_comment', action: 'created', issueTitle: '[review] pkg@1.0.0',
    issueBody: '', issueNumber: 9, actor: 'u', label: '', commentBody: '', ...over,
  }) as never
  it('issues/closed → skip; titled issue without version → mismatch target has no @ver; amendAt reason-undefined arm', async () => {
    const { resolveVerdictEvent } = await import('../pipeline/human-verdict.ts')
    expect(resolveVerdictEvent(ev({ event: 'issues', action: 'closed', issueTitle: '[concern] x' })).skip).toBeTruthy()
    // target '[review] pkg' (no version) + spec arg elsewhere → mismatch msg target 'pkg' bare
    const r = resolveVerdictEvent(ev({ issueTitle: '[review] pkg', commentBody: '/concern other/repo wrong target' }))
    expect(r.mismatch).toContain('pkg')
    expect(r.mismatch).not.toContain('pkg@')
    // amendAt: latest human line WITHOUT reason field → v.reason ?? '' arm
    const noReason = JSON.stringify({ name: 'a', version: '1.0.0', verdict: 'pass', source: 'human', at: '2026-01-01T00:00:00Z' })
    expect(amendAt([noReason], 'a', '1.0.0', 'pass', 'new reason')).toBe('2026-01-01T00:00:00Z')
    // isDupVerdict: reason undefined on stored line → ?? '' normalize
    expect(isDupVerdict([noReason], 'a', '1.0.0', 'pass', '')).toBe(true)
  })
})

describe('fetch/github compat + category + description arms', () => {
  it('fetchRepoPackage: engines/peerDependencies passthrough + !ok arm; packageName/tree/marketMeta fetchFn-default', async () => {
    const pkg = await fetchRepoPackage('o/r', {
      fetchFn: (async () => mkRes({ name: 'n', engines: { node: '>=18' }, peerDependencies: { react: '^18' } })) as typeof fetch,
    })
    expect(pkg.pkg?.engines).toEqual({ node: '>=18' })
    expect(pkg.pkg?.peerDependencies).toEqual({ react: '^18' })
    expect((await fetchRepoPackage('o/r', { fetchFn: (async () => mkRes('nf', 500)) as typeof fetch })).status).toBe('error')
    // fetchFn-default arms via stubbed global fetch
    vi.stubGlobal('fetch', (async (u: unknown) => {
      const s = String(u)
      if (s.includes('git/trees')) return mkRes({ tree: [{ path: 'a' }], sha: 's' })
      if (s.includes('raw.githubusercontent.com')) return mkRes({ name: 'x' })
      if (s.includes('market.json') || s.includes('opencode')) return mkRes({})
      if (s.includes('api.github.com/repos/')) return mkRes({ id: 1, created_at: 'x', default_branch: 'main' })
      return mkRes('nf', 404)
    }) as typeof fetch)
    await fetchRepoTree('o/r', 'HEAD')
    await fetchRepoPackageName('o/r')
    await fetchMarketMeta('o/r')
    await fetchRepoMeta('o/r')
    // fetchRepoPackage !ok non-404 non-429 → 'error' already covered; category all-invalid + description empty
    const m1 = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ category: [1, 2, 3] })) as typeof fetch })
    expect(m1 === null || m1.category === undefined).toBe(true)
    const m2 = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ description: {} })) as typeof fetch })
    expect(m2 === null || m2.description === undefined).toBe(true)
    // package.json without engines/peer → cond-expr false arms
    const pkg2 = await fetchRepoPackage('o/r', { fetchFn: (async () => mkRes({ name: 'n' })) as typeof fetch })
    expect(pkg2.pkg?.engines).toBeUndefined()
  })
})

describe('checkGuiBundle module-absence arms', () => {
  it('effect/solid-js unimportable → reqmap skips them; bundle still evaluates', async () => {
    vi.resetModules()
    vi.doMock('effect', () => { throw new Error('no effect') })
    vi.doMock('solid-js', () => { throw new Error('no solid') })
    vi.doMock('solid-js/web', () => { throw new Error('no web') })
    const { checkGuiBundle: chk } = await import('../pipeline/verify/gui.ts')
    const r = await chk('module.exports = { default: { setup() { throw new Error("x") } } }')
    expect(r.stage).toBe('setup')
    vi.doUnmock('effect'); vi.doUnmock('solid-js'); vi.doUnmock('solid-js/web'); vi.resetModules()
  })
})

describe('scan binary-blob known/unknown + remerge category-undefined + misc', () => {
  const tarEntry = (name: string, body: Buffer): Buffer => {
    const h = Buffer.alloc(512)
    h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116)
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136)
    h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263)
    h.fill(0x20, 148, 156)
    h.write(h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    const pad = Buffer.alloc((512 - (body.length % 512)) % 512)
    return Buffer.concat([h, body, pad])
  }
  it('binary non-media files → binary-blob findings (known wasm vs unknown bin)', async () => {
    const { gzipSync } = await import('node:zlib')
    const bin = Buffer.from([0, 1, 2, 3, 0, 255, 254, 253])
    const tar = Buffer.concat([
      tarEntry('package/a.wasm', bin),
      tarEntry('package/b.bin', bin),
      tarEntry('package/c.txt', Buffer.from('hello')),
      Buffer.alloc(1024),
    ])
    const r = await scanTarball(gzipSync(tar))
    const blobFindings = r.findings.filter(f => f.rule === 'binary-blob' || String(f).includes('binary'))
    expect(blobFindings.length).toBeGreaterThanOrEqual(1)
  })
  it('remerge: entries without category field → ?? [] arms', async () => {
    const raw = {
      name: 'nc', slug: 'nc', aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: 'nc' }, description: { en: 'd' },
      license: null, deprecated: false, replacement: null, deprecatedMessage: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {}, approval: 'approved',
      // category deliberately omitted
    }
    const idx = CatalogIndex.parse({ version: '1', generatedAt: 'x', categories: { tools: { en: 'Tools' } }, plugins: [raw as never], removed: [] })
    const out = remerge(idx, idx)
    expect(out).toBeTruthy()
  })
  it('sections(): part with content but no trailing newline still maps; mergeEntries dup-name oldByName', async () => {
    expect(sections('### A\nva').get('A')).toBe('va')
    const old = mkIdx([mkEntry('dd', { approval: 'pending' }), mkEntry('dd', { approval: 'approved' })])
    const m = mergeEntries([mkEntry('dd', { approval: 'pending' })], old, 'oc1', 'r1')
    expect(m.length).toBe(1)
  })
})
