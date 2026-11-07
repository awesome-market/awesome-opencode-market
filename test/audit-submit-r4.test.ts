/** audit #2 fresh round (submission-flow, round 4):
 *  1. ingest ran parallel to report — the abuse gate's label revert
 *     (remove approved + add needs-work) could be overwritten by report's
 *     label step landing afterwards, leaving an approved-labeled issue with
 *     NO seed row: comments stop re-reviewing under 'approved' and the
 *     author is stuck until the 30d sweep. ingest now needs report and
 *     waits for it via a status-check if (a failed report must not block
 *     queueing). Workflow-shape regression only — covered by review of the
 *     job graph, not a unit test.
 *  2. withdraw's usage hint fired on ANY '/[a-z]+' body — '/watch', '/why'
 *     prose comments by the author ate a '用法：/withdraw' reply. The hint
 *     now only fires for withdraw-shaped tokens. Workflow-shape only.
 *  3. normalizeRepoUrl didn't strip trailing sentence punctuation — prose
 *     captures like 'github.com/o/r,' failed cleanRepo (repo lost → kind
 *     could collapse to 'none' → invalid) and 'github.com/o/r.' minted a
 *     trailing-dot repo that 404s misleadingly. Trailing punctuation is now
 *     stripped before the .git// trims. */
import { describe, it, expect } from 'vitest'
import { normalizeRepoUrl } from '../pipeline/discover/github.ts'

describe('normalizeRepoUrl — trailing sentence punctuation', () => {
  it('comma/paren/period/semicolon captures canonicalize', () => {
    expect(normalizeRepoUrl('see github.com/o/r, it is nice')).toBe('o/r')
    expect(normalizeRepoUrl('(github.com/o/r)')).toBe('o/r')
    expect(normalizeRepoUrl('github.com/o/r.')).toBe('o/r')
    expect(normalizeRepoUrl('github.com/o/r;')).toBe('o/r')
    expect(normalizeRepoUrl('github.com/o/r!')).toBe('o/r')
    expect(normalizeRepoUrl('github.com/o/r?')).toBe('o/r')
  })
  it('.git suffix still stripped after punctuation removal', () => {
    expect(normalizeRepoUrl('github.com/o/r.git,')).toBe('o/r')
    expect(normalizeRepoUrl('github.com/o/r.git.')).toBe('o/r')
  })
  it('legit names unaffected', () => {
    expect(normalizeRepoUrl('github.com/o/r')).toBe('o/r')
    expect(normalizeRepoUrl('https://github.com/Owner/Repo-With_1.0'))
      .toBe('Owner/Repo-With_1.0')
    // interior dots/dashes/underscores survive — only TRAILING punct strips
    expect(normalizeRepoUrl('github.com/o/re.po_v2-x')).toBe('o/re.po_v2-x')
  })
  it('still rejects non-repo shapes', () => {
    expect(normalizeRepoUrl('github.com/a')).toBeNull()
    expect(normalizeRepoUrl('github.com/')).toBeNull()
  })
})
