/** Stage-5 tests: digest rendering + maturity window + diagnose candidate pick. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderDigest, nextDigestState, main as digestMain } from '../pipeline/ai/digest.ts'
import { verdictRecord, reviewMaterial, unreviewedTargets } from '../pipeline/ai/diagnose.ts'
import { applyMatureVerdicts, latestVerdicts, digestStateOf, akey, explainEntry, loadVerdicts } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.1.0', verdict: 'pass', at: '2026-01-02T00:00:00Z', source: 'ai', ...over,
})

describe('renderDigest', () => {
  it('lists unannounced verdicts, held queue, concerns', () => {
    const old = v({ name: 'old', at: '2025-12-01T00:00:00Z' })
    const md = renderDigest({
      index: idx([entry({ pendingUpdate: { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } }),
        entry({ name: 'held', pendingUpdate: { version: '9.9', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })]),
      verdicts: [v(), old, v({ name: 'flagged', verdict: 'concern', reason: 'inject|ed' })],
      prev: digestStateOf('2026-01-01T00:00:00Z', [old]),  // `old` already announced in a past digest
      now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('| pkg | 1.1.0 | ai |')
    expect(md).not.toContain('| old |')           // announced earlier — not re-shown
    expect(md).toContain('`held` v9.9')            // queue backlog
    expect(md).toContain('inject\\|ed')            // pipe escaped for table
    expect(md).toContain('# marketplace digest 2026-01-03')
  })
  it('held section shows the hold reason and sorts oldest-first', () => {
    const pu = (version: string, heldAt: string, reason?: string) => ({
      version, capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' as const }, heldAt, ...(reason ? { reason } : {}),
    })
    const md = renderDigest({
      index: idx([
        entry({ name: 'newer', pendingUpdate: pu('2.0', '2026-01-02T00:00:00Z', 'ai:needs-human') }),
        entry({ name: 'older', pendingUpdate: pu('1.0', '2026-01-01T00:00:00Z', 'ai:concern') }),
      ]),
      verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md.indexOf('`older` v1.0 · 待验证 · 在押自 2026-01-01 — ai:concern')).toBeLessThan(md.indexOf('`newer` v2.0 · 待验证 · 在押自 2026-01-02 — ai:needs-human'))
  })
  it('late-pushed verdict with old `at` still surfaces — seen-set, not timestamp window', () => {
    // the audit hole: a verdict dated BEFORE lastDigestAt but absent from the
    // file at render time must appear now (it was never actually announced).
    const late = v({ name: 'late', version: '2.0.0', at: '2025-12-01T00:00:00Z' })
    const md = renderDigest({
      index: idx([]), verdicts: [late],
      prev: digestStateOf('2026-01-01T00:00:00Z', []),
      now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('| late ⚠️不在目录 |')
  })
  it('same-day re-render stays cumulative (dayAnnounced)', () => {
    const morning = v({ name: 'morning', at: '2026-01-03T10:00:00Z' })
    const evening = v({ name: 'evening', at: '2026-01-03T20:00:00Z' })
    const prev = {
      lastDigestAt: '2026-01-03T12:00:00Z', day: '2026-01-03',
      dayAnnounced: [akey(morning)], announced: [akey(morning)],
    }
    const md = renderDigest({ index: idx([]), verdicts: [morning, evening], prev, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('| morning ⚠️不在目录 |')   // re-appears: it was announced TODAY
    expect(md).toContain('| evening ⚠️不在目录 |')
  })
  it('future-dated verdict is reported, not silently frozen', () => {
    const md = renderDigest({
      index: idx([]), verdicts: [v({ name: 'future', at: '2099-01-01T00:00:00Z' })],
      prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('1 条 verdict 时间戳在未来')
    expect(md).not.toContain('| future |')
  })
  it('verify backlog section reports queue/submissions/recent-failures/oldest', () => {
    const md = renderDigest({
      index: idx([
        entry({ name: 'wait-a', verification: { status: 'unverified' } }),
        entry({ name: 'wait-sub', discoveredVia: ['submission'], verification: { status: 'unverified' }, firstSeenAt: '2025-12-20T00:00:00Z' }),
        entry({ name: 'f7d', verification: { status: 'failed', verifiedAt: '2026-01-02T00:00:00Z' } }),
        entry({ name: 'flagged', verification: { status: 'unverified' }, capabilities: { scannedAt: 't', findings: [], redFlags: ['x:y'] } }),
      ]),
      verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('验证积压（queue — 3）')
    expect(md).toContain('投稿优先 1')
    expect(md).toContain('近 7 天验证失败 1')
    expect(md).toContain('最老等待 2025-12-20')
  })
  it('verify queue matches planTargets — retryable recent failures count', () => {
    // failed <7d with retries<3 is retried by planTargets → must count here
    const md = renderDigest({
      index: idx([entry({ name: 'retry', verification: { status: 'failed', verifiedAt: '2026-01-02T00:00:00Z', retries: 1 } })]),
      verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('验证积压（queue — 1）')
  })
  it('missing digest-state = bootstrap announces everything inside the window', () => {
    // G3: the first-ever digest windows the announce — a backlog months old
    // must not all mature off one render. Verdicts within the window still
    // announce normally.
    const md = renderDigest({ index: idx([]), verdicts: [v()], prev: null, now: new Date('2026-01-03') })
    expect(md).toContain('| pkg ⚠️不在目录 |')
  })
  it('D-E ghost verdict: a name absent from index is announced but marked', () => {
    const md = renderDigest({
      index: idx([]), verdicts: [v({ name: 'gone-pkg' })],
      prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('gone-pkg ⚠️不在目录')
  })
  it('D-V a pass superseded by a newer concern is marked, not implied as releasing', () => {
    const p = v({ name: 'flop', at: '2026-01-03T10:00:00Z' })
    const c = v({ name: 'flop', verdict: 'concern', source: 'human', at: '2026-01-03T12:00:00Z', reason: 'changed mind' })
    // the mark's real window: p was announced in the MORNING render, then a
    // human concern flipped it before the evening re-render — same-day
    // cumulative keeps p's row as history, marked so it can't read as
    // "about to ship". (A same-render supersession = p never announces.)
    const prev = {
      lastDigestAt: '2026-01-03T12:00:00Z', day: '2026-01-03',
      dayAnnounced: [akey(p)], announced: [akey(p)],
    }
    const md = renderDigest({ index: idx([]), verdicts: [p, c], prev, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('flop ⚠️不在目录 ⛔已被更新的 concern 刹车')
    expect(md).toContain('| flop ⚠️不在目录 | 1.1.0 | human |')   // concern row still lists
  })
  it('a superseded-before-first-render pass simply never announces', () => {
    const p = v({ name: 'flop', at: '2026-01-03T10:00:00Z' })
    const c = v({ name: 'flop', verdict: 'concern', source: 'human', at: '2026-01-03T12:00:00Z', reason: 'changed mind' })
    const md = renderDigest({ index: idx([]), verdicts: [p, c], prev: null, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).not.toContain('flop ⚠️不在目录 ⛔')   // dead line has no row at all
    expect(md).toContain('（pass verdicts — 0）')
    expect(md).toContain('| flop ⚠️不在目录 | 1.1.0 | human |')
  })
  it('D-F reason text cannot inject markdown links into the committed file', () => {
    const md = renderDigest({
      index: idx([]),
      verdicts: [v({ verdict: 'concern', reason: 'see [click](https://evil.example/x)' })],
      prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('\\[click\\]')
    expect(md).not.toContain('[click](https://evil.example')
  })
  it('D-K a duplicated verdict line renders once', () => {
    const ver = v({ name: 'dup' })
    const md = renderDigest({ index: idx([]), verdicts: [ver, ver], prev: null, now: new Date('2026-01-03T21:00:00Z') })
    expect((md.match(/\| dup /g) ?? []).length).toBe(1)
  })
  it('D-G held list caps at 50 oldest + truncation note', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry({
      name: `h${String(i).padStart(3, '0')}`, approval: 'pending',
      firstSeenAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    const md = renderDigest({ index: idx(many), verdicts: [], prev: null, now: new Date('2026-01-31T21:00:00Z') })
    expect(md).toContain('审核队列积压（held — 60）')
    expect(md).toContain('<details><summary>…其余 10 条')
    expect(md).toContain('</details>')
  })
  it('D-H held lines carry the phase tag (which lever applies)', () => {
    const pu = (over: object = {}) => ({
      version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' as const }, heldAt: '2026-01-01T00:00:00Z', ...over,
    })
    const ver = v({ name: 'passed', version: '2.0' })
    const md = renderDigest({
      index: idx([
        entry({ name: 'waiting-verify', approval: 'approved', pendingUpdate: pu() }),
        entry({ name: 'needs-review', approval: 'pending', verification: { status: 'verified' }, firstSeenAt: '2025-12-01T00:00:00Z' }),
        entry({ name: 'passed', approval: 'approved', pendingUpdate: pu({ verification: { status: 'verified' } }) }),
      ]),
      verdicts: [ver],
      prev: digestStateOf('2026-01-02T21:00:00Z', [ver]),  // already announced
      now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('`waiting-verify` v2.0 · 待验证')
    expect(md).toContain('`needs-review` v1.0.0（未上架） · 待评审')
    expect(md).toContain('`passed` v2.0 · 已公告·待放行闸')
  })
  it('verify-failed after a mature pass shows 验证失败, not 待放行闸 (release is structurally impossible)', () => {
    const pu = {
      version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'failed' as const, level: 'install' as const }, heldAt: '2026-01-01T00:00:00Z',
    }
    const ver = v({ name: 'stuck', version: '2.0' })
    const md = renderDigest({
      index: idx([entry({ name: 'stuck', approval: 'approved', pendingUpdate: pu })]),
      verdicts: [ver],
      prev: digestStateOf('2026-01-02T21:00:00Z', [ver]),   // pass already announced
      now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('`stuck` v2.0 · 验证失败')
    expect(md).not.toContain('`stuck` v2.0 · 已公告·待放行闸')
  })
  it('D-C pendingReview shares unreviewedTargets — unverified <48h held is deferred, not counted', () => {
    // 'young' is held+unverified but held <48h → diagnose defers to verify;
    // counting it as review backlog inflates §⑤ vs what diagnose picks up
    const young = entry({ name: 'young', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-03T12:00:00Z' })
    const reviewable = entry({ name: 'old', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-01T00:00:00Z' })
    const md = renderDigest({
      index: idx([young, reviewable]), verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('pending review — 1')
  })
})

describe('nextDigestState', () => {
  it('announced accumulates across days; dayAnnounced resets each day', () => {
    const k1 = v({ name: 'a', at: '2026-01-03T10:00:00Z' })
    const s1 = nextDigestState([k1], null, new Date('2026-01-03T21:00:00Z'))
    expect(s1.announced).toEqual([akey(k1)])
    expect(s1.dayAnnounced).toEqual([akey(k1)])
    expect(s1.lastDigestAt).toBe('2026-01-03T10:00:00Z')
    const k2 = v({ name: 'b', at: '2026-01-04T10:00:00Z' })
    const s2 = nextDigestState([k1, k2], s1, new Date('2026-01-04T21:00:00Z'))
    expect(s2.announced).toEqual([akey(k1), akey(k2)])
    expect(s2.dayAnnounced).toEqual([akey(k2)])
  })
  it('same-day re-run accumulates dayAnnounced instead of overwriting', () => {
    const k1 = v({ name: 'a', at: '2026-01-03T10:00:00Z' })
    const k2 = v({ name: 'b', at: '2026-01-03T20:00:00Z' })
    const s1 = nextDigestState([k1], null, new Date('2026-01-03T12:00:00Z'))
    const s2 = nextDigestState([k1, k2], s1, new Date('2026-01-03T21:00:00Z'))
    expect(s2.dayAnnounced).toEqual([akey(k1), akey(k2)])
    expect(s2.lastDigestAt).toBe('2026-01-03T20:00:00Z')
  })
  it('future-dated verdicts never enter announced', () => {
    const fut = v({ name: 'f', at: '2099-01-01T00:00:00Z' })
    const s = nextDigestState([fut], null, new Date('2026-01-03T21:00:00Z'))
    expect(s.announced).toEqual([])
    expect(s.dayAnnounced).toEqual([])
  })
})

describe('verdictRecord + digest maturity interplay', () => {
  it('bilingual reasons: reasonEn lands on the record and in the digest', () => {
    const rec = { ...verdictRecord(entry(), 'pass', '中文理由', { reasonEn: 'english reason' }), at: '2026-01-02T00:00:00Z' }
    expect(rec.reason).toBe('中文理由')
    expect(rec.reasonEn).toBe('english reason')
    const md = renderDigest({ index: idx([]), verdicts: [rec], prev: null, now: new Date('2026-01-03') })
    expect(md).toContain('中文理由 / english reason')
  })
  it('pass verdict announced in a digest → released; unannounced → held', () => {
    const pu = { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' as const }, heldAt: 't' }
    const e = entry({ pendingUpdate: pu })
    const ver = v({ name: 'pkg', version: '1.1.0' })
    // digest exists but this verdict line was never announced → frozen
    const held = applyMatureVerdicts(idx([e]), [ver], digestStateOf('2026-01-01T00:00:00Z', []))
    expect(held.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
    // a digest that rendered this verdict line → mature → released
    const rel = applyMatureVerdicts(idx([e]), [ver], digestStateOf('2026-01-02T21:00:00Z', [ver]))
    expect(rel.index.plugins[0]!.latestVersion).toBe('1.1.0')
    expect(rel.index.plugins[0]!.pendingUpdate).toBeUndefined()
  })
  it('human pass also needs digest appearance (no shortcut)', () => {
    const pu = { version: '1.1.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' as const }, heldAt: 't' }
    const e = entry({ pendingUpdate: pu })
    const hv = v({ source: 'human' })
    const held = applyMatureVerdicts(idx([e]), [hv], digestStateOf('2026-01-01T00:00:00Z', []))
    expect(held.index.plugins[0]!.pendingUpdate?.version).toBe('1.1.0')
  })
})

describe('unreviewedTargets (diagnose candidate pick)', () => {
  it('picks never-verdicted pending entries and pendingUpdates', () => {
    const pend = entry({ name: 'a', approval: 'pending' })
    const bump = entry({ name: 'b', approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const done = entry({ name: 'c', approval: 'approved' })                    // approved, no hold → not a target
    const targets = unreviewedTargets(idx([pend, bump, done]), [])
    expect(targets.map(e => e.name)).toEqual(['a', 'b'])
  })
  it('a HUMAN verdict excludes the target — AI must never overturn it', () => {
    const bump = entry({ approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const hv: AiVerdict = { name: 'pkg', version: '2.0', verdict: 'concern', at: 't2', source: 'human', reason: 'no' }
    expect(unreviewedTargets(idx([bump]), [hv])).toEqual([])
  })
  it('an existing AI verdict also excludes (no re-review churn)', () => {
    const pend = entry({ approval: 'pending' })
    const av: AiVerdict = { name: 'pkg', version: '1.0.0', verdict: 'pass', at: 't1', source: 'ai' }
    expect(unreviewedTargets(idx([pend]), [av])).toEqual([])
  })
  it('verdict on a DIFFERENT version does not exclude the held candidate', () => {
    const bump = entry({ approval: 'approved', latestVersion: '1.0.0', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const old = v({ name: 'pkg', version: '1.0.0' })
    expect(unreviewedTargets(idx([bump]), [old]).map(e => e.name)).toEqual(['pkg'])
  })
  it('unverified <48h defers to the verify run; past 48h reviews anyway', () => {
    const young = entry({ name: 'young', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-09T12:00:00Z' })
    const old = entry({ name: 'old', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-01T00:00:00Z' })
    const verified = entry({ name: 'done', approval: 'pending', verification: { status: 'verified' }, firstSeenAt: '2026-01-09T12:00:00Z' })
    const now = '2026-01-10T00:00:00Z'
    expect(unreviewedTargets(idx([young, old, verified]), [], null, { now }).map(e => e.name))
      .toEqual(['old', 'done'])  // young unverified waits; verified never waits
  })
  it('NaN heldAt/firstSeenAt is treated as old (reviewable, not stuck)', () => {
    const nan = entry({ name: 'nan', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: 'not-a-date' })
    expect(unreviewedTargets(idx([nan]), [], null, { now: '2026-01-10T00:00:00Z' })).toHaveLength(1)
  })
  it('targets sort oldest-held first (FIFO, not name order)', () => {
    const z = entry({ name: 'zzz', approval: 'pending', firstSeenAt: '2026-01-01T00:00:00Z' })
    const a = entry({ name: 'aaa', approval: 'pending', firstSeenAt: '2026-01-05T00:00:00Z' })
    expect(unreviewedTargets(idx([a, z]), []).map(e => e.name)).toEqual(['zzz', 'aaa'])
  })
  it('force re-reviews a verdicted target', () => {
    const pend = entry({ approval: 'pending' })
    const av = v({ version: '1.0.0' })
    const s = [av]
    expect(unreviewedTargets(idx([pend]), s, new Set(['pkg']))).toEqual([])
    expect(unreviewedTargets(idx([pend]), s, new Set(['pkg']), { force: true })).toHaveLength(1)
  })
})

describe('reviewMaterial', () => {
  it('covers pending capabilities not the whole archive', () => {
    const m = reviewMaterial(entry({
      pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: ['uses http'], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' },
    }))
    expect(m.some(x => x.id === 'manifest')).toBe(true)
    expect(m.some(x => x.id === 'finding:uses http')).toBe(true)
    expect(m.some(x => x.id === 'pending')).toBe(true)
  })
  it('verdictRecord pins pendingUpdate.version', () => {
    const rec = verdictRecord(entry({ pendingUpdate: { version: '3.0.1', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } }), 'pass', 'looks fine')
    expect(rec.version).toBe('3.0.1')
    expect(rec.source).toBe('ai')
  })
})

describe('announcement candidates (Bug-1/O1)', () => {
  const held = (name: string, ver: string) => entry({
    name, pendingUpdate: {
      version: ver, capabilities: { scannedAt: 't', findings: [], redFlags: [] },
      verification: { status: 'unverified' }, heldAt: '2026-01-01T00:00:00Z',
    },
  })

  it('a superseded verdict line never re-announces — no phantom rows', () => {
    const index = idx([held('pkg', '1.1.0')])
    const v1 = v({ at: '2026-01-02T00:00:00Z', reason: 'first pass' })
    const v2 = v({ verdict: 'concern', at: '2026-01-02T12:00:00Z', reason: 'flipped' })
    const s1 = nextDigestState([v1], null, new Date('2026-01-02T21:00:00Z'), index)
    expect(s1.announced).toEqual([akey(v1)])
    const s2 = nextDigestState([v1, v2], s1, new Date('2026-01-03T21:00:00Z'), index)
    expect(s2.announced).toEqual([akey(v2)])          // v1 pruned with supersession
    // day 3: v1's akey is absent from prev.announced — it must NOT come back
    const md = renderDigest({ index, verdicts: [v1, v2], prev: s2, now: new Date('2026-01-04T21:00:00Z') })
    expect(md).not.toContain('first pass')
    expect(md).not.toContain('flipped')              // v2 was already announced too
    expect(md).toContain('（pass verdicts — 0）')
  })

  it('pass on an already-approved display slot is never announced nor rendered', () => {
    const index = idx([entry({ name: 'live', latestVersion: '1.0.0' })])
    const pv = v({ name: 'live', version: '1.0.0' })
    expect(nextDigestState([pv], null, new Date('2026-01-02T21:00:00Z'), index).announced).toEqual([])
    const md = renderDigest({ index, verdicts: [pv], prev: null, now: new Date('2026-01-02T21:00:00Z') })
    expect(md).toContain('（pass verdicts — 0）')
    expect(md).not.toContain('| live |')
  })

  it('concern on an approved displayed slot still announces (brake surface)', () => {
    const index = idx([entry({ name: 'live' })])
    const c = v({ name: 'live', version: '1.0.0', verdict: 'concern', source: 'human' })
    expect(nextDigestState([c], null, new Date('2026-01-02T21:00:00Z'), index).announced).toEqual([akey(c)])
    const md = renderDigest({ index, verdicts: [c], prev: null, now: new Date('2026-01-02T21:00:00Z') })
    expect(md).toContain('| live |')
  })

  it('ghost verdict (name absent from index) still announces', () => {
    const g = v({ name: 'ghost' })
    const s = nextDigestState([g], null, new Date('2026-01-02T21:00:00Z'), idx([]))
    expect(s.announced).toEqual([akey(g)])
  })

  it('a pruned pass re-announces once if its slot comes back', () => {
    const pv = v({ name: 'pkg', version: '2.0.0' })
    const heldI = idx([held('pkg', '2.0.0')])
    const s1 = nextDigestState([pv], null, new Date('2026-01-02T21:00:00Z'), heldI)
    expect(s1.announced).toEqual([akey(pv)])
    // released → approved, hold gone → key no longer a slot → pruned
    const liveI = idx([entry({ name: 'pkg', latestVersion: '2.0.0' })])
    const s2 = nextDigestState([pv], s1, new Date('2026-01-03T21:00:00Z'), liveI)
    expect(s2.announced).toEqual([])
    // entry returns pending on the same version (removed→re-entry) →
    // the live pass line re-announces ONCE — a fresh objection window
    const brakeI = idx([entry({ name: 'pkg', latestVersion: '2.0.0', approval: 'pending' })])
    const s3 = nextDigestState([pv], s2, new Date('2026-01-04T21:00:00Z'), brakeI)
    expect(s3.announced).toEqual([akey(pv)])
  })

  it('nextDigestState without index keeps legacy all-live behavior (tests/tools)', () => {
    const pv = v({ name: 'pkg', version: '1.0.0' })
    expect(nextDigestState([pv], null, new Date('2026-01-02T21:00:00Z')).announced).toEqual([akey(pv)])
  })
})

describe('digest audit fixes', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'digest-'))

  it('refuses to re-announce when digest-state is lost but digest history exists (Bug-2)', async () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'index.json'), JSON.stringify(idx([])))
      writeFileSync(join(d, 'ai-verdicts.jsonl'), '')
      mkdirSync(join(d, 'digest'))
      writeFileSync(join(d, 'digest', '2026-01-01.md'), '# old digest')
      await expect(digestMain(['--index', join(d, 'index.json'), '--verdicts', join(d, 'ai-verdicts.jsonl'),
        '--state', join(d, 'digest-state.json'), '--out-dir', d, '--dry']))
        .rejects.toThrow(/missing\/corrupt/)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('true bootstrap (no digest history) proceeds with prev=null', async () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'index.json'), JSON.stringify(idx([])))
      writeFileSync(join(d, 'ai-verdicts.jsonl'), '')
      await digestMain(['--index', join(d, 'index.json'), '--verdicts', join(d, 'ai-verdicts.jsonl'),
        '--state', join(d, 'digest-state.json'), '--out-dir', d, '--dry'])
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('escapes raw HTML in reasons — injected links must not render (Bug-3)', () => {
    const md = renderDigest({
      index: idx([]), verdicts: [v({ name: 'evil', reason: 'see <a href=https://x>here</a> & <img src=x>' })],
      prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('&lt;a href')
    expect(md).not.toContain('<a href')
    expect(md).not.toContain('<img')
  })

  it('normalizes `at` offsets to Z-ISO at the read boundary (Bug-4)', () => {
    const d = tmp()
    try {
      const f = join(d, 'v.jsonl')
      writeFileSync(f, JSON.stringify(v({ at: '2026-01-02T08:00:00+08:00' })) + '\n')
      const [vv] = loadVerdicts(f)
      expect(vv?.at).toBe('2026-01-02T00:00:00.000Z')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('phase label: announced AI pass on an unscanned slot does not promise release', () => {
    const pu = {
      version: '2.0', heldAt: '2026-01-01T00:00:00Z',
      capabilities: { scannedAt: null, findings: [], redFlags: [] },
      verification: { status: 'skipped' as const },
    }
    const e = entry({ name: 'pkg', pendingUpdate: pu })
    const pv = v({ name: 'pkg', version: '2.0' })
    const prev = {
      lastDigestAt: '2026-01-03T12:00:00Z', day: '2026-01-03',
      dayAnnounced: [akey(pv)], announced: [akey(pv)],
    }
    const md = renderDigest({ index: idx([e]), verdicts: [pv], prev, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('AI pass 被旗标/未扫描拦截·需人工')
    expect(md).not.toContain('已公告·待放行闸')
  })

  it('§④ oldest wait uses the shared hold clock (candidateHeldAt), not firstSeenAt', () => {
    const e = entry({
      name: 'old', approval: 'pending', firstSeenAt: '2026-01-01T00:00:00Z',
      capabilities: { scannedAt: '2025-12-01T00:00:00Z', findings: [], redFlags: [] },
      verification: { status: 'unverified' },
    })
    const md = renderDigest({ index: idx([e]), verdicts: [], prev: null, now: new Date('2026-01-04T00:00:00Z') })
    expect(md).toContain('最老等待 2025-12-01')
  })

  it('held backlog beyond 50 stays readable in a collapsed block', () => {
    const es = Array.from({ length: 53 }, (_, i) => entry({
      name: `h${i}`, approval: 'pending', firstSeenAt: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`,
      capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
    }))
    const md = renderDigest({ index: idx(es), verdicts: [], prev: null, now: new Date('2026-01-04T00:00:00Z') })
    expect(md).toContain('<details><summary>…其余 3 条')
    expect(md).toContain('`h52`')                      // beyond the cap — inside <details>
    expect(md).toContain('</details>')
  })

  it('explainEntry: pass on an already-approved displayed slot reports released', () => {
    const e = entry({ approval: 'approved', latestVersion: '1.0.0' })
    const pv = v({ name: 'pkg', version: '1.0.0' })
    const disp = explainEntry(e, [pv], null).find(s => s.slot === 'displayed')
    expect(disp?.outcome).toBe('release')
    expect(disp?.why).toContain('已上架')
  })
})

describe('package brake + 24h window + display surfaces (post-audit batch)', () => {
  const brake = (at = '2026-01-02T00:00:00Z'): AiVerdict =>
    ({ name: 'pkg', version: null, verdict: 'concern', at, source: 'human', reason: 'malware-suspect' })
  const heldEntry = () => entry({ approval: 'pending', firstSeenAt: '2026-01-01T00:00:00Z' })

  it('unreviewedTargets skips a package-braked slot — no LLM burn on a decided package', () => {
    expect(unreviewedTargets(idx([heldEntry()]), [brake()])).toEqual([])
    // a newer human PASS on the slot key lifts the brake for that slot
    const lift = v({ version: '1.0.0', at: '2026-01-03T00:00:00Z', source: 'human' })
    expect(unreviewedTargets(idx([heldEntry()]), [brake(), lift])).toEqual([])
    // ↑ lift verdicted the slot anyway — the exclusion here is the seen-check;
    // the pure lift case: brake on pkg A must not brake pkg B
    const other = entry({ name: 'other', approval: 'pending', firstSeenAt: '2026-01-01T00:00:00Z' })
    expect(unreviewedTargets(idx([heldEntry(), other]), [brake()]).map(e => e.name)).toEqual(['other'])
  })

  it('§② shows 包级刹车 phase for a braked hold and §⑤ excludes it', () => {
    const md = renderDigest({
      index: idx([heldEntry()]), verdicts: [brake()],
      prev: digestStateOf('2026-01-01T00:00:00Z', []), now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('`pkg` v1.0.0（未上架） · 包级刹车·需人工解除')
    expect(md).toContain('## ⑤ 评审积压（pending review — 0）')
  })

  it('§① marks an AI pass under a package brake — announced but never releasing', () => {
    const p = v({ version: '1.0.0' })
    const md = renderDigest({
      index: idx([heldEntry()]), verdicts: [brake('2026-01-01T00:00:00Z'), p],
      prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('pkg ⛔已被包级 concern 刹车')
  })

  it('§③ marks a superseded concern resolved; package-level row shows —（包级）', () => {
    const c = v({ version: '1.0.0', verdict: 'concern', at: '2026-01-01T00:00:00Z' })
    const lift = v({ version: '1.0.0', at: '2026-01-02T00:00:00Z' })
    const md = renderDigest({
      index: idx([heldEntry()]), verdicts: [c, lift, brake('2026-01-01T12:00:00Z')],
      // c was announced by a PREVIOUS digest — its resolution now shows as a
      // marked row instead of silently disappearing from §③
      prev: digestStateOf('2026-01-01T21:00:00Z', [c]),
      now: new Date('2026-01-03T21:00:00Z'),
    })
    // brake itself is a fresh concern this render → 1 standing + 1 resolved
    expect(md).toContain('Concerns（1 ·已解除 1）')
    expect(md).toContain('pkg ✅已被更新的 pass 解除')
    expect(md).toContain('| pkg | —（包级） | human |')
    // never-announced concern resolved between renders stays out — the
    // reader never saw it, so there's nothing to close
    const silent = v({ name: 's', version: '1.0', verdict: 'concern', at: '2026-01-02T01:00:00Z' })
    const md2 = renderDigest({
      index: idx([heldEntry()]), verdicts: [c, lift, silent, v({ name: 's', version: '1.0', at: '2026-01-02T02:00:00Z' })],
      prev: digestStateOf('2026-01-01T21:00:00Z', [c]),
      now: new Date('2026-01-03T21:00:00Z'),
    })
    // no brake row in this render → only the resolved c shows
    expect(md2).toContain('Concerns（0 ·已解除 1）')
    expect(md2).toContain('pkg ✅已被更新的 pass 解除')
    expect(md2).not.toContain('`s` ✅') // silent concern: never announced, never shown
  })

  it('phaseOf on a repo-only slot reads the null-key verdict — announced human pass is 待放行闸', () => {
    const gh = entry({ approval: 'pending', latestVersion: null, source: { kind: 'github', id: 'o/r' }, verification: { status: 'skipped' } })
    const hv = v({ version: null, source: 'human' })
    const md = renderDigest({
      index: idx([gh]), verdicts: [hv],
      prev: digestStateOf('2026-01-01T00:00:00Z', [hv]), now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('· 已公告·待放行闸')
    const md2 = renderDigest({
      index: idx([gh]), verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md2).toContain('需人工评审（AI 不审 repo-only）')
  })

  it('上期公告·已生效 lists last-render announcements whose slot is now displayed', () => {
    const p = v({ name: 'landed', version: '2.0' })
    const prev = { lastDigestAt: 't', day: '2026-01-02', dayAnnounced: [akey(p)], announced: [akey(p)] }
    const md = renderDigest({
      index: idx([entry({ name: 'landed', latestVersion: '2.0', approval: 'approved' })]),
      verdicts: [p], prev, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md).toContain('上期公告·已生效 1：`landed`@2.0')
    // still pending → not claimed as landed
    const md2 = renderDigest({
      index: idx([entry({ name: 'landed', latestVersion: '2.0', approval: 'pending' })]),
      verdicts: [p], prev, now: new Date('2026-01-03T21:00:00Z'),
    })
    expect(md2).not.toContain('上期公告·已生效')
  })

  it('§⑦ renders 24h removals; older tombstones stay out', () => {
    const i = idx([])
    i.removed = [
      { slug: 'gone', name: 'gone', disappearedAt: '2026-01-03T10:00:00Z', reason: 'npm-404' },
      { slug: 'old', name: 'old', disappearedAt: '2025-12-01T00:00:00Z', reason: 'manual' },
    ]
    const md = renderDigest({ index: i, verdicts: [], prev: null, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('## ⑦ 近 24h 下架（1）')
    expect(md).toContain('`gone` — npm-404')
    expect(md).not.toContain('`old` — manual')
  })

  it('badLines surfaces malformed verdict rows in the header', () => {
    const md = renderDigest({ index: idx([]), verdicts: [], prev: null, badLines: 2, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('⚠️ 2 行 verdict 无法解析已跳过')
  })

  it('loadVerdicts reports the malformed-line count via sink', () => {
    const d = mkdtempSync(join(tmpdir(), 'vl-'))
    const f = join(d, 'v.jsonl')
    writeFileSync(f, JSON.stringify(v()) + '\n{bad json\n' + JSON.stringify(v({ name: 'b' })) + '\n')
    try {
      const sink = { bad: 0 }
      const vs = loadVerdicts(f, sink)
      expect(vs).toHaveLength(2)
      expect(sink.bad).toBe(1)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('announced today is NOT yet mature — the objection window needs one more render', () => {
    const e = heldEntry()
    const p = v({ version: '1.0.0' })
    // announced in an EARLIER digest → releases
    const r = applyMatureVerdicts(idx([e]), [p], digestStateOf('2026-01-01T00:00:00Z', [p]))
    expect(r.releases).toEqual(['pkg@1.0.0'])
    // same announcement but stamped into TODAY's dayAnnounced → still window
    const sameDay = { ...digestStateOf('2026-01-03T21:00:00Z', [p]), dayAnnounced: [akey(p)] }
    const r2 = applyMatureVerdicts(idx([e]), [p], sameDay)
    expect(r2.releases).toEqual([])
    expect(r2.index.plugins[0]!.approval).toBe('pending')
    // explainEntry agrees — 'wait' with the objection-window reason
    const [sx] = explainEntry(e, [p], sameDay)
    expect(sx!.outcome).toBe('wait')
    expect(sx!.why).toContain('异议窗')
  })

  it('hand-restored announced:[] state stays inside the bootstrap window; a real empty render exits it', () => {
    const old = v({ name: 'ancient', at: '2025-01-01T00:00:00Z' })
    const restored = { lastDigestAt: '', announced: [], day: '2026-01-03', dayAnnounced: [] }
    const s = nextDigestState([old], restored, new Date('2026-01-03T21:00:00Z'))
    expect(s.announced).toEqual([])                       // windowed, not mass-announced
    const s2 = nextDigestState([old], s, new Date('2026-01-04T21:00:00Z'))
    expect(s2.announced).toEqual([akey(old)])             // next render announces normally — no deadlock
  })
})
