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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage, checkSkillStructureGit, gitDepPrepNote, type ExecFn } from '../pipeline/verify/verify.ts'
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
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: caps, verification: { status: 'unverified' }, compat: {},
  approval: 'approved', ...over,
})
const idx = (plugins: PluginEntry[]) =>
  CatalogIndex.parse({ version: '1', generatedAt: 't', categories: {}, plugins, removed: [] })
const base = { level: 'load' as const, opencodeVersion: '2.3.0', verifiedAt: '2026-01-02T00:00:00Z' }

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
      verification: { status: 'verified', level: 'load', opencodeVersion: '2.3.0', verifiedAt: '2026-01-01' },
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

describe('audit#4 — gitDepPrepNote names the upstream opencode bug', () => {
  // pacote's in-clone prepare re-invokes the opencode binary as npm → every
  // git dep with build/prepare/install-type scripts or workspaces fails
  // `plugin add` on ≤2.3.0 (anomalyco/opencode#62817). The excerpt must say
  // "upstream bug", not read as a package defect.
  const WHY = 'NpmInstallFailedError: Failed to install o/r#abc: git dep preparation failed'
  const GIT = { repo: 'o/r', sha: 'abc123' }
  const fakeRun = (pkgJson: string | null, failTar = false) => (async (cmd: string, args: string[]) => {
    if (failTar) throw new Error('tar exploded')
    if (cmd === 'tar' && args[0] === 'tzf')
      return { stdout: pkgJson === null ? 'r-abc/README.md\n' : `r-abc/package.json\nr-abc/src/index.ts\n`, stderr: '' }
    if (cmd === 'tar' && args[0] === 'xzOf') return { stdout: pkgJson ?? '', stderr: '' }
    return { stdout: '', stderr: '' }
  }) as unknown as ExecFn

  it('trigger scripts → upstream-bug annotation naming the scripts', async () => {
    const note = await gitDepPrepNote(WHY, GIT, fakeRun('{"scripts":{"build":"tsc","test":"vitest"}}'))
    expect(note).toContain('upstream opencode bug')
    expect(note).toContain('build')
    expect(note).not.toContain('test/')
  })
  it('workspaces field alone triggers the annotation', async () => {
    const note = await gitDepPrepNote(WHY, GIT, fakeRun('{"workspaces":["packages/*"],"scripts":{"test":"vitest"}}'))
    expect(note).toContain('upstream opencode bug')
    expect(note).toContain('workspaces')
  })
  it('no trigger shape → empty note (genuine install failure keeps plain excerpt)', async () => {
    expect(await gitDepPrepNote(WHY, GIT, fakeRun('{"scripts":{"test":"vitest"},"main":"index.ts"}'))).toBe('')
    expect(await gitDepPrepNote(WHY, GIT, fakeRun(null))).toBe('')          // no root package.json
  })
  it('non-git targets and unrelated errors never fetch or annotate', async () => {
    expect(await gitDepPrepNote(WHY, undefined, fakeRun('{"scripts":{"build":"x"}}'))).toBe('')
    expect(await gitDepPrepNote('npm 404', GIT, fakeRun('{"scripts":{"build":"x"}}'))).toBe('')
    expect(await gitDepPrepNote(WHY, { repo: 'o/r' }, fakeRun('{"scripts":{"build":"x"}}'))).toBe('') // sha-less
  })
  it('codeload/tar failure degrades to no note — never blocks the failure path', async () => {
    expect(await gitDepPrepNote(WHY, GIT, fakeRun('{"scripts":{"build":"x"}}', true))).toBe('')
    const bad = (async () => ({ stdout: 'not json', stderr: '' })) as unknown as ExecFn
    expect(await gitDepPrepNote(WHY, GIT, bad)).toBe('')
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

describe('diagFile → per-package logUrl', () => {
  it('a failed row carrying diagFile publishes a catalog blob URL; env-less merge omits it', () => {
    const repo = 'awesome-market/awesome-opencode-market'
    const keep = process.env.GITHUB_REPOSITORY
    process.env.GITHUB_REPOSITORY = repo
    try {
      const m = mergeResults(idx([entry()]), [
        { name: 'p', version: '1.0.0', status: 'failed', diagFile: 'p-1.0.0.log', ...base },
      ])
      const v = m.plugins[0]!.verification
      expect(v.logUrl).toBe(`https://github.com/${repo}/blob/catalog/verify-logs/p-1.0.0.log`)
    } finally { delete process.env.GITHUB_REPOSITORY }
    // no repo env → field absent, never a fabricated URL
    // (GITHUB_REPOSITORY is always set under Actions — must stay deleted here)
    const m2 = mergeResults(idx([entry()]), [
      { name: 'p', version: '1.0.0', status: 'failed', diagFile: 'p-1.0.0.log', ...base },
    ])
    expect(m2.plugins[0]!.verification.logUrl).toBeUndefined()
    if (keep !== undefined) process.env.GITHUB_REPOSITORY = keep
    // verified rows / rows without diagFile stay clean
    const m3 = mergeResults(idx([entry()]), [
      { name: 'p', version: '1.0.0', status: 'verified', ...base },
    ])
    expect(m3.plugins[0]!.verification.logUrl).toBeUndefined()
  })
  it('path-traversal diagFile is rejected by the result schema', async () => {
    // merge.ts loads results-*.json through a zod gate — a crafted row with
    // a slashed diagFile must drop, not write a traversal into the index
    const { execFileSync } = await import('node:child_process')
    const d = mkdtempSync(join(tmpdir(), 'vm-'))
    writeFileSync(join(d, 'i.json'), JSON.stringify(idx([entry()])))
    mkdirSync(join(d, 'res'))
    writeFileSync(join(d, 'res/results-0.json'), JSON.stringify([
      { name: 'p', version: '1.0.0', status: 'failed', level: 'install',
        opencodeVersion: '2.3.0', verifiedAt: '2026-01-02T00:00:00Z', diagFile: '../evil.log' },
    ]))
    process.env.GITHUB_REPOSITORY = 'o/r'
    try {
      execFileSync('npx', ['tsx', 'pipeline/verify/merge.ts', join(d, 'i.json'), join(d, 'res'), join(d, 'out.json')],
        { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' })
      const out = JSON.parse(readFileSync(join(d, 'out.json'), 'utf8'))
      expect(out.plugins[0].verification.logUrl).toBeUndefined()
    } finally { delete process.env.GITHUB_REPOSITORY }
  })
})
