/** audit #2 fresh-batch (submission flow, round 2):
 *  1. The verdict job's catalog `git fetch` must be FATAL — `|| true` left
 *     FETCH_HEAD/origin/catalog stale-or-absent, so the SEED lookup missed
 *     live seeds (late-ingest could replace a newer pin with an older
 *     review-marker version) and dedupe ran on an EMPTY verdicts file →
 *     duplicate/conflicting verdict lines landed.
 *  2. `git ls-remote --exit-code` must distinguish causes: exit 2 = catalog
 *     branch genuinely absent (bootstrap message) vs any other failure =
 *     connectivity (retry guidance) — a blip must not read as "未初始化".
 *  3. `argignored` must resolve spec tokens by name OR source.repo — an
 *     'owner/repo' arg naming a DIFFERENT catalog entry through its repo
 *     identity used to slip past the name-only lookup. */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const SUBMIT = readFileSync(join(REPO, '.github/workflows/submit.yml'), 'utf8')

// the verdict job's resolve step (id: v → id: app) — where the catalog
// fetch + bootstrap checks live
const VSTEP = SUBMIT.slice(SUBMIT.indexOf('id: v'), SUBMIT.indexOf('id: app'))

describe('verdict job — catalog fetch is fatal after ls-remote passes', () => {
  it('ls-remote distinguishes absent-branch (rc 2) from connectivity failures', () => {
    expect(VSTEP).toContain('LSRC=$?')
    expect(VSTEP).toContain('[ "$LSRC" = 2 ]')
    expect(VSTEP).toContain('[ "$LSRC" != 0 ]')
    expect(VSTEP).toContain('尚未初始化')
    expect(VSTEP).toContain('无法访问仓库')
  })

  it('the catalog fetch refuses stale state — no `|| true`', () => {
    // the fetch line itself must not swallow failure (the || on the next
    // line is the explicit refuse-path, which is what we want)
    expect(VSTEP).not.toMatch(/git fetch[^\n]*catalog[^\n]*\|\| true/)
    expect(VSTEP).toContain("git fetch --depth=1 origin '+refs/heads/catalog:refs/remotes/origin/catalog' --quiet 2>/dev/null \\")
    // the failure path tells the user the write was refused + is retryable
    expect(VSTEP).toContain('catalog 分支拉取失败')
    expect(VSTEP).toContain('echo "skip=1" >> "$GITHUB_OUTPUT"; exit 0; }')
  })

  it('the advisory fetch in the REVIEW step stays non-fatal (deliberate)', () => {
    const rstep = SUBMIT.slice(SUBMIT.indexOf('id: parse'), SUBMIT.indexOf('id: v'))
    const advisory = rstep.match(/git fetch --depth=1[^\n]*\|\| true/g) ?? []
    expect(advisory.length).toBeGreaterThan(0)
  })
})

describe('verdict job — argignored resolves repo identities', () => {
  const extract = () => {
    const m = SUBMIT.match(/node -e '([^']+)' "\$TOKNAME"/)
    expect(m, 'argignored lookup node -e must exist').not.toBeNull()
    return m![1]!
  }

  it('looks the spec token up by name AND source.repo', () => {
    expect(extract()).toContain('source?.repo')
  })

  it('warns only when the token resolves to a DIFFERENT entry (functional)', () => {
    const script = extract()
    writeFileSync('/tmp/index.json', JSON.stringify({ plugins: [
      { name: 'pkg-a', source: { repo: 'o/a' } },
      { name: 'o/b', source: { repo: 'o/b' } },
      { name: 'pkg-c', source: { repo: 'o/c' } },
    ] }))
    const run = (tok: string, entry: string) =>
      spawnSync('node', ['-e', script, tok], { env: { ...process.env, ENTRY: entry } }).status
    // 'owner/repo' arg naming a DIFFERENT entry's repo → warn (exit 0)
    expect(run('o/c', 'pkg-a')).toBe(0)
    // same entry reached via its own repo path → not a cross-target → no warn
    expect(run('o/a', 'pkg-a')).toBe(1)
    // another entry by NAME still warns (regression)
    expect(run('o/b', 'pkg-a')).toBe(0)
    // this entry's own name → no warn
    expect(run('pkg-a', 'pkg-a')).toBe(1)
    // token matches nothing → reason prose → no warn
    expect(run('zzz', 'pkg-a')).toBe(1)
  })
})
