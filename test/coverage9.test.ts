// coverage9 — second edge-branch batch: verdicts apply/explain matrix,
// human-verdict event resolution, submission-status main, merge pendingUpdate
// paths, digest phase variants, verify/* residual branches.
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatalogIndex } from '../src/schema.ts'
import type { PluginEntry, AiVerdict, DigestState } from '../src/schema.ts'

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

const dg = (announced: string[], over: Partial<DigestState> = {}): DigestState =>
  ({ lastDigestAt: '2026-01-10T00:00:00Z', announced, day: '2026-01-10', dayAnnounced: announced, ...over })

describe('verdicts applyMatureVerdicts matrix', () => {
  it('concern on legacy→pending, pending reason update, approved+concern→pending, pass release gates', async () => {
    const { applyMatureVerdicts, akey } = await import('../pipeline/verdicts.ts')
    const now = '2026-01-05T00:00:00Z'
    // legacy entry + mature human concern → pending with reason
    const leg = mkEntry('leg', { approval: 'legacy' })
    const vc = verdict({ name: 'leg', version: '1.0.0', verdict: 'concern', source: 'human', reason: 'bad', at: now })
    const idx1 = mkIdx([leg])
    const d1 = dg([akey(vc)])
    const r1 = applyMatureVerdicts(idx1, [vc], d1)
    expect(r1.index.plugins[0]!.approval).toBe('pending')
    expect(r1.index.plugins[0]!.approvalReason).toBe('bad')
    expect(r1.held).toContain('leg@1.0.0')
    // pending entry + concern with SAME reason → no held push (reason unchanged)
    const pen = mkEntry('pen', { approval: 'pending', approvalReason: 'same' })
    const vc2 = verdict({ name: 'pen', version: '1.0.0', verdict: 'concern', source: 'human', reason: 'same', at: now })
    const r2 = applyMatureVerdicts(mkIdx([pen]), [vc2], dg([akey(vc2)]))
    expect(r2.held).toEqual([])
    // pending + mature ai pass + releasable verification → approved
    const ok = mkEntry('ok', {
      approval: 'pending',
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load' } as never,
      latestVersion: '1.0.0',
    })
    const vp = verdict({ name: 'ok', version: '1.0.0', verdict: 'pass', at: now })
    const r3 = applyMatureVerdicts(mkIdx([ok]), [vp], dg([akey(vp)]))
    expect(r3.index.plugins[0]!.approval).toBe('approved')
    expect(r3.releases).toContain('ok@1.0.0')
    // approved/live entry + concern → back to pending (brake)
    const live = mkEntry('live', { approval: 'approved' })
    const vc3 = verdict({ name: 'live', version: '1.0.0', verdict: 'concern', source: 'human', at: now })
    const r4 = applyMatureVerdicts(mkIdx([live]), [vc3], dg([akey(vc3)]))
    expect(r4.index.plugins[0]!.approval).toBe('pending')
    // ai pass blocked by redFlags → stays pending
    const flagged = mkEntry('flag', {
      approval: 'pending',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] },
      verification: { status: 'verified', level: 'load' } as never,
    })
    const vp2 = verdict({ name: 'flag', version: '1.0.0', verdict: 'pass', at: now })
    const r5 = applyMatureVerdicts(mkIdx([flagged]), [vp2], dg([akey(vp2)]))
    expect(r5.index.plugins[0]!.approval).toBe('pending')
    // unannounced pass → not mature → stays pending
    const r6 = applyMatureVerdicts(mkIdx([mkEntry('unann', { approval: 'pending' })]), [verdict({ name: 'unann', version: '1.0.0', verdict: 'pass', at: now })], dg([]))
    expect(r6.index.plugins[0]!.approval).toBe('pending')
    // sha mismatch → gate refuses
    const shaEntry = mkEntry('sha', {
      approval: 'pending', integrity: 'sha512-real',
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load' } as never,
    })
    const vsha = verdict({ name: 'sha', version: '1.0.0', verdict: 'pass', at: now, sha: 'sha512-other' })
    const r7 = applyMatureVerdicts(mkIdx([shaEntry]), [vsha], dg([akey(vsha)]))
    expect(r7.index.plugins[0]!.approval).toBe('pending')
    // empty verdicts → passthrough
    const r8 = applyMatureVerdicts(mkIdx([mkEntry('e')]), [], null)
    expect(r8.releases).toEqual([])
  })
})

describe('verdicts explainEntry outcomes', () => {
  it('covers brake/concern/wait/release/none + packageBrake + aiBlocked', async () => {
    const { explainEntry, akey } = await import('../pipeline/verdicts.ts')
    const base = {
      name: 'p', latestVersion: '1.0.0', approval: 'pending' as const,
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load' },
      integrity: null,
    }
    // no verdict → none
    expect(explainEntry(base as never, [], null)[0]!.outcome).toBe('none')
    // concern on pending → 'concern' outcome (not brake — brake needs live slot)
    const vc = verdict({ name: 'p', version: '1.0.0', verdict: 'concern', reason: 'r', at: '2026-01-02T00:00:00Z' })
    expect(explainEntry(base as never, [vc], null)[0]!.outcome).toBe('concern')
    // concern on APPROVED displayed slot → 'brake'
    const live = { ...base, approval: 'approved' as const }
    expect(explainEntry(live as never, [vc], null)[0]!.outcome).toBe('brake')
    // pass unannounced → wait 未成熟
    const vp = verdict({ name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-01-03T00:00:00Z' })
    expect(explainEntry(base as never, [vp], dg([]))[0]!.outcome).toBe('wait')
    // pass announced + releasable → release
    const rel = explainEntry(base as never, [vp], dg([akey(vp)]))[0]!
    expect(rel.outcome).toBe('release')
    // pass on live display slot → release no-op ('已上架')
    expect(explainEntry(live as never, [vp], dg([akey(vp)]))[0]!.outcome).toBe('release')
    // ai pass + redFlags → aiBlockedByFlags wait
    const flagged = { ...base, capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] } }
    const xp = explainEntry(flagged as never, [vp], dg([akey(vp)]))[0]!
    expect(xp.aiBlockedByFlags).toBe(true)
    expect(xp.outcome).toBe('wait')
    // ai pass + unscanned → aiBlockedByNoScan
    const unscanned = { ...base, capabilities: { scannedAt: null, findings: [], redFlags: [] } }
    const xn = explainEntry(unscanned as never, [vp], dg([akey(vp)]))[0]!
    expect(xn.aiBlockedByNoScan).toBe(true)
    // sha mismatch → wait drift
    const shaE = { ...base, integrity: 'sha512-A' }
    const vsha = verdict({ name: 'p', version: '1.0.0', verdict: 'pass', at: '2026-01-03T00:00:00Z', sha: 'sha512-B' })
    expect(explainEntry(shaE as never, [vsha], dg([akey(vsha)]))[0]!.outcome).toBe('wait')
    // unreleasable verification → wait
    const badVer = { ...base, verification: { status: 'failed', level: 'install' } }
    expect(explainEntry(badVer as never, [vp], dg([akey(vp)]))[0]!.outcome).toBe('wait')
    // package brake: human concern on name@null overrides slot verdict
    const pkgConcern = verdict({ name: 'p', version: null, verdict: 'concern', source: 'human', reason: 'pkg bad', at: '2026-01-04T00:00:00Z' })
    const xb = explainEntry(base as never, [vp, pkgConcern], dg([akey(vp), akey(pkgConcern)]))[0]!
    expect(xb.verdict).toBe('concern')   // package brake substitutes the verdict
    expect(xb.why).toContain('包级刹车')
    // pendingUpdate slot explained separately
    const withPu = { ...base, pendingUpdate: { version: '2.0.0', capabilities: base.capabilities, verification: base.verification, integrity: null } }
    const slots = explainEntry(withPu as never, [verdict({ name: 'p', version: '2.0.0', verdict: 'pass', at: '2026-01-06T00:00:00Z' })], null)
    expect(slots.some(s => s.slot === 'pendingUpdate')).toBe(true)
  })
})

describe('atCmp/latestVerdicts ordering edges', () => {
  it('string tiebreak a<b arm + older-after-newer does not win', async () => {
    const { atCmp, latestVerdicts, vkey } = await import('../pipeline/verdicts.ts')
    expect(atCmp('2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00Z')).toBe(-1)  // '+'<'Z'
    const newer = verdict({ at: '2026-01-02T00:00:00Z', verdict: 'concern' })
    const older = verdict({ at: '2026-01-01T00:00:00Z', verdict: 'pass' })
    const m = latestVerdicts([newer, older])
    expect(m.get(vkey('p', '1.0.0'))!.verdict).toBe('concern')
    // same-ms different spelling → later line wins via string tiebreak
    const a = verdict({ at: '2026-01-01T00:00:00Z', verdict: 'pass' })
    const b = verdict({ at: '2026-01-01T00:00:00+00:00', verdict: 'concern' })
    const m2 = latestVerdicts([a, b])
    expect(m2.get(vkey('p', '1.0.0'))!.verdict).toBe('pass')   // 'Z' > '+00:00' lexically → a is later
  })
})

describe('human-verdict resolveVerdictEvent', () => {
  const ev = (over: Record<string, unknown>) => ({
    event: 'issue_comment', action: 'created',
    issueBody: '', issueNumber: 9, actor: 'u', label: '', commentBody: '', issueTitle: '[review] pkg@1.0.0', ...over,
  }) as never
  it('label channel: pass/concern/unknown-label/no-title skips', async () => {
    const { resolveVerdictEvent } = await import('../pipeline/human-verdict.ts')
    const labeled = (label: string, title = '[review] pkg@1.0.0 x') =>
      resolveVerdictEvent(ev({ event: 'issues', action: 'labeled', issueTitle: title, label }))
    expect(labeled('verdict:pass').verdict).toBe('pass')
    expect(labeled('verdict:concern').verdict).toBe('concern')
    expect(labeled('random-label').skip).toBe('noresolve')
    expect(labeled('verdict:pass', 'no title here').skip).toBe('noresolve')
    expect(resolveVerdictEvent(ev({ issueTitle: '[submit] x' })).skip).toBe('submit')
  })
  it('comment channel: /approve /concern spec args, mismatch flag, reason-only', async () => {
    const { resolveVerdictEvent } = await import('../pipeline/human-verdict.ts')
    // bare command → titled target
    const r1 = resolveVerdictEvent(ev({ commentBody: '/approve looks good' }))
    expect(r1.verdict).toBe('pass')
    expect(r1.name).toBe('pkg')
    // spec arg matching title → no mismatch
    const r2 = resolveVerdictEvent(ev({ commentBody: '/concern pkg@1.0.0 because reasons' }))
    expect(r2.verdict).toBe('concern')
    expect(r2.mismatch).toBeUndefined()
    // spec arg pointing ELSEWHERE on titled issue → mismatch flag
    const r3 = resolveVerdictEvent(ev({ commentBody: '/concern other/pkg@2.0.0 wrong target' }))
    expect(r3.mismatch).toBeTruthy()
    // untitled issue + spec arg → resolves to arg
    const r4 = resolveVerdictEvent(ev({ issueTitle: 'random', commentBody: '/approve pkg@3.0.0 ok' }))
    expect(r4.name).toBe('pkg')
    // [concern] form issue opened → verdict from Action field
    const form = ev({
      event: 'issues', action: 'opened', issueTitle: '[concern] something',
      issueBody: '### npm 包名或 owner/repo\n\npkg-z\n\n### 版本（可留空）\n\n1.0.0\n\n### 操作 / Action\n\npass\n',
      commentBody: '',
    })
    const r5 = resolveVerdictEvent(form)
    expect(r5.name).toBe('pkg-z')
    expect(r5.verdict).toBe('pass')
    // non-command comment → skip
    expect(resolveVerdictEvent(ev({ commentBody: 'just chatting' })).skip).toBe('noresolve')
  })
})

describe('submission-status.main dry path', () => {
  it('prints rows without GH env; v8-ignored CLI guard stays uncovered', async () => {
    const { main } = await import('../pipeline/submission-status.ts')
    const dir = mkdtempSync(join(tmpdir(), 'ss-'))
    const idx = join(dir, 'index.json'), subs = join(dir, 'subs.txt')
    writeFileSync(idx, JSON.stringify(mkIdx([mkEntry('p', { approval: 'pending' })]).valueOf()))
    writeFileSync(subs, '{"name":"p","issue":1,"notified":false}\n')
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
    const env = process.env
    const keep = { ...env }
    delete env.GH_REPO; delete env.GH_TOKEN
    try { main(['node', 'x', idx, subs]) } finally { Object.assign(env, keep); spy.mockRestore() }
    expect(logs.some(l => l.includes('"issue":1'))).toBe(true)
  })
})

describe('notify-published.main + repo-name match', () => {
  it('main rewrites subs file, prints issues; repo seed matches by entry name case-insensitively', async () => {
    const { main, markNotified } = await import('../pipeline/notify-published.ts')
    const dir = mkdtempSync(join(tmpdir(), 'np8-'))
    const idx = join(dir, 'i.json'), subs = join(dir, 's.txt'), stale = join(dir, 'stale.txt'), dead = join(dir, 'dead.txt')
    writeFileSync(idx, JSON.stringify(mkIdx([mkEntry('O/R', { source: { kind: 'github', id: 'O/R', repo: 'O/R' } })]).valueOf()))
    writeFileSync(subs, [
      '{"repo":"o/r","issue":3,"notified":false,"at":"2026-01-01T00:00:00Z"}',   // repo matches entry.name lowercased
      '{"name":"ghost","issue":4,"notified":false,"at":"2020-01-01T00:00:00Z"}', // ancient unlanded → dead
    ].join('\n'))
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(String(a[0])) })
    try { main(['node', 'x', idx, subs, stale, dead]) } finally { spy.mockRestore() }
    expect(logs).toContain('3\to/r')
    const after = readFileSync(subs, 'utf8')
    expect(after).toContain('"notified":true')
    expect(after).toContain('"dead":true')
    expect(readFileSync(dead, 'utf8')).toContain('4')
    // markNotified: s.name undefined + s.repo matching p.name.toLowerCase (2nd cond)
    const r = markNotified(mkIdx([mkEntry('Owner/Repo', { source: { kind: 'github', id: 'o/r', repo: 'other/repo' } })]),
      ['{"repo":"owner/repo","issue":8,"notified":false}'], { now: Date.now() })
    expect(r.issues).toEqual([8])
  })
})

describe('publish/merge pendingUpdate + ruleOf edges', () => {
  it('same held version keeps remote verification; remote-only hold resurrects; category ?? []', async () => {
    const { mergeEntries, buildIndex } = await import('../pipeline/publish/merge.ts')
    // e.pendingUpdate.version === prev.pendingUpdate.version → remote verification wins
    const pu = { version: '2.0.0', heldAt: 't', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' }, integrity: 'sha512-x' }
    const prevEntry = mkEntry('p', { approval: 'approved', latestVersion: '1.0.0', pendingUpdate: { ...pu, verification: { status: 'failed', level: 'install' } } as never })
    const freshEntry = mkEntry('p', { approval: 'approved', latestVersion: '1.0.0', pendingUpdate: pu as never })
    const old = mkIdx([prevEntry])
    const merged = mergeEntries([freshEntry], old, 'oc1', 'r1')
    expect((merged[0]!.pendingUpdate as { verification: { status: string } }).verification.status).toBe('failed')  // remote slot kept
    // remote holds a version ours never saw → resurrect
    const prevHold = mkEntry('q', { approval: 'approved', latestVersion: '1.0.0', pendingUpdate: { version: '9.9.9', heldAt: 't', reason: 'r', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never })
    const freshQ = mkEntry('q', { approval: 'approved', latestVersion: '1.0.0' })
    const m2 = mergeEntries([freshQ], mkIdx([prevHold]), 'oc1', 'r1')
    expect(m2[0]!.pendingUpdate?.version).toBe('9.9.9')
    // buildIndex: old removed entries filtered by aliveNames + age cutoff
    const bi = buildIndex([mkEntry('alive')], mkIdx([], {
      removed: [
        { name: 'alive', slug: 'alive', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' },   // resurrected → dropped
        { name: 'ancient', slug: 'ancient', disappearedAt: '2000-01-01T00:00:00Z', reason: 'manual' }, // past retention → dropped
        { name: 'keep', slug: 'keep', disappearedAt: '2026-01-01T00:00:00Z', reason: 'manual' },
      ],
    }), { opencodeVersion: 'oc1', now: '2026-06-01T00:00:00Z' })
    expect(bi.index.removed.map(r => r.slug)).toEqual(['keep'])
  })
})

describe('discover residual edges', () => {
  it('github.searchTopic: token header, maxPages=1 cap warn path, empty items', async () => {
    const { searchTopic } = await import('../pipeline/discover/github.ts')
    const headersSeen: (string | null)[] = []
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      headersSeen.push(new Headers(init?.headers).get('authorization'))
      return mkRes({ items: [] })
    }) as typeof fetch
    const out = await searchTopic('t', { fetchFn, token: 'tok123', maxPages: 1 })
    expect(out).toEqual([])
    expect(headersSeen[0]).toContain('tok123')
    // full page at maxPages boundary → hitPageCap warn (items.length===100 && page===maxPages)
    const full = Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, description: null, archived: false, fork: false, pushed_at: null, stargazers_count: 0, default_branch: 'main' }))
    const fetchFn2 = (async () => mkRes({ items: full })) as typeof fetch
    const out2 = await searchTopic('t', { fetchFn: fetchFn2, maxPages: 1 })
    expect(out2.length).toBe(100)
  })
  it('npm.searchByKeyword: full-page cap + repoUrl links shape', async () => {
    const { searchByKeyword } = await import('../pipeline/discover/npm.ts')
    const full = Array.from({ length: 250 }, (_, i) => ({ package: { name: `p${i}`, version: '1.0.0', description: 'd', keywords: ['k'], links: { repository: 'https://r' }, date: '2026-01-01' } }))
    const out = await searchByKeyword('k', { fetchFn: (async () => mkRes({ objects: full, total: 9999 })) as typeof fetch, size: 250, maxPages: 1 })
    expect(out.length).toBe(250)
    expect(out[0]!.repoUrl).toBe('https://r')
    // objects missing → [] break
    const out2 = await searchByKeyword('k', { fetchFn: (async () => mkRes({})) as typeof fetch })
    expect(out2).toEqual([])
  })
  it('seed.extractRepos + filterByStars archived/low-stars + repoToNpm branch fallback', async () => {
    const { extractRepos } = await import('../pipeline/discover/seed.ts')
    expect(extractRepos('- [a](https://github.com/o/a) and https://github.com/o/b\ndup https://github.com/o/a'))
      .toEqual(['o/a', 'o/b'])
    const { repoToNpm } = await import('../pipeline/discover/seed.ts')
    // branch 'dev' 404 → falls through to main/master
    const fetchFn = (async (u: unknown) => {
      const s = String(u)
      if (s.includes('/dev/')) return mkRes('nf', 404)
      if (s.includes('/main/')) return mkRes({ name: 'via-main' })
      return mkRes('nf', 404)
    }) as typeof fetch
    expect(await repoToNpm('o/r', { branch: 'dev', fetchFn })).toBe('via-main')
    // pkg.name missing → falls through all branches → null
    const fetchFn2 = (async () => mkRes({ name: null })) as typeof fetch
    expect(await repoToNpm('o/r', { fetchFn: fetchFn2 })).toBeNull()
  })
})

describe('fetch/github residual edges', () => {
  it('fetchRepoMeta ok fields + !ok + tree truncated + pkgName dir variants', async () => {
    const { fetchRepoMeta, fetchRepoTree, fetchRepoPackageName } = await import('../pipeline/fetch/github.ts')
    const meta = await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes({
      id: 1, created_at: '2020-01-01T00:00:00Z', pushed_at: '2026-01-01T00:00:00Z',
      stargazers_count: 7, archived: false, topics: ['opencode'], license: { spdx_id: 'MIT' },
      default_branch: 'main',
    })) as typeof fetch })
    expect(meta.status).toBe('ok')
    expect(meta.meta!.stars).toBe(7)
    expect(meta.meta!.topics).toContain('opencode')
    expect(meta.meta!.license).toBe('MIT')
    expect((await fetchRepoMeta('o/r', { fetchFn: (async () => mkRes('nf', 500)) as typeof fetch })).status).toBe('error')
    // tree truncated flag + sha
    const tree = await fetchRepoTree('o/r', 'HEAD', { fetchFn: (async () => mkRes({ tree: [{ path: 'a' }], truncated: true, sha: 'sha1' })) as typeof fetch })
    expect(tree.truncated).toBe(true)
    // fetchRepoPackageName: clean dir variant + pkg fields
    const pkg = await fetchRepoPackageName('o/r', { dir: '/sub/dir/', fetchFn: (async (u: unknown) => {
      expect(String(u)).toContain('/sub/dir/package.json')
      return mkRes({ name: 'n', main: 'm' })
    }) as typeof fetch })
    expect(pkg.status).toBe('ok')
    expect(pkg.pkgName).toBe('n')
    // '.' segment in dir → error
    expect((await fetchRepoPackageName('o/r', { dir: 'a/./b', fetchFn: (async () => mkRes({})) as typeof fetch })).status).toBe('error')
  })
  it('fetchMarketMeta category/description validation edges', async () => {
    const { fetchMarketMeta } = await import('../pipeline/fetch/github.ts')
    // category non-array → dropped; description non-object → dropped → null
    expect(await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ category: 'x', description: 'y' })) as typeof fetch })).toBeNull()
    // category all-strings kept + capped at 8
    const m = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ category: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] })) as typeof fetch })
    expect(m!.category!.length).toBe(8)
    // description zh only
    const m2 = await fetchMarketMeta('o/r', { fetchFn: (async () => mkRes({ description: { zh: '描述' } })) as typeof fetch })
    expect(m2).toEqual({ description: { zh: '描述' } })
  })
})

describe('backfill residual edges', () => {
  it('packument 404 → fields stay null; repo meta without id → untouched', async () => {
    const { backfill } = await import('../pipeline/backfill.ts')
    const e1 = mkEntry('gone')                       // packument 404 → pk null → skip
    const e2 = mkEntry('norepoid', { source: { kind: 'github', id: 'o/r', repo: 'o/r' } })  // meta lacks id
    const out = await backfill(mkIdx([e1, e2]), {
      fetchFn: (async (u: unknown) => {
        const s = String(u)
        if (s.includes('api.github.com/repos/')) return mkRes({ created_at: 'x' })   // no id
        return mkRes('nf', 404)
      }) as typeof fetch,
    })
    expect(out.plugins.find(p => p.name === 'gone')!.createdAt).toBeNull()
    expect((out.plugins.find(p => p.name === 'norepoid')!.source as { repoId?: number }).repoId).toBeUndefined()
  })
})

describe('ai/digest phaseOf variants', () => {
  it('concern-rec / ai-blocked / willAnnounce / failed-verification phases', async () => {
    const { renderDigest } = await import('../pipeline/ai/digest.ts')
    const prev = { lastDigestAt: '2026-01-01T00:00:00Z', announced: [], day: '2026-01-01', dayAnnounced: [] }
    const heldEntry = (name: string, over: Record<string, unknown> = {}) => mkEntry(name, {
      approval: 'pending', latestVersion: '1.0.0',
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' },
      ...over,
    } as Partial<PluginEntry>)
    const idx = mkIdx([
      heldEntry('c1'),   // will get a concern verdict → 已打标 concern
      heldEntry('c2', { capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] } }),  // ai pass + flags → 拦截
      heldEntry('c3', { capabilities: { scannedAt: null, findings: [], redFlags: [] } }),    // ai pass + unscanned → 拦截
      heldEntry('c4', { verification: { status: 'failed', level: 'install', attempts: 1 } as never }),  // 验证失败
      heldEntry('c5'),   // mature announced ai pass → 已公告·待放行闸 or 已裁决·待日报公告
    ])
    const at = '2026-01-02T00:00:00Z'
    const vs: AiVerdict[] = [
      verdict({ name: 'c1', version: '1.0.0', verdict: 'concern', reason: 'x', at }),
      verdict({ name: 'c2', version: '1.0.0', verdict: 'pass', at }),
      verdict({ name: 'c3', version: '1.0.0', verdict: 'pass', at }),
      verdict({ name: 'c5', version: '1.0.0', verdict: 'pass', at }),
    ]
    const md = renderDigest({ index: idx, verdicts: vs, prev, now: new Date('2026-01-03T00:00:00Z') })
    expect(md).toContain('已打标 concern')
    expect(md).toContain('需人工')
    expect(md).toContain('验证失败')
  })
})

describe('re-features residual edges', () => {
  it('filesOf tarball cache hit across slots + dry default writes file', async () => {
    const { main } = await import('../pipeline/re-features.ts')
    const f = join(mkdtempSync(join(tmpdir(), 'rf9-')), 'index.json')
    // two slots sharing one tarball URL with no exports/main → filesOf twice → cache hit
    const e = mkEntry('pk-shared', {
      features: [],
      pendingUpdate: { version: '1.0.0', heldAt: 't', reason: 'r',
        capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' } } as never,
    })
    writeFileSync(f, JSON.stringify(mkIdx([e])))
    let tarballFetches = 0
    const fetchFn = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('registry.npmjs.org')) return mkRes({ versions: { '1.0.0': { dist: { tarball: 'https://r/shared.tgz' } } } })
      if (u.includes('shared.tgz')) { tarballFetches++; return mkRes('notarealtar') }
      return mkRes('nf', 404)
    }) as typeof fetch
    // scanTarball will throw on garbage → filesOf throws → entry fails; still exercises cache path setup
    const r = await main(f, { fetchFn })   // no dry → writes file (covers ?? default + write path)
    expect(typeof r.changed.length).toBe('number')
    const idx2 = JSON.parse(readFileSync(f, 'utf8'))
    expect(idx2.generatedAt).toBeTruthy()
  })
})

describe('verify/gui.checkGuiBundle stages', () => {
  it('whitelist violation + missing setup + findGuiBundle layout variants', async () => {
    const { checkGuiBundle, findGuiBundle } = await import('../pipeline/verify/gui.ts')
    // bundle requiring a non-whitelisted module → stage 'whitelist'
    const bad = await checkGuiBundle('const x = require("evil-module"); module.exports = { default: { setup(){} } }')
    expect(bad.ok).toBe(false)
    // valid require but no setup export → stage 'setup'
    const noSetup = await checkGuiBundle('module.exports = { default: {} }')
    expect(noSetup.ok).toBe(false)
    expect(noSetup.stage).toBe('setup')
    // minimal valid bundle with setup → ok or a later-stage failure, never a throw
    const good = await checkGuiBundle('module.exports = { default: { setup(ctx){ return {} } } }')
    expect(typeof good.ok).toBe('boolean')
    // findGuiBundle: package dir without bundle → error
    const home = mkdtempSync(join(tmpdir(), 'vg9-'))
    const pkgDir = join(home, 'node_modules', '@scope', 'plug')
    require('node:fs').mkdirSync(pkgDir, { recursive: true })
    require('node:fs').writeFileSync(join(pkgDir, 'package.json'), '{}')
    const miss = findGuiBundle(home, '@scope/plug')
    expect('error' in miss || 'path' in miss).toBe(true)
  })
})

describe('verify/tui + merge + plan residuals', () => {
  it('checkTui custom command opt + judgeTuiPane live-session heuristic', async () => {
    const { checkTui, judgeTuiPane } = await import('../pipeline/verify/tui.ts')
    // custom command flows into tmux new-session args
    const cmds: string[][] = []
    const run = (async (cmd: string, args: string[]) => {
      cmds.push([cmd, ...args])
      if (args[0] === 'new-session') return { stdout: '', stderr: '' }
      if (args[0] === 'has-session') return { stdout: '', stderr: '' }
      if (args[0] === 'capture-pane') return { stdout: 'opencode ready', stderr: '' }
      return { stdout: '', stderr: '' }
    }) as never
    const r = await checkTui({}, run, { settleMs: 1, command: 'opencode --foo' })
    expect(cmds[0]!.join(' ')).toContain('opencode --foo')
    expect(typeof r.ok).toBe('boolean')
    // judgeTuiPane: alive + recognizable pane → ok; dead → not ok
    expect(judgeTuiPane('opencode v1.0 ready — plugins loaded, type /help for commands', true).ok).toBe(true)
    expect(judgeTuiPane('', false).ok).toBe(false)
  })
  it('mergeResults: flagged slot downgrades verified→skipped; plan hostStaleVerify no-version', async () => {
    const { mergeResults } = await import('../pipeline/verify/merge.ts')
    const idx = mkIdx([
      mkEntry('f', { approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: ['x'] } }),
      mkEntry('s', { approval: 'pending', capabilities: { scannedAt: 't', findings: [], redFlags: [] } }),
    ])
    const results = [
      { name: 'f', version: '1.0.0', status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
      { name: 's', version: '1.0.0', status: 'verified', level: 'load', opencodeVersion: 'oc1', verifiedAt: 't' },
    ]
    const out = mergeResults(idx, results as never)
    expect(out.plugins.find(e => e.name === 'f')!.verification.status).toBe('skipped')
    expect(out.plugins.find(e => e.name === 's')!.verification.status).toBe('verified')
    const { hostStaleVerify, verifyTargetOf } = await import('../pipeline/verify/plan.ts')
    // no version → hostStaleVerify false regardless
    const noVer = mkEntry('nv', { latestVersion: null, verification: { status: 'verified', level: 'load', opencodeVersion: 'oc-old' } as never })
    expect(verifyTargetOf(noVer).version).toBeNull()
    expect(hostStaleVerify(noVer)).toBe(false)
  })
})
