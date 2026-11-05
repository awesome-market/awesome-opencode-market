/** Stage-5 tests: digest rendering + maturity window + diagnose candidate pick. */
import { describe, it, expect } from 'vitest'
import { renderDigest, nextDigestState } from '../pipeline/ai/digest.ts'
import { verdictRecord, reviewMaterial, unreviewedTargets } from '../pipeline/ai/diagnose.ts'
import { applyMatureVerdicts, latestVerdicts, digestStateOf, akey } from '../pipeline/verdicts.ts'
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
      index: idx([entry(), entry({ name: 'held', pendingUpdate: { version: '9.9', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })]),
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
    expect(md.indexOf('`older` v1.0 · 待验证 — ai:concern')).toBeLessThan(md.indexOf('`newer` v2.0 · 待验证 — ai:needs-human'))
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
  it('missing digest-state = bootstrap announces everything seen', () => {
    const md = renderDigest({ index: idx([]), verdicts: [v({ at: '2001-01-01T00:00:00Z' })], prev: null, now: new Date('2026-01-03') })
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
    const md = renderDigest({ index: idx([]), verdicts: [p, c], prev: null, now: new Date('2026-01-03T21:00:00Z') })
    expect(md).toContain('flop ⚠️不在目录 ⛔已被更新的 concern 刹车')
    expect(md).toContain('| flop ⚠️不在目录 | 1.1.0 | human |')   // concern row still lists
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
    expect(md).toContain('还有 10 条')
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
    expect(md).toContain('`needs-review` (未发布过) · 待评审')
    expect(md).toContain('`passed` v2.0 · 已公告·待放行闸')
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
  const seen = (vs: AiVerdict[]) => latestVerdicts(vs)
  it('picks never-verdicted pending entries and pendingUpdates', () => {
    const pend = entry({ name: 'a', approval: 'pending' })
    const bump = entry({ name: 'b', approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const done = entry({ name: 'c', approval: 'approved' })                    // approved, no hold → not a target
    const targets = unreviewedTargets(idx([pend, bump, done]), seen([]))
    expect(targets.map(e => e.name)).toEqual(['a', 'b'])
  })
  it('a HUMAN verdict excludes the target — AI must never overturn it', () => {
    const bump = entry({ approval: 'approved', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const hv: AiVerdict = { name: 'pkg', version: '2.0', verdict: 'concern', at: 't2', source: 'human', reason: 'no' }
    expect(unreviewedTargets(idx([bump]), seen([hv]))).toEqual([])
  })
  it('an existing AI verdict also excludes (no re-review churn)', () => {
    const pend = entry({ approval: 'pending' })
    const av: AiVerdict = { name: 'pkg', version: '1.0.0', verdict: 'pass', at: 't1', source: 'ai' }
    expect(unreviewedTargets(idx([pend]), seen([av]))).toEqual([])
  })
  it('verdict on a DIFFERENT version does not exclude the held candidate', () => {
    const bump = entry({ approval: 'approved', latestVersion: '1.0.0', pendingUpdate: { version: '2.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'unverified' }, heldAt: 't' } })
    const old = v({ name: 'pkg', version: '1.0.0' })
    expect(unreviewedTargets(idx([bump]), seen([old])).map(e => e.name)).toEqual(['pkg'])
  })
  it('unverified <48h defers to the verify run; past 48h reviews anyway', () => {
    const young = entry({ name: 'young', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-09T12:00:00Z' })
    const old = entry({ name: 'old', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: '2026-01-01T00:00:00Z' })
    const verified = entry({ name: 'done', approval: 'pending', verification: { status: 'verified' }, firstSeenAt: '2026-01-09T12:00:00Z' })
    const now = '2026-01-10T00:00:00Z'
    expect(unreviewedTargets(idx([young, old, verified]), seen([]), null, { now }).map(e => e.name))
      .toEqual(['old', 'done'])  // young unverified waits; verified never waits
  })
  it('NaN heldAt/firstSeenAt is treated as old (reviewable, not stuck)', () => {
    const nan = entry({ name: 'nan', approval: 'pending', verification: { status: 'unverified' }, firstSeenAt: 'not-a-date' })
    expect(unreviewedTargets(idx([nan]), seen([]), null, { now: '2026-01-10T00:00:00Z' })).toHaveLength(1)
  })
  it('targets sort oldest-held first (FIFO, not name order)', () => {
    const z = entry({ name: 'zzz', approval: 'pending', firstSeenAt: '2026-01-01T00:00:00Z' })
    const a = entry({ name: 'aaa', approval: 'pending', firstSeenAt: '2026-01-05T00:00:00Z' })
    expect(unreviewedTargets(idx([a, z]), seen([])).map(e => e.name)).toEqual(['zzz', 'aaa'])
  })
  it('force re-reviews a verdicted target', () => {
    const pend = entry({ approval: 'pending' })
    const av = v({ version: '1.0.0' })
    const s = seen([av])
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
