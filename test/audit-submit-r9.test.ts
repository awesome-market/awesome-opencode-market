/** audit #2 fresh round (submission flow), round 9:
 *  1. catalog-append.sh's APPLY path `mv`s release.ts output over index.json
 *     with no `-s` guard — a release.ts that exits 0 but emits NOTHING
 *     truncates the catalog index and pushes the empty file (same failure
 *     shape catalog.yml's release fold guards; the verdict/heal paths hit it
 *     via APPLY_INDEX/APPLY_ONLY).
 *  2. catalog-withdraw.sh touched + unconditionally staged submissions.txt —
 *     on a catalog branch WITHOUT the file, /withdraw committed a stray
 *     empty submissions.txt. The fix must still let ENTRY tombstoning run
 *     (a pending submission-only entry can outlive its seed row).
 *  3. parseSubmission did not lowercase `name` — an issue form typed 'MyPkg'
 *     was passed verbatim to review.ts → GET /MyPkg misses the lowercase
 *     npm doc-id → false 'invalid: package not found'.
 *  4. submit.yml command gates admitted ≤1 leading space while the in-step
 *     [[:space:]] parsers accept arbitrary whitespace — '  /approve' missed
 *     the verdict/withdraw jobs AND the review exclusion. */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSubmission } from '../pipeline/submission.ts'

const REPO = join(__dirname, '..')
const APPEND = join(REPO, 'bin', 'catalog-append.sh')
const WITHDRAW = join(REPO, 'bin', 'catalog-withdraw.sh')
const SUBMIT_YML = readFileSync(join(REPO, '.github/workflows/submit.yml'), 'utf8')

let root: string, remote: string, code: string, stubbin: string

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const remoteShow = (name: string): string => {
  try { return execFileSync('git', ['-C', remote, 'show', `catalog:${name}`], { encoding: 'utf8' }) }
  catch { return '' }
}
const remoteLog = () => git(remote, 'log', 'catalog', '--oneline').split('\n').filter(Boolean)
const runScript = (script: string, env: Record<string, string>): { code: number; out: string } => {
  const r = spawnSync('bash', [script], {
    cwd: code,
    env: { ...process.env, PATH: `${stubbin}:${process.env.PATH}`, WT: join(root, `wt-${Math.random().toString(36).slice(2)}`), ...env },
    encoding: 'utf8', timeout: 60_000,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const seedCatalog = (files: Record<string, string>) => {
  const s = mkdtempSync(join(root, 'seed-'))
  execFileSync('git', ['clone', '-q', remote, s])
  execFileSync('git', ['-C', s, 'checkout', '-q', 'catalog'])
  for (const [f, c] of Object.entries(files)) writeFileSync(join(s, f), c)
  git(s, 'add', '-A')
  git(s, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed')
  git(s, 'push', '-q', 'origin', 'catalog')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'asr9-'))
  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', remote])
  const s = mkdtempSync(join(root, 'init-'))
  execFileSync('git', ['clone', '-q', remote, s])
  execFileSync('git', ['-C', s, 'checkout', '-q', '--orphan', 'catalog'])
  writeFileSync(join(s, 'index.json'), JSON.stringify({ plugins: [], removed: [] }, null, 2) + '\n')
  git(s, 'add', '-A')
  git(s, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  git(s, 'push', '-q', 'origin', 'catalog')
  code = mkdtempSync(join(root, 'code-'))
  execFileSync('git', ['clone', '-q', remote, code])
  // stub npx: release.ts that exits 0 but emits nothing — the empty-output
  // shape the -s guard exists to catch. `npx tsx … > index.new.json` still
  // runs through the redirect, so the file exists but is zero bytes.
  stubbin = join(root, 'stubbin')
  mkdirSync(stubbin, { recursive: true })
  writeFileSync(join(stubbin, 'npx'), '#!/bin/bash\nexit 0\n')
  chmodSync(join(stubbin, 'npx'), 0o755)
}, 60_000)

describe('catalog-append.sh — apply never truncates index.json on empty release output', () => {
  it('APPLY_ONLY with an empty release.ts emit degrades and keeps the index intact', () => {
    const index = remoteShow('index.json')
    expect(index).toContain('"plugins"')
    const statusFile = join(root, 'apply-status')
    const r = runScript(APPEND, {
      APPLY_ONLY: '1',
      MSG: 'heal apply test',
      STATUS_FILE: statusFile,
    })
    expect(r.code).toBe(0)
    expect(readFileSync(statusFile, 'utf8').trim()).toBe('degraded')
    // index.json on the branch is untouched — no empty catalog was pushed
    expect(remoteShow('index.json')).toBe(index)
  })
})

describe('catalog-withdraw.sh — no stray submissions.txt on branches lacking it', () => {
  it('ENTRY tombstoning still retracts a pending submission-only entry, without creating submissions.txt', () => {
    const idx = JSON.parse(remoteShow('index.json'))
    idx.plugins.push(
      { name: 'victim-pkg', slug: 'victim-pkg', approval: 'pending', discoveredVia: ['submission'], source: { kind: 'npm', repo: null, version: '1.0.0' } },
      { name: 'organic-pkg', slug: 'organic-pkg', approval: 'pending', discoveredVia: ['search'], source: { kind: 'npm', repo: null, version: '2.0.0' } },
    )
    seedCatalog({ 'index.json': JSON.stringify(idx, null, 2) + '\n' })
    const before = remoteLog().length
    const r = runScript(WITHDRAW, { ISSUE: '9', MSG: 'withdraw test', ENTRY: 'victim-pkg' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('retracted pending submission-only entry victim-pkg')
    // exactly one commit (the index tombstone) — no stray submissions.txt
    expect(remoteLog().length).toBe(before + 1)
    expect(remoteShow('submissions.txt')).toBe('')
    const after = JSON.parse(remoteShow('index.json'))
    expect(after.plugins.map((p: { name: string }) => p.name)).toEqual(['organic-pkg'])
    expect(after.removed[0].name).toBe('victim-pkg')
  })

  it('withdraw with nothing to withdraw pushes nothing and creates no file', () => {
    const before = remoteLog().length
    const r = runScript(WITHDRAW, { ISSUE: '10', MSG: 'withdraw noop' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('nothing to withdraw')
    expect(remoteLog().length).toBe(before)
    expect(remoteShow('submissions.txt')).toBe('')
  })

  it('existing submissions.txt rows are still removed (guarded path unchanged)', () => {
    seedCatalog({
      'submissions.txt':
        JSON.stringify({ name: 'gone-pkg', repo: null, issue: 11, at: 't0', notified: false }) + '\n' +
        JSON.stringify({ name: 'keep-pkg', repo: null, issue: 12, at: 't0', notified: false }) + '\n',
    })
    const r = runScript(WITHDRAW, { ISSUE: '11', MSG: 'withdraw row' })
    expect(r.code).toBe(0)
    const rows = remoteShow('submissions.txt').split('\n').filter(Boolean).map(l => JSON.parse(l))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('keep-pkg')
  })
})

describe('parseSubmission — name is canonicalized lowercase at parse', () => {
  it('issue-form npm name typed in mixed case resolves lowercase', () => {
    const s = parseSubmission('### npm 包名或 owner/repo\n\nMyPkg\n\n### 英文描述\n\nx')
    expect(s.name).toBe('mypkg')
    expect(s.kind).toBe('npm')
  })
  it('scoped names and [submit] title fallback are lowercased too', () => {
    expect(parseSubmission('body without fields', '[submit] @Scope/Pkg').name).toBe('@scope/pkg')
    expect(parseSubmission('nothing here', '[submit] Lodash').name).toBe('lodash')
  })
})

describe('submit.yml — command gates cover two-space-indented commands', () => {
  it('review exclusion, verdict, withdraw and withdraw-deny gates all include the two-space prefixes', () => {
    expect(SUBMIT_YML).toContain("startsWith(github.event.comment.body, '  /')")
    for (const p of ["'  /a'", "'  /A'", "'  /c'", "'  /C'", "'  /w'", "'  /W'"])
      expect(SUBMIT_YML).toContain(`startsWith(github.event.comment.body, ${p})`)
  })
})
