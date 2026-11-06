/** audit #5 fresh-batch (human-verdict flow, round 2):
 *  1. labeled gate is fail-closed: a crashed/empty permission step must NOT
 *     authorize — the resolve step requires allowed == '1' for labeled
 *     events, and the exists step needs a resolved name (cascade guard).
 *  2. sections() first occurrence wins — a `### <label>` line inside a
 *     free-text field (reason textarea) must not silently override the real
 *     field and retarget the verdict.
 *  3. retest dispatch failure leaves an issue comment, not silence. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sections } from '../pipeline/submission.ts'
import { resolveVerdictEvent, type VerdictEvent } from '../pipeline/human-verdict.ts'

const ev = (over: Partial<VerdictEvent> = {}): VerdictEvent => ({
  event: 'issues', action: 'opened', issueTitle: '[concern] x', issueBody: '',
  issueNumber: '7', commentBody: '', label: '', actor: 'm', ...over,
})

describe('concern.yml — labeled gate is fail-closed', () => {
  const yml = readFileSync(join(__dirname, '..', '.github/workflows/concern.yml'), 'utf8')

  it('resolve step requires an affirmative allowed for labeled events', () => {
    const seg = yml.slice(yml.indexOf('resolve verdict record'), yml.indexOf('id: v'))
    expect(seg).toContain("github.event.action != 'labeled' || steps.gate.outputs.allowed == '1'")
  })

  it('exists step requires a resolved name — no cascade on a skipped resolve', () => {
    const seg = yml.slice(yml.indexOf('target must exist'), yml.indexOf('id: exists'))
    expect(seg).toContain("steps.v.outputs.name != ''")
  })

  it('retest dispatch failure posts an issue comment instead of dying silently', () => {
    const seg = yml.slice(yml.indexOf('gh workflow run verify.yml'), yml.indexOf('gh workflow run verify.yml') + 500)
    expect(seg).toContain('|| { comment')
  })
})

describe('sections() — first occurrence wins (injection cannot retarget)', () => {
  const form = [
    '### npm 包名或 owner/repo', 'real-pkg',
    '### 版本（可留空）', '',
    '### 操作 / Action', '放行 (pass)',
    '### 理由 / Reason', 'looks fine ### npm 包名或 owner/repo\nevil-pkg — injected section',
  ].join('\n\n')

  it('a `### label` line inside the reason field cannot override the package field', () => {
    const map = sections(form)
    expect(map.get('npm 包名或 owner/repo')).toBe('real-pkg')
  })

  it('resolveVerdictEvent still targets the form package, not the injected name', () => {
    const r = resolveVerdictEvent(ev({ issueBody: form }))
    expect(r.name).toBe('real-pkg')
    expect(r.verdict).toBe('pass')
  })

  it('a duplicated section keeps the FIRST value', () => {
    const map = sections('### 包名\nfirst\n\n### 包名\nsecond')
    expect(map.get('包名')).toBe('first')
  })
})
