// audit #3 (verify-flow, fresh round):
//  1. github pin drift is STALE, not failed — the sha is the version identity;
//     a measurement for the old commit must drop (npm re-tag keeps failed/drift)
//  2. verifyPackage refuses parts with neither plugin nor skill — a crafted
//     target can't be structure-checked into a false 'verified'
//  3. checkSkillStructureGit refuses sha-less input instead of silently
//     verifying whatever HEAD serves
//  4. findGuiBundle tolerates plugin-influenced tree entries (file named like
//     a dir) — an ENOTDIR crash recorded harness:true, making the package
//     permanently unverifiable instead of honestly failed
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage, checkSkillStructureGit, type ExecFn } from '../pipeline/verify/verify.ts'
import { findGuiBundle } from '../pipeline/verify/gui.ts'
import { mergeResults } from '../pipeline/verify/merge.ts'
import { CatalogIndex, type PluginEntry } from '../src/schema.ts'

const caps = { scannedAt: 't', findings: [], redFlags: [] }
const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: {}, features: [], category: [],
  license: null, deprecated: false, deprecatedMessage: null, replacement: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: caps, verification: { status: 'unverified' }, compat: {},
  approval: 'approved', ...over,
})
const idx = (plugins: PluginEntry[]) =>
  CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })
const base = { level: 'load' as const, opencodeVersion: '2.2.5', verifiedAt: '2026-01-02T00:00:00Z' }

const noopExec = (async () => ({ stdout: '', stderr: '' })) as unknown as ExecFn

describe('audit#3 — github pin drift drops, npm drift still fails', () => {
  it('github: verified result on the OLD pin drops; npm: same shape still failed/drift', () => {
    const gh = entry({
      name: 'g', slug: 'g', latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'shaNEW' },
    })
    const m = mergeResults(idx([gh]), [
      { name: 'g', status: 'verified', integrity: 'shaOLD', ...base },
    ])
    expect(m.plugins[0]!.verification.status).toBe('unverified')   // stale — dropped, not failed
    expect(m.plugins[0]!.verification.retries).toBeUndefined()     // no retry budget burned

    const npm = entry({ integrity: 'sha512-PINNED' })
    const m2 = mergeResults(idx([npm]), [
      { name: 'p', version: '1.0.0', status: 'verified', integrity: 'sha512-RETAGGED', ...base },
    ])
    expect(m2.plugins[0]!.verification.status).toBe('failed')      // npm re-tag stays a drift failure
    expect(m2.plugins[0]!.verification.retries).toBe(1)
  })

  it('github: a failed result on the OLD pin also drops — sha2 was never exercised', () => {
    const gh = entry({
      name: 'g', slug: 'g', latestVersion: null,
      source: { kind: 'github', id: 'o/r', repo: 'O/R', version: 'shaNEW' },
      verification: { status: 'verified', level: 'load', opencodeVersion: '2.2.5', verifiedAt: '2026-01-01' },
    })
    const m = mergeResults(idx([gh]), [
      { name: 'g', status: 'failed', integrity: 'shaOLD', ...base },
    ])
    expect(m.plugins[0]!.verification.status).toBe('verified')     // standing evidence untouched
  })
})

describe('audit#3 — verifyPackage refuses unanswerable targets', () => {
  it('parts with neither plugin nor skill → harness throw, not a fake skill check', async () => {
    await expect(verifyPackage('p', {
      home: mkdtempSync(join(tmpdir(), 'vh-')),
      execFn: noopExec, parts: ['mcp'],
    })).rejects.toThrow('no verifiable payload')
  })
  it('checkSkillStructureGit without a pinned sha → throw, no HEAD fallback', async () => {
    await expect(checkSkillStructureGit(
      mkdtempSync(join(tmpdir(), 'vh-')), noopExec, 'o/r', undefined,
    )).rejects.toThrow('no pinned commit sha')
  })
})

describe('audit#3 — findGuiBundle tolerates malformed install trees', () => {
  it('a FILE inside the npm cache root is skipped, not a shard crash', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'))
    const npmRoot = join(home, 'cache', 'opencode', 'npm')
    mkdirSync(npmRoot, { recursive: true })
    writeFileSync(join(npmRoot, 'p@1.0.0'), 'not a directory')
    const found = findGuiBundle(home, 'p')
    expect('error' in found).toBe(true)
  })
  it('a file named like a scope dir inside node_modules does not crash the git-path scan', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh-'))
    const spec = 'o/r#abc123'
    const slug = 'r'
    const gitDir = `git-${slug}-${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`
    const nm = join(home, 'cache', 'opencode', 'npm', gitDir, 'ts', 'node_modules')
    mkdirSync(nm, { recursive: true })
    writeFileSync(join(nm, '@scope'), 'a file, not a scope directory')
    const found = findGuiBundle(home, 'p', spec)
    expect('error' in found).toBe(true)   // graceful "not found", not a thrown ENOTDIR
  })
})
