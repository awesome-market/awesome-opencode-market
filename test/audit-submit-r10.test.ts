/** audit #2 fresh round (submission flow), round 10:
 *  1. submit.yml scraped EVERY github-actions[bot] comment for review
 *     markers (verdict:/target:/reviewedVersion:/repoSha:/repoPkg:/
 *     createdAt:) with per-pattern tail -1 — the edited-skip prior.txt and
 *     the verdict job's late-ingest rvc.txt. Any NEWER bot comment carrying
 *     marker-shaped text (the submission-status comment clips a verdict
 *     reason — maintainer/AI free text — into its body) could hijack the
 *     verdict and donate its pins. The scrape must be scoped to comments
 *     starting '## Automated review' (the report job's fixed header).
 *  2. upload-artifact@v4 artifacts are immutable per run — review-md-N
 *     without `overwrite: true` makes "Re-run all jobs" 409 at upload and
 *     wedges the issue's review until the 1-day retention expires.
 *  3. report/ingest/sweep/withdraw/withdraw-deny/review-alert were the only
 *     jobs in the repo without timeout-minutes — ingest/withdraw run git
 *     push retry loops that must not burn the 6h default on a hang.
 *  4. withdraw + conseed passed a SINGLE env ENTRY key (name ?? repo) — a
 *     name+repo submission's repo-twin pending entry survived the env
 *     fallback (DERIVED covers the rows-present case only). */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const WITHDRAW = join(REPO, 'bin', 'catalog-withdraw.sh')
const SUBMIT_YML = readFileSync(join(REPO, '.github/workflows/submit.yml'), 'utf8')

let root: string, remote: string, code: string, stubbin: string

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim()
const remoteShow = (name: string): string => {
  try { return execFileSync('git', ['-C', remote, 'show', `catalog:${name}`], { encoding: 'utf8' }) }
  catch { return '' }
}
const runScript = (env: Record<string, string>): { code: number; out: string } => {
  const r = spawnSync('bash', [WITHDRAW], {
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
  root = mkdtempSync(join(tmpdir(), 'asr10-'))
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
  stubbin = join(root, 'stubbin')
  mkdirSync(stubbin, { recursive: true })
  writeFileSync(join(stubbin, 'npx'), '#!/bin/bash\nexit 0\n')
  chmodSync(join(stubbin, 'npx'), 0o755)
}, 60_000)

describe('submit.yml — review-marker scrapes are scoped to Automated-review comments', () => {
  it('every bot-comment jq filter requires the ## Automated review header', () => {
    // the unscoped pattern must be gone entirely — all three scrape sites
    // (edited-skip gh api + curl fallback, late-ingest rvc.txt) are marker
    // scrapes and share the same trust boundary
    expect(SUBMIT_YML).not.toContain('select(.user.login == "github-actions[bot]") | .body')
    const scoped = SUBMIT_YML.match(/startswith\("## Automated review"\)/g) ?? []
    expect(scoped.length).toBeGreaterThanOrEqual(3)
  })
})

describe('submit.yml — review artifact survives re-run-all attempts', () => {
  it('review-md upload carries overwrite: true', () => {
    expect(SUBMIT_YML).toMatch(/name: review-md-[^\n]+\n[\s\S]{0,300}?overwrite: true/)
  })
})

describe('submit.yml — every job carries an explicit timeout', () => {
  // jobs sit at 2-space indent under `jobs:`; a job block ends at the next
  // 2-space `name:` key (deeper-indented step keys can't match — the char
  // after the two spaces must be non-space). timeout-minutes must appear
  // inside each block.
  const jobBlocks = (name: string): string => {
    const m = new RegExp(`^  ${name}:\\n`, 'm').exec(SUBMIT_YML)
    if (!m) return ''
    const rest = SUBMIT_YML.slice(m.index + m[0].length)
    const nxt = rest.search(/^  [a-zA-Z-]+:/m)
    return nxt === -1 ? rest : rest.slice(0, nxt)
  }
  for (const job of ['review', 'report', 'ingest', 'verdict', 'sweep', 'withdraw', 'withdraw-deny', 'review-alert']) {
    it(`${job} has timeout-minutes`, () => {
      expect(jobBlocks(job)).toMatch(/timeout-minutes: \d+/)
    })
  }
})

describe('submit.yml — withdraw/conseed pass the full name+repo key set', () => {
  it('withdraw step derives space-joined keys instead of name ?? repo', () => {
    expect(SUBMIT_YML).toContain("[s.name,s.repo].filter(Boolean).join(' ')")
    expect(SUBMIT_YML).not.toContain("console.log(s.name??s.repo??'')")
  })
  it('verdict job emits entrykeys and conseed prefers it over the single entry', () => {
    expect(SUBMIT_YML).toContain('echo "entrykeys=$EKEYS"')
    expect(SUBMIT_YML).toContain('ENTRY: ${{ steps.v.outputs.entrykeys || steps.v.outputs.entry }}')
  })
})

describe('catalog-withdraw.sh — env ENTRY accepts a space-joined key list', () => {
  it('zero-seed fallback retracts pending entries matched by name OR source.repo', () => {
    const idx = JSON.parse(remoteShow('index.json'))
    idx.plugins.push(
      // name hit — the npm twin
      { name: 'twins-pkg', slug: 'twins-pkg', approval: 'pending', discoveredVia: ['submission'], source: { kind: 'npm', repo: 'octo/widgets', version: '1.0.0' } },
      // repo-only hit — a github-kind entry whose name IS the repo
      { name: 'octo/gadgets', slug: 'octo-gadgets', approval: 'pending', discoveredVia: ['submission'], source: { kind: 'github', repo: 'octo/gadgets', version: null } },
      // source.repo-only hit — different name, repo matches the second key
      { name: 'alias-pkg', slug: 'alias-pkg', approval: 'pending', discoveredVia: ['submission'], source: { kind: 'npm', repo: 'octo/gadgets', version: '2.0.0' } },
      // organic pending entry sharing a key — must survive
      { name: 'twins-pkg', slug: 'twins-pkg-organic', approval: 'pending', discoveredVia: ['search'], source: { kind: 'npm', repo: null, version: '1.0.0' } },
    )
    seedCatalog({ 'index.json': JSON.stringify(idx, null, 2) + '\n' })
    const r = runScript({ ISSUE: '21', MSG: 'multi-key withdraw', ENTRY: 'twins-pkg octo/gadgets' })
    expect(r.code).toBe(0)
    const after = JSON.parse(remoteShow('index.json'))
    expect(after.plugins.map((p: { name: string }) => p.name)).toEqual(['twins-pkg'])
    expect(after.plugins[0].discoveredVia).toEqual(['search'])
    expect(after.removed.map((x: { name: string }) => x.name).sort())
      .toEqual(['alias-pkg', 'octo/gadgets', 'twins-pkg'])
  })
})
