/** audit #6 (日报流 §6, 第 5 轮) — fresh independent pass found no production
 *  defect; the two fail-closed maturity-anchor contracts had ZERO coverage:
 *
 *  1. BOOTSTRAP WINDOW — the first render ever (prev=null) must NOT announce
 *     the entire verdict backlog: every announced pass matures at the next
 *     applyMatureVerdicts, so months of backlog would all release within ~6h,
 *     collapsing the objection window the digest exists to provide. Only
 *     verdicts ≤14d old announce; older candidates are visibly withheld in
 *     the header and announce normally from the SECOND render on (the anchor
 *     written by render 1 makes it non-bootstrap — no deadlock).
 *  2. HAND-RESTORED MINIMAL STATE — {announced:[], lastDigestAt:''} is the
 *     shape of a hand-rebuilt digest-state; it must re-enter the bootstrap
 *     window (an empty anchor cannot be told from "never rendered"). But a
 *     REAL anchor with a legitimately-drained announced set
 *     (lastDigestAt non-empty) must NOT re-enter: the backlog announces.
 *  3. STATE-LOSS REFUSE — prev=null while digest/*.md history exists means
 *     digest-state.json vanished or went corrupt: main() must THROW (the
 *     workflow fails loud, watchdog alerts) rather than re-announce the
 *     whole backlog in one shot — the exact fail-open the file warns about. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderDigest, nextDigestState, main } from '../pipeline/ai/digest.ts'
import { akey } from '../pipeline/verdicts.ts'
import type { CatalogIndex, PluginEntry, AiVerdict, DigestState } from '../src/schema.ts'

const mkEntry = (name: string, over: Partial<PluginEntry> = {}): PluginEntry => ({
  name, slug: name.toLowerCase(), aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: name, version: '1.0.0' }, description: { en: 'd' }, category: [],
  license: 'MIT', deprecated: false, replacement: null,
  deprecatedMessage: null, createdAt: '2020-01-01', modifiedAt: null, maintainers: ['a'], distTags: { latest: '1.0.0' },
  firstSeenAt: '2026-01-01', latestVersion: '1.0.0', publishedAt: '2026-01-01',
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: '2026-01-01' },
  capabilities: { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] },
  verification: { status: 'verified', level: 'load' }, compat: {},
  approval: 'pending', approvalReason: 'awaiting-review',
  ...over,
})
const mkIndex = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 't', categories: {}, plugins, removed: [],
})
const v = (name: string, version: string | null, verdict: 'pass' | 'concern', at: string,
  source: 'ai' | 'human' = 'ai', reason?: string): AiVerdict => ({
  name, version, verdict, at, source, ...(reason ? { reason } : {}),
})
const NOW = new Date('2026-02-01T21:15:00Z')
const OLD = '2026-01-01T10:00:00Z'   // 31d before NOW — outside the 14d window
const FRESH = '2026-01-30T10:00:00Z' // 2d before NOW — inside the window

describe('§6 bootstrap window — first render must not mass-release the backlog', () => {
  it('prev=null: only ≤14d-old candidates announce; older backlog withheld', () => {
    const idx = mkIndex([mkEntry('old-pkg'), mkEntry('new-pkg')])
    const oldV = v('old-pkg', '1.0.0', 'pass', OLD)
    const newV = v('new-pkg', '1.0.0', 'pass', FRESH)
    const st = nextDigestState([oldV, newV], null, NOW, idx)
    expect(st.announced).toContain(akey(newV))
    expect(st.announced).not.toContain(akey(oldV))
  })

  it('withheld count is rendered in the header — staged announce is visible, not silent', () => {
    const idx = mkIndex([mkEntry('old-pkg')])
    const oldV = v('old-pkg', '1.0.0', 'pass', OLD)
    const md = renderDigest({ index: idx, verdicts: [oldV], prev: null, now: NOW })
    expect(md).toContain('首次公告（bootstrap）')
    expect(md).toContain('1 条早于 14 天')
    expect(md).not.toContain('old-pkg | ')        // withheld row not in §①
  })

  it('second render exits bootstrap: withheld backlog announces (real anchor, no deadlock)', () => {
    const idx = mkIndex([mkEntry('old-pkg')])
    const oldV = v('old-pkg', '1.0.0', 'pass', OLD)
    const first = nextDigestState([oldV], null, NOW, idx)
    expect(first.announced).toHaveLength(0)
    expect(first.lastDigestAt).not.toBe('')       // a real anchor was written
    const second = nextDigestState([oldV], first, new Date('2026-02-02T21:15:00Z'), idx)
    expect(second.announced).toContain(akey(oldV))
  })

  it('a bootstrap render that withheld nothing still exits bootstrap next time', () => {
    const idx = mkIndex([mkEntry('new-pkg')])
    const newV = v('new-pkg', '1.0.0', 'pass', FRESH)
    const first = nextDigestState([newV], null, NOW, idx)
    // unrelated OLD line joins the log later; announced must NOT be reset to
    // windowed mode — the anchor is real, so a drained-looking announced set
    // is not re-bootstrapped
    const late = v('old-pkg2', '1.0.0', 'pass', OLD)
    const idx2 = mkIndex([mkEntry('new-pkg'), mkEntry('old-pkg2')])
    const second = nextDigestState([newV, late], first, new Date('2026-02-02T21:15:00Z'), idx2)
    expect(second.announced).toContain(akey(late))
  })
})

describe('§6 hand-restored minimal state re-enters bootstrap', () => {
  const restored: DigestState = { lastDigestAt: '', day: '', dayAnnounced: [], announced: [] }
  it('{announced:[], lastDigestAt:""} withholds the >14d backlog like prev=null', () => {
    const idx = mkIndex([mkEntry('old-pkg'), mkEntry('new-pkg')])
    const oldV = v('old-pkg', '1.0.0', 'pass', OLD)
    const newV = v('new-pkg', '1.0.0', 'pass', FRESH)
    const st = nextDigestState([oldV, newV], restored, NOW, idx)
    expect(st.announced).toContain(akey(newV))
    expect(st.announced).not.toContain(akey(oldV))
  })
  it('but a REAL anchor with drained announced does NOT re-bootstrap', () => {
    const idx = mkIndex([mkEntry('old-pkg')])
    const oldV = v('old-pkg', '1.0.0', 'pass', OLD)
    const drained: DigestState = { lastDigestAt: '2026-01-31T21:15:00Z', day: '2026-01-31', dayAnnounced: [], announced: [] }
    const st = nextDigestState([oldV], drained, NOW, idx)
    expect(st.announced).toContain(akey(oldV))
  })
})

describe('§6 state-loss guard — prev=null + digest history refuses to re-announce', () => {
  it('main() throws when digest/*.md exists but digest-state.json is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-r9-'))
    mkdirSync(join(dir, 'digest'))
    writeFileSync(join(dir, 'digest', '2026-01-15.md'), '# marketplace digest 2026-01-15\n')
    writeFileSync(join(dir, 'index.json'), JSON.stringify(mkIndex([mkEntry('p')])))
    writeFileSync(join(dir, 'ai-verdicts.jsonl'), JSON.stringify(v('p', '1.0.0', 'pass', FRESH)) + '\n')
    await expect(main([
      '--index', join(dir, 'index.json'),
      '--verdicts', join(dir, 'ai-verdicts.jsonl'),
      '--state', join(dir, 'digest-state.json'),  // absent — the lost state
      '--out-dir', dir,
    ])).rejects.toThrow(/missing\/corrupt.*refusing to re-announce/)
  })
  it('main() renders when there is genuinely no history (true bootstrap)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-r9-fresh-'))
    writeFileSync(join(dir, 'index.json'), JSON.stringify(mkIndex([mkEntry('p')])))
    writeFileSync(join(dir, 'ai-verdicts.jsonl'), JSON.stringify(v('p', '1.0.0', 'pass', FRESH)) + '\n')
    await expect(main([
      '--index', join(dir, 'index.json'),
      '--verdicts', join(dir, 'ai-verdicts.jsonl'),
      '--state', join(dir, 'digest-state.json'),
      '--out-dir', dir, '--dry',
    ])).resolves.toBeUndefined()
  })
})
