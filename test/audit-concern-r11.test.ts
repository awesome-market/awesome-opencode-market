/** audit #5 leftover-risk fixes (round 11):
 *  retest's run-link lookup used `gh run list --limit 1` — the newest verify
 *  run could be a concurrent scheduled tick or another maintainer's retest,
 *  posting a "Run:" link to the wrong workflow run. The lookup now stamps
 *  SINCE before dispatching and filters to workflow_dispatch runs created
 *  at/after that stamp, so the link can only point at a run this dispatch
 *  could have produced. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const YML = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')

describe('retest — run link is pinned to this dispatch', () => {
  it('stamps SINCE before gh workflow run and filters the lookup by it', () => {
    const sinceIdx = YML.indexOf('SINCE=$(date -u')
    const dispatchIdx = YML.indexOf('gh workflow run verify.yml')
    const lookupIdx = YML.indexOf('RUN_URL=$(sleep 8; gh run list')
    expect(sinceIdx).toBeGreaterThan(-1)
    expect(dispatchIdx).toBeGreaterThan(sinceIdx)   // stamp precedes dispatch
    expect(lookupIdx).toBeGreaterThan(dispatchIdx)  // lookup follows dispatch
    const lookup = YML.slice(lookupIdx, lookupIdx + 600)
    expect(lookup).toContain('event == \\"workflow_dispatch\\"')
    expect(lookup).toContain('createdAt >= \\"$SINCE\\"')
  })
})
