import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applyMatureVerdicts, latestVerdicts, loadVerdicts, loadLastDigestAt } from '../pipeline/verdicts.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
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
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.index.plugins[0]!.approvalReason).toBeUndefined()
    expect(r.releases).toEqual(['p@1.0.0'])
  })
  it('pass not yet in a digest → stays pending (maturity = digest appearance)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', AFTER)], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('no digest-state at all → all pass verdicts frozen (fail-closed bootstrap)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], null)
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('concern applies immediately + sets reason, no maturity needed', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending' })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'concern', AFTER, 'ai', 'exec in install')], DIGEST)
    const e = r.index.plugins[0]!
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('exec in install')
  })
  it('release gate: verification unverified → mature pass does NOT release', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending', verification: { status: 'unverified' } })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('pending')
    expect(r.releases).toEqual([])
  })
  it('release gate: verification failed → stays pending', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'pending', verification: { status: 'failed', level: 'install' } })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('pending')
  })
  it('red-flag entry: source:ai pass intercepted; source:human pass releases', () => {
    const flags = { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: ['lifecycle-script:x.js'] }
    const idx = mkIndex([mkEntry('p', { approval: 'pending', capabilities: flags, verification: { status: 'skipped', level: 'install' } })])
    const ai = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'ai')], DIGEST)
    expect(ai.index.plugins[0]!.approval).toBe('pending')
    const human = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE, 'human')], DIGEST)
    expect(human.index.plugins[0]!.approval).toBe('approved')
  })
})

describe('applyMatureVerdicts — pendingUpdate release', () => {
  it('mature pass on held version → promote: version/caps/verify/features promoted', () => {
    const pu = mkPu('1.1.0', {
      capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: ['f:new'], redFlags: [] },
      features: ['server', 'tui'], publishedAt: '2026-02-01',
    })
    const idx = mkIndex([mkEntry('p', { pendingUpdate: pu, features: ['server'] })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE)], DIGEST)
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
  it('legacy entry releasing held version → self-heals to approved', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'legacy', pendingUpdate: mkPu('1.1.0') })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.index.plugins[0]!.latestVersion).toBe('1.1.0')
  })
  it('held version pass but verification unverified → release gate holds', () => {
    const idx = mkIndex([mkEntry('p', { pendingUpdate: mkPu('1.1.0', { verification: { status: 'unverified' } }) })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE)], DIGEST)
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.version).toBe('1.1.0')
  })
  it('concern on held version → reason recorded, hold stays', () => {
    const idx = mkIndex([mkEntry('p', { pendingUpdate: mkPu('1.1.0') })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'concern', AFTER, 'ai', 'net egress')], DIGEST)
    const e = r.index.plugins[0]!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.reason).toBe('net egress')
  })
  it('pass on held version with red flags: ai intercepted, human releases', () => {
    const pu = mkPu('1.1.0', { capabilities: { scannedAt: 't2', rulesetVersion: 'r', findings: [], redFlags: ['lifecycle-script:x'] }, verification: { status: 'skipped' } })
    const idx = mkIndex([mkEntry('p', { pendingUpdate: pu })])
    const ai = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'ai')], DIGEST)
    expect(ai.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
    const human = applyMatureVerdicts(idx, [mkVerdict('p', '1.1.0', 'pass', BEFORE, 'human')], DIGEST)
    expect(human.index.plugins[0]!.latestVersion).toBe('1.1.0')
  })
})

describe('applyMatureVerdicts — displayed-version brake', () => {
  it('concern on displayed version → approval back to pending (human brake)', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'approved' })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'concern', AFTER, 'human', 'malware reported')], DIGEST)
    const e = r.index.plugins[0]!
    expect(e.approval).toBe('pending')
    expect(e.approvalReason).toBe('malware reported')
  })
  it('pass on displayed version of approved entry → no-op', () => {
    const idx = mkIndex([mkEntry('p', { approval: 'approved' })])
    const r = applyMatureVerdicts(idx, [mkVerdict('p', '1.0.0', 'pass', BEFORE)], DIGEST)
    expect(r.index.plugins[0]!.approval).toBe('approved')
    expect(r.releases).toEqual([])
  })
  it('github-kind (version null): concern@null brakes displayed, pass@null approves pending', () => {
    const gh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'o/r' }, latestVersion: null, verification: { status: 'skipped' } })
    const braked = applyMatureVerdicts(mkIndex([gh]), [mkVerdict('o/r', null, 'concern', AFTER, 'human')], DIGEST)
    expect(braked.index.plugins[0]!.approval).toBe('pending')
    const pendingGh = mkEntry('o/r', { source: { kind: 'github', id: 'o/r', repo: 'o/r' }, latestVersion: null, verification: { status: 'skipped' }, approval: 'pending' })
    const approved = applyMatureVerdicts(mkIndex([pendingGh]), [mkVerdict('o/r', null, 'pass', BEFORE)], DIGEST)
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
function mkFetchFor(latest: string, tgz: Buffer) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search')) {
      return new Response(JSON.stringify({ objects: [
        { package: { name: 'mypkg', version: latest, description: 'd', keywords: ['opencode'], links: {}, date: 't' } },
      ] }))
    }
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.includes('registry.npmjs.org/mypkg')) {
      return new Response(JSON.stringify({
        'dist-tags': { latest },
        versions: { [latest]: { keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' } } },
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
    const ds = join(dir, 'digest.json'); writeFileSync(ds, JSON.stringify({ lastDigestAt: DIGEST }))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf, digestStatePath: ds,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.latestVersion).toBe('1.1.0')           // 1.1.0 released at run start
    expect(e.pendingUpdate?.version).toBe('1.2.0')  // 1.2.0 held as the next candidate
    expect(e.approval).toBe('approved')
  })
  it('immature verdict → no release; npm bump overwrites the hold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-imm-'))
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: mkPu('1.1.0'),
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    const vf = join(dir, 'verdicts.jsonl')
    writeFileSync(vf, JSON.stringify(mkVerdict('mypkg', '1.1.0', 'pass', AFTER)) + '\n') // after digest
    const ds = join(dir, 'digest.json'); writeFileSync(ds, JSON.stringify({ lastDigestAt: DIGEST }))
    const idx = await run({
      outPath: join(dir, 'out.json'), oldIndexPath: oldPath, verdictsPath: vf, digestStatePath: ds,
      fetchFn: mkFetchFor('1.2.0', mkTgz()), now: '2026-02-02T00:00:00Z',
    })
    const e = idx.plugins.find(p => p.name === 'mypkg')!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.version).toBe('1.2.0')  // immature 1.1.0 starved — by design
  })
  it('held version is not rescanned — reuse compares vs pendingUpdate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-reuse-'))
    const pu = mkPu('1.1.0', { capabilities: { scannedAt: 'earlier', rulesetVersion: 'r2', findings: ['x'], redFlags: [] } })
    const old = mkIndex([mkEntry('mypkg', {
      latestVersion: '1.0.0', approval: 'approved', pendingUpdate: pu,
      capabilities: { scannedAt: 't', rulesetVersion: 'r2', findings: [], redFlags: [] },
      metrics: { stars: null, npmDownloads30d: null, checkedAt: '2026-02-02T00:00:00Z' },
    })])
    const oldPath = join(dir, 'old.json'); writeFileSync(oldPath, JSON.stringify(old))
    // RULESET_VERSION is 'r' in code? — fetch actual to keep test honest
    const { RULESET_VERSION } = await import('../pipeline/scan/rules.ts')
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
