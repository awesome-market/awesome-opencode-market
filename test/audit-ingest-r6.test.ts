/** audit #1 fresh round (catalog-ingestion, round 6):
 *  1. CLI entry guard — `import.meta.url === 'file://'+argv[1]` was FALSE on
 *     non-ASCII checkouts (url-encode vs raw path) and symlinked invocations
 *     (loader realpaths the module url, argv[1] keeps the spelled path):
 *     every `npx tsx pipeline/*.ts` silently exited 0 and did nothing —
 *     the entire catalog pipeline was dead on such checkouts. Shared
 *     isMain() canonicalizes both sides via realpathSync+fileURLToPath;
 *     21 CLI entrypoints migrated.
 *  2. mergeEntries resurrected a remote hold even when the worker had
 *     DELIBERATELY unbound it — the evidence-regressed path drops a
 *     pendingUpdate pinned to the regressed version "so merge re-evaluates
 *     instead of releasing evidence-less code", but the remote-hold branch
 *     can't tell "never saw" from "deliberately dropped" and restored it
 *     verbatim. The unbind was dead code. Resurrection now skips the hold
 *     when the fresh entry carries `sec:evidence-regressed@<pu.version>`.
 *  3. ghWorker's tree-transient branch kept the old entry (correct) but did
 *     NOT stamp 'repo-fetch-error' like the meta-probe failure above it —
 *     a seed repo whose tree kept erroring sat 'queued' unexplained until
 *     the 30-day dead cutoff.
 *  4. submission-status/notify-published main() indexed argv[2]/argv[3]
 *     without a usage guard — a bare invocation crashed with a TypeError
 *     instead of printing usage like seed-outcome.ts does. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import type { CatalogIndex, PluginEntry } from '../src/schema.ts'
import { isMain } from '../pipeline/main-guard.ts'
import { mergeEntries } from '../pipeline/publish/merge.ts'
import { run } from '../pipeline/run.ts'
import { RULESET_VERSION } from '../pipeline/scan/rules.ts'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const mkRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'approved',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

describe('isMain: CLI entry guard is path-encoding/symlink safe', () => {
  it('argv[1] vs itself → true; missing/garbage url → false', () => {
    expect(isMain(pathToFileURL(process.argv[1]!).href)).toBe(true)
    expect(isMain('file:///no/such/module-here.ts')).toBe(false)
    // vitest runs this file imported — argv[1] is the vitest binary, not us
    expect(isMain(import.meta.url)).toBe(false)
  })

  it('entry guard fires under a non-ASCII checkout path', () => {
    const d = tmp('入口守卫-')
    const guardUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../pipeline/main-guard.ts')).href
    writeFileSync(join(d, 'cli.ts'),
      `import { isMain } from '${guardUrl}'\nconsole.log(isMain(import.meta.url) ? 'MAIN' : 'SKIP')\n`)
    // old guard printed nothing here: url-encoded meta vs raw argv spelling
    expect(execFileSync('npx', ['tsx', join(d, 'cli.ts')], { encoding: 'utf8' }).trim()).toBe('MAIN')
  })

  it('entry guard fires through a symlinked script path', () => {
    const real = tmp('mainguard-real-')
    const link = join(tmpdir(), `mainguard-ln-${process.pid}-${Date.now()}`)
    symlinkSync(real, link)
    const guardUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../pipeline/main-guard.ts')).href
    writeFileSync(join(real, 'cli.ts'),
      `import { isMain } from '${guardUrl}'\nconsole.log(isMain(import.meta.url) ? 'MAIN' : 'SKIP')\n`)
    expect(execFileSync('npx', ['tsx', join(link, 'cli.ts')], { encoding: 'utf8' }).trim()).toBe('MAIN')
  })

  it('no pipeline module keeps the raw file:// argv compare', () => {
    const pipeDir = join(dirname(fileURLToPath(import.meta.url)), '../pipeline')
    const bad: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.ts') && readFileSync(p, 'utf8').includes('file://${process.argv')) bad.push(p)
      }
    }
    walk(pipeDir)
    expect(bad).toEqual([])
  })
})

describe('mergeEntries: evidence-regressed unbind survives', () => {
  const pu = (version: string) => ({
    version, heldAt: 't', reason: 'awaiting-review',
    capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION, findings: [], redFlags: [] },
    verification: { status: 'unverified' as const },
  }) as NonNullable<PluginEntry['pendingUpdate']>

  it('remote hold pinned to the regressed version is NOT resurrected', () => {
    const prev = e({ name: 'p', slug: 'p', pendingUpdate: pu('2.0.0') })
    // worker pushed `prev` minus the hold, stamped with the marker
    const ours = e({ name: 'p', slug: 'p',
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION,
        findings: ['sec:evidence-regressed@2.0.0'], redFlags: [] } })
    const m = mergeEntries([ours], idx([prev]), 'oc1', RULESET_VERSION)
    expect(m[0]!.pendingUpdate).toBeUndefined()
  })

  it('remote hold we never saw still resurrects (unchanged contract)', () => {
    const prev = e({ name: 'q', slug: 'q', pendingUpdate: pu('9.9.9') })
    const m = mergeEntries([e({ name: 'q', slug: 'q' })], idx([prev]), 'oc1', RULESET_VERSION)
    expect(m[0]!.pendingUpdate?.version).toBe('9.9.9')
  })

  it('hold on a DIFFERENT version than the regressed one still resurrects', () => {
    const prev = e({ name: 'r', slug: 'r', pendingUpdate: pu('3.0.0') })
    // marker names 4.0.0 (current upstream), not the held 3.0.0 — the hold
    // pinned elsewhere must survive (regression only disqualifies ITS version)
    const ours = e({ name: 'r', slug: 'r',
      capabilities: { scannedAt: 't', rulesetVersion: RULESET_VERSION,
        findings: ['sec:evidence-regressed@4.0.0'], redFlags: [] } })
    const m = mergeEntries([ours], idx([prev]), 'oc1', RULESET_VERSION)
    expect(m[0]!.pendingUpdate?.version).toBe('3.0.0')
  })
})

describe('ghWorker: tree-transient stamps seed outcome', () => {
  it('seed repo + tree fetch error → repo-fetch-error (not silent queued)', async () => {
    const d = tmp('air6-')
    const seedPath = join(d, 'submissions.txt')
    writeFileSync(seedPath, '{"repo":"o/x","issue":1}\n')
    const outcomesPath = join(d, 'outcomes.json')
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/-/v1/search')) return mkRes({ objects: [] })
      if (url.includes('api.github.com/search')) return mkRes({ items: [] })
      if (url.includes('api.github.com/repos/o/x') && !url.includes('/git/trees/'))
        return mkRes({ stargazers_count: 5, full_name: 'o/x', pushed_at: 't2', id: 9, default_branch: 'main' })
      if (url.includes('/git/trees/')) return mkRes({}, 500)
      return mkRes({}, 404)
    }) as typeof fetch
    // the lone seed candidate fails its tree probe → empty index → the
    // corruption gate would throw before writing outcomes; force it for this
    // unit path (the gate itself is covered elsewhere)
    await run({ outPath: join(d, 'i.json'), seedPath, seedOutcomesPath: outcomesPath, fetchFn: f, now: 't', forceGate: true })
    const outcomes = JSON.parse(readFileSync(outcomesPath, 'utf8')) as Record<string, string>
    expect(outcomes['o/x']).toBe('repo-fetch-error')
  })
})
