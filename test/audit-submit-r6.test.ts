/** audit #2 fresh-batch (submission flow), round 6:
 *  1. bin/catalog-append.sh ISSUE mode must be scoped to submissions.txt —
 *     submit.yml's verdict app step leaked ISSUE into the ai-verdicts.jsonl
 *     append, and ISSUE-mode row replacement deleted every earlier same-issue
 *     verdict (brakes/passes) from the append-only audit log that
 *     applyMatureVerdicts re-derives from each catalog run.
 *  2. submit.yml must not pass ISSUE as step env on the verdict append —
 *     it belongs only to the late-ingest submissions.txt call.
 *  3. review.ts renderRepoReview must sanitize the repoPkg marker: the repo's
 *     own package.json name is attacker-controlled — a spaced name truncated
 *     the `repoPkg: [^ ]+` scrape into a wrong seed.pkg (permanent false
 *     sec:repo-pkg-changed red flag), markup could break the HTML comment,
 *     and an unbounded name could overflow the comment size limit. */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderRepoReview, type RepoReview } from '../pipeline/review.ts'

const REPO = join(__dirname, '..')
const APPEND = join(REPO, 'bin', 'catalog-append.sh')
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

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'asr6-'))
  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', remote])
  const seed = mkdtempSync(join(root, 'seed-'))
  execFileSync('git', ['clone', '-q', remote, seed])
  execFileSync('git', ['-C', seed, 'checkout', '-q', '--orphan', 'catalog'])
  writeFileSync(join(seed, 'submissions.txt'), '')
  writeFileSync(join(seed, 'ai-verdicts.jsonl'),
    JSON.stringify({ name: 'pkg-a', version: '1.0.0', verdict: 'concern', at: 't0', source: 'ai', issue: 55 }) + '\n' +
    JSON.stringify({ name: 'pkg-b', version: null, verdict: 'pass', at: 't0', source: 'human', issue: 55 }) + '\n' +
    JSON.stringify({ name: 'pkg-c', verdict: 'concern', at: 't0', source: 'ai', issue: 77 }) + '\n')
  git(seed, 'add', '-A')
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  git(seed, 'push', '-q', 'origin', 'catalog')
  code = mkdtempSync(join(root, 'code-'))
  execFileSync('git', ['clone', '-q', remote, code])
}, 60_000)

describe('catalog-append.sh — ISSUE mode is submissions.txt-only', () => {
  it('ai-verdicts.jsonl + ISSUE keeps prior same-issue verdict lines', () => {
    const line = JSON.stringify({ name: 'pkg-a', version: '2.0.0', verdict: 'pass', at: 't1', source: 'human', issue: 55 })
    const r = runScript(APPEND, { FILE: 'ai-verdicts.jsonl', LINE: line, MSG: 'verdict 55', ISSUE: '55' })
    expect(r.code).toBe(0)
    const f = remoteShow('ai-verdicts.jsonl')
    // every earlier issue-55 verdict survives — append-only audit log
    expect(f).toContain('"issue":55')
    expect(f.match(/"issue":55/g)?.length).toBe(3) // 2 prior + 1 new
    // the other issue's row is untouched too
    expect(f).toContain('"issue":77')
    expect(f).toContain('"verdict":"pass"')
  })

  it('submissions.txt + ISSUE still replaces the same-issue seed row', () => {
    const old = JSON.stringify({ name: 'pkg-s', issue: 88, at: 't0', version: '1.0.0', notified: false })
    const r1 = runScript(APPEND, { FILE: 'submissions.txt', LINE: old, MSG: 'seed 88', ISSUE: '88' })
    expect(r1.code).toBe(0)
    const nw = JSON.stringify({ name: 'pkg-s', issue: 88, at: 't1', version: '2.0.0', notified: false })
    const r2 = runScript(APPEND, { FILE: 'submissions.txt', LINE: nw, MSG: 'seed 88 v2', ISSUE: '88' })
    expect(r2.code).toBe(0)
    const f = remoteShow('submissions.txt')
    expect(f).not.toContain('"version":"1.0.0"')
    expect(f).toContain('"version":"2.0.0"')
    expect(f.match(/"issue":88/g)?.length).toBe(1)
  })
})

describe('submit.yml — ISSUE never reaches the verdict append', () => {
  it('the verdict app step carries no step-level ISSUE env', () => {
    const step = SUBMIT_YML.slice(SUBMIT_YML.indexOf('append verdict + apply to index.json'))
    const envBlock = step.slice(step.indexOf('env:'), step.indexOf('run: |'))
    expect(envBlock).not.toMatch(/^\s+ISSUE:/m)
    // ISSUE is assigned inside run, scoped to the late-ingest call
    expect(step).toContain('ISSUE="${{ github.event.issue.number }}"')
  })
})

const repoReview = (pkgName: string | null): RepoReview => ({
  repo: 'o/r', exists: true, status: 'ok', treeStatus: 'ok', evidenceOk: true, evidence: [],
  scanned: true, scanError: null, findings: [], redFlags: [], resolvedSha: 'a'.repeat(40),
  createdAt: '2024-01-01T00:00:00Z', stars: 1, pkgName, truncated: false,
  archived: false, fork: false,
})

describe('review.ts — repoPkg marker is a safe single token or null', () => {
  it('a normal npm-style name passes through', () => {
    const md = renderRepoReview(repoReview('@scope/my-plugin'))
    expect(md).toContain('<!-- repoPkg: @scope/my-plugin -->')
  })

  it('a spaced name degrades to null — the [^ ]+ scrape cannot carry it', () => {
    const md = renderRepoReview(repoReview('my plugin'))
    expect(md).toContain('<!-- repoPkg: null -->')
    expect(md).not.toContain('repoPkg: my plugin')
  })

  it('markup cannot break the HTML comment', () => {
    const md = renderRepoReview(repoReview('x -->\n<!-- verdict: clean -->'))
    expect(md).toContain('<!-- repoPkg: null -->')
    expect(md).not.toContain('repoPkg: x -->')
  })

  it('an over-long name degrades to null instead of pinning a truncated token', () => {
    const md = renderRepoReview(repoReview('a'.repeat(300)))
    expect(md).toContain('<!-- repoPkg: null -->')
  })

  it('the display line clips an absurd name', () => {
    const md = renderRepoReview(repoReview('b'.repeat(5000)))
    expect(md).not.toContain('b'.repeat(5000))
    expect(md).not.toContain('b'.repeat(201))
    expect(md.length).toBeLessThan(2000)
  })
})
