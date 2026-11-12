/** audit #9 (站点发布流 §9, 第 5 轮) — fresh independent pass found no
 *  production defect; the deploy gate's boundary semantics had thin coverage
 *  — the three axes that decide whether a dispatch actually publishes:
 *
 *  1. skills-degraded gate applies only at candidates ≥ 10 — a small
 *     catalog's registry blip must not freeze the deploy (registry 抖动 ≠
 *     真空目录); ≥10 with under-half landed = a real fetch outage, refuse.
 *  2. floor=0 is a VALID floor (explicit-parse '0' ≠ unset) — a small
 *     curated catalog must be able to deploy below 200.
 *  3. legacy prev health.json (entries only, no total) falls back to
 *     entries for the 50%-of-previous ratio — pre-`total` snapshots still
 *     gate correctly.
 *  4. a mass-brake visible collapse on an intact total deploys — the gate
 *     compares total (incl. pending), so a brake wave reaches the site. */
import { describe, it, expect } from 'vitest'
import { healthGate } from '../pipeline/site/build.ts'

const cur = (total: number, skills?: { candidates?: number; landed?: number; degraded?: boolean }) =>
  skills === undefined ? { entries: total, total } : { entries: total, total, skills }

describe('§9 healthGate boundary semantics', () => {
  it('skills degraded below 10 candidates → allowed (small catalog, registry blip)', () => {
    expect(healthGate(null, cur(300, { candidates: 8, landed: 2, degraded: true }))).toBeNull()
  })
  it('skills degraded at ≥10 candidates → refused (fetch outage, not a real state)', () => {
    const msg = healthGate(null, cur(300, { candidates: 12, landed: 3, degraded: true }))
    expect(msg).toContain('skills degraded')
    expect(msg).toContain('3/12')
  })
  it('degraded flag absent → skills arm skipped entirely', () => {
    expect(healthGate(null, cur(300, { candidates: 50, landed: 1, degraded: false }))).toBeNull()
  })
  it('floor=0 → an empty catalog deploys (curated catalog can be tiny)', () => {
    expect(healthGate(null, cur(0), 0)).toBeNull()
  })
  it('floor still binds when nonzero — 199 < 200 refuses', () => {
    expect(healthGate(null, cur(199), 200)).toContain('below floor')
  })
  it('legacy prev {entries} (no total) still feeds the 50% ratio', () => {
    const msg = healthGate({ entries: 400 }, cur(150), 0)
    expect(msg).toContain('50%')
  })
  it('mass-brake visible collapse on intact total → deploys (brake must reach the site)', () => {
    // prev had 400 total; cur still 400 total but every entry braked — the
    // data plane is intact, only approvals changed → gate stays open
    expect(healthGate({ total: 400 }, { entries: 0, total: 400 })).toBeNull()
  })
})
