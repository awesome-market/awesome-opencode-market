// coverage11 — fourth edge batch, post-ingestion-audit code: compatStrings,
// versionCmp prerelease semantics, dedupeSlugs, trustFlags/mergeEntries
// identity-delta arms, fetchTarball manual redirect validation, plus residual
// small-file branches.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogIndex } from '../src/schema.ts'
import type { PluginEntry, AiVerdict } from '../src/schema.ts'
import { compatStrings, fetchTarball, fetchPackument, fetchDownloads30d } from '../pipeline/fetch/npm.ts'
import { versionCmp, dedupeSlugs, mergeEntries, trustFlags, buildIndex } from '../pipeline/publish/merge.ts'
import { planTargets, verifyPartsOf, hostStaleVerify } from '../pipeline/verify/plan.ts'
import { sections, parseSubmission } from '../pipeline/submission.ts'
import { backfill } from '../pipeline/backfill.ts'
import { searchByKeyword } from '../pipeline/discover/npm.ts'
import { searchTopic } from '../pipeline/discover/github.ts'
import { repoToNpm, filterByStars } from '../pipeline/discover/seed.ts'
import { main as reFeaturesMain } from '../pipeline/re-features.ts'
import { renderDigest } from '../pipeline/ai/digest.ts'
import { isDupVerdict, amendAt, resolveVerdictEvent } from '../pipeline/human-verdict.ts'
import { applyMatureVerdicts, akey, vkey, latestVerdicts, explainEntry } from '../pipeline/verdicts.ts'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { remerge } from '../pipeline/remerge.ts'
import type { DigestState } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
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

afterEach(() => { vi.unstubAllGlobals() })

describe('compatStrings matrix', () => {
  it('string/object/array/empty engines + peer object edges + length caps', () => {
    expect(compatStrings('>=18', undefined)).toEqual({ engines: '>=18' })
    expect(compatStrings('   ', undefined)).toEqual({})               // whitespace-only → skipped
    expect(compatStrings({ node: '>=18', npm: '^9', bad: 1 }, undefined))
      .toEqual({ engines: 'node >=18; npm ^9' })                      // non-string values filtered
    expect(compatStrings({ a: 1, b: 2 }, undefined)).toEqual({})       // all filtered → s='' → skip
    expect(compatStrings(['x'], undefined)).toEqual({})               // array → not plain object
    expect(compatStrings(42, undefined)).toEqual({})                  // non-string non-object
    expect(compatStrings(undefined, { react: '^18', lodash: '~4' }))
      .toEqual({ peer: 'react@^18, lodash@~4' })
    expect(compatStrings(undefined, ['a'])).toEqual({})               // peer array skipped
    expect(compatStrings(undefined, 'str')).toEqual({})               // peer string skipped
    expect(compatStrings(undefined, { x: 1 })).toEqual({})            // peer all-filtered
    // length caps: engines 400→300, peer 600→500
    const longEng = 'e'.repeat(400)
    const r1 = compatStrings(longEng, undefined)
    expect(r1.engines!.length).toBe(300)
    const longPeer = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(20)]))
    const r2 = compatStrings(undefined, longPeer)
    expect(r2.peer!.length).toBeLessThanOrEqual(500)
  })
})

describe('versionCmp prerelease semantics', () => {
  it('release > prerelease, identifier-list length, numeric<alpha, string order', () => {
    expect(versionCmp(null, '1.0.0')).toBe(0)
    expect(versionCmp('1.0.0', '')).toBe(0)
    expect(versionCmp('abc', '1.0.0')).toBe(0)                        // NaN core → 0
    expect(versionCmp('1.0.0', '1.0.0-rc.9')).toBe(1)                 // release > own prerelease
    expect(versionCmp('1.0.0-rc.9', '1.0.0')).toBe(-1)
    expect(versionCmp('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)        // shorter id list <
    expect(versionCmp('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1)
    expect(versionCmp('1.0.0-1', '1.0.0-alpha')).toBe(-1)              // numeric < alphanumeric
    expect(versionCmp('1.0.0-alpha', '1.0.0-1')).toBe(1)
    expect(versionCmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1)           // string order
    expect(versionCmp('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)     // numeric compare not lex
    expect(versionCmp('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0)
    expect(versionCmp('1.2.0', '1.10.0')).toBe(-1)
    expect(versionCmp('2.0', '1.9.9')).toBe(1)
    expect(versionCmp('1.0', '1.0.1')).toBe(-1)                       // missing core segment = 0
    expect(versionCmp('1.0.0-x-y-z', '1.0.0-x-y-z')).toBe(0)
  })
})

describe('dedupeSlugs collision healing', () => {
  it('canonical survivor keeps slug; losers get name-slug + alias + --N suffix', () => {
    const a = mkEntry('Foo/Bar', { slug: 'dup', name: 'Foo/Bar' })
    const b = mkEntry('baz-qux', { slug: 'dup', name: 'baz-qux' })
    const c = mkEntry('baz-qux', { slug: 'dup', name: 'baz-qux' })    // same name → same slug target
    const out = dedupeSlugs([a, b, c])
    const slugs = out.map(e => e.slug)
    expect(new Set(slugs).size).toBe(3)                                // all unique
    // canonical = entry whose slug===name-lowercase; none match → name-asc first ('baz-qux' < 'foo/bar')
    const canon = out.find(e => e.name === 'baz-qux')!
    expect(canon.slug).toBe('dup')                                     // canonical keeps colliding slug
    const losers = out.filter(e => e.slug !== 'dup')
    expect(losers.length).toBe(2)
    expect(losers.every(e => e.aliases.includes('dup'))).toBe(true)    // old slug preserved
    // single-entry groups untouched
    expect(dedupeSlugs([mkEntry('solo')])[0]!.slug).toBe('solo')
  })
})

describe('trustFlags + mergeEntries identity-delta arms', () => {
  it('name-reused/repo-recreated/maintainer-changed/version-rollback/delta-rule flags', () => {
    const prev = mkEntry('p', {
      firstSeenAt: '2020-01-01T00:00:00Z',
      createdAt: '2019-01-01T00:00:00Z',
      maintainers: ['a'],
      source: { kind: 'npm', id: 'p', repoId: 1 } as never,
      latestVersion: '2.0.0',
      capabilities: { scannedAt: 't', findings: ['rule:x'], redFlags: [], rulesetVersion: 'r1' },
    })
    const fresh = mkEntry('p', {
      createdAt: '2021-01-01T00:00:00Z',          // > firstSeenAt → sec:name-reused
      maintainers: ['b'],                          // changed → sec:maintainer-changed
      source: { kind: 'npm', id: 'p', repoId: 2 } as never,  // → sec:repo-recreated
      latestVersion: '1.0.0',                      // rollback vs prev 2.0.0 → sec:version-rollback
      capabilities: { scannedAt: 't', findings: ['rule:x', 'lifecycle-script:postinstall', 'newrule:z'], redFlags: [], rulesetVersion: 'r1' },
    })
    const tf = trustFlags(prev, fresh)
    expect(tf.redFlags).toContain('sec:name-reused')
    expect(tf.redFlags).toContain('sec:repo-recreated')
    expect(tf.redFlags).toContain('sec:version-rollback')
    expect(tf.findings).toContain('sec:maintainer-changed')
    expect(tf.redFlags).toContain('sec-delta:lifecycle-script')  // strong rule → redFlags
    expect(tf.findings).toContain('sec-delta:newrule')                // non-strong → findings
    // ruleset mismatch → no delta flags
    const tf2 = trustFlags(prev, { ...fresh, capabilities: { ...fresh.capabilities, rulesetVersion: 'r2' } })
    expect([...tf2.findings, ...tf2.redFlags].filter(f => f.startsWith('sec-delta:'))).toEqual([])
    // prev undefined → empty
    expect(trustFlags(undefined, fresh)).toEqual({ findings: [], redFlags: [] })
  })
  it('mergeEntries: verified+new-redFlags→skipped; verified+findings-only stays; prevVer layer restore', async () => {
    const { mergeResults } = await import('../pipeline/verify/merge.ts')
    // identity red flag on a VERIFIED displayed entry → verification downgraded to skipped
    const old = mkIdx([mkEntry('p', {
      approval: 'approved', firstSeenAt: '2020-01-01T00:00:00Z', createdAt: '2019-01-01T00:00:00Z',
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
    })])
    const fresh = mkEntry('p', {
      approval: 'approved', createdAt: '2021-01-01T00:00:00Z',   // name-reused red flag
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
    })
    const merged = mergeEntries([fresh], old, 'oc1', 'r1')
    expect(merged[0]!.capabilities.redFlags).toContain('sec:name-reused')
    expect(merged[0]!.verification.status).toBe('skipped')
    // findings-only (maintainer change) on verified → stays verified (no redFlags)
    const old2 = mkIdx([mkEntry('q', {
      approval: 'approved', maintainers: ['a'], firstSeenAt: '2020-01-01T00:00:00Z',
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
    })])
    const freshQ = mkEntry('q', {
      approval: 'approved', maintainers: ['b'],
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [], rulesetVersion: 'r1' },
    })
    const m2 = mergeEntries([freshQ], old2, 'oc1', 'r1')
    expect(m2[0]!.capabilities.findings).toContain('sec:maintainer-changed')
    expect(m2[0]!.verification.status).toBe('verified')
    // prevVer layer: same cacheKey+ruleset → remote verification/capabilities restored
    const old3 = mkIdx([mkEntry('v', {
      approval: 'approved', latestVersion: '1.0.0',
      verification: { status: 'verified', level: 'interactive', opencodeVersion: 'oc1', verifiedAt: 'old' },
      capabilities: { scannedAt: 't', findings: ['remote:f'], redFlags: [], rulesetVersion: 'r1' },
    })])
    const freshV = mkEntry('v', {
      approval: 'approved', latestVersion: '1.0.0',
      verification: { status: 'unverified' },
      capabilities: { scannedAt: 't', findings: ['fresh:f'], redFlags: [], rulesetVersion: 'r1' },
    })
    const m3 = mergeEntries([freshV], old3, 'oc1', 'r1')
    expect(m3[0]!.verification.status).toBe('verified')          // prevVer.verification restored
    expect(m3[0]!.capabilities.findings).toEqual(expect.arrayContaining(['remote:f', 'fresh:f']))
    // rulesetVersion mismatch → prevVer NOT applied (sameRuleset false)
    const old4 = mkIdx([mkEntry('w', {
      approval: 'approved', latestVersion: '1.0.0',
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      capabilities: { scannedAt: 't', findings: ['remote:w'], redFlags: [], rulesetVersion: 'OLD' },
    })])
    const m4 = mergeEntries([mkEntry('w', { approval: 'approved', latestVersion: '1.0.0', capabilities: { scannedAt: 't', findings: ['fresh:w'], redFlags: [], rulesetVersion: 'r1' } })], old4, 'oc1', 'r1')
    expect(m4[0]!.verification.status).toBe('verified')           // verification layer restores regardless
    expect(m4[0]!.capabilities.findings).not.toContain('remote:w') // capabilities merge gated by sameRuleset
    // duplicate names inside OLD index → oldByName second hit
    const dupOld = mkIdx([mkEntry('dd', { approval: 'pending' }), mkEntry('dd', { approval: 'approved' })])
    const m5 = mergeEntries([mkEntry('dd', { approval: 'pending' })], dupOld, 'oc1', 'r1')
    expect(m5.length).toBe(1)
    void mergeResults
  })
})

describe('fetchTarball manual redirect validation', () => {
  const redir = (loc: string | null, status = 302) =>
    new Response(null, { status, headers: loc ? { location: loc } : {} })
  it('follows https redirects (relative+absolute), rejects downgrade/missing/malformed/chain', async () => {
    // happy path: 302 relative → 200 small body
    let calls = 0
    const ok = await fetchTarball('https://r/a.tgz', {
      maxBytes: 1024,
      fetchFn: (async (u: unknown) => {
        calls++
        const s = String(u)
        if (s.endsWith('/a.tgz')) return redir('/b.tgz')
        if (s.endsWith('/b.tgz')) return new Response(new Uint8Array([1, 2, 3]))
        return mkRes('nf', 404)
      }) as typeof fetch,
    })
    expect(ok.length).toBe(3)
    expect(calls).toBe(2)
    // absolute https redirect
    const ok2 = await fetchTarball('https://r/a.tgz', {
      maxBytes: 1024,
      fetchFn: (async (u: unknown) => String(u).endsWith('/a.tgz') ? redir('https://cdn.r/b.tgz') : new Response(new Uint8Array([9]))) as typeof fetch,
    })
    expect(ok2.length).toBe(1)
    // >5 hops → too long
    let hop = 0
    await expect(fetchTarball('https://r/a.tgz', {
      maxBytes: 1024,
      fetchFn: (async () => redir(`https://r/h${hop++}.tgz`)) as typeof fetch,
    })).rejects.toThrow('too long')
    // redirect without Location
    await expect(fetchTarball('https://r/a.tgz', {
      fetchFn: (async () => redir(null)) as typeof fetch,
    })).rejects.toThrow('without Location')
    // non-https redirect target
    await expect(fetchTarball('https://r/a.tgz', {
      fetchFn: (async () => redir('http://evil/x.tgz')) as typeof fetch,
    })).rejects.toThrow('non-https')
    // malformed location
    await expect(fetchTarball('https://r/a.tgz', {
      fetchFn: (async () => redir('http://[::1')) as typeof fetch,
    })).rejects.toThrow('malformed')
    // non-ok final → fetch failed
    await expect(fetchTarball('https://r/a.tgz', {
      fetchFn: (async () => mkRes('nf', 500)) as typeof fetch,
    })).rejects.toThrow('fetch failed')
    // content-length over cap → too large (before body read)
    await expect(fetchTarball('https://r/a.tgz', {
      maxBytes: 10,
      fetchFn: (async () => new Response(new Uint8Array([1]), { headers: { 'content-length': '999' } })) as typeof fetch,
    })).rejects.toThrow('too large')
    // stream body exceeding cap mid-read
    const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); c.close() } })
    await expect(fetchTarball('https://r/a.tgz', {
      maxBytes: 10,
      fetchFn: (async () => new Response(stream)) as typeof fetch,
    })).rejects.toThrow('too large')
    // malformed entry URL → malformed error; non-https entry URL → https error
    await expect(fetchTarball('not a url')).rejects.toThrow('malformed')
    await expect(fetchTarball('http://r/a.tgz')).rejects.toThrow('must be https')
    // arrayBuffer fallback (!reader path): Response with null body status? use text body w/o stream — jsdom Response always has reader; simulate via object cast
    const fakeRes = { ok: true, status: 200, headers: new Headers({ 'content-length': '3' }), body: null, arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer } as unknown as Response
    const fb = await fetchTarball('https://r/a.tgz', { maxBytes: 100, fetchFn: (async () => fakeRes) as typeof fetch })
    expect(fb.length).toBe(3)
    const fakeBig = { ...fakeRes, arrayBuffer: async () => new Uint8Array(50).buffer } as unknown as Response
    await expect(fetchTarball('https://r/a.tgz', { maxBytes: 10, fetchFn: (async () => fakeBig) as typeof fetch })).rejects.toThrow('too large')
  })
})

describe('planTargets retest mode + residual small branches', () => {
  it('retest bypasses verifyQueued → no-parts entries still filtered at parts gate', async () => {
    const noparts = mkEntry('np', { contains: [] as never, approval: 'pending' })
    const skillOnly = mkEntry('sk', { contains: ['skill'] as never, approval: 'pending' })
    const targets = planTargets(mkIdx([noparts, skillOnly]), 48, true)   // retest=true
    expect(targets.every(t => t.name !== 'np')).toBe(true)
    expect(targets.some(t => t.name === 'sk')).toBe(true)
    // verifyPartsOf: on an APPROVED entry pendingUpdate.contains wins over
    // entry.contains — the hold IS the candidate under review there. (On a
    // PENDING entry the slot rule makes the entry itself the candidate, so
    // a leftover hold's parts must NOT win — audit-verify-r3.test.ts.)
    const held = mkEntry('h', {
      contains: ['plugin'] as never, approval: 'approved',
      pendingUpdate: { version: '2.0.0', heldAt: 't', reason: 'r', contains: ['skill'] as never,
        capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never,
    })
    expect(verifyPartsOf(held)).toEqual(['skill'])
  })
  it('submission sections: header without trailing newline skipped (nl<0)', () => {
    expect(sections('### lone-header').size).toBe(0)
    expect(sections('### H\nvalue\n### tail-no-nl').get('H')).toBe('value')
    const sub = parseSubmission('### repo\n\nhttps://github.com/o/r\n')
    expect(sub.repo).toBe('o/r')
  })
  it('backfill: entry WITH maintainers keeps them (if[1] else arm)', async () => {
    const e = mkEntry('m', { maintainers: ['keep@x'] })
    const out = await backfill(mkIdx([e]), {
      fetchFn: (async (u: unknown) => {
        const s = String(u)
        if (s.includes('registry.npmjs.org'))
          return mkRes({ 'dist-tags': { latest: '1.0.0' }, time: { created: 'x', modified: 'y' },
            versions: { '1.0.0': { version: '1.0.0' } }, maintainers: [{ name: 'new@x' }] })
        return mkRes('nf', 404)
      }) as typeof fetch,
    })
    expect(out.plugins[0]!.maintainers).toEqual(['keep@x'])
  })
  it('discover/seed fetchFn-default arms via stubbed global fetch', async () => {
    vi.stubGlobal('fetch', (async (u: unknown) => {
      const s = String(u)
      if (s.includes('api.github.com/repos/')) return mkRes({ stargazers_count: 5, archived: false, default_branch: 'main' })
      if (s.includes('raw.githubusercontent.com')) return mkRes({ name: 'rn' })
      if (s.includes('api.github.com/search')) return mkRes({ items: [] })
      if (s.includes('registry.npmjs.org')) return mkRes({ objects: [] })
      return mkRes('nf', 404)
    }) as typeof fetch)
    await repoToNpm('o/r')
    await filterByStars(['o/r'], 1)
    await searchByKeyword('k')
    await searchTopic('t')
    await backfill(mkIdx([mkEntry('p')]))
    await fetchPackument('p')
    await fetchDownloads30d('p')
  })
})

describe('re-features same/sameSet/githubCleared residual arms', () => {
  it('reorder-only detection + features-undefined ?? arms + github clear without features', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf11-'))
    const f = join(dir, 'i.json')
    const raw = (name: string, over: Record<string, unknown> = {}) => ({
      name, slug: name, aliases: [], type: 'plugin', discoveredVia: [],
      source: { kind: 'npm', id: name }, description: { en: 'd' }, category: [],
      license: null, deprecated: false, replacement: null, deprecatedMessage: null,
      createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
      firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
      metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, compat: {}, approval: 'approved',
      ...over,
    })
    // entry A: old features ['tui','server'] vs detected ['server','tui'] → sameSet reorder
    // entry B: features undefined → ?? [] arms in same/sameSet
    // entry C: github kind, features undefined → ?? 0 → no clear (stays undefined)
    const eA = raw('reord', { features: ['tui', 'server'] })
    const eB = raw('nofeat')   // no features field at all
    const eC = raw('gh2', { source: { kind: 'github', id: 'o/r', repo: 'o/r' }, type: 'skill' })  // no features → ?? 0
    const eD = raw('gh3', { source: { kind: 'github', id: 'o/r2', repo: 'o/r2' }, type: 'skill', features: ['tui'] })
    writeFileSync(f, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: [eA, eB, eC, eD], removed: [] }))
    const pack = { versions: { '1.0.0': { version: '1.0.0', main: 'i.js', exports: { './tui': './t.js' } } } }
    const out = await reFeaturesMain(f, {
      dry: true,
      fetchFn: (async (u: unknown) => {
        const s = String(u)
        if (s.includes('registry.npmjs.org')) return mkRes(pack)
        return mkRes('nf', 404)
      }) as typeof fetch,
    })
    expect(out.reorderOnly).toBeGreaterThanOrEqual(1)
    expect(out.githubCleared).toBe(1)   // only eD had features to clear
  })
})

describe('digest/human-verdict/verdicts residual arms', () => {
  it('digest: pendingUpdate version arm + non-pass phase + version-null verdict row + arg parse', async () => {
    const prev: DigestState = { lastDigestAt: '2026-01-01T00:00:00Z', announced: [], day: '2026-01-01', dayAnnounced: [] }
    const held = (n: string, over: Record<string, unknown> = {}) => mkEntry(n, {
      approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, ...over,
    } as Partial<PluginEntry>)
    // approval:'approved' — a pendingUpdate only describes the candidate on a
    // displayed entry; on a pending entry it's the B3 inverted state and the
    // digest must show latestVersion instead (audit #6)
    const pu = held('pu', { approval: 'approved', latestVersion: '9.9.9', pendingUpdate: { version: '2.0.0', heldAt: 't', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never })
    const concern = held('cc')
    const idx = mkIdx([pu, concern])
    const vs: AiVerdict[] = [
      verdict({ name: 'cc', version: '1.0.0', verdict: 'concern', reason: 'r', at: '2026-01-02T00:00:00Z' }),
      verdict({ name: 'ghost', version: null, verdict: 'pass', source: 'human', reason: 'pkg brake', at: '2026-01-02T00:00:00Z' }),
    ]
    const md = renderDigest({ index: idx, verdicts: vs, prev, now: new Date('2026-01-03T00:00:00Z') })
    expect(md).toContain('v2.0.0')     // pendingUpdate slot version surfaces
    expect(md).toContain('—')          // version-null verdict row
  })
  it('human-verdict: mismatch w/o version + isDupVerdict/amendAt edge arms', async () => {
    const ev = (over: Record<string, unknown>) => ({
      event: 'issue_comment', action: 'created', issueTitle: '[review] pkg@1.0.0',
      issueBody: '', issueNumber: 9, actor: 'u', label: '', commentBody: '', ...over,
    }) as never
    // '/concern owner/repo' — slash spec, no version → mismatch msg w/o @ver
    const r = resolveVerdictEvent(ev({ commentBody: '/concern other/repo wrong target' }))
    expect(r.mismatch).toContain('other/repo')
    // isDupVerdict: JSON-parse-error line skipped; version-null match; reason normalize
    const lines = [
      '{bad json',
      JSON.stringify(verdict({ name: 'a', version: null, verdict: 'pass', source: 'human', reason: 'multi\nline', at: 't' })),
      JSON.stringify(verdict({ name: 'a', version: '1.0.0', verdict: 'pass', source: 'ai', reason: 'x', at: 't' })),
    ]
    expect(isDupVerdict(lines, 'a', null, 'pass', 'multi line')).toBe(true)   // oneLine normalize both sides
    expect(isDupVerdict(lines, 'a', '1.0.0', 'pass', 'x')).toBe(false)        // ai source → not dup
    // amendAt: latest line is AI → null; blank-only → null
    expect(amendAt(lines, 'a', '1.0.0', 'pass', 'y')).toBeNull()
    expect(amendAt(['', '  '], 'a', null, 'pass', 'r')).toBeNull()
  })
  it('verdicts: latestVerdicts replace-order + explainEntry packageBrake override + reason-less why', async () => {
    // second OLDER verdict must not replace newer (if[1] false arm both orders)
    const n = verdict({ at: '2026-01-02T00:00:00Z', verdict: 'concern' })
    const o = verdict({ at: '2026-01-01T00:00:00Z', verdict: 'pass' })
    expect(latestVerdicts([n, o]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    expect(latestVerdicts([o, n]).get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    // human pass NEWER than package brake on same slot → brake dissolved (334 if[0])
    const pkgBrake = verdict({ name: 'pb', version: null, verdict: 'concern', source: 'human', reason: 'pkg', at: '2026-01-01T00:00:00Z' })
    const slotPass = verdict({ name: 'pb', version: '1.0.0', verdict: 'pass', source: 'human', at: '2026-01-09T00:00:00Z' })
    const pb = mkEntry('pb', { approval: 'pending' })
    const announced = [akey(pkgBrake), akey(slotPass)]
    const dg = { lastDigestAt: 't', announced, day: 'd', dayAnnounced: announced } as DigestState
    const slots = explainEntry(pb as never, [pkgBrake, slotPass], dg)
    expect(slots[0]!.verdict).toBe('pass')
    // applyMatureVerdicts: pending+concern SAME reason → held NOT pushed (reason unchanged arm)
    const pen = mkEntry('pn', { approval: 'pending', approvalReason: 'same' })
    const vc = verdict({ name: 'pn', version: '1.0.0', verdict: 'concern', source: 'human', reason: 'same', at: '2026-01-05T00:00:00Z' })
    const r = applyMatureVerdicts(mkIdx([pen]), [vc], { lastDigestAt: 't', announced: [akey(vc)], day: 'd', dayAnnounced: [akey(vc)] } as DigestState)
    expect(r.held).toEqual([])
    // legacy + concern → pending w/ reason (253/256 ?? 'null' arms need latestVersion null)
    const gh = mkEntry('gh', { latestVersion: null, source: { kind: 'github', id: 'o/r', repo: 'o/r' } })
    const vg = verdict({ name: 'gh', version: null, verdict: 'concern', source: 'human', reason: 'r', at: '2026-01-05T00:00:00Z' })
    const r2 = applyMatureVerdicts(mkIdx([gh]), [vg], { lastDigestAt: 't', announced: [akey(vg)], day: 'd', dayAnnounced: [akey(vg)] } as DigestState)
    expect(r2.held).toContain('gh@null')
  })
})

describe('scan/remerge residuals', () => {
  it('scanTarball: media-extension file skipped from body buffering; remerge ?? arms', async () => {
    // tar with a .png (media → skipBody) + a .js (text)
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
    const { gzipSync } = await import('node:zlib')
    const tar = Buffer.concat([
      tarEntry('package/logo.png', Buffer.alloc(100, 7)),
      tarEntry('package/index.js', Buffer.from('module.exports = 1')),
      Buffer.alloc(1024),
    ])
    const r = await scanTarball(gzipSync(tar))
    expect(r.files).toContain('package/index.js')
    expect(r.files).toContain('package/logo.png')
    // remerge with category-undefined entries → ?? [] arms
    const idx = mkIdx([mkEntry('p')])
    const out = remerge(idx, idx)
    expect(out).toBeTruthy()
  })
})
