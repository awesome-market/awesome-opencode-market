import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { scanTarball, fmtFinding } from '../pipeline/scan/scan.ts'
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
  it('literal-ip rejects version/RFC/SVG/OID false positives', () => {
    const r = RULES.find(r => r.id === 'literal-ip')!
    // octet-overflow version soup
    expect(r.test('f.js', 'd="M11.385.6.113a9"')).toBeNull()
    // version pin
    expect(r.test('f.js', '"opencv-python==4.9.0.80"')).toBeNull()
    // UA string
    expect(r.test('f.js', 'Chrome/131.0.0.0 Safari/537.36')).toBeNull()
    // RFC section ref
    expect(r.test('f.js', 'RFC 9309 §2.3.1.4 recommends')).toBeNull()
    // kernel version fragment glued to dotted token
    expect(r.test('f.js', 'kernel_version: 5.10.0-180.12.0.50.oe2203')).toBeNull()
    // multicast + CGNAT excluded
    expect(r.test('f.js', 'ssdp 239.255.255.250')).toBeNull()
    expect(r.test('f.js', 'cgnet 100.64.0.0/10')).toBeNull()
    // real IPs still fire — bare token, host assignment, url
    expect(r.test('f.js', 'connect("45.33.32.156")')).toBeTruthy()
    expect(r.test('f.js', 'const host = "45.33.32.156"')).toBeTruthy()
  })

  it('demotes high hits in non-execution / inert context to medium', () => {
    const cred = RULES.find(r => r.id === 'credential-read')!
    // test/fixture path — content that never runs on the consumer
    expect(cred.test('package/test/plugin.test.ts', 'fs.readFileSync(home + "/.ssh/id_rsa")')!.sev).toBe('medium')
    expect(cred.test('package/src/plugin.spec.js', 'x(".npmrc")')!.sev).toBe('medium')
    // comment line — describing the path, not opening it
    expect(cred.test('package/guard.mjs', '// detects: cat ~/.aws/credentials')!.sev).toBe('medium')
    // quoted example/detection signature — spaces or shell/regex syntax
    // inside the string mean "command about the path", not the path itself
    expect(cred.test('package/guard.mjs', 'rx("cat\\\\s+~/.ssh")')!.sev).toBe('medium')
    expect(cred.test('package/deny.mjs', "deny('cat ~/.ssh/id_rsa')")!.sev).toBe('medium')
    // a closed earlier string must NOT demote the real read after it
    expect(cred.test('package/index.js', "const a='x'; readFileSync('/root/.npmrc')")!.sev).toBeUndefined()
    // bare path literal — the real operational signal stays high
    expect(cred.test('package/index.js', 'fs.readFileSync(home + "/.ssh/id_rsa")')!.sev).toBeUndefined()

    const obf = RULES.find(r => r.id === 'obfuscation')!
    // eval inside a detection-signature string
    expect(obf.test('package/rules.mjs', "deny('eval(String.fromCharCode(114))')")!.sev).toBe('medium')
    // test file
    expect(obf.test('package/test/t.test.ts', 'eval(atob(x))')!.sev).toBe('medium')
    // real eval stays high
    expect(obf.test('package/index.js', "const a='x'; eval('run()')")!.sev).toBeUndefined()
    // hex blob in test dir demotes; in src stays high
    const hex = "'\\x41\\x42\\x43\\x44\\x45\\x46\\x47\\x48'"
    expect(obf.test('package/test/fixtures/blob.js', `const b = ${hex}`)!.sev).toBe('medium')
    expect(obf.test('package/index.js', `const b = ${hex}`)!.sev).toBeUndefined()

    const life = RULES.find(r => r.id === 'lifecycle-script')!
    // fixture package.json is a test asset — finding, not a flag
    expect(life.test('package/test/fixtures/pkg/package.json', '{"scripts":{"postinstall":"x"}}')!.sev).toBe('medium')
    expect(life.test('package/package.json', '{"scripts":{"postinstall":"x"}}')!.sev).toBeUndefined()
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

  it('captures the offending source line + number as evidence', async () => {
    const r = await scanTarball(tgz)
    const cred = r.findings.find(f => f.rule === 'credential-read')!
    expect(cred.file).toBe('pkg/dist/index.js')
    expect(cred.lineNo).toBe(5)
    expect(cred.line).toContain('.ssh/id_rsa')
    const evalHit = r.findings.find(f => f.rule === 'obfuscation')!
    expect(evalHit.lineNo).toBe(2)
    expect(evalHit.line).toContain('eval(')
    const life = r.findings.find(f => f.rule === 'lifecycle-script')!
    expect(life.line).toContain('postinstall')
    // serialization keeps the `rule:file` head and appends ` — L<no>: <code>`
    expect(fmtFinding(cred)).toMatch(/^credential-read:pkg\/dist\/index\.js — L5: /)
  })

  it('findings are capped at 500 with a scan-capped marker', async () => {
    // each planted file hits ~6 rules — 120 files ≫ the 500-finding ceiling
    const dir = mkdtempSync(join(tmpdir(), 'scanfat-'))
    mkdirSync(join(dir, 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'fat', version: '1.0.0' }))
    for (let i = 0; i < 120; i++) {
      writeFileSync(join(dir, 'pkg', `f${i}.js`),
        `eval(x); fetch('https://a.example'); require('child_process'); fs.readFileSync('/root/.ssh/id_rsa'); connect('45.33.32.156'); const b='${'A'.repeat(220)}'`)
    }
    const out = join(dir, 'f.tgz')
    execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    const r = await scanTarball(readFileSync(out))
    // 500 real findings + 1 scan-capped marker
    expect(r.findings.length).toBe(501)
    expect(r.findings.some(f => f.rule === 'scan-capped')).toBe(true)
    expect(r.findings.filter(f => f.rule === 'scan-capped')).toHaveLength(1)
  }, 30000)

  it('parses in memory — no tar entries land under cwd', async () => {
    // regression: extract() is Unpack — it writes every entry to
    // process.cwd() (the CI workspace in production). tar.t parses only.
    const work = mkdtempSync(join(tmpdir(), 'scancwd-'))
    const prev = process.cwd()
    process.chdir(work)
    try {
      await scanTarball(tgz)   // 'pkg/'-prefixed fixture — old code wrote work/pkg/**
      expect(readdirSync(work)).toEqual([])
    } finally { process.chdir(prev) }
  })

  it('r3 rules: private IPv4 ignored, public v6 flagged, times not flagged', () => {
    const ip = RULES.find(r => r.id === 'literal-ip')!
    expect(ip.test('f.js', '10.0.0.1')).toBeNull()
    expect(ip.test('f.js', '192.168.1.5')).toBeNull()
    expect(ip.test('f.js', '172.16.0.9')).toBeNull()
    expect(ip.test('f.js', 'meet at 12:30:45')).toBeNull()
    expect(ip.test('f.js', '2001:db8::1')).toBeNull()       // doc range
    expect(ip.test('f.js', 'fd00::dead:beef')).toBeNull()  // ULA
    expect(ip.test('f.js', '2404:6800:4003:c02::64')).toBeTruthy() // public v6
    const lc = RULES.find(r => r.id === 'lifecycle-script')!
    for (const hook of ['preinstall', 'postinstall', 'install', 'prepublish'])
      expect(lc.test('package/package.json', `{"scripts":{"${hook}":"x"}}`), hook).toBeTruthy()
    const ps = RULES.find(r => r.id === 'pack-script')!
    expect(ps.sev).toBe('medium')
    for (const hook of ['prepublishOnly', 'prepack', 'postpack']) {
      expect(lc.test('package/package.json', `{"scripts":{"${hook}":"x"}}`), hook).toBeNull()
      expect(ps.test('package/package.json', `{"scripts":{"${hook}":"x"}}`), hook).toBeTruthy()
    }
    expect(lc.test('package/package.json', '{"scripts":{"test":"x","build":"y","prepublishOnly":"z"}}')).toBeNull()
  })
})
