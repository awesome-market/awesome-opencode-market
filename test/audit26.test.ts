/** audit #3 fresh-batch (verification flow, round 2):
 *  1. mergeResults drift rewrite: an already-failed result keeps its REAL
 *     failing stage and log (drift note prepends); a drifted 'verified'
 *     still becomes failed/install.
 *  2. findGuiBundle git-install: multiple gui-export packages under the
 *     install tree resolve by repo-basename match; several unmatched
 *     candidates produce an honest 'ambiguous' error instead of [0].
 *  3. checkSkillTgz passes `--` before member names (option-injection guard).
 *  4. verify.yml merge drops a stale local 'catalog' branch before worktree
 *     add; apiNames carries a basename candidate for scoped npm names. */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { findGuiBundle } from '../pipeline/verify/gui.ts'
import type { VerifyResult } from '../pipeline/verify/verify.ts'
import { CatalogIndex, type PluginEntry } from '../src/schema.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'p' }, description: { en: '' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved', integrity: 'sha512-pinned',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: 'x', categories: {}, plugins, removed: [],
})
const res = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  name: 'p', version: '1.0.0', status: 'verified', level: 'load',
  opencodeVersion: '9.9.9', verifiedAt: '2026-02-01T00:00:00Z', ...over,
})

describe('mergeResults — drift rewrite preserves failed-result evidence', () => {
  it('failed result keeps its real level + excerpt under the drift note', () => {
    const m = mergeResults(idx([entry()]), [res({
      status: 'failed', level: 'load', integrity: 'sha512-other',
      logExcerpt: 'real failure: plugin blew up at load',
    })])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('failed')
    expect(v.level).toBe('load')
    expect(v.logExcerpt).toContain('differ from the pinned anchor')
    expect(v.logExcerpt).toContain('real failure: plugin blew up at load')
  })

  it('verified result still becomes failed/install on drift', () => {
    const m = mergeResults(idx([entry()]), [res({
      status: 'verified', level: 'render', integrity: 'sha512-other',
    })])
    const v = m.plugins[0]!.verification
    expect(v.status).toBe('failed')
    expect(v.level).toBe('install')
    expect(v.logExcerpt).toContain('differ from the pinned anchor')
  })

  it('matching integrity is untouched (regression)', () => {
    const m = mergeResults(idx([entry()]), [res({ integrity: 'sha512-pinned' })])
    expect(m.plugins[0]!.verification.status).toBe('verified')
  })
})

describe('findGuiBundle — git-install candidate resolution', () => {
  const sha = 'a'.repeat(40)
  const spec = `o/real-pkg#${sha}`
  const guiPkg = (dir: string, name: string) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports: { './gui': './g.js' } }))
    writeFileSync(join(dir, 'g.js'), 'module.exports = {}')
  }
  const tree = (home: string, pkgs: string[]) => {
    // opencode git cache layout: <npmRoot>/git-<slug>-<hash>/<ts>/node_modules/<pkg>
    const gitDir = `git-real-pkg-${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`
    const nm = join(home, 'cache', 'opencode', 'npm', gitDir, 'ts0', 'node_modules')
    for (const p of pkgs) guiPkg(join(nm, p), p)
  }

  it('prefers the package whose name matches the repo basename over an earlier dep', () => {
    const home = mkdtempSync(join(tmpdir(), 'gui-'))
    tree(home, ['a-dep', 'real-pkg'])
    const found = findGuiBundle(home, 'o/real-pkg', spec)
    expect('path' in found && found.path).toContain(join('node_modules', 'real-pkg'))
  })

  it('multiple non-matching candidates → honest ambiguous error', () => {
    const home = mkdtempSync(join(tmpdir(), 'gui-'))
    tree(home, ['a-dep', 'b-dep'])
    const found = findGuiBundle(home, 'o/real-pkg', spec)
    expect('error' in found && found.error).toContain('ambiguous gui bundle')
  })

  it('a single candidate still resolves (repo name ≠ package name is legal)', () => {
    const home = mkdtempSync(join(tmpdir(), 'gui-'))
    tree(home, ['odd-name'])
    const found = findGuiBundle(home, 'o/real-pkg', spec)
    expect('src' in found && found.src).toContain('module.exports')
  })
})

describe('verify flow — structural hardening', () => {
  it('checkSkillTgz guards member names with `--` (no option injection)', () => {
    const src = readFileSync(join(__dirname, '..', 'pipeline/verify/verify.ts'), 'utf8')
    expect(src).toContain("['xzf', tgz, '-O', '--', entry]")
  })

  it('npm apiNames carry a basename candidate for scoped packages', () => {
    const src = readFileSync(join(__dirname, '..', 'pipeline/verify/verify.ts'), 'utf8')
    expect(src).toContain("npmBase = name.split('/').pop()")
    expect(src).toContain('[name, npmBase]')
  })

  it('merge job drops a stale local catalog branch before worktree add', () => {
    const yml = readFileSync(join(__dirname, '..', '.github/workflows/verify.yml'), 'utf8')
    const seg = yml.slice(yml.indexOf('git worktree remove /tmp/cat'), yml.indexOf('ok=0'))
    expect(seg).toContain('git branch -D catalog')
    expect(seg.indexOf('git branch -D catalog')).toBeLessThan(seg.indexOf('git worktree add /tmp/cat'))
  })
})
