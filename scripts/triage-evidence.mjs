// Triage evidence extractor: untar each tgz, rescan via scanTarball (current
// ruleset), then print matched evidence lines for each remaining red flag.
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanTarball } from '../pipeline/scan/scan.ts'

const T = '/tmp/triage_tgz'
const X = join(tmpdir(), 'triage-extract')
mkdirSync(X, { recursive: true })

const PATS = {
  'credential-read': /\.ssh|id_rsa|\.aws\/credentials|keychain|\.npmrc|\.netrc/g,
  obfuscation: /eval\(|new Function|(\\x[0-9a-fA-F]{2}){8,}/g,
  'child-process': /child_process|execSync|spawnSync|\bspawn\(|\bexec\(/g,
  'network-call': /fetch\(|http\.request|require\(['"]https?['"]|axios|\bcurl\s|\bwget\s/g,
}

const tgzs = process.argv[2] === '--all'
  ? readdirSync(T).filter(f => f.endsWith('.tgz')).map(f => join(T, f))
  : process.argv.slice(2).map(f => join(T, f))

const out = []
for (const tgz of tgzs) {
  const key = tgz.split('/').pop().replace('.tgz', '')
  const dir = join(X, key)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  try { execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'pipe' }) } catch { out.push({ key, err: 'untar-failed' }); continue }
  const buf = readFileSync(tgz)
  const res = await scanTarball(buf)
  const rec = { key, redFlags: res.redFlags.map(f => `${f.rule}:${f.file}`), evidence: {} }
  const files = []
  const walk = d => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); f.isDirectory() ? walk(p) : files.push(p) } }
  try { walk(dir) } catch {}
  for (const rf of res.redFlags) {
    const disk = files.find(f => f.endsWith('/' + rf.file) || f.endsWith(rf.file.replace(/^package\//, '')))
    if (!disk) { rec.evidence[rf.rule + ':' + rf.file] = ['<file not found>']; continue }
    let txt = ''; try { txt = readFileSync(disk, 'utf8') } catch { txt = '' }
    if (rf.rule === 'binary-blob') { rec.evidence[rf.rule + ':' + rf.file] = [`<binary ${txt.length || '?'}B>`]; continue }
    const pat = PATS[rf.rule]; const lines = []
    if (pat) for (const [i, line] of txt.split('\n').entries()) { if (pat.test(line)) lines.push(`${i + 1}: ${line.trim().slice(0, 130)}`); if (lines.length >= 3) break; pat.lastIndex = 0 }
    if (rf.rule === 'lifecycle-script' || rf.rule === 'prepare-script' || rf.rule === 'pack-script') {
      try { const pj = JSON.parse(txt); lines.push(...Object.entries(pj.scripts || {}).filter(([k]) => /install|prepare|pack|publish/i.test(k)).map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)) } catch {}
    }
    rec.evidence[rf.rule + ':' + rf.file] = lines.slice(0, 4)
  }
  out.push(rec)
}
console.log(JSON.stringify(out))
