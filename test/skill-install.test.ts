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
  it('extracts package files into root/<basename>', async () => {
    const gz = makeGz(['package/README.md', 'hi'], ['package/SKILL.md', '# skill'])
    await installSkillTar({ name: '@x/my-skill', gzipped: gz, root })
    expect(readFileSync(join(root, 'my-skill', 'README.md'), 'utf8')).toBe('hi')
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toBe('# skill')
  })

  it('same-basename packages both get namespaced dirs', async () => {
    const gz = makeGz(['package/SKILL.md', '# s'])
    await installSkillTar({ name: '@a/test', gzipped: gz, root })
    expect(existsSync(join(root, 'test', 'SKILL.md'))).toBe(true)   // singleton → basename
    await installSkillTar({ name: '@b/test', gzipped: gz, root })
    expect(existsSync(join(root, 'a--test', 'SKILL.md'))).toBe(true) // first renamed
    expect(existsSync(join(root, 'b--test', 'SKILL.md'))).toBe(true) // second namespaced
    expect(existsSync(join(root, 'test'))).toBe(false)
    // reinstall of the first package must land back at a--test, not test
    await installSkillTar({ name: '@a/test', gzipped: gz, root })
    expect(existsSync(join(root, 'a--test', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'test'))).toBe(false)
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

  it('github codeload wrapper root is stripped — repo id installs + uninstalls clean', async () => {
    // codeload archives ship every path under `<repo>-<ref>/`; it must be
    // peeled like npm's package/ or skill nests stay one level too deep
    const gz = makeGz(
      ['myrepo-abc1234/README.md', 'hi'],
      ['myrepo-abc1234/.opencode/skills/alpha/SKILL.md', '# a'],
      ['myrepo-abc1234/.opencode/skills/beta/SKILL.md', '# b'],
    )
    const msg = await installSkillTar({ name: 'o/myrepo', gzipped: gz, root })
    expect(msg).toMatch(/lifted 2/)
    expect(existsSync(join(root, 'myrepo', 'README.md'))).toBe(true)
    expect(existsSync(join(root, 'alpha', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'beta', 'SKILL.md'))).toBe(true)
    // no wrapper dir may remain inside the package dir
    expect(existsSync(join(root, 'myrepo', 'myrepo-abc1234'))).toBe(false)
    await uninstallSkillDir('o/myrepo', root)
    expect(existsSync(join(root, 'myrepo'))).toBe(false)
    expect(existsSync(join(root, 'alpha'))).toBe(false)
    expect(existsSync(join(root, 'beta'))).toBe(false)
  })

  it('single-segment first path is not mistaken for a wrapper (root-level files)', async () => {
    // an npm tarball whose package/ strip leaves root-level files must NOT be
    // treated as wrapped — the 'every item shares segment' rule prevents this
    const gz = makeGz(['package/SKILL.md', '# s'], ['package/README.md', 'r'])
    await installSkillTar({ name: 'solo', gzipped: gz, root })
    expect(existsSync(join(root, 'solo', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'solo', 'README.md'))).toBe(true)
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

  it('uninstall prefers the namespaced dir, falls back to basename', async () => {
    // collided install lives at a--test — a foreign `test` dir must survive
    mkdirSync(join(root, 'a--test'), { recursive: true })
    writeFileSync(join(root, 'a--test', '.market-skills.json'), JSON.stringify({ name: '@a/test', paths: [] }))
    writeFileSync(join(root, 'a--test', 'SKILL.md'), '#')
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(join(root, 'test', 'SKILL.md'), '# foreign')
    await uninstallSkillDir('@a/test', root)
    expect(existsSync(join(root, 'a--test'))).toBe(false)
    expect(existsSync(join(root, 'test', 'SKILL.md'))).toBe(true)   // foreign untouched
    // singleton install lives at basename
    await uninstallSkillDir('@a/test', root)
    expect(existsSync(join(root, 'test'))).toBe(false)
  })

  it('manifest paths cannot escape the root', async () => {
    mkdirSync(join(root, 'evil'), { recursive: true })
    writeFileSync(join(root, 'evil', '.market-skills.json'), JSON.stringify({ paths: ['../outside', '/abs'] }))
    await uninstallSkillDir('evil', root)
    // path traversal entries filtered by the root/ prefix guard
    expect(existsSync(join(root, 'evil'))).toBe(false)
  })
})
