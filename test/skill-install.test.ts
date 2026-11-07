import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installSkillTar, uninstallSkillDir } from '../plugins/market/src/skill-install.ts'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// minimal tar builder — 512-byte header + content padded to 512, with a
// real ustar checksum (installSkillTar verifies it — a zeroed field is
// 'corrupt tarball', not a lenient pass)
function tarEntry(name: string, content: string | null, type = '0'): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write('0000644', 100)
  const size = content === null ? 0 : Buffer.byteLength(content)
  h.write(size.toString(8).padStart(11, '0'), 124)
  h.write(type, 156)
  h.fill(0x20, 148, 156)                 // chksum field counts as spaces
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  if (content === null) return h
  const body = Buffer.from(content)
  const pad = Buffer.alloc(Math.ceil(size / 512) * 512 - size)
  return Buffer.concat([h, body, pad])
}
const makeGz = (...files: [string, string | null, string?][]) =>
  gzipSync(Buffer.concat([...files.map(([n, c, t]) => tarEntry(n, c, t)), Buffer.alloc(1024)]))
// recompute the header checksum after a test mutates a field — otherwise the
// checksum gate fires first and the test silently stops covering its target
const retar = (h: Buffer) => {
  h.fill(0x20, 148, 156)
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
}

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

  it('a failed FRESH install leaves no wedge — retry succeeds', async () => {
    // died between mkdir and manifest write → manifest-less dir → the foreign
    // guard used to refuse every retry ('already exists and is not managed')
    await expect(installSkillTar({ name: 'wedged', gzipped: gzipSync(Buffer.alloc(1024)), root })).rejects.toThrow('empty')
    expect(existsSync(join(root, 'wedged'))).toBe(false)
    const gz = makeGz(['package/SKILL.md', '# s'])
    await installSkillTar({ name: 'wedged', gzipped: gz, root })
    expect(readFileSync(join(root, 'wedged', 'SKILL.md'), 'utf8')).toBe('# s')
  })

  it('a failed REINSTALL preserves the previous version', async () => {
    const gz = makeGz(['package/SKILL.md', '# v1'], ['package/extra.txt', 'e'])
    await installSkillTar({ name: 'upg', gzipped: gz, root })
    await expect(installSkillTar({ name: 'upg', gzipped: gzipSync(Buffer.alloc(1024)), root })).rejects.toThrow('empty')
    // old install must survive a failed upgrade — files AND manifest intact
    expect(readFileSync(join(root, 'upg', 'SKILL.md'), 'utf8')).toBe('# v1')
    expect(readFileSync(join(root, 'upg', 'extra.txt'), 'utf8')).toBe('e')
    expect(existsSync(join(root, 'upg', '.market-skills.json'))).toBe(true)
    const gz2 = makeGz(['package/SKILL.md', '# v2'])
    await installSkillTar({ name: 'upg', gzipped: gz2, root })
    expect(readFileSync(join(root, 'upg', 'SKILL.md'), 'utf8')).toBe('# v2')
  })

  it('an EMPTY manifest-less dir is a failed-install leftover — healed, not refused', async () => {
    mkdirSync(join(root, 'leftover'), { recursive: true })
    const gz = makeGz(['package/SKILL.md', '# s'])
    await installSkillTar({ name: 'leftover', gzipped: gz, root })
    expect(readFileSync(join(root, 'leftover', 'SKILL.md'), 'utf8')).toBe('# s')
  })

  it('a NON-EMPTY manifest-less dir is foreign — refuses and says how to unblock', async () => {
    mkdirSync(join(root, 'foreign'), { recursive: true })
    writeFileSync(join(root, 'foreign', 'SKILL.md'), '# mine')
    const gz = makeGz(['package/SKILL.md', '# s'])
    await expect(installSkillTar({ name: 'foreign', gzipped: gz, root }))
      .rejects.toThrow(/not managed by market.*delete .* manually/)
    expect(readFileSync(join(root, 'foreign', 'SKILL.md'), 'utf8')).toBe('# mine')
  })

  it('control-char filenames are skipped, not written to the skills dir', async () => {
    const gz = makeGz(
      ['package/SKILL.md', '# s'],
      ['package/ok.txt', 'fine'],
      ['package/bad\x07name.txt', 'evil'],
      ['package/sub/bad\x01f.txt', 'evil2'],
      ['package/esc\x1b[31m.txt', 'evil3'])
    await installSkillTar({ name: 'ctrl', gzipped: gz, root })
    expect(readFileSync(join(root, 'ctrl', 'SKILL.md'), 'utf8')).toBe('# s')
    expect(readFileSync(join(root, 'ctrl', 'ok.txt'), 'utf8')).toBe('fine')
    const names = readdirSync(join(root, 'ctrl'))
    expect(names).toContain('ok.txt')
    expect(names.filter(n => /[\x00-\x1f\x7f-\x9f]/.test(n))).toEqual([])
    expect(existsSync(join(root, 'ctrl', 'sub'))).toBe(false)  // nested bad name never materializes its dir either
  })

  it('tar metadata members (pax global / GNU longlink / volume) do not break wrapper detection', async () => {
    // 'g'/'K'/'V' headers carry fixed placeholder names — they used to land
    // in `items`, break the shared-first-segment rule, and strand every
    // skill one level deep ('wrote N, lifted 0' silent dead install)
    const gz = makeGz(
      ['pax_global_header', '27 comment=packed by test\n', 'g'],
      ['@LongLink', 'a-very-long-link-target-name', 'K'],
      ['myrepo-abc1234/', null, 'V'],
      ['myrepo-abc1234/README.md', 'hi'],
      ['myrepo-abc1234/.opencode/skills/alpha/SKILL.md', '# a'],
    )
    const msg = await installSkillTar({ name: 'o/myrepo', gzipped: gz, root })
    expect(msg).toMatch(/lifted 1/)
    expect(readFileSync(join(root, 'alpha', 'SKILL.md'), 'utf8')).toBe('# a')
    expect(readFileSync(join(root, 'myrepo', 'README.md'), 'utf8')).toBe('hi')
    expect(existsSync(join(root, 'myrepo', 'pax_global_header'))).toBe(false)
    expect(existsSync(join(root, 'myrepo', '@LongLink'))).toBe(false)
    expect(existsSync(join(root, 'myrepo', 'myrepo-abc1234'))).toBe(false)
  })

  it('a tarball with files but nothing loadable fails honestly — no dead "installed"', async () => {
    // docs/license-only package: extraction succeeds but no SKILL.md exists
    // at any discoverable level — reporting success would badge a package
    // opencode can never load
    const gz = makeGz(['package/README.md', 'docs'], ['package/LICENSE', 'mit'])
    await expect(installSkillTar({ name: 'docsonly', gzipped: gz, root }))
      .rejects.toThrow('no loadable skill')
    // fresh-install cleanup: no manifest-less wedge for the retry path
    expect(existsSync(join(root, 'docsonly'))).toBe(false)
  })

  it('a member declaring more bytes than the buffer holds is corrupt, not silently truncated', async () => {
    const e = tarEntry('package/SKILL.md', '# s')
    e.write('00000010000', 124)   // declare 4096 bytes — the buffer holds ~6
    retar(e)
    const gz = gzipSync(Buffer.concat([e, Buffer.alloc(1024)]))
    await expect(installSkillTar({ name: 'trunc', gzipped: gz, root }))
      .rejects.toThrow('corrupt tarball')
  })

  it('a base-256 (binary) size field is refused, not misparsed as octal 0', async () => {
    const e = tarEntry('package/SKILL.md', '# s')
    e[124] = 0x80                // high bit = GNU base-256 encoding marker
    retar(e)
    const gz = gzipSync(Buffer.concat([e, Buffer.alloc(1024)]))
    await expect(installSkillTar({ name: 'b256', gzipped: gz, root }))
      .rejects.toThrow('corrupt tarball')
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

  it('a header checksum mismatch is corrupt tarball, not a silent member', async () => {
    // flip a name byte AFTER the checksum was written — every downstream
    // field is untrustworthy once the header fails its own integrity check
    const e = tarEntry('package/SKILL.md', '# s')
    e[10] = e[10]! ^ 0xff
    const gz = gzipSync(Buffer.concat([e, Buffer.alloc(1024)]))
    await expect(installSkillTar({ name: 'badck', gzipped: gz, root }))
      .rejects.toThrow('corrupt tarball')
  })

  it('an all-zero checksum field is refused, not treated as unsigned', async () => {
    const e = tarEntry('package/SKILL.md', '# s')
    e.fill(0, 148, 156)
    const gz = gzipSync(Buffer.concat([e, Buffer.alloc(1024)]))
    await expect(installSkillTar({ name: 'zerock', gzipped: gz, root }))
      .rejects.toThrow('corrupt tarball')
  })

  it('GNU sparse members are refused — hole semantics are unsafe for skills', async () => {
    // 'S' type + pax .sparse.* keywords both promise "mostly zeros" — our
    // bounds check assumes real bytes; a sparse member would write stale
    // dest contents it never received
    const gz1 = makeGz(['package/SKILL.md', '# s'], ['package/big.bin', null, 'S'])
    await expect(installSkillTar({ name: 'sparse1', gzipped: gz1, root }))
      .rejects.toThrow('sparse')
    const pax = '36 GNU.sparse.size=1048576 GNU.sparse.realsize=0\n'
    const gz2 = makeGz(['package/SKILL.md', '# s'], ['pax_hdr', pax, 'x'])
    await expect(installSkillTar({ name: 'sparse2', gzipped: gz2, root }))
      .rejects.toThrow('sparse')
    expect(existsSync(join(root, 'sparse1'))).toBe(false)
    expect(existsSync(join(root, 'sparse2'))).toBe(false)
  })

  it('Windows-reserved names never reach disk', async () => {
    const gz = makeGz(
      ['package/SKILL.md', '# s'],
      ['package/CON.txt', 'x'],
      ['package/nul.md', 'x'],
      ['package/com10.md', 'ok'],       // COM10 is NOT reserved
      ['package/foo./bar.txt', 'x'])    // trailing dot segment
    await installSkillTar({ name: 'winsafe', gzipped: gz, root })
    expect(existsSync(join(root, 'winsafe', 'CON.txt'))).toBe(false)
    expect(existsSync(join(root, 'winsafe', 'nul.md'))).toBe(false)
    expect(existsSync(join(root, 'winsafe', 'com10.md'))).toBe(true)
    expect(existsSync(join(root, 'winsafe', 'foo.'))).toBe(false)
    expect(readFileSync(join(root, 'winsafe', 'SKILL.md'), 'utf8')).toBe('# s')
  })

  it('reinstall sweeps files the previous version wrote — foreign files survive', async () => {
    const gz1 = makeGz(
      ['package/SKILL.md', '# v1'],
      ['package/old.txt', 'old'],
      ['package/docs/guide.md', 'guide'])
    await installSkillTar({ name: 'stale', gzipped: gz1, root })
    // user drops their own file inside the managed dir — it is NOT ours
    writeFileSync(join(root, 'stale', 'mine.txt'), 'user')
    // v2 drops old.txt + docs/, adds new.txt
    const gz2 = makeGz(['package/SKILL.md', '# v2'], ['package/new.txt', 'new'])
    const msg = await installSkillTar({ name: 'stale', gzipped: gz2, root })
    expect(readFileSync(join(root, 'stale', 'SKILL.md'), 'utf8')).toBe('# v2')
    expect(existsSync(join(root, 'stale', 'old.txt'))).toBe(false)
    expect(existsSync(join(root, 'stale', 'docs'))).toBe(false)   // emptied dir swept
    expect(readFileSync(join(root, 'stale', 'new.txt'), 'utf8')).toBe('new')
    expect(readFileSync(join(root, 'stale', 'mine.txt'), 'utf8')).toBe('user')
    const m = JSON.parse(readFileSync(join(root, 'stale', '.market-skills.json'), 'utf8')) as { files?: string[] }
    expect(m.files).toEqual(expect.arrayContaining(['SKILL.md', 'new.txt']))
    expect(m.files).not.toContain('old.txt')
    expect(msg).toMatch(/removed 2 stale/)
  })

  it('a symlinked dir inside dest cannot redirect extraction outside', async () => {
    const gz1 = makeGz(['package/SKILL.md', '# v1'])
    await installSkillTar({ name: 'link', gzipped: gz1, root })
    const outside = mkdtempSync(join(tmpdir(), 'sk-out-'))
    try {
      try { symlinkSync(outside, join(root, 'link', 'sub'), 'dir') }
      catch { rmSync(outside, { recursive: true, force: true }); return }  // no symlink perms
      const gz2 = makeGz(['package/SKILL.md', '# v2'], ['package/sub/evil.txt', 'escaped'])
      await installSkillTar({ name: 'link', gzipped: gz2, root })
      // the write through the link is refused — nothing lands outside
      expect(existsSync(join(outside, 'evil.txt'))).toBe(false)
      expect(readFileSync(join(root, 'link', 'SKILL.md'), 'utf8')).toBe('# v2')
      rmSync(outside, { recursive: true, force: true })
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('lift never follows a planted symlink inside a nest dir', async () => {
    const gz1 = makeGz(['package/SKILL.md', '# v1'])
    await installSkillTar({ name: 'lift', gzipped: gz1, root })
    const outside = mkdtempSync(join(tmpdir(), 'sk-lift-'))
    try {
      const nest = join(root, 'lift', '.opencode', 'skills')
      mkdirSync(nest, { recursive: true })
      try { symlinkSync(outside, join(nest, 'planted'), 'dir') }
      catch { rmSync(outside, { recursive: true, force: true }); return }
      // v2 carries a real nested skill alongside the planted link
      const gz2 = makeGz(
        ['package/SKILL.md', '# v2'],
        ['package/.opencode/skills/real-skill/SKILL.md', '# r'])
      await installSkillTar({ name: 'lift', gzipped: gz2, root })
      expect(readFileSync(join(root, 'real-skill', 'SKILL.md'), 'utf8')).toBe('# r')
      // the link stayed put — its .market-lift marker was never written
      // through it into `outside`
      expect(existsSync(join(outside, '.market-lift'))).toBe(false)
      expect(existsSync(join(nest, 'planted'))).toBe(true)
    } finally { rmSync(outside, { recursive: true, force: true }) }
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

  it('manifest-less dirs are FOREIGN — refuses to delete, preserves everything', async () => {
    // .market-skills.json existed since this installer was born, so a dir
    // without one can never be a market install — it is user files. The old
    // "legacy fallback" rm -rf'd it AND swept every <id>-* sibling.
    mkdirSync(join(root, 'old-pkg-sub', 'x'), { recursive: true })
    writeFileSync(join(root, 'old-pkg-sub', 'x', 'SKILL.md'), '#')
    mkdirSync(join(root, 'old-pkg'), { recursive: true })
    writeFileSync(join(root, 'old-pkg', 'SKILL.md'), '# foreign')
    await expect(uninstallSkillDir('old-pkg', root)).rejects.toThrow(/not managed by market/)
    expect(existsSync(join(root, 'old-pkg-sub', 'x', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, 'old-pkg', 'SKILL.md'))).toBe(true)
  })

  it('stray <id>-* dirs with no package dir are reported, not deleted', async () => {
    // orphan lifts from a manually-deleted install are indistinguishable from
    // foreign dirs — report honestly instead of guessing
    mkdirSync(join(root, 'old-pkg-sub'), { recursive: true })
    writeFileSync(join(root, 'old-pkg-sub', 'SKILL.md'), '#')
    await expect(uninstallSkillDir('old-pkg', root)).rejects.toThrow(/not managed by market/)
    expect(existsSync(join(root, 'old-pkg-sub', 'SKILL.md'))).toBe(true)
    // nothing at all → idempotent 'removed'
    await expect(uninstallSkillDir('never-installed', root)).resolves.toBe('removed')
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
    // the remaining 'test' dir has NO manifest — it is foreign, so a second
    // uninstall must refuse rather than delete user files (was: deleted it)
    await expect(uninstallSkillDir('@a/test', root)).rejects.toThrow(/not managed by market/)
    expect(existsSync(join(root, 'test', 'SKILL.md'))).toBe(true)
  })

  it('manifest paths cannot escape the root', async () => {
    mkdirSync(join(root, 'evil'), { recursive: true })
    // a name-matching manifest proves ownership; its path entries still get
    // the root/ prefix guard — traversal entries are filtered, not honored
    writeFileSync(join(root, 'evil', '.market-skills.json'), JSON.stringify({ name: 'evil', paths: ['../outside', '/abs'] }))
    await uninstallSkillDir('evil', root)
    expect(existsSync(join(root, 'evil'))).toBe(false)
    // a manifest WITHOUT the package name is foreign — ownership is exact,
    // symmetric with install's refusal to merge into unowned dirs
    mkdirSync(join(root, 'noname'), { recursive: true })
    writeFileSync(join(root, 'noname', '.market-skills.json'), JSON.stringify({ paths: [] }))
    await expect(uninstallSkillDir('noname', root)).rejects.toThrow(/not managed by market/)
    expect(existsSync(join(root, 'noname'))).toBe(true)
  })
})
