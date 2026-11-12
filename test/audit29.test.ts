/** audit #6 fresh-batch (digest flow, round 2):
 *  1. verdicts-compact topAt honors the rankable() future-stamp exemption —
 *     a far-future line must not count as the key's "top" or every REAL
 *     rankable line reads as superseded-below-it and gets deleted (the
 *     exact line latestVerdicts would pick — silently un-verdicting the
 *     key; a live concern/brake vanishes).
 *  2. publish-digest.sh reclaims the stale lock atomically via `mv`, the
 *     same pattern ai-diagnose.sh hardened — rmdir+mkdir lets a second
 *     reclaimer delete the first's fresh lock (double-run). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compactLines } from '../pipeline/verdicts-compact.ts'
import { latestVerdicts, vkey } from '../pipeline/verdicts.ts'

const line = (at: string, verdict: 'pass' | 'concern', source = 'ai') =>
  JSON.stringify({ name: 'p', version: '1.0.0', verdict, at, source })

// align the fixture clock with wall-clock: latestVerdicts ranks against its
// own internal Date.now() — a "future" stamp must be unrankable under BOTH
// the injected `now` and the real one or the assertion is time-dependent
const NOW = Date.now()

describe('compactLines — future-stamp exemption in topAt', () => {
  it('a far-future line must not make real lines "superseded" (concern would vanish)', () => {
    const future = new Date(NOW + 30 * 86_400_000).toISOString()
    const lines = [
      line('2025-01-01T00:00:00Z', 'concern'),     // >180d old, real brake
      line(future, 'pass'),                        // unrankable writer bug
    ]
    const { lines: kept } = compactLines(lines, { days: 180, now: NOW })
    // the old concern stays: the future line isn't a legitimate "top" — and
    // latestVerdicts (with its own rankable filter) still sees the brake
    expect(kept).toHaveLength(2)
    const vs = kept.map(l => JSON.parse(l))
    expect(latestVerdicts(vs).get(vkey('p', '1.0.0'))?.verdict).toBe('concern')
  })

  it('a genuinely superseded old line still drops (regression)', () => {
    const lines = [
      line('2025-01-01T00:00:00Z', 'concern'),
      line(new Date(NOW - 86_400_000).toISOString(), 'pass'),
    ]
    const { lines: kept, dropped } = compactLines(lines, { days: 180, now: NOW })
    expect(dropped).toBe(1)
    expect(kept).toHaveLength(1)
    expect(JSON.parse(kept[0]!).verdict).toBe('pass')
  })

  it('the future line itself is never dropped (its at can never age out)', () => {
    const future = new Date(NOW + 30 * 86_400_000).toISOString()
    const { lines: kept } = compactLines([line(future, 'pass')], { days: 180, now: NOW })
    expect(kept).toHaveLength(1)
  })
})

describe('publish-digest.sh — atomic stale-lock reclaim', () => {
  const sh = readFileSync(join(__dirname, '..', 'bin/publish-digest.sh'), 'utf8')

  it('reclaims via mv (atomic), not rmdir+mkdir (second reclaimer can delete the fresh lock)', () => {
    const seg = sh.slice(sh.indexOf('digest.lock'), sh.indexOf('another run in progress'))
    expect(seg).toContain('mv "$LOCK" "$LOCK.stale.$$"')
    expect(seg).not.toContain('rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK"')
  })
})
