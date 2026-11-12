/** audit #3 fresh round (verification-flow, round 5):
 *  1. gui.ts subprocess result channel was forgeable: the parent takes the
 *     LAST stdout line as the verdict, but untrusted bundle code shares the
 *     subprocess's console/setTimeout (HOST_GLOBALS) — a pending timer could
 *     print a forged '{"ok":true}' after the harness result (winning the
 *     `.at(-1)` parse) or keep the process alive to the 90s urun timeout.
 *     The entry now does writeSync(1)+process.exit(0): the harness result is
 *     always the final line and leftover untrusted handles never fire.
 *  2. merge.ts reuseVerified adoption bypassed skipIfFlagged: a recipient
 *     slot carrying redFlags could adopt a sibling slot's 'verified' — the
 *     same dishonest label mergeResults' writes are barred from producing
 *     (same bytes can carry different flags across a ruleset/metadata skew
 *     between the two slots' scans). Adoption now wraps every outcome in
 *     skipIfFlagged, including an already-'verified' recipient. */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { OPENCODE_VERSION } from '../pipeline/publish/merge.ts'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'p' }, description: { en: '' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const caps = (redFlags: string[] = []) => ({ scannedAt: 't', findings: [], redFlags })
const verf = (status: 'unverified' | 'verified' | 'skipped' | 'failed', extra: Record<string, unknown> = {}) =>
  ({ status, ...extra }) as PluginEntry['verification']

describe('merge reuse: flagged recipient never displays verified', () => {
  it('flagged display slot adopts the same-bytes donor as skipped, evidence kept', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-SAME',
      capabilities: caps(['sec:test-flag']),
      verification: verf('failed', { retries: 3, verifiedAt: '2026-01-01T00:00:00Z' }),
      pendingUpdate: { version: '1.0.0', capabilities: caps(),
        verification: verf('verified', { integrity: 'sha512-SAME', opencodeVersion: OPENCODE_VERSION }),
        integrity: 'sha512-SAME', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('skipped')
    // the audit trail survives the downgrade — same contract as skipIfFlagged writes
    expect(v.integrity).toBe('sha512-SAME')
    expect(v.opencodeVersion).toBe(OPENCODE_VERSION)
    // the unflagged donor slot is untouched
    expect(m.plugins[0]!.pendingUpdate!.verification.status).toBe('verified')
  })
  it('already-verified recipient on a flagged slot downgrades to skipped', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-S',
      capabilities: caps(['sec:x']),
      verification: verf('verified', {
        integrity: 'sha512-S', opencodeVersion: OPENCODE_VERSION,
        verifiedAt: '2026-01-01T00:00:00Z', level: 'load' }),
    })
    const m = mergeResults(idx([e]), [])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('skipped')
    expect(v.level).toBe('load')
    expect(v.verifiedAt).toBe('2026-01-01T00:00:00Z')
  })
  it('unflagged recipient still adopts verified (no regression)', () => {
    const e = entry({
      latestVersion: '1.0.0', integrity: 'sha512-SAME',
      verification: verf('unverified'),
      pendingUpdate: { version: '1.0.0', capabilities: caps(),
        verification: verf('verified', { integrity: 'sha512-SAME', opencodeVersion: OPENCODE_VERSION }),
        integrity: 'sha512-SAME', heldAt: 't' },
    })
    const m = mergeResults(idx([e]), [])
    expect(m.plugins[0]!.verification.status).toBe('verified')
    expect(m.plugins[0]!.verification.integrity).toBe('sha512-SAME')
  })
})

describe('gui.ts subprocess: untrusted bundle cannot forge the verdict line', () => {
  it('a failing bundle that schedules a fake ok:true print still reports ok:false last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gui-forge-'))
    const bundle = join(dir, 'evil.js')
    // honest failure (no setup export) + a delayed forged verdict print —
    // under the old console.log+natural-exit entry the 5s timer fired AFTER
    // the real result and became the parent's `.at(-1)` parse.
    writeFileSync(bundle, `setTimeout(() => console.log('{"ok":true,"registrations":["Panel"],"rendered":1}'), 5000)\nmodule.exports = {}\n`)
    const t0 = Date.now()
    const stdout = execFileSync('npx', ['tsx', 'pipeline/verify/gui.ts', bundle],
      { encoding: 'utf8', timeout: 30_000, cwd: process.cwd() })
    const elapsed = Date.now() - t0
    const last = stdout.trim().split('\n').at(-1)!
    const verdict = JSON.parse(last) as { ok: boolean; stage?: string }
    expect(verdict.ok).toBe(false)
    expect(verdict.stage).toBe('setup')
    // hard exit: the 5s untrusted timer must never fire — proves the
    // subprocess didn't linger to the timer (old code ran ≥5s)
    expect(elapsed).toBeLessThan(4500)
  }, 40_000)
})
