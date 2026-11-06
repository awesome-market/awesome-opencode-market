// audit #5 (human-verdict flow, fresh round): the verdict job's inline
// version-resolution must mirror candidateVer's slot rule — a pending
// entry's candidate is the entry itself, so a residual pendingUpdate must
// not shadow latestVersion as the verdict target (same B3 class fixed in
// #3/#4). Plus regression guards for the triage close and heal contract.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const YML = readFileSync(join(__dirname, '..', '.github', 'workflows', 'concern.yml'), 'utf8')

const entry = (over: Record<string, unknown> = {}) => ({
  name: 'pkg', source: { kind: 'npm', id: 'pkg' },
  latestVersion: '1.0.0', approval: 'approved',
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'verified' },
  ...over,
})

const extractInfo = () => {
  const m = YML.match(/INFO=\$\(node -e '([\s\S]*?)' "\$NAME" "\$VER"\)/)
  expect(m, 'INFO node -e script must exist in concern.yml').not.toBeNull()
  return m![1]!
}

const runInfo = (name: string, ver: string, plugins: unknown[]) => {
  const d = mkdtempSync(join(tmpdir(), 'hv5-'))
  const idxPath = join(d, 'index.json')
  writeFileSync(idxPath, JSON.stringify({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] }))
  const script = extractInfo().replaceAll('/tmp/index.json', idxPath)
  const r = spawnSync('node', ['-e', script, name, ver], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as Record<string, string>
}

const pendingPued = () => entry({
  name: 'pend', approval: 'pending', latestVersion: '2.0.0',
  verification: { status: 'unverified' },
  pendingUpdate: { version: '9.9.9', heldAt: 't',
    capabilities: { scannedAt: 't', findings: [], redFlags: ['hold-flag'] },
    verification: { status: 'verified' } },
})
const approvedHeld = () => entry({
  name: 'appr', approval: 'approved', latestVersion: '1.0.0',
  pendingUpdate: { version: '2.0.0', heldAt: 't',
    capabilities: { scannedAt: 't', findings: [], redFlags: [] },
    verification: { status: 'verified' } },
})

describe('audit#5 — verdict target resolution mirrors the B3 slot rule', () => {
  it('pending+pu: blank version resolves to latestVersion (candidate), not the hold', () => {
    const r = runInfo('pend', '', [pendingPued()])
    expect(r.v).toBe('2.0.0')
    expect(r.v).not.toBe('9.9.9')
    // heldver must not advertise the inverted hold as "在押版本"
    expect(r.heldver).toBe('')
    // vstatus/flags come from the ENTRY slot — pu.version !== v → slot=e
    expect(r.vstatus).toBe('unverified')
    expect(r.flags).toBe(0)   // entry caps clean; hold's 'hold-flag' must not leak
  })

  it('approved+hold: blank version still resolves to the held version', () => {
    const r = runInfo('appr', '', [approvedHeld()])
    expect(r.v).toBe('2.0.0')
    expect(r.heldver).toBe('2.0.0')
    expect(r.vstatus).toBe('verified')
  })

  it('approved without hold: blank version resolves to the displayed slot', () => {
    const r = runInfo('pkg', '', [entry({ name: 'pkg' })])
    expect(r.v).toBe('1.0.0')
    expect(r.heldver).toBe('')
  })
})

describe('audit#5 — workflow contract guards', () => {
  it('triage job actually closes the rejected [concern] issue', () => {
    const triage = YML.slice(YML.indexOf('  triage:'))
    expect(triage).toContain('gh issue close "$ISSUE" -R "$GH_REPO"')
  })

  it('degraded apply has the APPLY_ONLY heal path', () => {
    expect(YML).toContain('APPLY_ONLY: "1"')
    expect(YML).toContain("steps.app.outputs.apply == 'degraded'")
  })

  it('labeled events require an affirmative permission gate (fail-closed)', () => {
    expect(YML).toContain("github.event.action != 'labeled' || steps.gate.outputs.allowed == '1'")
  })
})
