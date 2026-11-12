/** Audit task #6 — digest flow (.github/workflows/digest.yml +
 *  pipeline/ai/digest.ts + pipeline/verdicts-compact.ts +
 *  bin/publish-digest.sh).
 *  Fresh §6 audit findings:
 *   1. watchdog staleness probes ran `git log --grep` — that requires
 *      UNBOUNDED history (the probe's job is finding OLD commits; a bounded
 *      fetch makes a stale leg blind exactly when the outage is worst).
 *      Probes now use the commits API (paginate until match or out-of-window),
 *      blobs come via contents-API raw media, worktree+fetch are gone, and
 *      every remaining fetch is --depth=1 + forced refspec.
 *   2. `$'\n\n'` inside double quotes printed literally in alert bodies.
 *   3. a PENDING-probe crash read as "empty queue", blinding legs 1/5.
 *   4. digest-state.json / digest md written non-atomically — a torn anchor
 *      makes the next render refuse (state-loss guard) until manual restore.
 *   5. dead GITHUB_TOKEN env in the digest job. */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as digestMain } from '../pipeline/ai/digest.ts'

const WF = readFileSync('.github/workflows/digest.yml', 'utf8')
const SH = readFileSync('bin/publish-digest.sh', 'utf8')
const DTS = readFileSync('pipeline/ai/digest.ts', 'utf8')

function jobBlock(name: string): string {
  const m = WF.match(new RegExp(`^  ${name}:\\n`, 'm'))
  if (!m) return ''
  const rest = WF.slice(m.index! + m[0].length)
  const next = rest.search(/^  [a-zA-Z_][\w-]*:\n/m)
  return next === -1 ? rest : rest.slice(0, next)
}
const DIGEST = jobBlock('digest')
const WATCHDOG = jobBlock('watchdog')

describe('digest.yml — fetches are shallow + forced (§6-1)', () => {
  it('every git fetch in the workflow is tip-only', () => {
    const fetches = WF.match(/git( -C \S+)? fetch[^\n|]*/g) ?? []
    expect(fetches.length).toBeGreaterThan(0)
    for (const f of fetches) {
      expect(f).toContain('--depth=1')
      expect(f).toContain('+refs/heads/')
    }
    expect(WF).not.toMatch(/git fetch origin catalog/)
  })
  it('publish-digest.sh: clones and fetches all tip-only', () => {
    for (const f of SH.match(/git (clone|fetch)[^\n|]*/g) ?? []) {
      expect(f).toContain('--depth=1')
    }
    expect(SH).toContain('+refs/heads/catalog:refs/remotes/origin/catalog')
    expect(SH).toContain('+refs/heads/main:refs/remotes/origin/main')
  })
})

describe('digest.yml — watchdog probes via API, not history (§6-1)', () => {
  it('no git log / git fetch / worktree in the watchdog job', () => {
    // anchored at line start — comments may still mention git log (they
    // document what the API probe replaced)
    expect(WATCHDOG).not.toMatch(/^ *git log/m)
    expect(WATCHDOG).not.toMatch(/^ *git fetch/m)
    expect(WATCHDOG).not.toMatch(/^ *git worktree/m)
    expect(WATCHDOG).not.toMatch(/\/tmp\/cat/)
  })
  it('staleness probes hit the commits endpoint with path + prefix', () => {
    expect(WATCHDOG).toContain('commits?sha=catalog&path=')
    expect(WATCHDOG).toContain('per_page=100')
    expect(WATCHDOG).toContain('ai-diagnose:')
    expect(WATCHDOG).toContain('catalog:')
  })
  it('paginates while the page bottom is still inside the staleness window', () => {
    expect(WATCHDOG).toContain('page=$((page + 1))')
    expect(WATCHDOG).toContain('-le 5')
    // out-of-window floor still fires the leg (the real match is even older)
    expect(WATCHDOG).toMatch(/gt 48.*then[\s\S]*?return/)
  })
  it('blobs fetched via contents API raw media (14MB index, >1MB base64 limit)', () => {
    expect(WATCHDOG).toContain('contents/index.json?ref=catalog')
    expect(WATCHDOG).toContain('contents/ai-verdicts.jsonl?ref=catalog')
    expect(WATCHDOG).toContain('contents/diagnose.paused?ref=catalog')
    expect(WATCHDOG).toContain('contents/diagnose-health.json?ref=catalog')
    expect(WATCHDOG).toContain('application/vnd.github.raw')
  })
  it('index-blob failure skips only pending-gated legs, not the whole watchdog', () => {
    expect(WATCHDOG).toContain('BLOBS_OK=0')
    expect(WATCHDOG).toMatch(/if \[ "\$BLOBS_OK" = 1 \]/)
  })
})

describe('digest.yml — alert bodies + probe failure honesty (§6-2/§6-3)', () => {
  it("no literal $'\\n\\n' inside double-quoted bodies", () => {
    // the buggy form embedded $'\n\n' INSIDE the quotes → rendered literally
    expect(WF).not.toContain(`-->$'\\n\\n'$REASONS"`)
    // the fixed form closes the quote first: "...-->" $'\n\n' "$REASONS"
    expect(WATCHDOG).toContain(`-->"$'\\n\\n'"$REASONS"`)
  })
  it('PENDING probe crash exits loud (legs must not read broken as empty)', () => {
    expect(WATCHDOG).toMatch(/PENDING=\$\(npx tsx -e[\s\S]*?\|\| \{[^}]*exit 1/)
  })
  it('legs fingerprinting + in:title dedupe intact', () => {
    expect(WATCHDOG).toContain('watchdog-legs:')
    expect(WATCHDOG).toContain('in:title')
  })
})

describe('digest.ts — atomic anchor writes (§6-4)', () => {
  it('state + md write via tmp+rename, tmp outside digest/', () => {
    expect(DTS).toContain('renameSync')
    expect(DTS).toMatch(/stateTmp.*\.tmp[\s\S]*?renameSync\(stateTmp, statePath\)/)
    expect(DTS).toMatch(/mdTmp.*\.tmp[\s\S]*?renameSync\(mdTmp, digestPath\)/)
    expect(DTS).not.toMatch(/join\([^)]*'digest'[^)]*\.tmp/)
  })
  it('end-to-end: digestMain leaves complete artifacts and no tmp strays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-'))
    const idx = { version: '1', generatedAt: '2026-02-02T00:00:00Z', categories: {}, plugins: [], removed: [] }
    writeFileSync(join(dir, 'index.json'), JSON.stringify(idx))
    writeFileSync(join(dir, 'ai-verdicts.jsonl'), '')
    // real render first — writes a parseable state anchor + the md
    await digestMain(['x', '--index', join(dir, 'index.json'), '--verdicts', join(dir, 'ai-verdicts.jsonl'),
      '--state', join(dir, 'digest-state.json'), '--out-dir', dir])
    const st = JSON.parse(readFileSync(join(dir, 'digest-state.json'), 'utf8'))
    expect(st).toHaveProperty('lastDigestAt')
    expect(st).toHaveProperty('announced')
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
    const day = new Date().toISOString().slice(0, 10)
    expect(existsSync(join(dir, 'digest', `${day}.md`))).toBe(true)
    expect(readdirSync(join(dir, 'digest')).filter(f => f.endsWith('.tmp'))).toEqual([])
    // --date backfills the doc only — state untouched, no tmp strays
    const before = readFileSync(join(dir, 'digest-state.json'), 'utf8')
    await digestMain(['x', '--index', join(dir, 'index.json'), '--verdicts', join(dir, 'ai-verdicts.jsonl'),
      '--state', join(dir, 'digest-state.json'), '--out-dir', dir, '--date', '2026-02-02'])
    expect(existsSync(join(dir, 'digest', '2026-02-02.md'))).toBe(true)
    expect(readFileSync(join(dir, 'digest-state.json'), 'utf8')).toBe(before)
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('digest.yml — misc integrity (§6-5 + regression guards)', () => {
  it('no dead GITHUB_TOKEN env in the digest job', () => {
    expect(DIGEST).not.toMatch(/GITHUB_TOKEN/)
  })
  it('retry loop re-renders: fetch+reset+clean+compact+render inside the loop', () => {
    const loop = DIGEST.slice(DIGEST.indexOf('for i in 1 2 3 4'))
    for (const s of ['fetch --depth=1', 'reset --hard', 'verdicts-compact', 'digest.ts', 'diff --cached --quiet', 'HEAD:catalog'])
      expect(loop).toContain(s)
  })
  it('schedule gated to the owner whitelist; dispatch stays open', () => {
    // the digest job's if: is a single-line flow scalar, not a >- block
    const cond = DIGEST.match(/^    if: (.*)$/m)?.[1] ?? ''
    expect(cond).toContain('schedule')
    expect(cond).toContain('awesome-market')
    expect(cond).toContain('terry2010')
  })
  it('alert job fires on failure() || cancelled() of either leg', () => {
    const alert = jobBlock('alert')
    expect(alert).toContain('needs: [digest, watchdog]')
    expect(alert).toMatch(/failure\(\) \|\| cancelled\(\)/)
  })
})

describe('last_touch probe — functional, stubbed gh', () => {
  /** extract the function body from the workflow and run it under a fake gh */
  const fnSrc = (() => {
    const m = WATCHDOG.match(/          last_touch\(\) \{[\s\S]*?\n          \}/)
    return m ? m[0].replace(/^          /gm, '') : ''
  })()
  it('extracted a nonempty function', () => { expect(fnSrc).toContain('last_touch()') })

  function runProbe(pages: Record<number, string>, path = 'ai-verdicts.jsonl', prefix = 'ai-diagnose:'): string {
    const dir = mkdtempSync(join(tmpdir(), 'gh-'))
    // date shim: the workflow runs on ubuntu-latest where `date -d` is GNU —
    // emulate ISO→epoch via python3 on this dev machine (BSD date has no -d)
    writeFileSync(join(dir, 'date'), `#!/bin/bash
if [ "$1" = -d ]; then
  shift; iso="$1"; shift
  python3 -c "import datetime,sys; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" "$iso" 2>/dev/null || echo 0
else
  /bin/date "$@"
fi`)
    writeFileSync(join(dir, 'gh'), `#!/bin/bash
# args: <url> — page=N comes through the query string
u="$4"
p=$(printf '%s' "$u" | sed -nE 's/.*[?&]page=([0-9]+).*/\\1/p'); p=\${p:-1}
case "$p" in
${Object.entries(pages).map(([k, v]) => `  ${k}) cat <<'EOF'\n${v}\nEOF\n;;`).join('\n')}
  *) echo '[]' ;;
esac`)
    execFileSync('chmod', ['+x', join(dir, 'gh'), join(dir, 'date')])
    return execFileSync('bash', ['-c',
      `export PATH="${dir}:$PATH"; GH_REPO=o/r; ${fnSrc}; last_touch ${path} '${prefix}'`],
      { encoding: 'utf8' }).trim()
  }
  const commit = (msg: string, date: string) => ({ commit: { message: msg, committer: { date } } })
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()

  it('match on page 1 → its epoch', () => {
    const out = runProbe({ 1: JSON.stringify([commit('verify: x', hoursAgo(1)), commit('ai-diagnose: run', hoursAgo(5))]) })
    expect(Number(out)).toBeGreaterThan(Date.now() / 1000 - 6 * 3600)
    expect(Number(out)).toBeLessThan(Date.now() / 1000 - 4 * 3600)
  })
  it('no match but page bottom already stale → returns the floor epoch (leg still fires)', () => {
    const page = Array.from({ length: 5 }, (_, i) => commit('human-verdict: x', hoursAgo(60 + i)))
    const out = runProbe({ 1: JSON.stringify(page) })
    // oldest listed (~64h) returned as floor — the real match is even older
    expect(Number(out)).toBeLessThan(Date.now() / 1000 - 60 * 3600)
  })
  it('no match within a fresh page → paginates to find it', () => {
    const p1 = Array.from({ length: 100 }, (_, i) => commit('x', hoursAgo(i / 100)))
    const p2 = [commit('ai-diagnose: run', hoursAgo(30))]
    const out = runProbe({ 1: JSON.stringify(p1), 2: JSON.stringify(p2) })
    expect(Number(out)).toBeLessThan(Date.now() / 1000 - 29 * 3600)
  })
  it('no commits at all → 0 (bootstrap semantics)', () => {
    expect(runProbe({ 1: '[]' })).toBe('0')
  })
  it('empty prefix → first commit regardless of message (digest-state leg)', () => {
    const out = runProbe({ 1: JSON.stringify([commit('digest: 2026-02-02', hoursAgo(10))]) }, 'digest-state.json', '')
    expect(Number(out)).toBeGreaterThan(0)
  })
})
