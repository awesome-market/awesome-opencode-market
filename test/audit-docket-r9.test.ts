import { describe, it, expect } from 'vitest'
import { docketTargets, issueBody, NONE_BACKLOG, REPO_BACKLOG } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: '2026-01-01T00:00:00Z', findings: [], redFlags: [] },
  verification: { status: 'verified' }, compat: {},
  approval: 'pending',
  ...over,
})
const idx = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  name: 'pkg', version: '1.0.0', verdict: 'pass', at: '2026-01-01T00:00:00Z', source: 'ai', ...over,
})

const tmp = async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return mkdtempSync(join(tmpdir(), 'dk9-'))
}
const runMain = async (args: string[], ghFn: (a: string[]) => string | Promise<string> = a => (a.includes('list') ? '[]' : '')) => {
  const { main } = await import('../pipeline/docket.ts')
  const saved = process.env.GH_REPO
  process.env.GH_REPO = 'o/r'
  try { await main(['x', 'y', ...args], ghFn) }
  finally { process.env.GH_REPO = saved }
}

describe('§8: aux files — exists-but-corrupt is not "empty"', () => {
  it('a verdicts file of ONLY malformed lines refuses to sync (no label/body churn)', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, '{not json\n{"also":broken\n')
    const calls: string[][] = []
    await expect(runMain(['--index', idxPath, '--verdicts', vPath], a => { calls.push(a); return '[]' }))
      .rejects.toThrow(/malformed/)
    // zero gh traffic — the whole issue surface must stay untouched
    expect(calls.length).toBe(0)
  })

  it('a MISSING verdicts file fails fast instead of reading as empty', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    await expect(runMain(['--index', idxPath, '--verdicts', join(dir, 'nope.jsonl')]))
      .rejects.toThrow(/missing/)
  })

  it('bad lines are still tolerated when parseable lines exist (append-only posture)', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, '{broken\n' + JSON.stringify(v()) + '\n')
    await expect(runMain(['--index', idxPath, '--verdicts', vPath])).resolves.toBeUndefined()
  })

  it('an existing-but-malformed digest-state refuses to regress maturity to empty', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    const dPath = join(dir, 'digest-state.json')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    writeFileSync(dPath, '{"not":"a digest state"}')
    await expect(runMain(['--index', idxPath, '--verdicts', vPath, '--digest-state', dPath]))
      .rejects.toThrow(/digest-state.*malformed/)
  })

  it('missing digest-state file fails fast; empty file stays a legal first-run', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    await expect(runMain(['--index', idxPath, '--verdicts', vPath, '--digest-state', join(dir, 'nope.json')]))
      .rejects.toThrow(/missing/)
    const dPath = join(dir, 'digest-state.json')
    writeFileSync(dPath, '') // the workflow's touch fallback — legit empty
    await expect(runMain(['--index', idxPath, '--verdicts', vPath, '--digest-state', dPath]))
      .resolves.toBeUndefined()
  })
})

describe('§8: malformed latestVersion fails visible, not invisible', () => {
  it("pending entry with latestVersion '' lands in the repo-only backlog", () => {
    const t = docketTargets(idx([e({ latestVersion: '' })]), [])
    expect(t).toHaveLength(1)
    expect(t[0]!.name).toBe(REPO_BACKLOG)
    expect(t[0]!.backlog?.[0]?.name).toBe('pkg')
  })
})

describe('§8: stuck verdict:* on an aggregate issue surfaces in the body', () => {
  it('unreviewed backlog renders the inert-label warning', () => {
    const t = docketTargets(idx([e({ capabilities: { scannedAt: '2020-01-01T00:00:00Z', findings: [], redFlags: [] }, firstSeenAt: '2020-01-01' })]), [], null,
      { paused: true })[0]!
    expect(t.name).toBe(NONE_BACKLOG)
    const body = issueBody(t, { stuckLabel: 'verdict:pass' })
    expect(body).toContain('verdict:pass')
    expect(body).toContain('永不会写盘')
  })

  it('repo-only backlog renders the inert-label warning', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]), [])[0]!
    expect(t.name).toBe(REPO_BACKLOG)
    const body = issueBody(t, { stuckLabel: 'verdict:concern' })
    expect(body).toContain('verdict:concern')
    expect(body).toContain('永不会写盘')
  })

  it('a stuck verdict:* label on the live aggregate issue triggers a body edit', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = await tmp()
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ latestVersion: null })])))
    writeFileSync(vPath, '')
    // the stored body is the warning-free render — the stuck label must drift it
    const target = docketTargets(idx([e({ latestVersion: null })]), [])[0]!
    const stored = issueBody(target, { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (a: string[]) => {
      calls.push(a)
      if (a.includes('list')) return JSON.stringify([{
        number: 12, title: `[review] ${REPO_BACKLOG}`,
        labels: [{ name: 'review:pending' }, { name: 'verdict:pass' }],
        body: stored,
      }])
      return ''
    }
    await runMain(['--index', idxPath, '--verdicts', vPath], ghFn)
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--body')
    expect(edits).toContain('永不会写盘')
  })
})
