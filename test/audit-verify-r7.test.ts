/** audit #3 fresh round (verification-flow, round 7):
 *  verify.yml's merge retry loop ran `git fetch` bare under bash -e — the
 *  transient-prone step in a loop built for transient races. A network blip
 *  killed the whole merge job instead of consuming a retry: the shard
 *  results then waited ~12h for the next run's artifact sweep and a
 *  pipeline-alert fired for what should have been a retry. The fetch now
 *  guards with continue, matching catalog-append.sh's posture. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const YML = readFileSync(join(__dirname, '..', '.github/workflows/verify.yml'), 'utf8')

describe('verify.yml — merge retry loop guards the transient fetch', () => {
  it('the in-loop catalog fetch failure-continues instead of aborting under -e', () => {
    const loop = YML.slice(YML.indexOf('for i in 1 2 3 4; do', YML.indexOf('id: merge')))
    const fetchLine = loop.split('\n').find(l => l.includes("git fetch --depth=1 origin '+refs/heads/catalog"))
    expect(fetchLine).toBeTruthy()
    // the guard must be on the fetch statement itself (line continuation + ||)
    const idx = loop.indexOf(fetchLine!)
    const stmt = loop.slice(idx, loop.indexOf('\n', idx) + 400)
    expect(stmt).toContain('|| {')
    expect(stmt).toContain('continue')
  })

  it('commit and push failures still ride the same retry loop', () => {
    const loop = YML.slice(YML.indexOf('for i in 1 2 3 4; do', YML.indexOf('id: merge')))
    expect(loop).toContain('commit failed (attempt $i)')
    expect(loop).toContain('push rejected (attempt $i)')
    expect(loop).toContain('re-merging against fresh head and retrying')
  })

  it('the pre-loop fetch defers to the retry loop instead of dying under -e', () => {
    const pre = YML.slice(YML.indexOf('id: merge'), YML.indexOf('for i in 1 2 3 4; do', YML.indexOf('id: merge')))
    const fetchIdx = pre.indexOf("git fetch --depth=1 origin '+refs/heads/catalog")
    expect(fetchIdx).toBeGreaterThan(-1)
    const stmt = pre.slice(fetchIdx, fetchIdx + 400)
    expect(stmt).toContain('||')
    expect(stmt).toContain('retry loop will refetch')
    // ls-remote's hard failures (unreachable origin, missing branch) stay fatal/exit-0
    expect(pre).toContain('cannot reach origin for catalog')
    expect(pre).toContain('nothing to merge into')
  })
})
