/** audit #6 (日报流 §6, 第 6 轮) — four defects found on the fresh pass:
 *
 *  1. §③ DUPLICATE ROW on same-day re-render — a concern announced in the
 *     morning render and resolved by a newer pass before an evening
 *     re-render (workflow_dispatch / backup+CI same-day double run) sat in
 *     BOTH prevAnnounced (resolved set) and todayFirst (fresh set via
 *     prev.dayAnnounced carry-over): the identical row printed twice and
 *     the header over-counted '已解除'. resolved must exclude todayFirst
 *     akeys — the fresh §③ row already carries the ✅ mark.
 *  2. latestConcern FIRST-WINS on duplicate akeys — amendAt reuses the
 *     prior human line's `at` for reason-only corrections, so two lines can
 *     share one akey; every other consumer (latestVerdicts, freshMap) is
 *     last-wins. first-wins rendered the superseded reason in resolved rows.
 *  3. landed (上期公告·已生效) was DEAD CODE — it keyed on prev.dayAnnounced,
 *     but under the objection window a pass announced day N only matures on
 *     day N+2's catalog run, by which time dayAnnounced has rolled to day
 *     N+1's first-seen set: a released pass can never still sit in the
 *     previous render's dayAnnounced. prev.announced (cumulative live
 *     candidates) is the membership that actually survives until release —
 *     and self-limits: the released pass leaves candidacy, prunes from
 *     announced, and surfaces exactly once.
 *  4. publish-digest.sh / digest.yml `git add` was outside the retry loop —
 *     a failed add (ignored pathspec exits 1 yet still stages the rest)
 *     let `diff --cached` see the partially-staged digest-state.json and
 *     commit "state without the digest md": the maturity anchor advanced
 *     while the announcement surface silently went missing, all green.
 *     The e2e below drives the real script against a local bare remote whose
 *     catalog branch gitignores digest/ — pre-fix it "succeeded" having
 *     pushed only digest-state.json; post-fix it retries, then exits 1. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderDigest, nextDigestState } from '../pipeline/ai/digest.ts'
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
const DAY1 = new Date('2026-02-01T21:15:00Z')
const DAY1_EVE = new Date('2026-02-01T23:30:00Z')
const DAY2 = new Date('2026-02-02T21:15:00Z')
const sec3 = (md: string) => md.split('## ③')[1]!.split('## ④')[0]!

describe('§6 same-day re-render — resolved concerns must not duplicate the fresh row', () => {
  it('morning-announced concern resolved by an evening pass prints ONCE (fresh row carries ✅)', () => {
    const idx = mkIndex([mkEntry('pkg-a')])
    const concern = v('pkg-a', '1.0.0', 'concern', '2026-02-01T10:00:00Z', 'ai', 'looks bad')
    const pass = v('pkg-a', '1.0.0', 'pass', '2026-02-01T15:00:00Z', 'ai', 'fixed')
    // morning render: only the concern existed → it is announced today
    const s1 = nextDigestState([concern], null, DAY1, idx)
    expect(s1.dayAnnounced).toContain(akey(concern))
    // evening same-day re-render: pass landed at 15:00, resolves the concern
    const md = renderDigest({ index: idx, verdicts: [concern, pass], prev: s1, now: DAY1_EVE })
    const s3 = sec3(md)
    const rows = s3.split('\n').filter(l => l.includes('pkg-a'))
    expect(rows).toHaveLength(1)                       // was 2 before the fix
    expect(rows[0]).toContain('✅已被更新的 pass 解除')
    expect(md).toContain('## ③ Concerns（1）')          // no '·已解除 1' double-count
    expect(md).not.toContain('已解除 1')
  })

  it('yesterday-announced concern resolved today still lands in the resolved list', () => {
    const idx = mkIndex([mkEntry('pkg-a')])
    const concern = v('pkg-a', '1.0.0', 'concern', '2026-02-01T10:00:00Z', 'ai', 'looks bad')
    const pass = v('pkg-a', '1.0.0', 'pass', '2026-02-02T15:00:00Z', 'ai', 'fixed')
    const s1 = nextDigestState([concern], null, DAY1, idx)
    const s2 = nextDigestState([concern], s1, DAY2, idx)   // day2 render: still announced, nothing new
    const md = renderDigest({ index: idx, verdicts: [concern, pass], prev: s2, now: DAY2 })
    const s3 = sec3(md)
    const rows = s3.split('\n').filter(l => l.includes('pkg-a'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('✅已被更新的 pass 解除')
    expect(md).toContain('已解除 1')
  })
})

describe('§6 latestConcern — duplicate akeys keep the LAST (amended) line', () => {
  it('resolved row renders the amended reason, not the superseded one', () => {
    const idx = mkIndex([mkEntry('pkg-a')])
    const at = '2026-02-01T10:00:00Z'
    // amendAt reuses `at` on a reason-only correction → same akey, later line wins
    const stale = v('pkg-a', '1.0.0', 'concern', at, 'ai', 'STALE-REASON')
    const amended = v('pkg-a', '1.0.0', 'concern', at, 'ai', 'FRESH-REASON')
    const pass = v('pkg-a', '1.0.0', 'pass', '2026-02-02T09:00:00Z', 'ai', 'ok')
    const prev: DigestState = {
      lastDigestAt: '2026-02-01T21:15:00Z', day: '2026-02-01',
      dayAnnounced: [], announced: [akey(stale)],
    }
    const md = renderDigest({ index: idx, verdicts: [stale, amended, pass], prev, now: DAY2 })
    const s3 = sec3(md)
    const rows = s3.split('\n').filter(l => l.includes('pkg-a'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('FRESH-REASON')
    expect(rows[0]).not.toContain('STALE-REASON')
  })
})

describe('§6 landed — 上期公告·已生效 keys on cumulative announced, not dayAnnounced', () => {
  const passV = () => v('landed-pkg', '1.0.0', 'pass', '2026-02-01T10:00:00Z', 'ai', 'lgtm')

  it('a pass announced day N and released by day N+2 surfaces in the digest', () => {
    const pending = mkIndex([mkEntry('landed-pkg', { latestVersion: '1.0.0', approval: 'pending' })])
    const approved = mkIndex([mkEntry('landed-pkg', { latestVersion: '1.0.0', approval: 'approved', approvalReason: undefined })])
    const p = passV()
    // real state chain: announce day1, day2 render carries it in announced only
    const s1 = nextDigestState([p], null, DAY1, pending)
    const s2 = nextDigestState([p], s1, DAY2, pending)
    expect(s2.dayAnnounced).not.toContain(akey(p))   // the dead-code trap: dayAnnounced already rolled
    expect(s2.announced).toContain(akey(p))
    // day3 render: catalog released it overnight → landed must fire
    const md = renderDigest({ index: approved, verdicts: [p], prev: s2, now: new Date('2026-02-03T21:15:00Z') })
    expect(md).toContain('上期公告·已生效 1：`landed-pkg`@1.0')
  })

  it('duplicate verdict lines list the release once (akey dedupe)', () => {
    const approved = mkIndex([mkEntry('landed-pkg', { latestVersion: '1.0.0', approval: 'approved', approvalReason: undefined })])
    const p = passV()
    const prev: DigestState = { lastDigestAt: 't', day: '2026-02-02', dayAnnounced: [], announced: [akey(p)] }
    const md = renderDigest({ index: approved, verdicts: [p, { ...p }], prev, now: DAY2 })
    expect(md).toContain('上期公告·已生效 1：`landed-pkg`@1.0')
  })

  it('repo-only entries land too: latestVersion null === verdict version null', () => {
    // github-kind entries carry no versions — schema pins latestVersion:null
    // (run.ts) and verdicts stamp version:null, so the release check matches
    // on null===null and the row renders `name`@∅
    const ghEntry = mkEntry('gh-plugin', {
      source: { kind: 'github', id: 'owner/gh-plugin' },
      latestVersion: null, publishedAt: null, distTags: {},
      approval: 'approved', approvalReason: undefined,
    })
    const p = v('gh-plugin', null, 'pass', '2026-02-01T10:00:00Z', 'human', 'reviewed repo')
    const prev: DigestState = { lastDigestAt: 't', day: '2026-02-02', dayAnnounced: [], announced: [akey(p)] }
    const md = renderDigest({ index: mkIndex([ghEntry]), verdicts: [p], prev, now: DAY2 })
    expect(md).toContain('上期公告·已生效 1：`gh-plugin`@∅')
  })
})

// ── publish-digest.sh e2e: `git add` failure must retry, never false-green ──
// Harness mirrors audit-digest-r8: isolated HOME, local bare "remote" (no
// network, alert() slug-extraction no-ops on a non-github URL). CODED is
// pre-seeded as a main-branch clone with node_modules symlinked to this
// repo's and .deps-stamp pre-written so the script skips npm ci; the
// catalog branch is built minimal (data files only — the script reads no
// source from it). The failure variant gitignores digest/ so `git add
// digest/ digest-state.json` exits 1 while still staging digest-state.json.
const REPO = join(__dirname, '..')
const SCRIPT = join(REPO, 'bin', 'publish-digest.sh')

let e2eRoot: string
let remote: string, home: string, coded: string, catdg: string

const sh = (cmd: string, cwd?: string) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const seedCatalog = (ignoreDigest: boolean) => {
  const wt = join(e2eRoot, `catbuild-${ignoreDigest ? 'ign' : 'ok'}`)
  mkdirSync(wt, { recursive: true })
  sh('git init -q -b catalog', wt)
  writeFileSync(join(wt, 'index.json'), JSON.stringify({
    version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins: [], removed: [],
  }))
  writeFileSync(join(wt, 'ai-verdicts.jsonl'), '')
  writeFileSync(join(wt, 'digest-state.json'), JSON.stringify({
    lastDigestAt: '2026-01-01T21:15:00Z', announced: [], day: '2026-01-01', dayAnnounced: [],
  }))
  if (ignoreDigest) writeFileSync(join(wt, '.gitignore'), 'digest/\n')
  // -f: each seed builds an unrelated history in a fresh dir — the disposable
  // test remote has no use for fast-forward discipline
  sh(`git add -A && git -c user.email=t@t -c user.name=t commit -qm catalog && git remote add origin "${remote}" && git push -qf origin catalog`, wt)
}

const catalogTip = () => sh(`git ls-remote "${remote}" refs/heads/catalog`).split(/\s/)[0]

beforeAll(() => {
  e2eRoot = mkdtempSync(join(tmpdir(), 'pdg-add-'))
  home = join(e2eRoot, 'home')
  coded = join(home, '.local', 'share', 'opencode-market-code-digest')
  catdg = join(home, '.local', 'share', 'opencode-market-catalog-digest')
  remote = join(e2eRoot, 'remote.git')
  // bare remote carrying this repo's main (CODED renders from it).
  // pull_request checkouts are detached HEADs — the bare clone gets no
  // 'main' ref and the --branch main clone below dies. Pin one to HEAD.
  sh(`git clone -q --bare "${REPO}" "${remote}"`)
  const head = sh(`git -C "${REPO}" rev-parse HEAD`).trim()
  sh(`git -C "${remote}" update-ref refs/heads/main "${head}" && git -C "${remote}" symbolic-ref HEAD refs/heads/main`)
  // pre-seed CODED: pinned main + deps stamp + node_modules link (skip npm ci)
  sh(`git clone -q --depth=1 --single-branch --branch main "${remote}" "${coded}"`)
  symlinkSync(join(REPO, 'node_modules'), join(coded, 'node_modules'), 'dir')
  const lockHash = sh(`shasum -a 256 "${coded}/package-lock.json"`).split(/\s/)[0]
  writeFileSync(join(coded, '.deps-stamp'), `${lockHash}\n`)
}, 120_000)

afterAll(() => rmSync(e2eRoot, { recursive: true, force: true }))

const runScript = () => spawnSync('bash', [SCRIPT], {
  env: {
    ...process.env, HOME: home,
    MARKET_GIT_URL: remote, MARKET_REPO: join(e2eRoot, 'no-such-repo'),
  },
  encoding: 'utf8', timeout: 180_000,
})

describe('publish-digest.sh — git add failure retries instead of false-green', () => {
  it('control: clean catalog branch publishes digest md + state and pushes', () => {
    rmSync(catdg, { recursive: true, force: true })
    seedCatalog(false)
    const before = catalogTip()
    const r = runScript()
    expect(r.status).toBe(0)
    // empty index + unchanged verdicts → state still advances (day rolls) so a
    // real commit lands; assert the remote tip MOVED and carries the md
    expect(catalogTip()).not.toBe(before)
    const wt = join(e2eRoot, 'verify-ok')
    sh(`git clone -q "${remote}" "${wt}"`)
    sh('git checkout -q catalog', wt)
    const day = new Date().toISOString().slice(0, 10)
    expect(existsSync(join(wt, 'digest', `${day}.md`))).toBe(true)
    expect(JSON.parse(readFileSync(join(wt, 'digest-state.json'), 'utf8')).day).toBe(day)
  }, 200_000)

  it('ignored digest/ → add fails every attempt → exit 1, remote untouched (no state-only commit)', () => {
    rmSync(catdg, { recursive: true, force: true })
    seedCatalog(true)
    const before = catalogTip()
    const r = runScript()
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('add attempt')
    expect(r.stdout).not.toContain('nothing changed vs origin')
    // the partial-stage poison must NOT have been committed: remote tip identical
    expect(catalogTip()).toBe(before)
  }, 200_000)
})
