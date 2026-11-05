import { describe, it, expect } from 'vitest'
import { docketTargets, issueTitle, issueBody } from '../pipeline/docket.ts'
import type { CatalogIndex, PluginEntry, AiVerdict } from '../src/schema.ts'

const e = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'o/pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' }, description: { en: 'a pkg' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: 't', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
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

describe('docketTargets', () => {
  it('pending entry + ai pass → open decision', () => {
    const t = docketTargets(idx([e()]), [v()])
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: 't' }])
  })
  it('ai pass maturity phase follows digest-state membership', () => {
    const ver = v()
    const announced = { lastDigestAt: '2026-01-02T00:00:00Z', announced: [`${ver.name}\0${ver.version}\0${ver.at}`], day: '2026-01-02', dayAnnounced: [] }
    expect(docketTargets(idx([e()]), [ver], announced)[0]!.maturity).toBe('announced')
    expect(docketTargets(idx([e()]), [ver], null)[0]!.maturity).toBe('pending-announce')
  })
  it('ai concern on pendingUpdate → open decision for THAT version', () => {
    const t = docketTargets(idx([e({
      approval: 'approved',
      pendingUpdate: { version: '2.0.0', capabilities: { scannedAt: 't', findings: [], redFlags: [] }, verification: { status: 'verified' }, heldAt: 't' },
    })]), [v({ version: '2.0.0', verdict: 'concern' })])
    expect(t).toEqual([{ name: 'pkg', version: '2.0.0', verdict: 'concern', verification: 'verified', maturity: 'pending-announce',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: 't' }])
  })
  it('human verdict already rules → no docket entry', () => {
    expect(docketTargets(idx([e()]), [v({ source: 'human' })])).toEqual([])
  })
  it('released entry → no docket entry', () => {
    expect(docketTargets(idx([e({ approval: 'approved' })]), [v()])).toEqual([])
  })
  it('no verdict yet → AI queue will handle, no human ask', () => {
    expect(docketTargets(idx([e()]), [])).toEqual([])
  })
  it('repo-only pending (latestVersion null, no verdict) → standing human review issue', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]), [])
    expect(t).toEqual([{ name: 'pkg', version: null, verdict: 'none', verification: 'verified',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: 't' }])
  })
  it('repo-only pending WITH a human verdict → decided, no standing issue', () => {
    const t = docketTargets(idx([e({ latestVersion: null })]),
      [v({ version: null, source: 'human', verdict: 'pass' })])
    expect(t).toEqual([])
  })
  it('non-pending repo entry → nothing to decide', () => {
    expect(docketTargets(idx([e({ latestVersion: null, approval: 'approved' })]), [])).toEqual([])
  })
  it('latest wins: ai pass then human concern → excluded', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'concern', source: 'human' }),
    ])
    expect(t).toEqual([])
  })
  it('issueTitle: versioned and version-less', () => {
    expect(issueTitle({ name: 'pkg', version: '1.0.0' })).toBe('[review] pkg@1.0.0')
    expect(issueTitle({ name: '@s/p', version: '2.0.0' })).toBe('[review] @s/p@2.0.0')
    expect(issueTitle({ name: 'o/r', version: null })).toBe('[review] o/r')
  })
  it('ai pass over a standing human concern → re-review target carries the brake context (K-3)', () => {
    const t = docketTargets(idx([e()]), [
      v({ at: '2026-01-01T00:00:00Z', verdict: 'concern', source: 'human', reason: 'manual brake' }),
      v({ at: '2026-01-02T00:00:00Z', verdict: 'pass', source: 'ai' }),
    ])
    expect(t[0]!.verdict).toBe('pass')
    expect(t[0]!.humanVerdict?.verdict).toBe('concern')
    expect(t[0]!.humanVerdict?.reason).toBe('manual brake')
  })
  it('held past NO_VERDICT_AGE_MS with zero verdicts → standing none issue (diagnose stalled)', () => {
    const t = docketTargets(idx([e({ firstSeenAt: '2026-01-01T00:00:00Z' })]), [], null,
      { now: '2026-01-05T00:00:00Z' })
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'none', verification: 'verified',
      slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: '2026-01-01T00:00:00Z' }])
  })
  it('young hold without verdict stays AI-owned — no issue inside the age window', () => {
    expect(docketTargets(idx([e({ firstSeenAt: '2026-01-04T00:00:00Z' })]), [], null,
      { now: '2026-01-05T00:00:00Z' })).toEqual([])
  })
  it('flag: live entry with identity sec redFlags → standing issue on displayed key', () => {
    const t = docketTargets(idx([e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:repo-recreated'] } })]), [])
    expect(t).toEqual([{ name: 'pkg', version: '1.0.0', verdict: 'flag', reason: 'sec:repo-recreated',
      verification: 'verified', slug: 'o/pkg', findings: 0, redFlags: 1, heldAt: 't' }])
  })
  it('flag retired by any human verdict on the displayed key; pending entries never flag', () => {
    const flagged = e({ approval: 'approved',
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:name-reused'] } })
    expect(docketTargets(idx([flagged]), [v({ source: 'human' })])).toEqual([])
    expect(docketTargets(idx([e({
      capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:name-reused'] } })]), [])
      .every(t => t.verdict !== 'flag')).toBe(true)
  })
  it('targets sort pass → none → concern → flag (freshest issues = most urgent)', () => {
    const mk = (n: string, over: Partial<PluginEntry> = {}) =>
      e({ name: n, slug: `o/${n}`, firstSeenAt: 't', ...over })
    const t = docketTargets(idx([
      mk('flagpkg', { approval: 'approved', capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } }),
      mk('concpkg'),
      mk('nonepkg', { firstSeenAt: '2020-01-01T00:00:00Z' }),
      mk('passpkg'),
    ]), [
      v({ name: 'concpkg', verdict: 'concern' }),
      v({ name: 'passpkg', verdict: 'pass' }),
    ], null, { now: '2026-01-05T00:00:00Z' })
    expect(t.map(x => x.verdict)).toEqual(['pass', 'none', 'concern', 'flag'])
  })
})

describe('issueBody', () => {
  it('human concern under a newer ai pass is shown as a standing brake, not silent', () => {
    const body = issueBody({
      name: 'pkg', version: '1.0.0', verdict: 'pass',
      humanVerdict: v({ verdict: 'concern', source: 'human', reason: 'brake' }),
    })
    expect(body).toContain('在押刹车')
    expect(body).toContain('人工判词：**concern**')
  })
  it('no human verdict → no human line; body is deterministic', () => {
    const t = { name: 'pkg', version: '1.0.0', verdict: 'pass' as const, verification: 'verified' }
    expect(issueBody(t)).toBe(issueBody(t))
    expect(issueBody(t)).not.toContain('人工判词')
  })
  it('ai pass on a red-flagged hold is called out as ignored — human-only release', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', redFlags: 2 })
    expect(body).toContain('只能人工放行')
    expect(body).toContain('红旗 2 项')
  })
  it('clean ai pass states the veto-window semantics + maturity phase', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', maturity: 'pending-announce' })
    expect(body).toContain('待日报公告')
    const b2 = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass', maturity: 'announced' })
    expect(b2).toContain('待放行闸')
  })
  it('stuck verdict:* label produces a warning block', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'pass' }, { stuckLabel: 'verdict:pass' })
    expect(body).toContain('未写盘')
    expect(body).toContain('verdict:pass')
  })
  it('repo/pagesBase opts render data + detail links', () => {
    const body = issueBody({ name: 'p', version: '1.0.0', verdict: 'flag', reason: 'sec:x', slug: 'o/p' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    expect(body).toContain('github.com/o/r/blob/catalog')
    expect(body).toContain('https://o.github.io/r/p/o/p.html')
    expect(body).toContain('已上架')
  })
})

describe('docket main', () => {
  it('creates a label-free-of-ai verdict issue for repo-only pendings + closes decided ones', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ latestVersion: null })])))
    writeFileSync(vPath, '')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{ number: 9, title: '[review] stale/x' }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const create = calls.find(c => c.includes('create'))
    expect(create).toBeTruthy()
    expect(create!.join(' ')).toContain('[review] pkg')
    // 'none' verdicts carry no ai: label — the body itself says "AI 不审"
    expect(create!.join(' ')).not.toContain('ai:')
    expect(calls.some(c => c.includes('close') && c.includes('9'))).toBe(true)
  })

  it('re-syncs a stale ai:* label and body when the verdict flipped (K-2)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk2-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v({ verdict: 'concern' })) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 7, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }],
        body: '## 审核单 pkg@1.0.0\n- 当前 AI 判定：**pass** — stale',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label ai:pass')
    expect(edits).toContain('--add-label ai:concern')
    expect(edits).toContain('--body')
    expect(edits).toContain('当前 AI 判定：**concern**')
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('a wanted issue stripped of review:pending is re-labeled — title-keyed sync (K-5)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk3-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    // pre-compute the wanted body so only the label drifts — same opts main()
    // derives from GH_REPO
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: 't' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 3, title: '[review] pkg@1.0.0',
        labels: [{ name: 'ai:pass' }],   // review:pending stripped by hand
        body: wantBody,
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--add-label review:pending')
    expect(edits).not.toContain('--body')
  })

  it('auto-close swaps review:pending → review:decided and names the reason', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk4-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e({ approval: 'approved' })])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 5, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }], body: 'x',
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--remove-label review:pending')
    expect(edits).toContain('--add-label review:decided')
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('已放行'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('5'))).toBe(true)
  })

  it('duplicate same-title issues: newest survives, older ones close as 重复审核单', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk5-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([
        { number: 1, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'old' },
        { number: 2, title: '[review] pkg@1.0.0', labels: [{ name: 'review:pending' }], body: 'new' },
      ])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    expect(calls.some(c => c.includes('close') && c.includes('1'))).toBe(true)
    expect(calls.some(c => c.includes('close') && c.includes('2'))).toBe(false)
    expect(calls.some(c => c.includes('comment') && c.join(' ').includes('重复审核单'))).toBe(true)
    expect(calls.some(c => c.includes('create'))).toBe(false)
  })

  it('a wanted issue with a stuck verdict label gets the warning baked into the body edit', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { main } = await import('../pipeline/docket.ts')
    const dir = mkdtempSync(join(tmpdir(), 'dk6-'))
    const idxPath = join(dir, 'index.json')
    const vPath = join(dir, 'v.jsonl')
    writeFileSync(idxPath, JSON.stringify(idx([e()])))
    writeFileSync(vPath, JSON.stringify(v()) + '\n')
    const wantBody = issueBody(
      { name: 'pkg', version: '1.0.0', verdict: 'pass', verification: 'verified', maturity: 'pending-announce',
        slug: 'o/pkg', findings: 0, redFlags: 0, heldAt: 't' },
      { repo: 'o/r', pagesBase: 'https://o.github.io/r' })
    const calls: string[][] = []
    const ghFn = (args: string[]) => {
      calls.push(args)
      if (args.includes('list')) return JSON.stringify([{
        number: 4, title: '[review] pkg@1.0.0',
        labels: [{ name: 'review:pending' }, { name: 'ai:pass' }, { name: 'verdict:pass' }],
        body: wantBody,   // everything else in sync — only the stuck label differs
      }])
      return ''
    }
    const saved = process.env.GH_REPO
    process.env.GH_REPO = 'o/r'
    try {
      await main(['x', 'y', '--index', idxPath, '--verdicts', vPath], ghFn)
    } finally { process.env.GH_REPO = saved }
    const edits = calls.filter(c => c.includes('edit')).map(c => c.join(' ')).join('\n')
    expect(edits).toContain('--body')
    expect(edits).toContain('未写盘')
    // ai:* is already correct — no label churn, only the body edit
    expect(edits).not.toContain('--add-label ai:')
  })
})
