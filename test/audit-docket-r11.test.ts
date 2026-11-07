/** audit #8 (审核单流 §8, 第 6 轮) — three findings:
 *
 *  1. docket.yml fetched diagnose.paused with a bare
 *     `git show origin/catalog:diagnose.paused > /tmp/diagnose.paused || true`.
 *     The `>` redirect creates the file BEFORE git show runs — when the path
 *     is absent on the catalog branch (the normal state) the failed show
 *     leaves an EMPTY /tmp/diagnose.paused behind, and docket.ts's
 *     existsSync() reads file EXISTENCE as the pause signal → paused=true
 *     on every CI tick. Every aged verdict-less hold then folded into the
 *     (unreviewed backlog) aggregate with a false "声明暂停" claim, and the
 *     per-version evidence surface never ran. Same stray-file hazard
 *     ai-diagnose.sh's cat-file -e probe documents. Fixed: gate material-
 *     ization on `git cat-file -e` and defer like the aux files when the
 *     blob exists but won't read.
 *  2. issueBody's flag branch asserted "判词早于信号记录时点" when
 *     flaggedAt was missing — an unverifiable ordering (the verdict may
 *     actually postdate the signal; the stamp is simply absent on legacy
 *     data). AGENTS: 不确定就说不确定 — now says the ordering is unknown.
 *  3. closeReason's repo-only check used `latestVersion === null` while
 *     docketTargets uses `!latestVersion` — a malformed '' pending entry
 *     joins the repo-only aggregate but its stale per-entry issue closed
 *     with the generic "离开队列" reason instead of "并入 repo-only 积压总单". */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { issueBody, main } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const YML = readFileSync(join(__dirname, '..', '.github', 'workflows', 'docket.yml'), 'utf8')

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const hv = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'o/r', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'human', ...over,
})

describe('docket.yml — diagnose.paused materialization is existence-gated', () => {
  it('probes the blob with cat-file -e BEFORE the git show redirect', () => {
    const probe = YML.indexOf('git cat-file -e origin/catalog:diagnose.paused')
    const show = YML.indexOf('git show origin/catalog:diagnose.paused > /tmp/diagnose.paused')
    expect(probe).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(probe)   // existence check precedes materialization
  })
  it('the unguarded `> file || true` swallow is gone — unreadable defers like the aux files', () => {
    // the phantom-file pattern: redirect creates the file even when git show
    // fails, and `|| true` keeps it — existsSync then reads a pause that was
    // never declared
    expect(YML).not.toContain('diagnose.paused > /tmp/diagnose.paused 2>/dev/null || true')
    expect(YML).toContain('diagnose.paused exists on origin/catalog but git show failed — defer to next tick')
  })
})

describe('issueBody — flag target with a pre-signal human verdict', () => {
  const flagT = (over: Record<string, unknown> = {}) => ({
    name: 'o/r', version: '1.0.0', verdict: 'flag' as const,
    reason: 'sec:repojack', verification: 'verified',
    humanVerdict: hv(),
    ...over,
  })
  it('missing flaggedAt admits the ordering is unknowable — never asserts it', () => {
    const body = issueBody(flagT())
    expect(body).toContain('flaggedAt 缺失')
    expect(body).toContain('无法确认该判词是否覆盖此信号')
    expect(body).not.toContain('判词早于信号记录时点')
    expect(body).not.toContain('裁决早于信号')
  })
  it('flaggedAt set keeps the explicit pre-signal ordering', () => {
    const body = issueBody(flagT({ flaggedAt: '2026-02-01T00:00:00Z' }))
    expect(body).toContain('信号首次观察 2026-02-01')
    expect(body).toContain('裁决早于信号')
  })
})

describe('closeReason — malformed version-less pending reads repo-only everywhere', () => {
  it("latestVersion:'' pending entry's stale per-entry issue closes as 并入 repo-only 积压总单", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dk-r11-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    // '' passes z.string() — docketTargets reads it version-less (!latestVersion)
    // and folds the entry into the repo-only aggregate; the close reason must
    // agree or the maintainer gets "离开队列" for a row that is IN the backlog
    writeFileSync(idxPath, JSON.stringify(idx([e({ name: 'weird', latestVersion: '' })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 5, title: '[review] weird', labels: [{ name: 'review:pending' }], body: 'x' },
      ])
      if (args.includes('view')) return 'earlier comment\n'
      if (args.includes('create')) return 'https://github.com/o/r/issues/42\n'
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    // sanity: the entry did join the repo-only aggregate this tick
    expect(calls.find(c => c.includes('create'))?.join(' ')).toContain('(repo-only backlog)')
    const comments = calls.filter(c => c.includes('comment')).map(c => c.join(' ')).join('\n')
    expect(comments).toContain('并入 repo-only 积压总单')
    expect(comments).not.toContain('评审目标已离开队列')
  })
})
