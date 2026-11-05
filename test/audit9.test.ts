import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyMatureVerdicts as applyMature, digestStateOf, explainEntry, akey } from '../pipeline/verdicts.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import { latestShaVerdicts, unreviewedTargets } from '../pipeline/ai/diagnose.ts'
import { nextDigestState, renderDigest } from '../pipeline/ai/digest.ts'
import { docketTargets } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'approved',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const mkPu = (version: string, over: Partial<NonNullable<PluginEntry['pendingUpdate']>> = {}) => ({
  version,
  capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified' as const, level: 'load' as const },
  heldAt: 'h',
  ...over,
})
const mkVerdict = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string): AiVerdict => ({
    name, version, verdict, at, source, ...(reason ? { reason } : {}),
  })
const DIGEST = '2026-02-01T21:00:00Z'
const BEFORE = '2026-02-01T10:00:00Z'
const AFTER = '2026-02-02T08:00:00Z'

describe('R-9: pendingUpdate only exists on a displayed entry', () => {
  it('pending+pu inverted state → stale hold dropped, candidate un-shadowed', () => {
    // a brake on the displayed v1.0.0 left pu@1.1.0 behind; upstream moved to
    // 1.2.0 — the 1.1.0 hold is OLDER than the candidate and would starve it
    // on every review surface (all prefer pendingUpdate.version).
    const prev = mkEntry('p', { approval: 'pending', latestVersion: '1.0.0', pendingUpdate: mkPu('1.1.0') })
    const fresh = mkEntry('p', { approval: 'pending', latestVersion: '1.2.0' })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.approval).toBe('pending')
    expect(out!.latestVersion).toBe('1.2.0')
    expect(out!.pendingUpdate).toBeUndefined()
  })
  it('reuse-push still carrying a hold on a pending entry → dropped', () => {
    const prev = mkEntry('p', { approval: 'pending', latestVersion: '1.0.0', pendingUpdate: mkPu('1.1.0') })
    const fresh = mkEntry('p', { approval: 'pending', latestVersion: '1.0.0', pendingUpdate: mkPu('1.1.0') })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.pendingUpdate).toBeUndefined()
  })
  it('displayed entries keep their holds — the gate must not overfire', () => {
    const prev = mkEntry('p', { pendingUpdate: mkPu('1.1.0') })
    const fresh = mkEntry('p')
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.pendingUpdate?.version).toBe('1.1.0')
  })
  it('R-8 still fires when ours is in transitional pending+pu and remote released the held version', () => {
    // brake fired mid-run → ours pending+pu@1.1.0; remote already released
    // 1.1.0 — adopt the released display state, not the pending shadow.
    // contains is version-scoped too: the remote released the HELD payload —
    // keeping our pinned display parts would misroute installs for 1.1.0.
    const prev = mkEntry('p', { approval: 'approved', latestVersion: '1.1.0', contains: ['skill'] })
    const fresh = mkEntry('p', { approval: 'pending', latestVersion: '1.0.0', contains: ['plugin'], pendingUpdate: mkPu('1.1.0') })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.approval).toBe('approved')
    expect(out!.latestVersion).toBe('1.1.0')
    expect(out!.pendingUpdate).toBeUndefined()
    expect(out!.contains).toEqual(['skill'])
  })
})

describe('publish catch-up apply (remerge ours-wins + release.ts re-derive)', () => {
  it('a human brake that landed mid-run re-brakes the merged index', () => {
    // remerge's approval layer is ours-wins → merged says approved; the
    // publish job's release.ts pass re-derives from the freshest verdicts —
    // the brake wins because verdicts, not snapshots, are the truth.
    const merged = mkEntry('p', { approval: 'approved', latestVersion: '1.0.0', approvalReason: 'human brake' })
    const r = applyMature(mkIndex([merged]), [mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'human brake')], null)
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.approvalReason).toBe('human brake')
  })
  it('release promotes the HELD version\'s own integrity — a stale SRI pins the wrong tarball', () => {
    const held = mkEntry('p', {
      integrity: 'sha512-OLD', latestVersion: '1.0.0',
      pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-NEW', publishedAt: '2026-02-01' }),
    })
    const ver = mkVerdict('p', '1.1.0', 'pass', BEFORE)
    const r = applyMature(mkIndex([held]), [ver], digestStateOf(DIGEST, [ver]))
    const out = r.index.plugins[0]!
    expect(out.latestVersion).toBe('1.1.0')
    expect(out.integrity).toBe('sha512-NEW')      // pu.integrity promoted
    expect(out.pendingUpdate).toBeUndefined()
  })
})

describe('latestShaVerdicts — twin reuse takes the NEWEST judgment on the bytes', () => {
  it('an overturned pass does not resurrect via sha reuse', () => {
    const old = { ...mkVerdict('p', '1.0.0', 'pass', BEFORE), sha: 'sha1' }
    const flip = { ...mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'malware reported'), sha: 'sha1' }
    // file order is oldest-first — `find` would return the stale pass
    const m = latestShaVerdicts([old, flip])
    expect(m.get('p\0sha1')!.verdict).toBe('concern')
  })
  it('sha-less verdicts and other names are ignored', () => {
    const m = latestShaVerdicts([
      mkVerdict('p', '1.0.0', 'pass', BEFORE),
      { ...mkVerdict('q', '1.0.0', 'pass', BEFORE), sha: 'sha1' },
    ])
    expect(m.size).toBe(1)
    expect(m.has('q\0sha1')).toBe(true)
  })
})

describe('unreviewedTargets — 48h verify-wait measures the CANDIDATE version age', () => {
  const idx = (scannedAt: string) => mkIndex([mkEntry('p', {
    approval: 'pending', firstSeenAt: '2020-01-01',
    capabilities: { scannedAt, rulesetVersion: 'r', findings: [], redFlags: [] },
    verification: { status: 'unverified' },
  })])
  it('freshly-scanned pending candidate defers even on an ancient entry', () => {
    // firstSeenAt is entry-level and never bumps — the old clock would have
    // expired the verify-wait instantly for every re-scanned candidate.
    expect(unreviewedTargets(idx('2026-02-02T00:00:00Z'), new Map(), null, { now: '2026-02-02T12:00:00Z' })).toHaveLength(0)
  })
  it('candidate scanned long ago → defer expired, degraded review proceeds', () => {
    expect(unreviewedTargets(idx('2026-02-01T00:00:00Z'), new Map(), null, { now: '2026-02-10T00:00:00Z' })).toHaveLength(1)
  })
})

describe('nextDigestState — announced bounded by the latest verdict per key', () => {
  it('superseded lines are pruned; the current latest stays announced', () => {
    const v1 = mkVerdict('p', '1.0.0', 'pass', BEFORE)
    const v2 = mkVerdict('p', '1.0.0', 'pass', AFTER)
    const s1 = nextDigestState([v1], null, new Date('2026-02-02T21:00:00Z'))
    expect(s1.announced).toEqual([akey(v1)])
    const s2 = nextDigestState([v1, v2], s1, new Date('2026-02-03T21:00:00Z'))
    expect(s2.announced).toEqual([akey(v2)])
  })
  it('different keys do not prune each other', () => {
    const a = mkVerdict('a', '1', 'pass', BEFORE)
    const b = mkVerdict('b', '1', 'concern', BEFORE, 'human')
    const s = nextDigestState([a, b], null, new Date('2026-02-02T21:00:00Z'))
    expect(s.announced.sort()).toEqual([akey(a), akey(b)].sort())
  })
})

describe('docket flag targets — identity sec redFlags on visible entries', () => {
  const flagged = () => mkEntry('p', {
    approval: 'approved',
    capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:repo-recreated'] },
  })
  it('opens a flag target on the displayed key', () => {
    const t = docketTargets(mkIndex([flagged()]), [])
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ name: 'p', version: '1.0.0', verdict: 'flag' })
    expect(t[0]!.reason).toContain('sec:repo-recreated')
  })
  it('any human verdict on the displayed key = decided → no standing issue', () => {
    expect(docketTargets(mkIndex([flagged()]), [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')])).toHaveLength(0)
  })
  it('an old ai verdict on the key does not suppress the flag', () => {
    // the flag is NEW information that postdates the release decision
    const t = docketTargets(mkIndex([flagged()]), [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai')])
    expect(t.some(x => x.verdict === 'flag')).toBe(true)
  })
  it('findings-level sec signals and pending entries stay off the flag surface', () => {
    const weak = mkEntry('w', { approval: 'approved',
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: ['sec:maintainer-changed'], redFlags: [] } })
    expect(docketTargets(mkIndex([weak]), [])).toHaveLength(0)
    const pending = mkEntry('q', { approval: 'pending',
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:name-reused'] } })
    expect(docketTargets(mkIndex([pending]), []).every(t => t.verdict !== 'flag')).toBe(true)
  })
  it('issueBody renders flag context', async () => {
    const { issueBody } = await import('../pipeline/docket.ts')
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'flag', reason: 'sec:repo-recreated' })
    expect(body).toContain('已上架')
    expect(body).toContain('sec:repo-recreated')
  })
})

describe('renderDigest §⑥ — live-entry trust alarm surface', () => {
  it('lists visible entries carrying identity sec redFlags', () => {
    const e = mkEntry('p', { approval: 'approved',
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:name-reused'] } })
    const md = renderDigest({ index: mkIndex([e]), verdicts: [], prev: null, now: new Date('2026-02-02T21:00:00Z') })
    expect(md).toContain('已上架条目信任信号')
    expect(md).toContain('sec:name-reused')
  })
  it('pending entries and clean entries produce an empty section', () => {
    const clean = mkEntry('c')
    const pending = mkEntry('q', { approval: 'pending',
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['sec:name-reused'] } })
    const md = renderDigest({ index: mkIndex([clean, pending]), verdicts: [], prev: null, now: new Date('2026-02-02T21:00:00Z') })
    expect(md).toContain('已上架条目信任信号（identity-level sec flags — 0）')
  })
})

describe('explainEntry — per-slot decision chain', () => {
  const v = mkVerdict('p', '1.0.0', 'pass', BEFORE)
  it('unannounced pass → wait (not mature)', () => {
    const e = mkEntry('p', { approval: 'pending', verification: { status: 'verified' } })
    const [s] = explainEntry(e, [v], digestStateOf(DIGEST, []))
    expect(s).toMatchObject({ slot: 'displayed', outcome: 'wait', announced: false, verdict: 'pass' })
  })
  it('announced pass + unverified → wait (verify gate)', () => {
    const e = mkEntry('p', { approval: 'pending', verification: { status: 'unverified' } })
    const [s] = explainEntry(e, [v], digestStateOf(DIGEST, [v]))
    expect(s!.outcome).toBe('wait')
    expect(s!.why).toContain('unverified')
  })
  it('announced pass + verified → release', () => {
    const e = mkEntry('p', { approval: 'pending', verification: { status: 'verified' } })
    const [s] = explainEntry(e, [v], digestStateOf(DIGEST, [v]))
    expect(s!.outcome).toBe('release')
  })
  it('human concern on displayed → brake; sticky over a later ai pass', () => {
    const e = mkEntry('p', { approval: 'approved' })
    const hc = mkVerdict('p', '1.0.0', 'concern', BEFORE, 'human', 'malware')
    const ap = mkVerdict('p', '1.0.0', 'pass', AFTER, 'ai')
    const [s] = explainEntry(e, [hc, ap], digestStateOf(DIGEST, [hc, ap]))
    expect(s).toMatchObject({ outcome: 'brake', verdict: 'concern', stickyHuman: true })
  })
  it('pendingUpdate slot explains independently of the displayed slot', () => {
    const e = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }) })
    const vp = mkVerdict('p', '1.1.0', 'pass', BEFORE)
    const slots = explainEntry(e, [vp], digestStateOf(DIGEST, []))
    expect(slots).toHaveLength(2)
    expect(slots[0]).toMatchObject({ slot: 'pendingUpdate', version: '1.1.0', outcome: 'wait' })
    expect(slots[1]).toMatchObject({ slot: 'displayed', outcome: 'none' })
  })
})

// ————— P7: pinned hold re-scans the HELD tarball on ruleset upgrade —————
function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'a9tgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}
// packument carrying BOTH the held version (for the re-scan tarball URL) and
// the newer upstream version — the standard mkFetchFor stubs only latest.
function mkFetchTwoVers(tgz: Buffer, includeHeldTarball = true) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search')) {
      return new Response(JSON.stringify({ objects: [
        { package: { name: 'mypkg', version: '1.2.0', description: 'd', keywords: ['opencode'], links: {}, date: 't' } },
      ] }))
    }
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.match(/api\.github\.com\/repos\/[^/?]+\/[^/?]+/)) return new Response('', { status: 404 })
    if (url.match(/registry\.npmjs\.org\/([^/?]+)/)) {
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.2.0' },
        versions: {
          ...(includeHeldTarball ? { '1.1.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/held.tgz' } } } : {}),
          '1.2.0': { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/new.tgz' } },
        },
        time: { created: '2020-01-01', '1.1.0': 't1', '1.2.0': 't2' },
      }))
    }
    if (url === 'https://x/held.tgz' || url === 'https://x/new.tgz') return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('run — pinned hold re-scans the held version on ruleset change', () => {
  const heldOld = () => mkEntry('mypkg', {
    latestVersion: '1.0.0', approval: 'approved',
    pendingUpdate: mkPu('1.1.0', {
      capabilities: { scannedAt: '2026-01-01', rulesetVersion: 'old-rules', findings: ['x'], redFlags: [] },
      verification: { status: 'verified', level: 'load' },
      heldAt: '2026-01-15T00:00:00Z',
    }),
  })
  it('held version re-scanned in place: ruleset updated, verification/heldAt preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a9-rescan-'))
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(mkIndex([heldOld()])))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchTwoVers(mkTgz()), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')                    // still pinned
    expect(e.pendingUpdate?.capabilities.rulesetVersion).toBe(RULESET_VERSION)  // re-scanned under current rules
    expect(e.pendingUpdate?.capabilities.scannedAt).toBe('2026-02-02T00:00:00Z')
    expect(e.pendingUpdate?.verification.status).toBe('verified')      // verify slot keyed to version, untouched
    expect(e.pendingUpdate?.heldAt).toBe('2026-01-15T00:00:00Z')       // review clock untouched
    expect(e.latestVersion).toBe('1.0.0')
  })
  it('held version has no tarball URL → stale scan kept this round (degrade, not corrupt)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a9-notar-'))
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(mkIndex([heldOld()])))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchTwoVers(mkTgz(), false), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')
    expect(e.pendingUpdate?.capabilities.rulesetVersion).toBe('old-rules') // untouched
    expect(e.pendingUpdate?.verification.status).toBe('verified')
  })
})
