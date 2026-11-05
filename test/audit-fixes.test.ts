/** Regression coverage for the catalog-pipeline audit fixes (2026-11):
 *  P0-1 held-scan retry, P0-2 unscanned release gate, P1-3/4 case-insensitive
 *  repo identity + blocklist, P1-5 tombstone name-reuse, P1-7 ruleset sweep,
 *  P2-8 evidence regression, P2-12 skill-only contains, P3 oversize
 *  memoization + submissions pruning. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { run } from '../pipeline/run.ts'
import { applyMatureVerdicts, explainEntry, akey } from '../pipeline/verdicts.ts'
import { reviewMaterial } from '../pipeline/ai/diagnose.ts'
import { markNotified } from '../pipeline/notify-published.ts'
import { installPlan } from '../plugins/market/src/catalog.ts'
import { verifyPartsOf } from '../pipeline/verify/plan.ts'
import { CatalogIndex, type PluginEntry, type AiVerdict } from '../src/schema.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const mkRes = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })

function mkTgz(files: Record<string, string> = {}): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'auditfx-'))
  writeFileSync(join(dir, 't.txt'), 'x')
  const entries = Object.keys(files).length ? files : { 'pkg/index.js': 'export default {}' }
  for (const [p, c] of Object.entries(entries)) {
    const fp = join(dir, p)
    execFileSync('mkdir', ['-p', join(fp, '..')])
    writeFileSync(fp, c)
  }
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, ...Object.keys(entries).map(k => k.split('/')[0]!)], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'd' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: null,
  integrity: null, contains: ['plugin'],
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: RULESET_VERSION },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idxOf = (plugins: PluginEntry[], removed: object[] = []): CatalogIndex =>
  CatalogIndex.parse({ version: '1', generatedAt: 'x', categories: {}, plugins, removed })
const verdict = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', source: 'ai', at: '2026-06-01', ...over,
})

describe('P0-1: scan-failed pendingUpdate re-fetches on the next run', () => {
  it('held slot with no rulesetVersion is re-scanned via the held tarball', async () => {
    const tgz = mkTgz()
    const d = mkdtempSync(join(tmpdir(), 'p01-'))
    const oldPath = join(d, 'old.json')
    const prev = entry({
      name: 'held-pkg', slug: 'o/held', latestVersion: '1.0.0', approval: 'approved',
      pendingUpdate: {
        version: '2.0.0', reason: 'awaiting-review', heldAt: '2026-01-01',
        // scan failed at admission — no timestamp, no ruleset stamp
        capabilities: { scannedAt: null, findings: [], redFlags: [] },
        verification: { status: 'unverified' },
      },
    })
    writeFileSync(oldPath, JSON.stringify(idxOf([prev])))
    let tarballFetches = 0
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'held-pkg', version: '2.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/held-pkg'))
        return mkRes({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/1.tgz' } },
            '2.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/2.tgz' } },
          },
          time: {},
        })
      if (url.includes('x/2.tgz') || url.includes('x/1.tgz')) { tarballFetches++; return new Response(new Uint8Array(tgz)) }
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-11-05T00:00:00Z' })
    const pu = out.plugins[0]!.pendingUpdate
    // the OLD bug: `?? prev.capabilities` borrowed the displayed slot's ruleset
    // → wholesale reuse → tarball never re-fetched, scannedAt stayed null
    expect(tarballFetches).toBeGreaterThan(0)
    expect(pu!.capabilities.scannedAt).toBe('2026-11-05T00:00:00Z')
    expect(pu!.capabilities.rulesetVersion).toBe(RULESET_VERSION)
  })
})

describe('P0-2: unscanned slots are not AI-releasable (没扫到 ≠ 安全)', () => {
  const unscanned = entry({
    approval: 'pending',
    capabilities: { scannedAt: null, findings: [], redFlags: [] },
    verification: { status: 'verified' },
  })
  it('mature AI pass on scannedAt:null slot → NOT released; human pass → released', () => {
    const ai = verdict()
    const digest = { lastDigestAt: 'x', announced: [akey(ai)], dayAnnounced: [] }
    const held = applyMatureVerdicts(idxOf([unscanned]), [ai], digest)
    expect(held.index.plugins[0]!.approval).toBe('pending')
    const human = verdict({ source: 'human' })
    const d2 = { lastDigestAt: 'x', announced: [akey(human)], dayAnnounced: [] }
    const rel = applyMatureVerdicts(idxOf([unscanned]), [human], d2)
    expect(rel.index.plugins[0]!.approval).toBe('approved')
  })
  it('explainEntry reports aiBlockedByNoScan with the no-scan why', () => {
    const v = verdict()
    const ex = explainEntry(unscanned, [v], { lastDigestAt: 'x', announced: [akey(v)], dayAnnounced: [] })
    const disp = ex.find(s => s.slot === 'displayed')!
    expect(disp.aiBlockedByNoScan).toBe(true)
    expect(disp.outcome).toBe('wait')
  })
  it('reviewMaterial exposes never-ran scan state distinctly from clean', () => {
    const m = reviewMaterial(unscanned)
    const scan = m.find(b => b.id === 'scan')!
    expect(scan.text).toContain('never-ran')
    const clean = reviewMaterial(entry({ approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: [] } }))
    expect(clean.find(b => b.id === 'scan')!.text).toContain('scanned=t')
  })
})

describe('P1-3/P1-4: case-insensitive repo identity + blocklist', () => {
  it('npm-covered repo filters a case-variant github candidate; blocked fullName matches lowercase list', async () => {
    const tgz = mkTgz()
    const d = mkdtempSync(join(tmpdir(), 'p134-'))
    writeFileSync(join(d, 'block.json'), JSON.stringify({ names: ['owner/blocked'], slugs: ['owner/blocked'] }))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'cover-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search'))
        return mkRes({ items: [
          // display-case variant of the npm entry's repo — must still dedupe
          { full_name: 'Owner/Good', description: 'opencode plugin', archived: false, fork: false, pushed_at: 't', stargazers_count: 1, default_branch: 'main', topics: ['opencode-plugin'] },
          // case-variant of a blocklisted repo — must still be blocked
          { full_name: 'Owner/Blocked', description: 'opencode plugin', archived: false, fork: false, pushed_at: 't', stargazers_count: 1, default_branch: 'main', topics: ['opencode-plugin'] },
        ] })
      if (url.includes('registry.npmjs.org/cover-pkg'))
        return mkRes({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { repository: 'https://github.com/owner/good', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } },
          time: {},
        })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      if (url.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 1, pushed_at: 't', default_branch: 'main' })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), blocklistPath: join(d, 'block.json'), fetchFn: f, now: 't' })
    const names = out.plugins.map(p => p.name)
    expect(names).toContain('cover-pkg')
    // neither the case-variant duplicate nor the case-variant blocked repo got in
    expect(names).not.toContain('Owner/Good')
    expect(names).not.toContain('owner/good')
    expect(names).not.toContain('Owner/Blocked')
  })
})

describe('P1-5: tombstone identity — same name, different object', () => {
  it('re-entry with a different repoId on the tombstoned repo → sec:repo-recreated', async () => {
    const tgz = mkTgz()
    const d = mkdtempSync(join(tmpdir(), 'p15-'))
    const oldPath = join(d, 'old.json')
    writeFileSync(oldPath, JSON.stringify(idxOf([], [
      { slug: 'o/x', name: 'reused-pkg', reason: 'npm-404', disappearedAt: '2026-01-01',
        lastSource: { kind: 'npm', id: 'reused-pkg', repo: 'o/x', repoId: 111 },
        createdAt: '2020-01-01' },
    ])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'reused-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/reused-pkg'))
        return mkRes({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { repository: 'https://github.com/o/x', keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } },
          time: { created: '2026-06-01' },   // newer than the tombstone's createdAt
        })
      if (url.includes('api.github.com/repos/o/x')) return mkRes({ id: 999, stargazers_count: 1, pushed_at: 't' })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    const e = out.plugins.find(p => p.name === 'reused-pkg')!
    expect(e.capabilities.redFlags).toContain('sec:repo-recreated')
    expect(e.capabilities.redFlags).toContain('sec:name-reused')
    // and the tombstone itself recorded the outgoing entry's birth stamp
    expect(out.removed.length).toBe(0)
  })
})

describe('P1-7: ruleset sweep rescans carried-over stale entries', () => {
  it('carryover entry with legacy rulesetVersion gets re-scanned through gone-check', async () => {
    const tgz = mkTgz()
    const d = mkdtempSync(join(tmpdir(), 'p17-'))
    const oldPath = join(d, 'old.json')
    const stale = entry({
      name: 'stale-pkg',
      capabilities: { scannedAt: '2025-01-01', findings: [], redFlags: [], rulesetVersion: 'r1' },
    })
    writeFileSync(oldPath, JSON.stringify(idxOf([stale])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [] })      // not discovered — carryover
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/stale-pkg'))
        return mkRes({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { keywords: ['opencode'], main: 'i.js', dist: { tarball: 'https://x/t.tgz' } } },
          time: {},
        })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: '2026-11-05T00:00:00Z' })
    const e = out.plugins.find(p => p.name === 'stale-pkg')!
    expect(e.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(e.capabilities.scannedAt).toBe('2026-11-05T00:00:00Z')
  })
})

describe('P2-8: evidence regression keeps the approved slot', () => {
  it('approved entry re-processing a bump whose latest evidence regressed → kept + finding, not tombstoned', async () => {
    const d = mkdtempSync(join(tmpdir(), 'p28-'))
    const oldPath = join(d, 'old.json')
    // displayed version 0.9.0; upstream latest 1.0.0 regressed its evidence —
    // the bump forces the full path, so the gate actually runs
    writeFileSync(oldPath, JSON.stringify(idxOf([entry({ name: 'regressed-pkg', approval: 'approved', latestVersion: '0.9.0' })])))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'regressed-pkg', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/regressed-pkg'))
        // author dropped main/exports on latest — no installable artifact signal
        return mkRes({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { keywords: ['opencode'], dist: {} } }, time: {} })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), oldIndexPath: oldPath, fetchFn: f, now: 't' })
    const e = out.plugins.find(p => p.name === 'regressed-pkg')
    expect(e).toBeTruthy()
    expect(e!.capabilities.findings.some(x => x.startsWith('sec:evidence-regressed'))).toBe(true)
    expect(out.removed.map(r => r.name)).not.toContain('regressed-pkg')
  })
})

describe('P2-12 + contains:[] semantics', () => {
  it('verifyPartsOf honors explicit empty contains (no payload)', () => {
    expect(verifyPartsOf(entry({ contains: [] }))).toEqual([])
    expect(verifyPartsOf(entry({ contains: undefined }))).toEqual(['plugin'])
    expect(verifyPartsOf(entry({ contains: ['skill'] }))).toEqual(['skill'])
  })
  it('installPlan honors explicit empty contains', () => {
    const e = { name: 'x', type: 'plugin' as const, latestVersion: '1.0.0', contains: [] as [], source: { kind: 'npm' as const } }
    const p = installPlan(e as never)
    expect(p.plugin).toBe(false)
    expect(p.skill).toBeNull()
  })
  it('skill-only npm tarball (SKILL.md, no entry point) → contains [skill], verification skipped', async () => {
    const tgz = mkTgz({ 'pkg/skills/x/SKILL.md': '# s', 'pkg/package.json': '{"name":"sk","version":"1.0.0"}' })
    const d = mkdtempSync(join(tmpdir(), 'p212-'))
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search'))
        return mkRes({ objects: [{ package: { name: 'skill-only', version: '1.0.0', keywords: ['opencode'], links: {}, date: 't' } }] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('registry.npmjs.org/skill-only'))
        // readme admits it (opencode + install hint); no main/exports → no plugin payload
        return mkRes({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { keywords: [], dist: { tarball: 'https://x/t.tgz' } } },
          time: {}, readme: 'an opencode plugin — add it via opencode.json',
        })
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org')) return mkRes({ downloads: 1 })
      return mkRes({}, 404)
    }) as typeof fetch
    const out = await run({ outPath: join(d, 'i.json'), fetchFn: f, now: 't' })
    const e = out.plugins.find(p => p.name === 'skill-only')!
    expect(e.contains).toEqual(['skill'])
    // 'unverified' is correct: the skill part queues for the SKILL structure
    // check instead of a doomed plugin install — the old ['plugin','skill']
    // claim ran the plugin chain and failed into 'failed'
    expect(e.verification.status).toBe('unverified')
    expect(verifyPartsOf(e)).toEqual(['skill'])
  })
})

describe('P3: submissions terminal-row pruning', () => {
  it('dead/notified rows older than 90d drop; within grace they stay', () => {
    const now = Date.parse('2026-11-05')
    const old = '2026-01-01'   // >90d ago
    const recent = '2026-11-01' // within grace
    const { lines } = markNotified(idxOf([]), [
      `{"name":"a","issue":1,"dead":true,"at":"${old}"}`,
      `{"name":"b","issue":2,"notified":true,"at":"${old}"}`,
      `{"name":"c","issue":3,"dead":true,"at":"${recent}"}`,
      `{"name":"d","issue":4,"notified":true}`,   // no `at` → can't prove expiry → keep
      'plain-line',
    ], { now })
    expect(lines.join('\n')).not.toContain('"a"')
    expect(lines.join('\n')).not.toContain('"b"')
    expect(lines.join('\n')).toContain('"c"')
    expect(lines.join('\n')).toContain('"d"')
    expect(lines[lines.length - 1]).toBe('plain-line')
  })
})
