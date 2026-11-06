/** audit #4 round 5 — three diagnose-flow gaps:
 *  1. sha-reuse emitted 'pass' on a RED-FLAGGED candidate — the release gate
 *     ignores it (no release) but the key left the review queue without ever
 *     writing the mechanical concern that surfaces flagged holds to humans.
 *     §10: red flags force concern on EVERY AI path — reuse included.
 *  2. `--dry` wrote the --sweep-state stamp — an exploratory run advanced the
 *     6h drift-sweep clock so the next real run skipped the sweep.
 *  3. exit('usage: ...') threw ERR_INVALID_ARG_TYPE — usage errors printed a
 *     TypeError stack instead of the message. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as diagnoseMain, L05_CANARY_BENIGN, L05_CANARY_HOSTILE } from '../pipeline/ai/diagnose.ts'
import { AiVerdict } from '../src/schema.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

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
const hold = (name: string, ver: string, redFlags: string[] = []): PluginEntry =>
  e({ name, approval: 'approved', pendingUpdate: { version: ver, capabilities: { scannedAt: 't', findings: [], redFlags }, verification: { status: 'verified' }, heldAt: '2026-01-01T00:00:00Z' } })
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict =>
  AiVerdict.parse({ name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over })
const cleanL05 = () => new Map<string, number>([[L05_CANARY_BENIGN.id, 0.1], [L05_CANARY_HOSTILE.id, 0.9]])
const okOrnith = async () => ({ verdict: 'pass' as const, reasonZh: 'ok', reasonEn: 'ok' })

const files = (plugins: PluginEntry[], verdicts: AiVerdict[] = [], extra: string[] = []) => {
  const d = mkdtempSync(join(tmpdir(), 'dr5-'))
  const ip = join(d, 'index.json'), vp = join(d, 'v.jsonl'), op = join(d, 'out.jsonl'), sp = join(d, 'sweep.stamp')
  writeFileSync(ip, JSON.stringify(idx(plugins)))
  writeFileSync(vp, verdicts.map(x => JSON.stringify(x)).join('\n'))
  const argv = ['tsx', 'd.ts', '--index', ip, '--verdicts', vp, '--out', op, ...extra]
  return { argv, op, sp }
}
const outLines = (op: string): AiVerdict[] =>
  readFileSync(op, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AiVerdict)

describe('audit#4 r5 — sha reuse on a flagged candidate writes concern, never pass', () => {
  it('flagged hold with a same-sha twin pass → concern + reusedFrom provenance', async () => {
    const flagged = hold('bad', '2.0.0', ['net:exfil'])
    // a pass verdict already exists on v1.0.0 for sha S — v2.0.0 re-tags to the
    // same bytes but carries a red flag (ruleset bump / identity signal)
    const prior = v({ name: 'bad', version: '1.0.0', verdict: 'pass', sha: 'S' })
    let ornithCalls = 0
    const { argv, op } = files([flagged], [prior])
    await diagnoseMain(argv, {
      l05: cleanL05,
      ornith: async () => { ornithCalls++; return okOrnith() },
      sha: async (n, ver) => (n === 'bad' ? 'S' : undefined),
      ping: async () => true,
    })
    const got = outLines(op).find(x => x.name === 'bad' && x.version === '2.0.0')
    expect(got?.verdict).toBe('concern')                       // NOT 'pass'
    expect(got?.reason).toContain('机械红旗')
    expect(got?.reason).toContain('net:exfil')
    expect(got?.reusedFrom?.version).toBe('1.0.0')             // provenance still recorded
    expect(ornithCalls).toBe(0)                                // still a free verdict — no LLM call
  })

  it('unflagged hold with a same-sha twin pass → pass reuse preserved', async () => {
    const clean = hold('ok', '2.0.0')
    const prior = v({ name: 'ok', version: '1.0.0', verdict: 'pass', sha: 'S', reason: 'clean' })
    const { argv, op } = files([clean], [prior])
    await diagnoseMain(argv, {
      l05: cleanL05, ornith: okOrnith,
      sha: async () => 'S', ping: async () => true,
    })
    const got = outLines(op).find(x => x.name === 'ok')
    expect(got?.verdict).toBe('pass')
    expect(got?.reusedFrom?.version).toBe('1.0.0')
  })

  it('flagged hold with a same-sha twin CONCERN → still concern', async () => {
    const flagged = hold('worse', '2.0.0', ['sec:delta'])
    const prior = v({ name: 'worse', version: '1.0.0', verdict: 'concern', sha: 'S' })
    const { argv, op } = files([flagged], [prior])
    await diagnoseMain(argv, {
      l05: cleanL05, ornith: okOrnith,
      sha: async () => 'S', ping: async () => true,
    })
    expect(outLines(op).find(x => x.name === 'worse')?.verdict).toBe('concern')
  })
})

describe('audit#4 r5 — --dry does not consume the drift-sweep stamp', () => {
  it('a --dry run leaves --sweep-state absent; a real run writes it', async () => {
    const verdicted = hold('old', '2.0.0')
    const prior = v({ name: 'old', version: '2.0.0', verdict: 'pass', sha: 'A', at: '2026-01-01T00:00:00Z' })
    const dryRun = files([verdicted], [prior], [])
    const argv = [...dryRun.argv, '--sweep-state', dryRun.sp, '--dry']
    // injected sha reports drift → the sweep path runs; --dry must not stamp
    await diagnoseMain(argv, {
      l05: cleanL05, ornith: okOrnith,
      sha: async () => 'B', ping: async () => true,
    })
    expect(existsSync(dryRun.sp)).toBe(false)

    const real = files([verdicted], [prior], [])
    await diagnoseMain([...real.argv, '--sweep-state', real.sp], {
      l05: cleanL05, ornith: okOrnith,
      sha: async () => 'B', ping: async () => true,
    })
    expect(existsSync(real.sp)).toBe(true)
  })
})

describe('audit#4 r5 — usage errors print the message, not a TypeError', () => {
  const run = (args: string[]) => {
    try {
      execFileSync('npx', ['tsx', 'pipeline/ai/diagnose.ts', ...args], {
        cwd: join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { status: 0, stderr: '' }
    } catch (x) {
      const err = x as { status?: number | null; stderr?: string }
      return { status: err.status ?? 1, stderr: String(err.stderr ?? '') }
    }
  }
  it('missing required args → exit 1 with the usage line on stderr', () => {
    const r = run([])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('usage: --index')
    expect(r.stderr).not.toContain('ERR_INVALID_ARG_TYPE')
  })
  it('--limit -1 → exit 1 naming the bad flag', () => {
    const r = run(['--index', 'x', '--verdicts', 'y', '--out', 'z', '--limit', '-1'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('non-negative')
    expect(r.stderr).not.toContain('TypeError')
  })
})
