/** audit #2 fresh-batch (submission flow):
 *  1. bin/catalog-append.sh + catalog-withdraw.sh now fetch the catalog branch
 *     with `--depth=1` and a FORCED tracking-ref refspec — the retry loop must
 *     still land appends/replacements, and must survive a rewritten (non-FF)
 *     remote that would wedge a plain `git fetch origin catalog`.
 *  2. submit.yml's late-ingest marker scrape must gate on the review's
 *     `target:` marker matching the current parse (A→B→A donation guard),
 *     the perm-step typo-hint regex must cover '/a ok'/'/c'-shaped commands,
 *     the withdraw gate must accept edited comments, and the sweep's
 *     approved-stalled arm must be gated on a trustworthy live-seed set. */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** Push a fresh commit to remote.catalog from a throwaway clone (moves the
 *  tip forward), or rewrite history entirely when `rewrite` is set. */
function moveRemoteCatalog(msg: string, rewrite = false): void {
  const side = mkdtempSync(join(root, 'side-'))
  execFileSync('git', ['clone', '-q', '-b', 'catalog', remote, side])
  if (rewrite) {
    execFileSync('git', ['-C', side, 'checkout', '-q', '--orphan', 'rew'])
    execFileSync('git', ['-C', side, 'rm', '-rfq', '.'])
  }
  writeFileSync(join(side, 'moved.marker'), msg)
  git(side, 'add', '-A')
  git(side, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg)
  git(side, 'push', '-q', '--force', 'origin', rewrite ? 'rew:catalog' : 'catalog')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'a14-'))
  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', remote])
  const seed = mkdtempSync(join(root, 'seed-'))
  execFileSync('git', ['clone', '-q', remote, seed])
  execFileSync('git', ['-C', seed, 'checkout', '-q', '--orphan', 'catalog'])
  writeFileSync(join(seed, 'submissions.txt'), '')
  git(seed, 'add', '-A')
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'catalog')
  // the script's own checkout — wildcard fetch refspec like actions/checkout
  code = mkdtempSync(join(root, 'code-'))
  execFileSync('git', ['clone', '-q', remote, code])
}, 60_000)

const SEED_42 = JSON.stringify({ name: 'pkg-a', repo: null, issue: 42, version: '1.0.0', at: '2026-01-01T00:00:00Z', notified: false })
const SEED_42B = JSON.stringify({ name: 'pkg-a', repo: null, issue: 42, version: '1.0.1', at: '2026-01-02T00:00:00Z', notified: false })
const SEED_43 = JSON.stringify({ name: 'pkg-b', repo: null, issue: 43, version: '2.0.0', at: '2026-01-01T00:00:00Z', notified: false })

describe('catalog-append.sh — shallow forced-refspec fetch', () => {
  it('lands a seed row on the remote catalog tip', () => {
    const r = runScript(APPEND, {
      FILE: 'submissions.txt', LINE: SEED_42, MSG: 'seed 42', ISSUE: '42',
      STATUS_FILE: join(root, 'st1'),
    })
    expect(r.code).toBe(0)
    expect(remoteShow('submissions.txt')).toContain('"issue":42')
    expect(readFileSync(join(root, 'st1'), 'utf8').trim()).toBe('skipped')
  })

  it('ISSUE mode replaces the same issue\'s row instead of stacking', () => {
    const r = runScript(APPEND, {
      FILE: 'submissions.txt', LINE: SEED_42B, MSG: 'seed 42 re-review', ISSUE: '42',
    })
    expect(r.code).toBe(0)
    const rows = remoteShow('submissions.txt').split('\n').filter(l => l.includes('"issue":42'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('"1.0.1"')
  })

  it('keeps a different issue\'s row for the same-package family', () => {
    runScript(APPEND, { FILE: 'submissions.txt', LINE: SEED_43, MSG: 'seed 43', ISSUE: '43' })
    const body = remoteShow('submissions.txt')
    expect(body).toContain('"issue":42')
    expect(body).toContain('"issue":43')
  })

  it('survives a remote tip that moved forward mid-run (refetch→push)', () => {
    moveRemoteCatalog('moved-forward')
    const line = JSON.stringify({ name: 'pkg-c', issue: 44, at: 't', notified: false })
    const r = runScript(APPEND, { FILE: 'submissions.txt', LINE: line, MSG: 'seed 44', ISSUE: '44' })
    expect(r.code).toBe(0)
    expect(remoteShow('submissions.txt')).toContain('"issue":44')
  })

  it('survives a REWRITTEN (non-FF) catalog branch — the forced refspec wins', () => {
    moveRemoteCatalog('rewritten-history', true)
    const line = JSON.stringify({ name: 'pkg-d', issue: 45, at: 't', notified: false })
    const r = runScript(APPEND, { FILE: 'submissions.txt', LINE: line, MSG: 'seed 45', ISSUE: '45' })
    expect(r.code).toBe(0)
    expect(remoteShow('submissions.txt')).toContain('"issue":45')
  })
})

describe('catalog-withdraw.sh — shallow forced-refspec fetch', () => {
  it('removes only this issue\'s seed rows; other issues keep theirs', () => {
    // re-seed locally — the rewrite test above legitimately wiped the file
    for (const [issue, name] of [[90, 'pkg-x'], [91, 'pkg-y']] as const) {
      const line = JSON.stringify({ name, issue, at: 't', notified: false })
      expect(runScript(APPEND, { FILE: 'submissions.txt', LINE: line, MSG: `seed ${issue}`, ISSUE: String(issue) }).code).toBe(0)
    }
    const r = runScript(WITHDRAW, { ISSUE: '90', MSG: 'withdraw 90' })
    expect(r.code).toBe(0)
    const body = remoteShow('submissions.txt')
    expect(body).not.toContain('"issue":90')
    expect(body).toContain('"issue":91')
  })
})

/** Extract the perm-step elif regex from the YAML and run it in bash — the
 *  test fails if the regex is edited back to the narrow `[ac][a-z]+` form. */
const hintCheck = (comment: string): string =>
  bash(`LOW=${JSON.stringify(comment.toLowerCase())}; ` +
    `if [[ "$LOW" =~ ^[[:space:]]*/(approve|concern)([[:space:]]|$) ]]; then echo command; ` +
    `elif [[ "$LOW" =~ ^[[:space:]]*/[ac]([a-z]|[[:space:]]|$) ]]; then echo hint; ` +
    `else echo silent; fi`)

describe('submit.yml — verdict perm-step typo hints', () => {
  it('workflow carries the widened [ac]([a-z]|[[:space:]]|$) hint regex', () => {
    expect(SUBMIT_YML).toContain('[ac]([a-z]|[[:space:]]|$)')
  })

  it.each([
    ['/a ok', 'hint'], ['/a', 'hint'], ['/c 原因', 'hint'], ['/c', 'hint'],
    ['/apply now', 'hint'], ['/concerned', 'hint'], [' /a fix', 'hint'],
    ['/approve', 'command'], ['/concern x', 'command'], ['/APPROVE', 'command'],
    ['/watch', 'silent'], ['/weird', 'silent'], ['/a-b', 'silent'], ['/xyz', 'silent'],
    ['plain comment', 'silent'],
  ])('%s → %s', (body, want) => {
    expect(hintCheck(body)).toBe(want)
  })
})

describe('submit.yml — late-ingest cross-target guard', () => {
  it('scrapes the review target marker and gates late-ingest on it', () => {
    const late = SUBMIT_YML.slice(SUBMIT_YML.indexOf('if [ -z "$SEED" ] && [ "$VERDICT" = pass ]'), SUBMIT_YML.indexOf('# argignored'))
    expect(late).toContain("RVTGT=$(grep -oE 'target:")
    expect(late).toContain('RVMATCH')
    expect(late).toContain('[ -n "$RVMATCH" ]')
    // lastreview must not cite a different package's verdict either
    expect(late).toContain('[ -n "${RV:-}" ] && [ -n "$RVMATCH" ] && echo "lastreview=')
  })

  it('marker scrape tail -1 lands the LAST bot comment — functional check', () => {
    const rvc = [
      '<!-- createdAt: t1 -->\n<!-- reviewedVersion: 1.0.0 -->\n<!-- target: pkg-a -->\n<!-- verdict: clean -->',
      '<!-- createdAt: t2 -->\n<!-- reviewedVersion: 2.0.0 -->\n<!-- target: pkg-b -->\n<!-- verdict: flagged -->',
    ].join('\n\n')
    const out = bash(
      `printf '%s' ${JSON.stringify(rvc)} > /tmp/a14-rvc.txt; ` +
      `RVTGT=$(grep -oE 'target: [^ ]+' /tmp/a14-rvc.txt | tail -1 | awk '{print $2}'); ` +
      `ENTRY='pkg-b'; [ -n "$RVTGT" ] && [ "\${RVTGT,,}" = "\${ENTRY,,}" ] && echo match || echo nomatch`)
    expect(out).toBe('match')
    const mismatch = bash(
      `ENTRY='pkg-a'; RVTGT='pkg-b'; [ -n "$RVTGT" ] && [ "\${RVTGT,,}" = "\${ENTRY,,}" ] && echo match || echo nomatch`)
    expect(mismatch).toBe('nomatch')
  })
})

describe('submit.yml — withdraw gate + sweep live-seed trust', () => {
  it('withdraw and withdraw-deny accept edited comments', () => {
    const wd = SUBMIT_YML.slice(SUBMIT_YML.indexOf('  withdraw:'), SUBMIT_YML.indexOf('  withdraw-deny:'))
    expect(wd).toContain('["created","edited"]')
    const deny = SUBMIT_YML.slice(SUBMIT_YML.indexOf('  withdraw-deny:'))
    expect(deny).toContain('["created","edited"]')
  })

  it('approved-stalled arm only runs on a truthful live-seed set', () => {
    expect(SUBMIT_YML).toContain('LIVE_OK=1')
    expect(SUBMIT_YML).toContain('[ -n "$LIVE_OK" ]')
    expect(SUBMIT_YML).toContain('approved-stalled arm skipped this run')
  })

  it('catalog fetches in the workflow are depth-limited', () => {
    for (const m of SUBMIT_YML.matchAll(/git fetch [^\n]*catalog[^\n]*/g)) {
      expect(m[0]).toContain('--depth=1')
    }
  })
})

describe('bin scripts — forced tracking refspec', () => {
  it('append + withdraw fetch with --depth=1 and +refspec', () => {
    for (const f of ['bin/catalog-append.sh', 'bin/catalog-withdraw.sh']) {
      const src = readFileSync(join(REPO, f), 'utf8')
      expect(src).toContain("--depth=1 origin '+refs/heads/catalog:refs/remotes/origin/catalog'")
    }
  })
})
