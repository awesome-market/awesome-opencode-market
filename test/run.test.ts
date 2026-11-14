import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { run, loadOldIndex, anchorIntegrity, DRIFT_FLAG } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

function mkTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'runtgz-'))
  mkdirSync(join(dir, 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

/** Same shape as mkTgz plus a nested skill payload — dual-nature tarball. */
function mkTgzSkill(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'runtgz-'))
  mkdirSync(join(dir, 'pkg/skills/x'), { recursive: true })
  writeFileSync(join(dir, 'pkg/package.json'), JSON.stringify({ name: 'p', main: 'index.js' }))
  writeFileSync(join(dir, 'pkg/index.js'), 'export default { id: "p", setup() {} }')
  writeFileSync(join(dir, 'pkg/skills/x/SKILL.md'), '---\nname: x\n---\n# skill\n')
  const out = join(dir, 'p.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'pkg'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  return readFileSync(out)
}

/** Mock fetch routing by URL substring. */
function mkFetch(tgz: Buffer) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/-/v1/search')) {
      return new Response(JSON.stringify({ objects: [
        { package: { name: 'good-pkg', version: '1.0.0', description: 'd',
          keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
        { package: { name: 'kw-only', version: '1.0.0', description: '',
          keywords: ['opencode'], links: {}, date: 't' } },
      ] }))
    }
    if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
    if (url.includes('registry.npmjs.org') && url.includes('good-pkg')) {
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { repository: 'https://github.com/o/good', license: 'MIT',
          dist: { tarball: 'https://x/t.tgz' }, keywords: ['opencode'], main: 'index.js' } },
        time: { '1.0.0': 't' },
      }))
    }
    if (url.includes('registry.npmjs.org') && url.includes('kw-only')) {
      return new Response(JSON.stringify({
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { keywords: ['opencode'], dist: {} } },
        time: {},
      }))
    }
    if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
    // repo tree: evidence-bearing paths so github-kind candidates pass the gate
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [
      { path: '.opencode/plugin/x.ts' }, { path: 'package.json' }, { path: 'README.md' },
    ] }))
    if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 3, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } }))
    if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
    if (url.includes('/contents/')) return new Response('', { status: 404 })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('pipeline/run', () => {
  it('end-to-end: candidate → evidence gate → scan → index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'))
    const out = join(dir, 'index.json')
    const idx = await run({ outPath: out, fetchFn: mkFetch(mkTgz()), now: '2026-11-02T00:00:00Z' })
    expect(idx.plugins).toHaveLength(1)
    const e = idx.plugins[0]!
    expect(e.name).toBe('good-pkg')
    expect(e.slug).toBe('o/good')
    expect(e.capabilities.scannedAt).toBe('2026-11-02T00:00:00Z')
    expect(e.verification.status).toBe('unverified')
    expect(e.metrics.stars).toBe(3)
    expect(e.metrics.npmDownloads30d).toBe(7)
    const written = JSON.parse(readFileSync(out, 'utf8'))
    expect(written.version).toBe('1')
  })
  it('loadOldIndex: valid, invalid, missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'old-'))
    expect(loadOldIndex()).toBeNull()
    expect(loadOldIndex(join(dir, 'nope.json'))).toBeNull()
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ version: '1', generatedAt: 'x', categories: {}, plugins: [], removed: [] }))
    expect(loadOldIndex(good)!.plugins).toEqual([])
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{"version":"9"}')
    // present-but-corrupt hard-fails — running blind would re-pend the catalog
    expect(() => loadOldIndex(bad)).toThrow()
  })
})

describe('pipeline/run seed injection', () => {
  it('--seed injects npm names + github: lines become github-kind, dedups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runseed-'))
    const seed = join(dir, 'seed.txt')
    writeFileSync(seed, 'seed-pkg\ngithub:o/r\ngood-pkg\n\n')
    const out = join(dir, 'index.json')
    const idx = await run({ outPath: out, seedPath: seed, fetchFn: mkFetch(mkTgz()), now: '2026-11-02T00:00:00Z' })
    // good-pkg dedup'd (already a candidate); github:o/r lands as a github-kind entry
    expect(idx.plugins.map(p => p.name)).toEqual(['good-pkg', 'o/r'])
    expect(idx.plugins.find(p => p.name === 'o/r')!.source.kind).toBe('github')
  })

  it('repo package.json naming a different package → sec:repo-mismatch finding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runmm-'))
    const base = mkFetch(mkTgz())
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('raw.githubusercontent.com') && url.includes('package.json'))
        return new Response(JSON.stringify({ name: 'totally-other-pkg' }))
      return base(input, init)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'index.json'), fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'good-pkg')!
    expect(e.capabilities.findings).toContain('sec:repo-mismatch:totally-other-pkg')
  })

  it('repo package.json naming the same package → no finding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runmm-'))
    const base = mkFetch(mkTgz())
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('raw.githubusercontent.com') && url.includes('package.json'))
        return new Response(JSON.stringify({ name: 'good-pkg' }))
      return base(input, init)
    }) as typeof fetch
    const idx = await run({ outPath: join(dir, 'index.json'), fetchFn: f, now: 't' })
    const e = idx.plugins.find(p => p.name === 'good-pkg')!
    expect(e.capabilities.findings.some(x => x.startsWith('sec:repo-mismatch'))).toBe(false)
  })
})

describe('github-kind hardening', () => {
  const ghItem = (full_name: string) => ({
    full_name, description: 'd', archived: false, fork: false,
    pushed_at: 't', stargazers_count: 1, default_branch: 'main', topics: ['opencode-plugin'],
  })
  const ghBase = (trees: (url: string) => Response | null, codeload: () => Response) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return new Response(JSON.stringify({ objects: [] }))
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [ghItem('o/r')] }))
      const t = trees(url); if (t) return t
      if (url.includes('codeload')) return codeload()
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 1 }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch

  it('stale search default_branch — tree probes HEAD, repo still admitted', async () => {
    // the repo renamed its branch after the search index snapshot: trees/main
    // 404s, but the HEAD ref still resolves — admission must not depend on the
    // stale name
    const f = ghBase(
      url => url.includes('/git/trees/main')
        ? new Response('{}', { status: 404 })
        : url.includes('/git/trees/HEAD')
          ? new Response(JSON.stringify({ tree: [{ path: 'SKILL.md' }] }))
          : null,
      () => new Response(new Uint8Array(mkTgz())),
    )
    const idx = await run({ outPath: join(mkdtempSync(join(tmpdir(), 'rb-')), 'i.json'), fetchFn: f, now: 't' })
    expect(idx.plugins.find(p => p.name === 'o/r')?.source.kind).toBe('github')
  })

  it('nested skills/<x>/SKILL.md marks contains:[skill]', async () => {
    // repos keep skills in a skills/ dir as often as at the root or
    // .opencode/skills — a nested SKILL.md must still tag the entry
    const f = ghBase(
      url => url.includes('/git/trees/')
        ? new Response(JSON.stringify({ tree: [{ path: 'skills/x/SKILL.md' }] }))
        : null,
      () => new Response(new Uint8Array(mkTgz())),
    )
    const idx = await run({ outPath: join(mkdtempSync(join(tmpdir(), 'sk-')), 'i.json'), fetchFn: f, now: 't' })
    // 'plugin' too — the repo ships a root package.json alongside the skill
    expect(idx.plugins.find(p => p.name === 'o/r')?.contains).toEqual(['plugin', 'skill'])
  })

  it('skill-only evidence derives type:skill; package.json present stays plugin', async () => {
    const withTree = (tree: { path: string }[]) => ghBase(
      url => url.includes('/git/trees/') ? new Response(JSON.stringify({ tree })) : null,
      () => new Response(new Uint8Array(mkTgz())),
    )
    const d = mkdtempSync(join(tmpdir(), 'ty-'))
    const skillOnly = await run({ outPath: join(d, 'a.json'), fetchFn: withTree([{ path: 'skills/x/SKILL.md' }]), now: 't' })
    expect(skillOnly.plugins.find(p => p.name === 'o/r')?.type).toBe('skill')
    const withPkg = await run({ outPath: join(d, 'b.json'), fetchFn: withTree([{ path: 'skills/x/SKILL.md' }, { path: 'package.json' }]), now: 't' })
    expect(withPkg.plugins.find(p => p.name === 'o/r')?.type).toBe('plugin')
  })

  it('hold surgery splits contains per version — candidate parts on pendingUpdate, displayed parts stay on entry', async () => {
    // v1.0.0 plugin-only → v2.0.0 adds a skill payload: install routing reads
    // entry.contains for the DISPLAYED version, so the held candidate's parts
    // must live on pendingUpdate.contains — the dual-nature boundary case
    let ver = '1.0.0'
    const tgzA = mkTgz()        // plugin only
    const tgzB = mkTgzSkill()   // plugin + SKILL.md
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({ objects: [
          { package: { name: 'good-pkg', version: ver, description: 'd',
            keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } }] }))
      }
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org') && url.includes('good-pkg')) {
        return new Response(JSON.stringify({
          'dist-tags': { latest: ver },
          versions: { [ver]: { repository: 'https://github.com/o/good', license: 'MIT',
            dist: { tarball: `https://x/t-${ver}.tgz` }, keywords: ['opencode'], main: 'index.js' } },
          time: { [ver]: 't' },
        }))
      }
      if (url.includes('x/t-1.0.0.tgz')) return new Response(new Uint8Array(tgzA))
      if (url.includes('x/t-2.0.0.tgz')) return new Response(new Uint8Array(tgzB))
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [
        { path: '.opencode/plugin/x.ts' }, { path: 'package.json' }, { path: 'README.md' }] }))
      if (url.includes('api.github.com/repos/')) return new Response(JSON.stringify({ stargazers_count: 3, archived: false, pushed_at: 't', license: { spdx_id: 'MIT' } }))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 7 }))
      if (url.includes('/contents/')) return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const d = mkdtempSync(join(tmpdir(), 'hold-'))
    const out1 = join(d, 'i1.json')
    await run({ outPath: out1, fetchFn: f, now: '2026-11-02T00:00:00Z' })
    // approve the displayed entry so the bump triggers hold surgery
    // (pending entries move their candidate in place — nothing to protect)
    const first = JSON.parse(readFileSync(out1, 'utf8'))
    first.plugins[0].approval = 'approved'
    delete first.plugins[0].approvalReason
    writeFileSync(out1, JSON.stringify(first))
    ver = '2.0.0'
    const idx2 = await run({ outPath: join(d, 'i2.json'), oldIndexPath: out1, fetchFn: f, now: '2026-11-03T00:00:00Z' })
    const e = idx2.plugins.find(p => p.name === 'good-pkg')!
    expect(e.latestVersion).toBe('1.0.0')
    expect(e.pendingUpdate?.version).toBe('2.0.0')
    expect(e.contains).toEqual(['plugin'])                          // displayed v1's parts
    expect(e.pendingUpdate?.contains).toEqual(['plugin', 'skill'])   // candidate v2's parts
  })

  it('oversize tarball stamps rulesetVersion — next run reuses, no re-fetch', async () => {
    let codeloadHits = 0
    const f = ghBase(
      url => url.includes('/git/trees/')
        ? new Response(JSON.stringify({ tree: [{ path: 'package.json' }], sha: 'commitA' }))
        : null,
      () => { codeloadHits++; return new Response('', { status: 200, headers: { 'content-length': '210000000' } }) },
    )
    const d = mkdtempSync(join(tmpdir(), 'big-'))
    const out1 = join(d, 'i1.json')
    const idx1 = await run({ outPath: out1, fetchFn: f, now: 't' })
    const e = idx1.plugins.find(p => p.name === 'o/r')!
    expect(e.capabilities.scannedAt).toBeNull()
    expect(e.capabilities.rulesetVersion).toBe(RULESET_VERSION)
    expect(codeloadHits).toBe(1)
    const idx2 = await run({ outPath: join(d, 'i2.json'), oldIndexPath: out1, fetchFn: f, now: 't2' })
    expect(codeloadHits).toBe(1)   // incremental reuse — oversize repo not re-fetched
    expect(idx2.plugins.find(p => p.name === 'o/r')?.capabilities.scannedAt).toBeNull()
  })
})

describe('kept-entry re-gate — discovery window is smaller than the catalog', () => {
  /** Phase 1 admits a dual-host package (foreign tags + opencode plugin add
   *  in readme); phase 2 drops it from discovery and strips the verb —
   *  under the tightened gate the kept entry must tombstone 'filtered',
   *  not ride forever on rescanStaleNpm which never re-checks evidence. */
  const fixture = (state: { searchHit: boolean; readme: string }) => {
    const tgz = mkTgz()
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) {
        const objects = [
          // a clean entry that stays discovered both phases — without it
          // the tombstoned index is empty and the publish gate refuses
          { package: { name: 'good-pkg', version: '1.0.0', description: 'd', keywords: ['opencode'], links: { repository: 'https://github.com/o/good' }, date: 't' } },
          ...(state.searchHit ? [{ package: { name: 'dsh-meter', version: '1.0.0', description: 'DeepSeek Harness plugin', keywords: ['dsh-plugin', 'opencode'], links: {}, date: 't' } }] : []),
        ]
        return new Response(JSON.stringify({ objects }))
      }
      if (url.includes('api.github.com/search')) return new Response(JSON.stringify({ items: [] }))
      if (url.includes('registry.npmjs.org') && url.includes('good-pkg')) {
        return new Response(JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { repository: 'https://github.com/o/good', license: 'MIT', keywords: ['opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' } } },
          time: { '1.0.0': 't' },
        }))
      }
      if (url.includes('registry.npmjs.org') && url.includes('dsh-meter')) {
        return new Response(JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { keywords: ['dsh-plugin', 'opencode'], main: 'index.js', dist: { tarball: 'https://x/t.tgz' } } },
          readme: state.readme,
          time: { '1.0.0': 't' },
        }))
      }
      if (url.includes('x/t.tgz')) return new Response(new Uint8Array(tgz))
      if (url.includes('api.npmjs.org/downloads')) return new Response(JSON.stringify({ downloads: 0 }))
      return new Response('', { status: 404 })
    }) as typeof fetch
  }

  it('pending foreign entry that falls out of discovery → filtered tombstone', async () => {
    const d = mkdtempSync(join(tmpdir(), 'reg-'))
    const out1 = join(d, 'i1.json')
    const idx1 = await run({ outPath: out1, fetchFn: fixture({ searchHit: true, readme: 'DeepSeek Harness plugin. For opencode: opencode plugin add dsh-meter' }), now: 't1' })
    expect(idx1.plugins.find(p => p.name === 'dsh-meter')).toBeTruthy()
    // forceGate: the fixture catalog is 2 entries so one tombstone trips
    // the 50%-drop publish gate — the test asserts the tombstone itself
    const idx2 = await run({ outPath: join(d, 'i2.json'), oldIndexPath: out1, fetchFn: fixture({ searchHit: false, readme: 'DeepSeek Harness plugin: dsh plugin add dsh-meter' }), now: 't2', forceGate: true })
    expect(idx2.plugins.find(p => p.name === 'dsh-meter')).toBeUndefined()
    expect(idx2.removed.some(r => r.name === 'dsh-meter' && r.reason === 'filtered')).toBe(true)
  })

  it('approved foreign entry is kept with sec:evidence-regressed, not tombstoned', async () => {
    const d = mkdtempSync(join(tmpdir(), 'reg2-'))
    const out1 = join(d, 'i1.json')
    const idx1 = await run({ outPath: out1, fetchFn: fixture({ searchHit: true, readme: 'DeepSeek Harness plugin. For opencode: opencode plugin add dsh-meter' }), now: 't1' })
    const first = JSON.parse(readFileSync(out1, 'utf8'))
    first.plugins[0].approval = 'approved'
    delete first.plugins[0].approvalReason
    writeFileSync(out1, JSON.stringify(first))
    const idx2 = await run({ outPath: join(d, 'i2.json'), oldIndexPath: out1, fetchFn: fixture({ searchHit: false, readme: 'DeepSeek Harness plugin: dsh plugin add dsh-meter' }), now: 't2', forceGate: true })
    const e = idx2.plugins.find(p => p.name === 'dsh-meter')
    expect(e).toBeTruthy()
    expect(e!.capabilities.findings.some(x => x.startsWith('sec:evidence-regressed'))).toBe(true)
    expect(idx2.removed.some(r => r.name === 'dsh-meter')).toBe(false)
  })
})

describe('classify', () => {
  it('assigns english category ids by keywords, declared fallback other', async () => {
    const { classify } = await import('../src/categories.ts')
    expect(classify('theme-x', 'x', 'colors and fonts')).toContain('appearance')
    expect(classify('x', 'x', 'git commit review')).toContain('workflow')
    expect(classify('x', 'x', 'zzz nothing')).toEqual(['other'])
    expect(classify('tok', 'x', 'llm pricing token').length).toBeLessThanOrEqual(2)
  })
})

describe('anchorIntegrity — same-version byte drift (re-tag guard)', () => {
  const caps = { scannedAt: 't', rulesetVersion: 'r', findings: [], redFlags: [] }
  it('same sha → anchor kept, no flag', () => {
    const r = anchorIntegrity(caps, 'sha512-a', 'sha512-a')
    expect(r.integrity).toBe('sha512-a')
    expect(r.capabilities.redFlags).toEqual([])
  })
  it('no prior anchor → backfill (field predates this entry)', () => {
    const r = anchorIntegrity(caps, null, 'sha512-a')
    expect(r.integrity).toBe('sha512-a')
    expect(r.capabilities.redFlags).toEqual([])
  })
  it('registry sha missing → keep the old anchor (absence proves nothing)', () => {
    const r = anchorIntegrity(caps, 'sha512-a', null)
    expect(r.integrity).toBe('sha512-a')
    const r2 = anchorIntegrity(caps, 'sha512-a', undefined)
    expect(r2.integrity).toBe('sha512-a')
  })
  it('DIFFERENT sha under the same version → freeze old anchor + sec flag', () => {
    // unpublish+republish is the signal — the index must NOT start certifying
    // the new bytes as the reviewed artifact
    const r = anchorIntegrity(caps, 'sha512-old', 'sha512-new')
    expect(r.integrity).toBe('sha512-old')
    expect(r.capabilities.redFlags).toContain(DRIFT_FLAG)
  })
  it('drift flag is deduped — repeated refresh does not stack it', () => {
    const flagged = { ...caps, redFlags: [DRIFT_FLAG] }
    const r = anchorIntegrity(flagged, 'sha512-old', 'sha512-new')
    expect(r.capabilities.redFlags.filter(f => f === DRIFT_FLAG)).toHaveLength(1)
  })
  it('capabilities object untouched on no-drift (same reference → no churn)', () => {
    const r = anchorIntegrity(caps, 'sha512-a', 'sha512-a')
    expect(r.capabilities).toBe(caps)
  })
})
