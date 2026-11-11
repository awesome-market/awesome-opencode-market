import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installSkillTar } from '../plugins/market/src/skill-install.ts'
import { assertSpecForName } from '../plugins/market/src/hostx.ts'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync as rfs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// minimal tar builder — same convention as skill-install.test.ts, with a
// real ustar checksum (installSkillTar verifies it)
function tarEntry(name: string, content: string | null, type = '0'): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write('0000644', 100)
  const size = content === null ? 0 : Buffer.byteLength(content)
  h.write(size.toString(8).padStart(11, '0'), 124)
  h.write(type, 156)
  h.fill(0x20, 148, 156)
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  if (content === null) return h
  const body = Buffer.from(content)
  const pad = Buffer.alloc(Math.ceil(size / 512) * 512 - size)
  return Buffer.concat([h, body, pad])
}
const makeGz = (...files: [string, string | null, string?][]) =>
  gzipSync(Buffer.concat([...files.map(([n, c, t]) => tarEntry(n, c, t)), Buffer.alloc(1024)]))

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'a22-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('audit #10 — client consumption flow', () => {
  it('a tarball-shipped .market-skills.json cannot forge ownership to delete sibling dirs', async () => {
    // a foreign sibling dir a prior/other install owns — the sweep must never touch it
    mkdirSync(join(root, 'victim'), { recursive: true })
    writeFileSync(join(root, 'victim', 'keep.txt'), 'precious')
    // crafted tarball: payload + forged manifest claiming 'victim' as a prior lift
    const forged = JSON.stringify({ name: 'evil-pkg', paths: ['victim'] })
    const gz = makeGz(
      ['package/SKILL.md', '# skill'],
      ['package/.market-skills.json', forged],
    )
    await installSkillTar({ name: 'evil-pkg', gzipped: gz, root })
    expect(readFileSync(join(root, 'victim', 'keep.txt'), 'utf8')).toBe('precious')
    expect(existsSync(join(root, 'victim'))).toBe(true)
  })

  it('bookkeeping files are never extracted; the real manifest names the installer', async () => {
    const forged = JSON.stringify({ name: 'other-owner', paths: [] })
    const gz = makeGz(
      ['package/SKILL.md', '# skill'],
      ['package/.opencode/skills/subskill/.market-lift', JSON.stringify({ name: 'other-owner' })],
      ['package/.opencode/skills/subskill/SKILL.md', '# sub'],
      ['package/.market-skills.json', forged],
    )
    await installSkillTar({ name: 'pkg-a', gzipped: gz, root })
    // shipped manifest must not land in dest — the real one names pkg-a
    const mf = JSON.parse(readFileSync(join(root, 'pkg-a', '.market-skills.json'), 'utf8'))
    expect(mf.name).toBe('pkg-a')
    // the lifted subskill carries OUR marker, not the shipped one
    const lift = JSON.parse(readFileSync(join(root, 'subskill', '.market-lift'), 'utf8'))
    expect(lift.name).toBe('pkg-a')
  })

  it('a failed install never persists a shipped manifest for the next run', async () => {
    // forged manifest + payload → make the install die AFTER extraction by
    // leaving only bookkeeping+no files? simplest deterministic failure:
    // tarball with a forged manifest and NO real files → 'empty tarball'
    const forged = JSON.stringify({ name: 'evil-pkg', paths: ['victim'] })
    const gz = makeGz(['package/.market-skills.json', forged])
    await expect(installSkillTar({ name: 'evil-pkg', gzipped: gz, root })).rejects.toThrow('empty')
    // dest must be gone entirely (fresh-install cleanup) — no manifest on disk
    expect(existsSync(join(root, 'evil-pkg'))).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })

  it('gui installed() marks apiOk only after plugin.list() resolves', () => {
    const src = rfs(join(__dirname, '..', 'plugins', 'market', 'src', 'gui.ts'), 'utf8')
    const m = src.match(/m\.client\?\.plugin\?\.list\) \{([\s\S]{0,400})/)
    expect(m).toBeTruthy()
    const block = m![1]!
    // the flag must be set AFTER the await, not before — a throwing call
    // must still count as inventory-unreachable
    const awaitPos = block.indexOf('await m.client.plugin.list()')
    const flagPos = block.indexOf('apiOk = true')
    expect(awaitPos).toBeGreaterThanOrEqual(0)
    expect(flagPos).toBeGreaterThan(awaitPos)
  })

  it('tui installPluginHalf evaluates pinSpec inside the guarded try', () => {
    const src = rfs(join(__dirname, '..', 'plugins', 'market', 'src', 'tui.tsx'), 'utf8')
    const m = src.match(/installPluginHalf = async \(e: MarketEntry, updating: boolean[^)]*\)[\s\S]{0,700}/)
    expect(m).toBeTruthy()
    const head = m![0]
    const tryPos = head.indexOf('try {')
    const pinPos = head.indexOf('pinSpec(e)')
    expect(tryPos).toBeGreaterThanOrEqual(0)
    expect(pinPos).toBeGreaterThan(tryPos)   // pinSpec inside the try block
    // and the unguarded declaration must not appear before the try
    expect(head.slice(0, tryPos)).not.toContain('pinSpec(e)')
  })

  it('assertSpecForName rejects a trailing-empty version spec', () => {
    expect(() => assertSpecForName('pkg', 'pkg@')).toThrow(/invalid version/)
    expect(() => assertSpecForName('pkg', 'pkg@1.0.0')).not.toThrow()
    expect(() => assertSpecForName('pkg', 'pkg')).not.toThrow()
    expect(() => assertSpecForName('pkg', 'other@1.0.0')).toThrow(/does not match/)
  })
})
