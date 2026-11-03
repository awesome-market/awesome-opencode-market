import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installSkillTar, uninstallSkillDir } from '../plugins/market/src/skill-install.ts'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// minimal tar builder — 512-byte header + content padded to 512
function tarEntry(name: string, content: string | null, type = '0'): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write('0000644', 100)
  const size = content === null ? 0 : Buffer.byteLength(content)
  h.write(size.toString(8).padStart(11, '0'), 124)
  h.write(type, 156)
  if (content === null) return h
  const body = Buffer.from(content)
  const pad = Buffer.alloc(Math.ceil(size / 512) * 512 - size)
  return Buffer.concat([h, body, pad])
}
const makeGz = (...files: [string, string | null, string?][]) =>
  gzipSync(Buffer.concat([...files.map(([n, c, t]) => tarEntry(n, c, t)), Buffer.alloc(1024)]))

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sk-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('installSkillTar', () => {
  it('extracts package files into root/<id>', async () => {
    const gz = makeGz(['package/README.md', 'hi'], ['package/SKILL.md', '# skill'])
    await installSkillTar({ name: '@x/my-skill', gzipped: gz, root })
    expect(readFileSync(join(root, 'my-skill', 'README.md'), 'utf8')).toBe('hi')
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toBe('# skill')
  })

  it('lifts nested .opencode/skills/* to root and writes manifest', async () => {
    const gz = makeGz(
      ['package/.opencode/skills', null, '5'],
      ['package/.opencode/skills/alpha', null, '5'],
      ['package/.opencode/skills/alpha/SKILL.md', '# a'],
      ['package/SKILL.md', '# pkg skill'])
    await installSkillTar({ name: 'my-pkg', gzipped: gz, root })
    expect(existsSync(join(root, 'alpha', 'SKILL.md'))).toBe(true)
    const m = JSON.parse(readFileSync(join(root, 'my-pkg', '.market-skills.json'), 'utf8'))
    expect(m.paths).toContain('alpha')
  })

  it('throws on empty tarball', async () => {
    await expect(installSkillTar({ name: 'x', gzipped: gzipSync(Buffer.alloc(1024)), root })).rejects.toThrow('empty')
  })

  it('foreign collision prefixes with <id>-', async () => {
    mkdirSync(join(root, 'shared'), { recursive: true })  // pre-existing foreign dir
    const gz = makeGz(
      ['package/.opencode/skills/shared', null, '5'],
      ['package/.opencode/skills/shared/SKILL.md', '# s'],
      ['package/SKILL.md', '# pkg'])
    await installSkillTar({ name: 'my-pkg', gzipped: gz, root })
    expect(existsSync(join(root, 'my-pkg-shared', 'SKILL.md'))).toBe(true)
  })
})

describe('uninstallSkillDir', () => {
  it('removes manifest-listed lifted paths + the package dir', async () => {
    const gz = makeGz(
      ['package/.opencode/skills/beta', null, '5'],
      ['package/.opencode/skills/beta/SKILL.md', '# b'],
      ['package/SKILL.md', '# pkg'])
    await installSkillTar({ name: 'my-pkg', gzipped: gz, root })
    await uninstallSkillDir('my-pkg', root)
    expect(existsSync(join(root, 'beta'))).toBe(false)
    expect(existsSync(join(root, 'my-pkg'))).toBe(false)
  })

  it('legacy fallback removes <id>-* dirs without a manifest', async () => {
    mkdirSync(join(root, 'old-pkg-sub', 'x'), { recursive: true })
    writeFileSync(join(root, 'old-pkg-sub', 'x', 'SKILL.md'), '#')
    mkdirSync(join(root, 'old-pkg'), { recursive: true })
    await uninstallSkillDir('old-pkg', root)
    expect(existsSync(join(root, 'old-pkg-sub'))).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })

  it('manifest paths cannot escape the root', async () => {
    mkdirSync(join(root, 'evil'), { recursive: true })
    writeFileSync(join(root, 'evil', '.market-skills.json'), JSON.stringify({ paths: ['../outside', '/abs'] }))
    await uninstallSkillDir('evil', root)
    // path traversal entries filtered by the root/ prefix guard
    expect(existsSync(join(root, 'evil'))).toBe(false)
  })
})
