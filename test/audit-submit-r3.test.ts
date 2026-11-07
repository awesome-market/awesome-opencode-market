/** audit #2 fresh-batch (submission flow):
 *  1. bin/catalog-{append,withdraw}.sh recover from a stale worktree
 *     REGISTRATION at $WT (dir deleted, registration left behind) — the old
 *     loop hit 'missing but registered worktree' on every retry; prune fixes.
 *  2. submit.yml's verdict-job repo SHA pin must reject non-hex `s.version`
 *     values — a name+repo seed found via s.repo carries an npm
 *     reviewedVersion, not a commit sha, and pinning it wedges shaOk.
 *  3. submit.yml's edited-skip must require a COMPLETE prior-comment history
 *     (PRIOR_FULL) — markers scraped from a truncated prefix can resurrect an
 *     old clean review over a newer flagged one.
 *  4. applySeedOutcomes clears `rejected` when the repo twin of a name+repo
 *     seed landed (notify-published/submission-status parity). */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySeedOutcomes } from '../pipeline/seed-outcome.ts'

const REPO = join(__dirname, '..')
const APPEND = join(REPO, 'bin', 'catalog-append.sh')
const WITHDRAW = join(REPO, 'bin', 'catalog-withdraw.sh')
const SUBMIT_YML = readFileSync(join(REPO, '.github/workflows/submit.yml'), 'utf8')

let root: string, remote: string, code: string

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const remoteShow = (name: string): string => {
  try { return execFileSync('git', ['-C', remote, 'show', `catalog:${name}`], { encoding: 'utf8' }) }
  catch { return '' }
}
const runScript = (script: string, env: Record<string, string>): { code: number; out: string } => {
  const r = spawnSync('bash', [script], {
    cwd: code, env: { ...process.env, WT: join(root, 'wt-scratch'), ...env },
    encoding: 'utf8', timeout: 60_000,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const bash = (script: string): string =>
  execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim()

/** Leave a worktree REGISTRATION without a directory at $WT — the state that
 *  made `worktree add` fail 'missing but registered' on every retry. */
function plantStaleWorktreeRegistration(): void {
  const wt = join(root, 'wt-scratch')
  mkdirSync(wt, { recursive: true })
  // origin/catalog — the clone's HEAD may be unborn (remote has no main)
  git(code, 'worktree', 'add', wt, 'origin/catalog', '--detach')
  rmSync(wt, { recursive: true, force: true })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'asr3-'))
  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', remote])
  const seed = mkdtempSync(join(root, 'seed-'))
  execFileSync('git', ['clone', '-q', remote, seed])
  execFileSync('git', ['-C', seed, 'checkout', '-q', '--orphan', 'catalog'])
  writeFileSync(join(seed, 'submissions.txt'), '')
  git(seed, 'add', '-A')
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'catalog')
  code = mkdtempSync(join(root, 'code-'))
  execFileSync('git', ['clone', '-q', remote, code])
}, 60_000)

describe('bin scripts — stale worktree registration recovery', () => {
  it('catalog-append.sh lands despite a missing-but-registered $WT', () => {
    plantStaleWorktreeRegistration()
    const line = JSON.stringify({ name: 'pkg-w', issue: 77, at: 't', notified: false })
    const r = runScript(APPEND, { FILE: 'submissions.txt', LINE: line, MSG: 'seed 77', ISSUE: '77' })
    expect(r.code).toBe(0)
    expect(remoteShow('submissions.txt')).toContain('"issue":77')
  })

  it('catalog-withdraw.sh lands despite a missing-but-registered $WT', () => {
    plantStaleWorktreeRegistration()
    const r = runScript(WITHDRAW, { ISSUE: '77', MSG: 'withdraw 77' })
    expect(r.code).toBe(0)
    expect(remoteShow('submissions.txt')).not.toContain('"issue":77')
  })

  it('both bin scripts prune worktree registrations inside the retry loop', () => {
    for (const f of ['bin/catalog-append.sh', 'bin/catalog-withdraw.sh']) {
      expect(readFileSync(join(REPO, f), 'utf8')).toContain('git worktree prune')
    }
  })

  it('catalog-append.sh grep line-dedupe is option-injection safe', () => {
    expect(readFileSync(join(REPO, 'bin', 'catalog-append.sh'), 'utf8')).toContain('grep -qxF -- "$LINE"')
  })
})

describe('submit.yml — repo verdict sha pin rejects non-sha seed versions', () => {
  it('the KIND=repo SHA path hex-validates the seed version before trusting it', () => {
    const repoBlock = SUBMIT_YML.slice(
      SUBMIT_YML.indexOf('if [ "$KIND" = repo ]; then'),
      SUBMIT_YML.indexOf('if [ -z "$SHA" ] && [ -s /tmp/index.json ]'),
    )
    expect(repoBlock).toContain('[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || SHA=""')
  })

  it('semver seed versions are rejected; commit-shas pass — functional check', () => {
    const check = (v: string) => bash(`SHA=${JSON.stringify(v)}; [[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || SHA=""; printf '%s' "$SHA"`)
    expect(check('1.2.3')).toBe('')
    expect(check('v1.2.3')).toBe('')
    expect(check('a'.repeat(40))).toBe('a'.repeat(40))
    expect(check('abcdef1')).toBe('abcdef1')
    expect(check('ABCDEF1'.toLowerCase())).toBe('abcdef1')
  })

  it('SEED lookup prefers this issue\'s row over another issue\'s same-package seed', () => {
    // own row is OLDER (row 1) than the other issue's (row 3) — own must win:
    // the verdict pins the artifact THIS issue's review scanned
    const file = join(root, 'seeds-pref.txt')
    writeFileSync(file, [
      JSON.stringify({ name: 'p', issue: 10, version: '1.0.0' }),
      JSON.stringify({ name: 'q', issue: 11, version: '9.9.9' }),
      JSON.stringify({ name: 'p', issue: 20, version: '2.0.0' }),
    ].join('\n'))
    const out = bash(
      `ISSUE_NUM=10 SUB_NAME='p' SUB_REPO='' node -e '
        const i=require("fs").readFileSync(process.argv[1],"utf8")
        const n=process.env.SUB_NAME||"", r=process.env.SUB_REPO||""
        const iss=Number(process.env.ISSUE_NUM||0)
        let hit=null, own=null
        for(const l of i.split("\\n")){try{const s=JSON.parse(l)
          const m=n&&s.name?.toLowerCase()===n.toLowerCase()||(!n&&r&&s.repo?.toLowerCase()===r.toLowerCase())
          if(m){hit=s;if(s.issue===iss)own=s}}catch{}}
        const pick=own??hit
        if(pick)console.log(JSON.stringify(pick))' ${file}`)
    expect(JSON.parse(out).version).toBe('1.0.0')
    // no own row → falls back to the last any-issue match (preserved semantics)
    const out2 = bash(
      `ISSUE_NUM=99 SUB_NAME='p' SUB_REPO='' node -e '
        const i=require("fs").readFileSync(process.argv[1],"utf8")
        const n=process.env.SUB_NAME||"", r=process.env.SUB_REPO||""
        const iss=Number(process.env.ISSUE_NUM||0)
        let hit=null, own=null
        for(const l of i.split("\\n")){try{const s=JSON.parse(l)
          const m=n&&s.name?.toLowerCase()===n.toLowerCase()||(!n&&r&&s.repo?.toLowerCase()===r.toLowerCase())
          if(m){hit=s;if(s.issue===iss)own=s}}catch{}}
        const pick=own??hit
        if(pick)console.log(JSON.stringify(pick))' ${file}`)
    expect(JSON.parse(out2).version).toBe('2.0.0')
  })
})

describe('submit.yml — edited-skip requires a complete comment history', () => {
  const skipBlock = SUBMIT_YML.slice(
    SUBMIT_YML.indexOf('SKIPSCAN=""'),
    SUBMIT_YML.indexOf('if [ -n "${BLOCKED:-}" ]'),
  )

  it('gates SKIPSCAN on PRIOR_FULL', () => {
    expect(skipBlock).toContain('PRIOR_FULL')
    expect(skipBlock).toContain('[ -n "$PRIOR_FULL" ] && [ "$PV" = "clean" ]')
  })

  it('marks history complete only on a short/empty terminal page', () => {
    expect(skipBlock).toContain('{ PRIOR_FULL=1; break; }')
    // a natural loop exit (page budget hit with a full page) leaves PRIOR_FULL
    // unset → no skip — this is the truncated-history guard doing its job
    expect(skipBlock).toContain('PRIOR_FULL=""')
  })

  it('anonymous pagination budget raised past the old 5-page cap', () => {
    expect(skipBlock).toContain('$(seq 1 20)')
    expect(skipBlock).not.toContain('for p in 1 2 3 4 5; do')
  })
})

/** Push a fresh catalog tip carrying the given files (tests seed their own
 *  branch state; scripts always fetch origin/catalog fresh in the retry
 *  loop, so the code clone's stale view doesn't matter). */
const seedCatalog = (files: Record<string, string>) => {
  const c = mkdtempSync(join(root, 'cat-'))
  execFileSync('git', ['clone', '-q', remote, c])
  try { git(c, 'checkout', '-q', '-b', 'cat', 'origin/catalog') }
  catch { git(c, 'checkout', '-q', '--orphan', 'cat') }
  for (const [n, data] of Object.entries(files)) writeFileSync(join(c, n), data)
  git(c, 'add', '-A')
  git(c, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed')
  git(c, 'push', '-q', 'origin', 'HEAD:catalog')
}
const pendingEntry = (name: string, repo?: string) => ({
  name, slug: name.replace('/', '-'), approval: 'pending',
  source: repo ? { kind: 'github', id: name, repo } : { kind: 'npm', id: name },
  discoveredVia: ['submission'],
})

describe('catalog-withdraw.sh — full key set retracts every submission pending entry', () => {
  it('name+repo seed retracts BOTH the npm twin and the github repo twin', () => {
    seedCatalog({
      'submissions.txt': JSON.stringify({ name: 'wd-pkg', repo: 'o/wd-repo', issue: 91, at: 't', notified: false }) + '\n',
      'index.json': JSON.stringify({ plugins: [pendingEntry('wd-pkg'), pendingEntry('o/wd-repo', 'o/wd-repo')] }),
    })
    const r = runScript(WITHDRAW, { ISSUE: '91', MSG: 'withdraw 91' })
    expect(r.code).toBe(0)
    const idx = JSON.parse(remoteShow('index.json'))
    expect(idx.plugins).toHaveLength(0)
    expect(idx.removed.map((x: { name: string }) => x.name).sort()).toEqual(['o/wd-repo', 'wd-pkg'])
  })

  it('keys from EVERY removed row are collected, not just the last row', () => {
    seedCatalog({
      'submissions.txt': [
        JSON.stringify({ name: 'wd-a', issue: 92, at: 't', notified: false }),
        JSON.stringify({ name: 'wd-b', issue: 92, at: 't', notified: false }),
      ].join('\n') + '\n',
      'index.json': JSON.stringify({ plugins: [pendingEntry('wd-a'), pendingEntry('wd-b')] }),
    })
    const r = runScript(WITHDRAW, { ISSUE: '92', MSG: 'withdraw 92' })
    expect(r.code).toBe(0)
    const idx = JSON.parse(remoteShow('index.json'))
    expect(idx.plugins).toHaveLength(0)
  })

  it('approved or organically-discovered entries are kept despite key match', () => {
    const approved = { ...pendingEntry('wd-live'), approval: 'approved' }
    const organic = { ...pendingEntry('wd-org'), discoveredVia: ['submission', 'search'] }
    seedCatalog({
      'submissions.txt': JSON.stringify({ name: 'wd-live', repo: 'wd-org', issue: 93, at: 't', notified: false }) + '\n',
      'index.json': JSON.stringify({ plugins: [approved, organic] }),
    })
    const r = runScript(WITHDRAW, { ISSUE: '93', MSG: 'withdraw 93' })
    expect(r.code).toBe(0)
    const idx = JSON.parse(remoteShow('index.json'))
    expect(idx.plugins.map((e: { name: string }) => e.name).sort()).toEqual(['wd-live', 'wd-org'])
    expect(remoteShow('submissions.txt')).not.toContain('"issue":93')
  })
})

describe('submit.yml — sweep failure is alerted, not silent', () => {
  it('review-alert waits on sweep and fires for schedule runs', () => {
    const alertBlock = SUBMIT_YML.slice(SUBMIT_YML.indexOf('review-alert:'))
    expect(alertBlock).toContain('needs: [review, report, ingest, sweep]')
    expect(alertBlock).toContain("github.event_name == 'schedule'")
    expect(alertBlock).toContain('pipeline-alert')
  })
})

describe('seed-outcome — repo-twin landing clears the rejected stamp', () => {
  const rejectedSeed = JSON.stringify({ name: 'p', repo: 'o/r', issue: 3, rejected: 'no-plugin-evidence' })
  const ghEntry = { name: 'o/r', source: { repo: 'o/r' } }

  it('name rejected but repo twin in index → stamp cleared', () => {
    const out = applySeedOutcomes([rejectedSeed], {}, { plugins: [ghEntry] })
    expect(JSON.parse(out[0]!).rejected).toBeUndefined()
  })

  it('entry landed by npm name still clears (unchanged behavior)', () => {
    const out = applySeedOutcomes([rejectedSeed], {}, { plugins: [{ name: 'p' }] })
    expect(JSON.parse(out[0]!).rejected).toBeUndefined()
  })

  it('no landing anywhere → stamp kept', () => {
    const out = applySeedOutcomes([rejectedSeed], {}, { plugins: [] })
    expect(JSON.parse(out[0]!).rejected).toBe('no-plugin-evidence')
  })

  it('a this-run rejection code still wins over a repo-twin landing', () => {
    const out = applySeedOutcomes([rejectedSeed], { p: 'blocklisted' }, { plugins: [ghEntry] })
    expect(JSON.parse(out[0]!).rejected).toBe('blocklisted')
  })
})
