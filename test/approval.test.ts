import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyMatureVerdicts as applyMature, latestVerdicts, loadVerdicts, loadLastDigestAt, digestStateOf } from '../pipeline/verdicts.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'
import type { CatalogIndex, PluginEntry, AiVerdict, DigestState } from '../src/schema.ts'

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

/** apply with a digest-state whose announced set contains exactly `vs`
 *  ('all'), nothing ('none'), an explicit state, or none at all (null).
 *  Maturity is membership, not timestamps — 'none' freezes even old-dated
 *  verdicts. */
const apply = (i: CatalogIndex, vs: AiVerdict[], mode: 'all' | 'none' | DigestState | null = 'all') =>
  applyMature(i, vs,
    mode === 'all' ? digestStateOf(DIGEST, vs) : mode === 'none' ? digestStateOf(DIGEST, []) : mode)

describe('verdicts loading', () => {
  it('loadVerdicts parses jsonl, skips malformed lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v-'))
    const f = join(dir, 'ai-verdicts.jsonl')
    writeFileSync(f, [
      JSON.stringify(mkVerdict('a', '1', 'pass', BEFORE)),
      'not json',
      JSON.stringify({ name: 'b' }), // missing required fields → dropped
      JSON.stringify(mkVerdict('b', null, 'concern', AFTER, 'human')),
    ].join('\n'))
    const vs = loadVerdicts(f)
    expect(vs).toHaveLength(2)
    expect(vs[1]!.source).toBe('human')
    expect(loadVerdicts(join(dir, 'nope'))).toEqual([])
    expect(loadVerdicts()).toEqual([])
  })
  it('loadVerdicts drops verdicts with a malformed `at` (would freeze silently as future-dated)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v-'))
    const f = join(dir, 'ai-verdicts.jsonl')
    writeFileSync(f, [
      JSON.stringify(mkVerdict('a', '1', 'pass', 'not-a-timestamp')),
      JSON.stringify(mkVerdict('b', '1', 'pass', BEFORE)),
    ].join('\n'))
    const vs = loadVerdicts(f)
    expect(vs).toHaveLength(1)
    expect(vs[0]!.name).toBe('b')
  })
  it('loadLastDigestAt: missing/invalid → null (-∞), valid → timestamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    expect(loadLastDigestAt(join(dir, 'none.json'))).toBeNull()
    expect(loadLastDigestAt()).toBeNull()
    const bad = join(dir, 'bad.json'); writeFileSync(bad, '{')
    expect(loadLastDigestAt(bad)).toBeNull()
    const good = join(dir, 'digest-state.json'); writeFileSync(good, JSON.stringify({ lastDigestAt: DIGEST }))
    expect(loadLastDigestAt(good)).toBe(DIGEST)
  })
  it('latestVerdicts: newest by `at` wins per name@version', () => {
    const m = latestVerdicts([
      mkVerdict('a', '1', 'pass', '2026-01-01T00:00:00Z'),
      mkVerdict('a', '1', 'concern', '2026-01-02T00:00:00Z', 'human', 'newer'),
      mkVerdict('a', '2', 'pass', '2026-01-01T00:00:00Z'),
    ])
    expect(m.get('a\0' + '1')!.verdict).toBe('concern')
    expect(m.get('a\0' + '2')!.verdict).toBe('pass')
  })
})

describe('applyMatureVerdicts — pending entries', () => {
  it('pending + mature pass + verified → approved', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)])
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.index.plugins[0]!.approvalReason).toBeUndefined()
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('pass not yet in a digest → stays pending (maturity = digest appearance)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', AFTER)], 'none')
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('no digest-state at all → all pass verdicts frozen (fail-closed bootstrap)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], null)
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('late-pushed verdict with old `at` does NOT mature — membership, not timestamp', () => {
    // the audit hole: at ≤ lastDigestAt but the line was not in the file when
    // the digest rendered → announced does not contain it → stays frozen.
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], 'none')
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('a NEW verdict line on an announced name@version is a new key — must re-announce', () => {
    const v1 = mkVerdict('p', '1.0.0', 'pass', BEFORE)
    const v2 = mkVerdict('p', '1.0.0', 'pass', '2026-02-01T12:00:00Z')
    // v1 announced; v2 (newer, wins latest) never appeared in a digest → held
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [v1, v2], digestStateOf(DIGEST, [v1]))
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('concern applies immediately + sets reason, no maturity needed', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'concern', AFTER, 'ai', 'exec in install')])
    const e = r.index.plugins[0]!
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('exec in install')
  })
  it('release gate: verification unverified → mature pass does NOT release', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending', verification: { status: 'unverified' } })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)])
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('release gate: verification failed → stays pending', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending', verification: { status: 'failed', level: 'install' } })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)])
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('red-flag entry: source:ai pass intercepted; source:human pass releases', () => {
    const flags = { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['lifecycle-script:x.js'] }
    const idx = mkIndex([mkEntry('p', { approval: 'pending', capabilities: flags, verification: { status: 'skipped', level: 'install' } })])
    const ai = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai')])
    expect(ai.index.plugins[0]!.approval).toBe('pending')
    const human = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')])
    expect(human.index.plugins[0]!.approval).toBe('approved')
  })
  it('human stickiness: a later ai pass cannot lift a human concern (R-4)', () => {
    // `latest` ranks by `at` — a skewed ai writer clock must not outrank the
    // human brake even when the ai pass is mature+announced.
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const hc = mkVerdict('p', '1.0.0', 'concern', BEFORE, 'human', 'malware reported')
    const ap = mkVerdict('p', '1.0.0', 'pass', AFTER, 'ai')
    const r = apply(idx, [hc, ap], digestStateOf(DIGEST, [hc, ap]))
    const e = r.index.plugins[0]!
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('malware reported')
    expect(r.releases).toEqual([])
  })
  it('a newer human pass lifts a human concern (only humans un-brake humans)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const hc = mkVerdict('p', '1.0.0', 'concern', BEFORE, 'human', 'malware reported')
    const hp = mkVerdict('p', '1.0.0', 'pass', AFTER, 'human')
    const r = apply(idx, [hc, hp], digestStateOf(DIGEST, [hc, hp]))
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('ai concern still overrides an earlier human pass (conservative direction stays open)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'approved' })])
    const hp = mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')
    const ac = mkVerdict('p', '1.0.0', 'concern', AFTER, 'ai', 'post-release drift')
    const r = apply(idx, [hp, ac])
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.index.plugins[0]!.approvalReason).toBe('post-release drift')
  })
  it('human stickiness on the held-version slot too', () => {
    const idx = mkIndex([mkEntry('p', { pendingUpdate: mkPu('1.1.0') })])
    const hc = mkVerdict('p', '1.1.0', 'concern', BEFORE, 'human', 'do not ship')
    const ap = mkVerdict('p', '1.1.0', 'pass', AFTER, 'ai')
    const r = apply(idx, [hc, ap], digestStateOf(DIGEST, [hc, ap]))
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.reason).toBe('do not ship')
    expect(r.releases).toEqual([])
  })
})

describe('applyMatureVerdicts — pendingUpdate release', () => {
  it('mature pass on held version → promote: version/caps/verify/features promoted', () => {
    const pu = mkPu('1.1.0', {
      capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: ['f:new'], redFlags: [] },
      features: ['server', 'tui'], publishedAt: '2026-02-01',
    })
    const idx = mkIndex([mkEntry('p', { pendingUpdate: pu, features: ['server'] })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE)])
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.1.0')
    expect(e.capabilities.findings).toContain('f:new')
    expect(e.verification.status).toBe('verified')
    expect(e.features).toEqual(['server', 'tui'])
    expect(e.publishedAt).toBe('2026-02-01')
    expect(e.source.version).toBe('1.1.0')
    expect(e.pendingUpdate).toBeUndefined()
    expect(e.approval).toBe('approved')
    expect(r.releases).toEqual(['p@1.1.0'])
  })
  it('release promotes the HELD byte-anchor + parts — displayed slot values would certify the wrong version', () => {
    // pu.integrity/pu.contains describe the CANDIDATE: leaving the displayed
    // version's values in place would pin the new release to the OLD
    // tarball's SRI and route installs by the old payload shape
    const pu = mkPu('1.1.0', { integrity: 'sha512-new==', contains: ['skill'] })
    const idx = mkIndex([mkEntry('p', {
      pendingUpdate: pu, integrity: 'sha512-old==', contains: ['plugin'],
    })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')])
    const e = r.index.plugins[0]!
    expect(e.integrity).toBe('sha512-new==')
    expect(e.contains).toEqual(['skill'])
  })
  it('legacy hold without pu.integrity releases with integrity:null (heals via needsIntegrity backfill)', () => {
    // the displayed version's SRI must NOT be inherited: v_new + v_old's hash
    // fails closed at every install AND freezes a WRONG anchor that trips a
    // permanent bogus sec:integrity-drift. null is honest — needsIntegrity
    // re-anchors the real tarball SRI on the next refreshMeta (null→newsha)
    const pu = mkPu('1.1.0')   // no integrity/contains — pre-field hold
    const idx = mkIndex([mkEntry('p', { pendingUpdate: pu, integrity: 'sha512-old==', contains: ['plugin'] })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')])
    const e = r.index.plugins[0]!
    expect(e.integrity).toBeNull()
    expect(e.contains).toEqual(['plugin'])
  })
  it('legacy entry releasing held version → self-heals to approved', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'legacy', pendingUpdate: mkPu('1.1.0') })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')])
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.index.plugins[0]!.latestVersion).toBe('1.1.0')
  })
  it('held version pass but verification unverified → release gate holds', () => {
    const idx = mkIndex([mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }) })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE)])
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.version).toBe('1.1.0')
  })
  it('concern on held version → reason recorded, hold stays', () => {
    const idx = mkIndex([mkEntry('p', { pendingUpdate: mkPu('1.1.0') })])
    const r = apply(idx, [mkVerdict('p', '1.1.0', 'concern', AFTER, 'ai', 'net egress')])
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.reason).toBe('net egress')
  })
  it('pass on held version with red flags: ai intercepted, human releases', () => {
    const pu = mkPu('1.1.0', { capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: ['lifecycle-script:x'] }, verification: { status: 'skipped' } })
    const idx = mkIndex([mkEntry('p', { pendingUpdate: pu })])
    const ai = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'ai')])
    expect(ai.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
    const human = apply(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')])
    expect(human.index.plugins[0]!.latestVersion).toBe('1.1.0')
  })
})

describe('applyMatureVerdicts — displayed-version brake', () => {
  it('concern on displayed version → approval back to pending (human brake)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'approved' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'malware reported')])
    const e = r.index.plugins[0]!
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('malware reported')
  })
  it('pass on displayed version of approved entry → no-op', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'approved' })])
    const r = apply(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)])
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.releases).toEqual([])
  })
  it('github-kind (version null): concern@null brakes displayed, pass@null approves pending', () => {
    const gh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'o/r' }, latestVersion: null, verification: { status: 'skipped' } })
    const braked = apply(mkIndex([gh]), [mkVerdict('o/r', null, 'concern', AFTER, 'human')])
    expect(braked.index.plugins[0]!.approval).toBe('pending')
    const pendingGh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'o/r' }, latestVersion: null, verification: { status: 'skipped' }, approval: 'pending' })
    const approved = apply(mkIndex([pendingGh]), [mkVerdict('o/r', null, 'pass', BEFORE)])
    expect(approved.index.plugins[0]!.approval).toBe('approved')
  })
})

describe('mergeEntries — hold surgery', () => {
  it('entry carrying pendingUpdate keeps it; display fields stay pinned', () => {
    const prev = mkEntry('p', { latestVersion: '1.0.0' })
    const fresh = mkEntry('p', {
      pendingUpdate: mkPu('1.1.0'),
      firstSeenAt: 'x', // should be overwritten by identity layer
    })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.pendingUpdate?.version).toBe('1.1.0')
    expect(out!.latestVersion).toBe('1.0.0')
    expect(out!.approval).toBe('approved')
  })
  it('same held version on both sides → remote verification slot wins', () => {
    const prev = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'verified', level: 'load' } }) })
    const fresh = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }) })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.pendingUpdate!.verification.status).toBe('verified')
  })
  it('same held version → remote fills byte-anchor/parts ours lacks', () => {
    // ours built without pu.integrity (older writer) — remote's anchor must
    // survive the merge, not get stripped to undefined
    const prev = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-r==', contains: ['skill'] }) })
    const fresh = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }) })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.pendingUpdate!.integrity).toBe('sha512-r==')
    expect(out!.pendingUpdate!.contains).toEqual(['skill'])
    // ours wins on conflict though — this run's data is authoritative
    const fresh2 = mkEntry('p', { pendingUpdate: mkPu('1.1.0', { integrity: 'sha512-mine==', verification: { status: 'unverified' } }) })
    const [out2] = mergeEntries([fresh2], mkIndex([prev]), '2.2.5', 'r')
    expect(out2!.pendingUpdate!.integrity).toBe('sha512-mine==')
  })
  it('prev holds a version ours never saw → hold carried (unless ours released it)', () => {
    const prev = mkEntry('p', { pendingUpdate: mkPu('1.1.0') })
    const fresh = mkEntry('p') // no pendingUpdate, latestVersion 1.0.0
    const [kept] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(kept!.pendingUpdate?.version).toBe('1.1.0')
    // ours released that exact version → don't resurrect
    const released = mkEntry('p', { latestVersion: '1.1.0' })
    const [gone] = mergeEntries([released], mkIndex([prev]), '2.2.5', 'r')
    expect(gone!.pendingUpdate).toBeUndefined()
  })
  it('sec-delta flags attach to pendingUpdate.capabilities, identity flags to display', () => {
    const prev = mkEntry('p', {
      capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
      createdAt: '2020-01-01', firstSeenAt: '2019-01-01', // triggers name-reused
    })
    const fresh = mkEntry('p', {
      pendingUpdate: mkPu('1.1.0', {
        capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: ['lifecycle-script:i.js'], redFlags: [] },
      }),
      createdAt: '2021-01-01',
    })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.capabilities.redFlags).toContain('sec:name-reused')        // identity → display
    expect(out!.capabilities.findings.some(f => f.startsWith('sec-delta'))).toBe(false)
    expect(out!.pendingUpdate!.capabilities.redFlags).toContain('sec-delta:lifecycle-script') // delta → held
    expect(out!.pendingUpdate!.verification.status).toBe('skipped')        // red-flag downgrade
  })
  it('rollback compares vs held target — held version does not false-fire', () => {
    const prev = mkEntry('p', { pendingUpdate: mkPu('1.1.0') })
    // npm latest = held candidate 1.1.0 (worker would reuse; merge should still not flag)
    const fresh1 = mkEntry('p', { pendingUpdate: mkPu('1.1.0'), createdAt: '2020-01-01' })
    const [a] = mergeEntries([fresh1], mkIndex([prev]), '2.2.5', 'r')
    expect(a!.capabilities.redFlags).not.toContain('sec:version-rollback')
    // npm latest genuinely regressed below held target → rollback flags
    const prev2 = mkEntry('p', { pendingUpdate: mkPu('1.1.0'), distTags: { latest: '1.0.5' } })
    const fresh2 = mkEntry('p', { pendingUpdate: mkPu('1.0.5'), createdAt: '2020-01-01' })
    const [b] = mergeEntries([fresh2], mkIndex([prev2]), '2.2.5', 'r')
    expect(b!.capabilities.redFlags).toContain('sec:version-rollback')
  })
  it('pending entry approval carries; new entries default pending + reason', () => {
    const prev = mkEntry('p', { approval: 'pending', approvalReason: 'exec found' })
    const fresh = mkEntry('p', { approval: 'pending' })
    const [out] = mergeEntries([fresh], mkIndex([prev]), '2.2.5', 'r')
    expect(out!.approval).toBe('pending')
    expect(out!.approvalReason).toBe('exec found')
    const [brand] = mergeEntries([mkEntry('new-pkg', { approval: 'pending', approvalReason: 'awaiting-review' })], null, '2.2.5', 'r')
    expect(brand!.approval).toBe('pending')
  })
})

// ————— run-level: hold surgery + verdict application order (starvation regression) —————
function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'aptgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}
function mkFetchFor(latest: string, tgz: Buffer, names: string[] = ['mypkg'], opts: { repoUrl?: string; repoMeta?: Record<string, unknown> } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search')) {
      return new Response(JSON.stringify({ objects: names.map(name => (
        { package: { name, version: latest, description: 'd', keywords: ['opencode'], links: {}, date: 't' } }
      )) }))
    }
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.match(/api\.github\.com\/repos\/[^/?]+\/[^/?]+/)) {
      return opts.repoMeta
        ? new Response(JSON.stringify(opts.repoMeta))
        : new Response('', { status: 404 })
    }
    const pkgM = url.match(/registry\.npmjs\.org\/([^/?]+)/)
    if (pkgM && names.includes(decodeURIComponent(pkgM[1]!))) {
      return new Response(JSON.stringify({
        'dist-tags': { latest },
        versions: { [latest]: { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' }, ...(opts.repoUrl ? { repository: { url: opts.repoUrl } } : {}) } },
        time: { created: '2020-01-01', [latest]: 't2' },
      }))
    }
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 1 }))
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('run — hold semantics end-to-end', () => {
  it('version bump on displayed entry → pendingUpdate, display pinned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-hold-'))
    const old = mkIndex([mkEntry('mypkg', { latestVersion: '1.0.0', approval: 'approved' })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchFor('1.1.0', mkTgz()), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.version).toBe('1.1.0')
    expect(e.pendingUpdate?.verification.status).toBe('unverified')
    expect(e.approval).toBe('approved')
  })
  it('mature verdict releases BEFORE discovery compare — high-frequency starvation regression', async () => {
    // Displayed 1.0.0, held 1.1.0 (verified) + mature pass@1.1.0; npm has moved to 1.2.0.
    // The 1.1.0 release must land at run start; then 1.2.0 becomes the new hold.
    const dir = mkdtempSync(join(tmpdir(), 'run-starve-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'verified', level: 'load' } }),
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const vf = join(dir, 'verdicts.jsonl')
    writeFileSync(vf, JSON.stringify(mkVerdict('mypkg', '1.1.0', 'pass', BEFORE)) + '\n')
    const ds = join(dir, 'digest.json'); writeFileSync(ds, JSON.stringify(digestStateOf(DIGEST, [mkVerdict('mypkg', '1.1.0', 'pass', BEFORE)])))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf, digestStatePath: ds,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.latestVersion).toBe('1.1.0')           // 1.1.0 released at run start
    expect(e.pendingUpdate?.version).toBe('1.2.0')  // 1.2.0 held as the next candidate
    expect(e.approval).toBe('approved')
  })
  it('immature verdict → hold stays pinned at its version; no release, no starvation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-imm-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0'),
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const vf = join(dir, 'verdicts.jsonl')
    writeFileSync(vf, JSON.stringify(mkVerdict('mypkg', '1.1.0', 'pass', AFTER)) + '\n') // not announced
    const ds = join(dir, 'digest.json'); writeFileSync(ds, JSON.stringify({ lastDigestAt: DIGEST }))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf, digestStatePath: ds,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.latestVersion).toBe('1.0.0')
    // R-1: an immature verdict is still IN-FLIGHT — the hold keeps 1.1.0 so the
    // review can complete; upstream 1.2.0 waits as the NEXT candidate
    expect(e.pendingUpdate?.version).toBe('1.1.0')
    expect(e.distTags.latest).toBe('1.2.0')
  })
  it('R-1 pin: upstream bump does not wipe in-flight verify/review state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-pin-'))
    const pu = mkPu('1.1.0', {
      verification: { status: 'unverified' },
      heldAt: '2026-02-01T00:00:00Z',
      reason: 'awaiting-review',
    })
    const old = mkIndex([mkEntry('mypkg', { latestVersion: '1.0.0', approval: 'approved', pendingUpdate: pu })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')          // pinned — not retargeted to 1.2.0
    expect(e.pendingUpdate?.heldAt).toBe('2026-02-01T00:00:00Z') // review clock not reset
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.distTags.latest).toBe('1.2.0')                  // upstream truth still recorded
  })
  it('R-1 pin: ruleset upgrade must not wipe the hold\'s verification', async () => {
    // stale ruleset in the held scan forces a rebuild past the short-circuit;
    // before the pin this rebuilt pendingUpdate wholesale → verification reset
    // to unverified and heldAt reset, mass-requeuing every in-flight hold.
    const dir = mkdtempSync(join(tmpdir(), 'run-rules-'))
    const pu = mkPu('1.1.0', {
      capabilities: { scannedAt: 'old', rulesetVersion: 'old-rules', findings: ['x'], redFlags: [] },
      verification: { status: 'verified', level: 'load' },
      heldAt: '2026-01-15T00:00:00Z',
    })
    const old = mkIndex([mkEntry('mypkg', { latestVersion: '1.0.0', approval: 'approved', pendingUpdate: pu })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchFor('1.1.0', mkTgz()), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')
    expect(e.pendingUpdate?.verification.status).toBe('verified')
    expect(e.pendingUpdate?.heldAt).toBe('2026-01-15T00:00:00Z')
  })
  it('R-1 pin: concern verdict on the held version is terminal → retarget to upstream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-term-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }),
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const vf = join(dir, 'verdicts.jsonl')
    writeFileSync(vf, JSON.stringify(mkVerdict('mypkg', '1.1.0', 'concern', BEFORE, 'ai', 'install hooks')) + '\n')
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.2.0')  // 1.1.0 dead → slot moves on
  })
  it('R-1 pin: exhausted verification retries are terminal; retryable failure stays pinned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-retr-'))
    const dead = mkEntry('deadpkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'failed', verifiedAt: '2026-02-01T00:00:00Z', retries: 3 } }),
    })
    const retrying = mkEntry('retrypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'failed', verifiedAt: '2026-02-01T00:00:00Z', retries: 1 } }),
    })
    const old = mkIndex([dead, retrying])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchFor('1.2.0', mkTgz(), ['deadpkg', 'retrypkg']), now: '2026-02-02T00:00:00Z' })
    expect(idx.plugins.find(p => p.name === 'deadpkg')!.pendingUpdate?.version).toBe('1.2.0')
    expect(idx.plugins.find(p => p.name === 'retrypkg')!.pendingUpdate?.version).toBe('1.1.0')
  })
  it('R-1 pin: repojack detection survives — fresh repoId still flows to trustFlags', async () => {
    // the pin path refreshes source.repoId from live repoMeta so a
    // deleted-and-recreated repo still fires sec:repo-recreated
    const dir = mkdtempSync(join(tmpdir(), 'run-repo-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }),
      source: { kind: 'npm', id: 'mypkg', version: '1.0.0', repo: 'o/r', repoId: 111 },
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath,
      fetchFn: mkFetchFor('1.2.0', mkTgz(), ['mypkg'], { repoUrl: 'https://github.com/o/r', repoMeta: { id: 999, stargazers_count: 7 } }),
      now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')   // still pinned
    expect(e.source.repoId).toBe(999)                 // refreshed from live meta
    expect(e.capabilities.redFlags).toContain('sec:repo-recreated')
  })
  it('R-1 pin: a human verdict on the newer version pulls the slot forward', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-human-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }),
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const vf = join(dir, 'verdicts.jsonl')
    writeFileSync(vf, JSON.stringify(mkVerdict('mypkg', '1.2.0', 'pass', BEFORE, 'human')) + '\n')
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.2.0')  // maintainer judged 1.2.0 — follow them
  })
  it('held version is not rescanned — reuse compares vs pendingUpdate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-reuse-'))
    const pu = mkPu('1.1.0', { capabilities: { scannedAt: 'earlier', rulesetVersion: RULESET_VERSION, findings: ['x'], redFlags: [] } })
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved', pendingUpdate: pu,
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-02-02T00:00:00Z' },
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const idxOld = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: { ...pu, capabilities: { ...pu.capabilities, rulesetVersion: RULESET_VERSION } },
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
      metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-02-02T00:00:00Z' },
    })])
    writeFileSync(oldPath, JSON.stringify(idxOld))
    const idx = await run({ outPath: join(dir, 'out.json'), oldIndexPath: oldPath, fetchFn: mkFetchFor('1.1.0', mkTgz()), now: '2026-02-02T00:00:00Z' })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.pendingUpdate?.version).toBe('1.1.0')
    expect(e.pendingUpdate?.capabilities.findings).toContain('x') // held scan kept, not rescanned
  })
})
