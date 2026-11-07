/** audit #3 fresh round (verification flow), round 9:
 *  verify.yml's merge step `mv`d release.ts output over index.new.json with
 *  no `-s` guard — the third instance of the same defect class already fixed
 *  in catalog.yml's release fold and catalog-append.sh's apply path. An
 *  exit-0-with-empty-output release.ts would truncate the merged index into
 *  a published empty catalog while RELEASE_FAILED still read 0.
 *  Fleet-wide guard: EVERY `release.ts … > out && mv` site must carry the
 *  `-s` non-empty check inside the same `if` pipeline. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const files = [
  ...readdirSync(join(REPO, '.github', 'workflows')).filter(f => /\.ya?ml$/.test(f)).map(f => join(REPO, '.github', 'workflows', f)),
  join(REPO, 'bin', 'catalog-append.sh'),
]

describe('release.ts emit sites — every mv is non-empty guarded', () => {
  it('no release.ts redirect is followed by an unguarded mv', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // find `release.ts … > <out>` blocks and require `[ -s <out> ]` to
      // appear before the matching `mv <out>` within the same if-branch
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(/release\.ts\b[^>]*>\s*(\S+)/)
        if (!m) continue
        const out = m[1]!
        // scan forward to the `mv <out>` (allowing a line-continued `&&`)
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (new RegExp(`mv\\s+${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lines[j]!)) {
            const window = lines.slice(i, j + 1).join('\n')
            if (!new RegExp(`\\[\\s*-s\\s+${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`).test(window))
              offenders.push(`${f}:${i + 1}`)
            break
          }
          if (/;\s*then|fi\b/.test(lines[j]!)) break   // left the if-branch — mv lives elsewhere
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
