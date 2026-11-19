import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  main as lookMain, loadConcernLooks, latestConcernLooks, deadLookKeys,
  parseLookOutput, concernQueue, devinLook, oneshotLook, type ConcernLook,
} from '../pipeline/ai/concern-look.ts'
import { CatalogIndex } from '../src/schema.ts'
import type { PluginEntry } from '../src/schema.ts'
import { issueBody } from '../pipeline/docket.ts'

const entry = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'pkg', slug: 'pkg', aliases: [], type: 'plugin', discoveredVia: ['npm-keyword'],
  source: { kind: 'npm', id: 'pkg' },
  description: { en: 'lints things' }, category: [],
  license: null, deprecated: false, replacement: null, deprecatedMessage: null,
  createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: null, npmDownloads30d: 5, downloadsMonth: null, starsDelta30d: null, checkedAt: 't' },
  capabilities: { scannedAt: 't', findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'pending',
  ...over,
})

const idxJson = (plugins: PluginEntry[]): CatalogIndex => ({
  version: '1', generatedAt: '2026-01-01T00:00:00Z', categories: {}, plugins, removed: [],
})

const verdict = (over: object = {}) => ({
  name: 'pkg', version: '1.0.0', verdict: 'concern',
  reason: 'reads credentials and calls a third party', reasonEn: 'credential read + third-party call',
  at: '2026-02-01T00:00:00Z', source: 'ai', ...over,
})

const look = (over: Partial<ConcernLook> = {}): ConcernLook => ({
  name: 'pkg', version: '1.0.0', verdictAt: '2026-02-01T00:00:00Z',
  at: '2026-02-02T00:00:00Z',
  claimCheck: 'unsupported', suggestion: 'pass',
  reasonZh: '凭据只发往硬编码端点', reasonEn: 'credentials go to hardcoded endpoint only',
  ...over,
})

function setup(plugins: PluginEntry[], verdicts: object[] = [], looks: object[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'concernlook-'))
  const idx = join(dir, 'index.json'), vd = join(dir, 'verdicts.jsonl')
  const ld = join(dir, 'looks.jsonl'), spool = join(dir, 'spool.jsonl')
  writeFileSync(idx, JSON.stringify(idxJson(plugins)))
  writeFileSync(vd, verdicts.map(v => JSON.stringify(v)).join('\n') + (verdicts.length ? '\n' : ''))
  writeFileSync(ld, looks.map(v => JSON.stringify(v)).join('\n') + (looks.length ? '\n' : ''))
  return { dir, idx, vd, ld, spool }
}
const args = (s: ReturnType<typeof setup>) =>
  ['--index', s.idx, '--verdicts', s.vd, '--looks', s.ld, '--spool', s.spool]

describe('concernQueue selection', () => {
  it('queues an AI concern with no human verdict and no prior look', () => {
    const s = setup([entry()], [verdict()])
    const q = concernQueue(CatalogIndex.parse(JSON.parse(readFileSync(s.idx, 'utf8'))), s.vd, s.ld)
    expect(q).toHaveLength(1)
    expect(q[0]!.e.name).toBe('pkg')
    expect(q[0]!.ver).toBe('1.0.0')
  })

  it('skips AI pass, human verdicts, and already-looked slots', () => {
    const s = setup(
      [entry({ name: 'pass-pkg' }), entry({ name: 'human-pkg' }), entry({ name: 'looked-pkg' })],
      [
        verdict({ name: 'pass-pkg', verdict: 'pass' }),
        verdict({ name: 'human-pkg' }),
        verdict({ name: 'human-pkg', source: 'human', at: '2026-02-03T00:00:00Z' }),
        verdict({ name: 'looked-pkg' }),
      ],
      [look({ name: 'looked-pkg' })],
    )
    const q = concernQueue(CatalogIndex.parse(JSON.parse(readFileSync(s.idx, 'utf8'))), s.vd, s.ld)
    expect(q).toHaveLength(0)
  })

  it('works without a looks file (first run) and with a null-version slot', () => {
    const s = setup(
      [entry({ name: 'gh-null', source: { kind: 'github', id: 'gh-null' }, latestVersion: null })],
      [verdict({ name: 'gh-null', version: null })],
    )
    const idx = CatalogIndex.parse(JSON.parse(readFileSync(s.idx, 'utf8')))
    // no looksPath at all — loadConcernLooks(undefined) → empty
    const q = concernQueue(idx, s.vd)
    expect(q).toHaveLength(1)
    expect(q[0]!.ver).toBeNull()
  })

  it('a NEWER concern verdict re-queues a previously-looked slot', () => {
    const s = setup(
      [entry()],
      [verdict(), verdict({ at: '2026-03-01T00:00:00Z' })],
      [look()],  // look.at 2026-02-02 < new verdict.at 2026-03-01
    )
    const q = concernQueue(CatalogIndex.parse(JSON.parse(readFileSync(s.idx, 'utf8'))), s.vd, s.ld)
    expect(q).toHaveLength(1)
  })

  it('dead keys (retry budget spent) stay out of the queue', () => {
    const fails = [1, 2, 3].map(i => look({
      at: `2026-02-0${i + 2}T00:00:00Z`, claimCheck: null, suggestion: null,
      aiNote: 'judge-error:timeout',
    }))
    const s = setup([entry()], [verdict()], fails)
    const q = concernQueue(CatalogIndex.parse(JSON.parse(readFileSync(s.idx, 'utf8'))), s.vd, s.ld)
    expect(q).toHaveLength(0)
  })
})

describe('deadLookKeys', () => {
  it('devin-unavailable never goes dead; bounded notes do at RETRY_BUDGET', () => {
    const unavail = [1, 2, 3, 4].map(i => look({
      name: 'a', at: `2026-02-0${i}T00:00:00Z`, claimCheck: null, suggestion: null,
      aiNote: 'devin-unavailable',
    }))
    const bounded = [1, 2, 3].map(i => look({
      name: 'b', at: `2026-02-0${i}T00:00:00Z`, claimCheck: null, suggestion: null,
      aiNote: 'parse-failed',
    }))
    const dead = deadLookKeys([...unavail, ...bounded])
    expect(dead.has('a\x001.0.0')).toBe(false)
    expect(dead.has('b\x001.0.0')).toBe(true)
  })
})

describe('parseLookOutput', () => {
  it('parses a bare JSON object', () => {
    const r = parseLookOutput('{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"ok","reason_en":"ok"}')
    expect(r?.claim_check).toBe('unsupported')
    expect(r?.verdict_suggestion).toBe('pass')
  })

  it('finds the JSON inside agent prose', () => {
    const r = parseLookOutput('I checked dist/index.js and the call site.\n{"claim_check":"inconclusive","verdict_suggestion":"concern","reason_zh":"看不到运行时","reason_en":"runtime not visible"}\nDone.')
    expect(r?.claim_check).toBe('inconclusive')
  })

  it('returns null on garbage and on JSON without our keys', () => {
    expect(parseLookOutput('no json here')).toBeNull()
    expect(parseLookOutput('{"foo":1}')).toBeNull()
  })
})

describe('main', () => {
  it('runs the look for each queued slot and appends records to the spool', async () => {
    const s = setup([entry()], [verdict()])
    const seen: string[] = []
    await lookMain([...args(s), '--limit', '5'], {
      devinUp: async () => true,
      look: async (e, v, ver) => {
        seen.push(`${e.name}@${ver}`)
        return { resp: { claim_check: 'unsupported', verdict_suggestion: 'pass', reason_zh: '调用点是固定 argv', reason_en: 'fixed argv call site' }, raw: '{}' }
      },
    })
    expect(seen).toEqual(['pkg@1.0.0'])
    const out = loadConcernLooks(s.spool)
    expect(out).toHaveLength(1)
    expect(out[0]!.claimCheck).toBe('unsupported')
    expect(out[0]!.suggestion).toBe('pass')
    expect(out[0]!.verdictAt).toBe('2026-02-01T00:00:00Z')
  })

  it('backend unavailable → <backend>-unavailable records, no look calls', async () => {
    process.env.CONCERN_LOOK_BACKEND = 'devin'
    try {
      const s = setup([entry()], [verdict()])
      let called = 0
      await lookMain([...args(s), '--limit', '5'], {
        devinUp: async () => false,
        look: async () => { called++; return { resp: null, raw: '' } },
      })
      expect(called).toBe(0)
      const out = loadConcernLooks(s.spool)
      expect(out).toHaveLength(1)
      expect(out[0]!.aiNote).toBe('devin-unavailable')
      expect(out[0]!.claimCheck).toBeNull()
    } finally { delete process.env.CONCERN_LOOK_BACKEND }
  })

  it('--dry lists the queue without writing', async () => {
    const s = setup([entry()], [verdict()])
    await lookMain([...args(s), '--dry'], { devinUp: async () => true })
    expect(existsSync(s.spool)).toBe(false)
  })
})

describe('loadConcernLooks / latestConcernLooks', () => {
  it('tolerates missing file, blank and malformed lines', () => {
    expect(loadConcernLooks(undefined)).toEqual([])
    expect(loadConcernLooks('/nonexistent/path.jsonl')).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'concernlook-'))
    const p = join(dir, 'looks.jsonl')
    writeFileSync(p, '{"name":"a","at":"2026-01-01T00:00:00Z"}\nnot-json\n{"name":"b"}\n\n')
    const list = loadConcernLooks(p)
    expect(list).toHaveLength(1)  // second line malformed, third lacks `at`
    const m = latestConcernLooks([...list, look({ name: 'a', at: '2026-01-02T00:00:00Z' })])
    expect(m.get('a\x001.0.0')?.at).toBe('2026-01-02T00:00:00Z')
    // newest-first order: the older record must NOT overwrite
    const m2 = latestConcernLooks([
      look({ name: 'a', at: '2026-01-02T00:00:00Z' }),
      look({ name: 'a', at: '2026-01-01T00:00:00Z' }),
    ])
    expect(m2.get('a\x001.0.0')?.at).toBe('2026-01-02T00:00:00Z')
    // null version keys on the empty-string slot
    const m3 = latestConcernLooks([look({ name: 'gh', version: null })])
    expect(m3.get('gh\x00')).toBeTruthy()
  })
})

describe('main edge cases', () => {
  it('a throwing look records judge-error and the batch continues', async () => {
    const s = setup(
      [entry(), entry({ name: 'pkg2', source: { kind: 'npm', id: 'pkg2' } })],
      [verdict(), verdict({ name: 'pkg2' })],
    )
    const seen: string[] = []
    await lookMain([...args(s), '--limit', '5'], {
      devinUp: async () => true,
      look: async e => {
        seen.push(e.name)
        if (e.name === 'pkg') throw 'plain string failure'  // non-Error throw
        return { resp: { claim_check: 'supported', verdict_suggestion: 'concern', reason_zh: '属实', reason_en: 'real' }, raw: '{}' }
      },
    })
    expect(seen).toEqual(['pkg', 'pkg2'])
    const out = loadConcernLooks(s.spool)
    expect(out).toHaveLength(2)
    expect(out.find(r => r.name === 'pkg')?.aiNote).toMatch(/^judge-error:/)
    expect(out.find(r => r.name === 'pkg2')?.claimCheck).toBe('supported')
  })

  it('unparseable output records parse-failed, not a silent pass', async () => {
    const s = setup([entry()], [verdict()])
    await lookMain([...args(s), '--limit', '5'], {
      devinUp: async () => true,
      look: async () => ({ resp: null, raw: 'agent said nothing useful', note: 'parse-failed' }),
    })
    const out = loadConcernLooks(s.spool)
    expect(out[0]!.aiNote).toBe('parse-failed')
    expect(out[0]!.claimCheck).toBeNull()
    expect(out[0]!.suggestion).toBeNull()
  })

  it('limit caps the batch', async () => {
    const s = setup(
      [entry(), entry({ name: 'pkg2', source: { kind: 'npm', id: 'pkg2' } })],
      [verdict(), verdict({ name: 'pkg2' })],
    )
    let calls = 0
    await lookMain([...args(s), '--limit', '1'], {
      devinUp: async () => true,
      look: async () => { calls++; return { resp: null, raw: '', note: 'parse-failed' } },
    })
    expect(calls).toBe(1)
  })
})

describe('devinLook prompt', () => {
  it('hands the agent the claim, material, flagged URLs, and read-only rules', async () => {
    const e = entry({
      capabilities: {
        scannedAt: 't',
        findings: ['exec-file:package/src/db.ts — L4: execFile("sqlite3")'],
        redFlags: [],
      },
    })
    let prompt = ''
    const { resp } = await devinLook(e, { verdict: 'concern', reason: '命令注入', reasonEn: 'cmd injection' }, '1.0.0', {
      run: async pf => {
        prompt = readFileSync(pf, 'utf8')
        return '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"argv 数组","reason_en":"argv array"}'
      },
    })
    expect(resp?.claim_check).toBe('unsupported')
    expect(prompt).toContain('UNTRUSTED')
    expect(prompt).toContain('unpkg.com/pkg@1.0.0/src/db.ts')
    expect(prompt).toContain('命令注入')
    expect(prompt).toContain('read-only')
  })

  it('github-source entries get raw.githubusercontent URLs in the prompt', async () => {
    const e = entry({
      name: 'gh-pkg',
      source: { kind: 'github', id: 'gh-pkg', repo: 'owner/repo', version: 'abc123' },
      latestVersion: null,
      capabilities: {
        scannedAt: 't',
        findings: ['network-call:package/src/net.ts — L9: fetch("https://x.example")'],
        redFlags: [],
      },
    })
    let prompt = ''
    await devinLook(e, { verdict: 'concern', reason: '外发', reasonEn: 'exfil' }, null, {
      run: async pf => {
        prompt = readFileSync(pf, 'utf8')
        return '{"claim_check":"inconclusive","verdict_suggestion":"concern","reason_zh":"无法静态判定","reason_en":"cannot tell statically"}'
      },
    })
    expect(prompt).toContain('raw.githubusercontent.com/owner/repo/abc123/src/net.ts')
    expect(prompt).toContain('Slot version: unknown')
  })

  it('degrades honestly when optional fields are absent', async () => {
    // github entry with no repo/version, verdict without reasons, no
    // flagged locations — every fallback branch
    const e = entry({
      name: 'bare',
      source: { kind: 'github', id: 'bare' },
      latestVersion: null,
      capabilities: { scannedAt: 't', findings: [], redFlags: [] },
    })
    let prompt = ''
    await devinLook(e, { verdict: 'concern' }, null, {
      run: async pf => {
        prompt = readFileSync(pf, 'utf8')
        return '{"claim_check":"inconclusive","verdict_suggestion":"concern"}'
      },
    })
    expect(prompt).toContain('github repo bare @ ?')
    expect(prompt).toContain('(none recorded)')
    expect(prompt).toContain('(no flagged locations)')
  })

  it('npm entry without latestVersion still produces a prompt', async () => {
    const e = entry({ name: 'noversion', latestVersion: null })
    let prompt = ''
    await devinLook(e, { verdict: 'concern', reason: 'r' }, null, {
      run: async pf => {
        prompt = readFileSync(pf, 'utf8')
        return 'garbage with no json'
      },
    })
    // src line renders the npm id with '?' when no version resolves
    expect(prompt).toContain('npm package pkg@?')
  })
})

describe('docket 复审 rendering', () => {
  const target = { name: 'Pkg', version: '1.0.0', verdict: 'concern' as const, reason: 'LLM 判 concern：凭据外泄' }
  const looks = (l: ConcernLook) => new Map([[`${l.name.toLowerCase()}\x00${l.version ?? ''}`, l]])

  it('renders the second-look verdict as advisory evidence', () => {
    const body = issueBody(target, {
      concernLooks: looks(look({ name: 'pkg' })),
    })
    expect(body).toContain('AI 复审')
    expect(body).toContain('指控不成立')
    expect(body).toContain('倾向误报')
    expect(body).toContain('凭据只发往硬编码端点')
    expect(body).toContain('放行仍需人工 verdict')
  })

  it('supported claim renders 指控成立; inconclusive renders 证据不足', () => {
    const sup = issueBody(target, {
      concernLooks: looks(look({ name: 'pkg', claimCheck: 'supported', suggestion: 'concern' })),
    })
    expect(sup).toContain('指控成立')
    expect(sup).toContain('维持疑虑')
    const inc = issueBody(target, {
      concernLooks: looks(look({ name: 'pkg', claimCheck: 'inconclusive', suggestion: null })),
    })
    expect(inc).toContain('证据不足无法判定')
    expect(inc).toContain('无明确建议')
  })

  it('a failed look renders 未完成, never a silent pass', () => {
    const body = issueBody(target, {
      concernLooks: looks(look({ name: 'pkg', claimCheck: null, suggestion: null, aiNote: 'parse-failed' })),
    })
    expect(body).toContain('AI 复审：**未完成**')
    expect(body).toContain('parse-failed')
    expect(body).not.toContain('指控不成立')
  })

  it('no look record → no 复审 line; pass verdict → no 复审 line', () => {
    expect(issueBody(target)).not.toContain('AI 复审')
    expect(issueBody({ ...target, verdict: 'pass' }, {
      concernLooks: looks(look({ name: 'pkg' })),
    })).not.toContain('AI 复审')
  })
})

describe('oneshotLook', () => {
  const JUDGE_OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
  const INCONCLUSIVE = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
  // router: tier0 (material-only) → tier0Resp, planner (has file list) →
  // planResp, final judge → judgeResp
  const chatRouter = (plan: string, judge: string, tier0 = INCONCLUSIVE) => {
    const calls: { role: string; content: string }[][] = []
    const fn = async (msgs: { role: string; content: string }[]) => {
      calls.push(msgs)
      const u = msgs[1]!.content
      if (u.includes('judge ONLY from the material above')) return tier0
      if (u.includes('Package files:')) return plan
      return judge
    }
    return { fn, calls }
  }

  it('tier0 consistent verdict short-circuits — no plan, no fetch', async () => {
    const { fn, calls } = chatRouter('{"fetch":[]}', JUDGE_OK, JUDGE_OK)
    const fetched: string[] = []
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/client.js'],
      fetchText: async (url) => { fetched.push(url); return 'x' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(calls).toHaveLength(1)
    expect(fetched).toHaveLength(0)
  })

  it('tier0 mixed signal escalates to the fetch round', async () => {
    const mixed = '{"claim_check":"unsupported","verdict_suggestion":"concern","reason_zh":"r","reason_en":"r"}'
    const { fn, calls } = chatRouter('{"fetch":["src/client.js"]}', JUDGE_OK, mixed)
    const fetched: string[] = []
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/client.js'],
      fetchText: async (url) => { fetched.push(url); return 'export const x = 1' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/client.js'])
  })

  it('plan → fetch → judge: fetched evidence reaches the judge prompt', async () => {
    const { fn, calls } = chatRouter('{"fetch":["src/client.js"]}', JUDGE_OK)
    const fetched: string[] = []
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn,
      listFiles: async () => ['src/client.js', 'src/other.js'],
      fetchText: async (url) => { fetched.push(url); return 'export const x = 1' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/client.js'])
    const judgeCall = calls[calls.length - 1]!
    expect(judgeCall[1]!.content).toContain('[fetched src/client.js]')
    expect(judgeCall[1]!.content).toContain('export const x = 1')
  })

  it('drops fetch picks outside the allowed set', async () => {
    const { fn, calls } = chatRouter('{"fetch":["../etc/passwd","notreal.js","src/client.js"]}', JUDGE_OK)
    const fetched: string[] = []
    await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn,
      listFiles: async () => ['src/client.js'],
      fetchText: async (url) => { fetched.push(url); return 'x' },
    })
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/client.js'])
    expect(calls[calls.length - 1]![1]!.content).not.toContain('passwd')
  })

  it('empty file list falls back to flagged paths from capabilities', async () => {
    const e = entry({ capabilities: { scannedAt: 't', findings: ['network-call:src/net.js — L4: fetch(u)'], redFlags: [] } })
    const { fn } = chatRouter('{"fetch":["src/net.js"]}', JUDGE_OK)
    const fetched: string[] = []
    const r = await oneshotLook(e, verdict(), '1.0.0', {
      chat: fn, listFiles: async () => [],
      fetchText: async (url) => { fetched.push(url); return 'const u = "https://api.example.com"' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/net.js'])
  })

  it('fetch failure skips the block; judge still runs on material alone', async () => {
    const { fn, calls } = chatRouter('{"fetch":["src/gone.js"]}', JUDGE_OK)
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/gone.js'],
      fetchText: async () => null,
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(calls[calls.length - 1]![1]!.content).toContain('(no additional files fetched)')
  })

  it('unparseable judge output records parse-failed', async () => {
    const { fn } = chatRouter('{"fetch":[]}', 'I cannot determine this.')
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => [], fetchText: async () => null,
    })
    expect(r.resp).toBeNull()
    expect(r.note).toBe('parse-failed')
  })
})

describe('ocTextOf', () => {
  it('extracts text parts, skips noise lines and non-text events', async () => {
    const { ocTextOf } = await import('../pipeline/ai/concern-look.ts')
    const jsonl = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      'plain noise line',
      '{"type":"text","part":{"type":"text","text":"hello"}}',
      '{"type":"text","part":{"type":"text"}}',
      '',
      '{"type":"text","part":{"type":"text","text":"world"}}',
    ].join('\n')
    expect(ocTextOf(jsonl)).toBe('hello\nworld')
    expect(ocTextOf('')).toBe('')
  })
})

describe('oneshotLook evidence plumbing', () => {
  const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
  const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
  const router = (plan: string, judge: string, tier0 = J) => {
    const calls: { role: string; content: string }[][] = []
    const fn = async (msgs: { role: string; content: string }[]) => {
      calls.push(msgs)
      const u = msgs[1]!.content
      if (u.includes('judge ONLY from the material above')) return tier0
      if (u.includes('Package files:')) return plan
      return judge
    }
    return { fn, calls }
  }

  it('unpkg ?meta listing feeds the planner — code files only, no node_modules', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({
      files: [{ path: '/src/a.ts' }, { path: '/node_modules/x/y.js' }, { path: '/README.md' }, { path: '/dist/b.js' }],
    }))) as typeof fetch
    try {
      const { fn, calls } = router('{"fetch":[]}', OK)
      await oneshotLook(entry(), verdict(), '1.0.0', { chat: fn, fetchText: async () => 'x' })
      const plan = calls.find(c => c[1]!.content.includes('Package files:'))!
      expect(plan[1]!.content).toContain('src/a.ts')
      expect(plan[1]!.content).toContain('dist/b.js')
      expect(plan[1]!.content).not.toContain('node_modules')
      expect(plan[1]!.content).not.toContain('README.md')
    } finally { globalThis.fetch = orig }
  })

  it('github-source entries skip the file listing entirely', async () => {
    const orig = globalThis.fetch
    let hit = false
    globalThis.fetch = (async () => { hit = true; return new Response('{}') }) as typeof fetch
    try {
      const gh = entry({ source: { kind: 'github', repo: 'a/b', version: 'deadbeef' } as never, capabilities: { scannedAt: 't', findings: ['network-call:src/n.js — L1: x'], redFlags: [] } })
      const { fn, calls } = router('{"fetch":["src/n.js"]}', OK)
      await oneshotLook(gh, verdict(), 'deadbeef', { chat: fn, fetchText: async () => 'x' })
      expect(hit).toBe(false)
      const plan = calls.find(c => c[1]!.content.includes('Package files:'))!
      expect(plan[1]!.content).toContain('src/n.js')
    } finally { globalThis.fetch = orig }
  })

  it('planner prose without a fetch array degrades to no picks', async () => {
    const { fn, calls } = router('I think src/index.js looks important', OK)
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/index.js'], fetchText: async () => 'x',
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(calls[calls.length - 1]![1]!.content).toContain('(no additional files fetched)')
  })

  it('tier0 supported+concern also short-circuits (consistent pair)', async () => {
    const sup = '{"claim_check":"supported","verdict_suggestion":"concern","reason_zh":"r","reason_en":"r"}'
    const { fn, calls } = router('{"fetch":[]}', OK, sup)
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['a.js'], fetchText: async () => 'x',
    })
    expect(r.resp?.claim_check).toBe('supported')
    expect(calls).toHaveLength(1)
  })

  it('tier0 unparseable output escalates instead of short-circuiting', async () => {
    const { fn, calls } = router('{"fetch":["src/a.js"]}', OK, 'utter garbage')
    const fetched: string[] = []
    await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/a.js'],
      fetchText: async (u) => { fetched.push(u); return 'x' },
    })
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(fetched.length).toBe(1)
  })
})

describe('backend selection in main', () => {
  it('oneshot backend without AI_MODEL records oneshot-unavailable', async () => {
    const saved = process.env.AI_MODEL
    delete process.env.AI_MODEL
    process.env.CONCERN_LOOK_BACKEND = 'oneshot'
    try {
      const s = setup([entry()], [verdict()])
      await lookMain([...args(s), '--limit', '3'])
      const out = loadConcernLooks(s.spool)
      expect(out[0]!.aiNote).toBe('oneshot-unavailable')
      expect(out).toHaveLength(1)
    } finally {
      if (saved !== undefined) process.env.AI_MODEL = saved
      delete process.env.CONCERN_LOOK_BACKEND
    }
  })

  it('opencode backend name flows into the unavailable note', async () => {
    process.env.CONCERN_LOOK_BACKEND = 'opencode'
    try {
      const s = setup([entry()], [verdict()])
      await lookMain([...args(s), '--limit', '3'], { devinUp: async () => false })
      expect(loadConcernLooks(s.spool)[0]!.aiNote).toBe('opencode-unavailable')
    } finally { delete process.env.CONCERN_LOOK_BACKEND }
  })
})

describe('deadLookKeys backend notes', () => {
  it('oneshot-unavailable never counts toward the retry budget', () => {
    const list = [0, 1, 2].map(() => look({ aiNote: 'oneshot-unavailable' }))
    expect(deadLookKeys(list).size).toBe(0)
  })
})

describe('opencodeLook transport', () => {
  it('run mock returning JSONL events → ocTextOf → parsed verdict', async () => {
    const { opencodeLook } = await import('../pipeline/ai/concern-look.ts')
    const jsonl = [
      '{"type":"text","part":{"type":"text","text":"working..."}}',
      '{"type":"text","part":{"type":"text","text":"{\\"claim_check\\":\\"supported\\",\\"verdict_suggestion\\":\\"concern\\",\\"reason_zh\\":\\"r\\",\\"reason_en\\":\\"r\\"}"}}',
    ].join('\n')
    const r = await opencodeLook(entry(), verdict(), '1.0.0', { run: async () => jsonl })
    expect(r.resp?.claim_check).toBe('supported')
    expect(r.note).toBeUndefined()
  })

  it('unparseable agent output records parse-failed', async () => {
    const { opencodeLook } = await import('../pipeline/ai/concern-look.ts')
    const r = await opencodeLook(entry(), verdict(), '1.0.0', { run: async () => 'no json here' })
    expect(r.resp).toBeNull()
    expect(r.note).toBe('parse-failed')
  })
})

describe('omlxChat transport via oneshotLook', () => {
  it('default chat path posts to AI_BASE_URL chat/completions', async () => {
    const savedM = process.env.AI_MODEL, savedB = process.env.AI_BASE_URL
    process.env.AI_MODEL = 'test-model'
    process.env.AI_BASE_URL = 'http://omlx.test/v1'
    const orig = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (url: unknown) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}' } }] }))
    }) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const r = await oneshotLook(entry(), verdict(), '1.0.0', { fetchText: async () => 'x' })
      expect(r.resp?.claim_check).toBe('unsupported')
      expect(seen).toEqual(['http://omlx.test/v1/chat/completions'])
    } finally {
      globalThis.fetch = orig
      if (savedM === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedM
      if (savedB === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = savedB
    }
  })
})

describe('oneshotLook fetch-loop edges', () => {
  const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
  const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
  const router = (plan: string, judge: string, tier0 = J) => {
    const calls: { role: string; content: string }[][] = []
    const fn = async (msgs: { role: string; content: string }[]) => {
      calls.push(msgs)
      const u = msgs[1]!.content
      if (u.includes('judge ONLY from the material above')) return tier0
      if (u.includes('Package files:')) return plan
      return judge
    }
    return { fn, calls }
  }

  it('entries with no resolvable version skip fetches (contextUrl null)', async () => {
    const e = entry({ latestVersion: null, source: { kind: 'npm', id: 'pkg' } as never })
    const { fn } = router('{"fetch":["ghost.js"]}', OK)
    const fetched: string[] = []
    const r = await oneshotLook(e, verdict(), null, {
      chat: fn, listFiles: async () => ['ghost.js'],
      fetchText: async (u) => { fetched.push(u); return 'x' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(fetched).toHaveLength(0)
  })

  it('total evidence cap stops later picks once 24KB is reached', async () => {
    const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js']
    const plan = `{"fetch":[${files.map(f => `"${f}"`).join(',')}]}`
    const { fn } = router(plan, OK)
    const fetched: string[] = []
    await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => files,
      fetchText: async (u) => { fetched.push(u); return 'x'.repeat(7000) },
    })
    expect(fetched.length).toBeLessThanOrEqual(4)   // 4×6KB = 24KB cap
    expect(fetched.length).toBeGreaterThanOrEqual(1)
  })
})

describe('devin backend model label', () => {
  it('devin backend records the configured devin model name', async () => {
    process.env.CONCERN_LOOK_BACKEND = 'devin'
    try {
      const s = setup([entry()], [verdict()])
      await lookMain([...args(s), '--limit', '3'], {
        devinUp: async () => true,
        look: async () => ({ resp: { claim_check: 'supported', verdict_suggestion: 'concern', reason_zh: 'r', reason_en: 'r' }, raw: '' }),
      })
      const out = loadConcernLooks(s.spool)
      expect(out[0]!.model).toBe('swe-2-flash-high')
      expect(out[0]!.claimCheck).toBe('supported')
    } finally { delete process.env.CONCERN_LOOK_BACKEND }
  })
})

describe('omlxChat edge branches', () => {
  const withEnv = async (fn: () => Promise<void>) => {
    const savedM = process.env.AI_MODEL, savedB = process.env.AI_BASE_URL
    process.env.AI_MODEL = 'm'; process.env.AI_BASE_URL = 'http://x/v1'
    try { await fn() } finally {
      if (savedM === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedM
      if (savedB === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = savedB
    }
  }
  const chatStub = (content: string | null, ok = true) => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => ok
      ? new Response(JSON.stringify({ choices: [{ message: { content } }] }))
      : new Response('err', { status: 500 })) as typeof fetch
    return () => { globalThis.fetch = orig }
  }

  it('non-OK response throws omlx <status>', () => withEnv(async () => {
    const restore = chatStub(null, false)
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      await expect(oneshotLook(entry(), verdict(), '1.0.0', { fetchText: async () => 'x' }))
        .rejects.toThrow('omlx 500')
    } finally { restore() }
  }))

  it('empty content + think=false path (plan call) still flows', () => withEnv(async () => {
    // tier0 → inconclusive, plan → think:false call returns empty content,
    // judge → OK. Sequence keyed on call order.
    const orig = globalThis.fetch
    let n = 0
    const bodies: Record<string, unknown>[] = []
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      n++
      bodies.push(JSON.parse(init?.body ?? '{}'))
      const content = n === 1
        ? '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
        : n === 2 ? '' : '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    }) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const r = await oneshotLook(entry(), verdict(), '1.0.0', {
        listFiles: async () => [], fetchText: async () => null,
      })
      expect(r.resp?.claim_check).toBe('unsupported')
      expect(bodies[1]!.chat_template_kwargs).toEqual({ enable_thinking: false })  // plan call
      expect(bodies[0]!.chat_template_kwargs).toBeUndefined()                     // tier0 thinks
    } finally { globalThis.fetch = orig }
  }))
})

describe('pkgFileList edges', () => {
  it('npm entry without any version yields empty file list', async () => {
    const orig = globalThis.fetch
    let hit = false
    globalThis.fetch = (async () => { hit = true; return new Response('{}') }) as typeof fetch
    try {
      const e = entry({ latestVersion: null, source: { kind: 'npm', id: 'pkg' } as never })
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const J = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
      // tier0 consistent → short-circuit before listFiles; force escalation with inconclusive tier0
      let n = 0
      const fn = async (msgs: { role: string; content: string }[]) => {
        n++
        const u = msgs[1]!.content
        if (u.includes('judge ONLY')) return '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
        return J
      }
      await oneshotLook(e, verdict(), null, { chat: fn, fetchText: async () => 'x' })
      // pkgFileList ran (no listFiles opt) → hit fetch only if version existed; none → no hit
      expect(hit).toBe(false)
    } finally { globalThis.fetch = orig }
  })
})

describe('real backend selection (oneshot end-to-end)', () => {
  it('no deps.look + backend oneshot runs the real two-round path', async () => {
    const savedM = process.env.AI_MODEL, savedB = process.env.AI_BASE_URL
    process.env.AI_MODEL = 'm'; process.env.AI_BASE_URL = 'http://x/v1'
    process.env.CONCERN_LOOK_BACKEND = 'oneshot'
    const orig = globalThis.fetch
    let n = 0
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('chat/completions')) {
        n++
        const content = n === 1
          ? '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
          : '{"claim_check":"supported","verdict_suggestion":"concern","reason_zh":"r2","reason_en":"r2"}'
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
      }
      if (u.includes('?meta')) return new Response(JSON.stringify({ files: [{ path: '/a.js' }] }))
      return new Response('file-body')
    }) as typeof fetch
    try {
      const s = setup([entry()], [verdict()])
      await lookMain([...args(s), '--limit', '3'])
      const out = loadConcernLooks(s.spool)
      expect(out).toHaveLength(1)
      expect(out[0]!.claimCheck).toBe('supported')
      expect(out[0]!.model).toBe('m')
    } finally {
      globalThis.fetch = orig
      delete process.env.CONCERN_LOOK_BACKEND
      if (savedM === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedM
      if (savedB === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = savedB
    }
  })
})

describe('coverage mop-up', () => {
  it('deadLookKeys handles null-version records', () => {
    const list = [look({ version: null as never, aiNote: 'judge-error:x' }),
                  look({ version: null as never, aiNote: 'judge-error:x' }),
                  look({ version: null as never, aiNote: 'judge-error:x' })]
    expect(deadLookKeys(list).has('pkg\u0000')).toBe(true)
  })

  it('flagged locations with no resolvable URL render without link', async () => {
    const e = entry({
      latestVersion: null,
      source: { kind: 'npm', id: 'pkg' } as never,
      capabilities: { scannedAt: 't', findings: ['network-call:src/x.js — L1: fetch(u)'], redFlags: [] },
    })
    const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
    const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
    let sawPrompt = ''
    await oneshotLook(e, { verdict: 'concern' }, null, {
      chat: async (msgs) => { sawPrompt = msgs[1]!.content; return OK },
      listFiles: async () => [], fetchText: async () => null,
    })
    expect(sawPrompt).toContain('network-call:src/x.js L1')
    expect(sawPrompt).not.toContain('src/x.js L1 — http')   // flagged line carries no source URL
  })

  it('omlxChat throws when AI_MODEL unset', async () => {
    const saved = process.env.AI_MODEL
    delete process.env.AI_MODEL
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      await expect(oneshotLook(entry(), verdict(), '1.0.0', { fetchText: async () => 'x' }))
        .rejects.toThrow('AI_MODEL unset')
    } finally { if (saved !== undefined) process.env.AI_MODEL = saved }
  })

  it('omlxChat empty message content degrades to parse-failed', async () => {
    const savedM = process.env.AI_MODEL, savedB = process.env.AI_BASE_URL
    process.env.AI_MODEL = 'm'; process.env.AI_BASE_URL = 'http://x/v1'
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: {} }] }))) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const r = await oneshotLook(entry(), verdict(), '1.0.0', {
        listFiles: async () => [], fetchText: async () => null,
      })
      expect(r.resp).toBeNull()
      expect(r.note).toBe('parse-failed')
    } finally {
      globalThis.fetch = orig
      if (savedM === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedM
      if (savedB === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = savedB
    }
  })

  it('pkgFileList returns [] on HTTP error and on fetch throw', async () => {
    const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
    const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
    const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
    const fn = async (msgs: { role: string; content: string }[]) =>
      msgs[1]!.content.includes('judge ONLY') ? J : OK
    for (const impl of [
      (async () => new Response('no', { status: 404 })) as typeof fetch,
      (async () => { throw new Error('net down') }) as typeof fetch,
    ]) {
      const orig = globalThis.fetch
      globalThis.fetch = impl
      try {
        // no listFiles opt → real pkgFileList runs against the stubbed fetch
        const r = await oneshotLook(entry(), verdict(), '1.0.0', { chat: fn, fetchText: async () => 'x' })
        expect(r.resp?.claim_check).toBe('unsupported')
      } finally { globalThis.fetch = orig }
    }
  })

  it('parseFetchPlan caps at 5, dedupes, and drops traversal', async () => {
    const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
    const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
    const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
    const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'g.js']
    const plan = `{"fetch":["a.js","a.js","../x.js","b.js","c.js","d.js","e.js","f.js","g.js"]}`
    const calls: { role: string; content: string }[][] = []
    const fn = async (msgs: { role: string; content: string }[]) => {
      calls.push(msgs)
      const u = msgs[1]!.content
      if (u.includes('judge ONLY')) return J
      if (u.includes('Package files:')) return plan
      return OK
    }
    const fetched: string[] = []
    await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => files,
      fetchText: async (u) => { fetched.push(u); return 'x' },
    })
    expect(fetched.length).toBe(5)                       // cap
    expect(new Set(fetched).size).toBe(fetched.length)  // dedup
    expect(fetched.every(u => !u.includes('x.js'))).toBe(true)  // no traversal escape... a.js contains 'x.js'? no
  })
})

describe('coverage mop-up round 2', () => {
  it('--dry tolerates verdicts without reason and prints queue', async () => {
    const s = setup([entry()], [{ name: 'pkg', version: '1.0.0', verdict: 'concern', at: '2026-02-01T00:00:00Z', source: 'ai' }])
    await lookMain([...args(s), '--dry'])
    expect(existsSync(s.spool)).toBe(false)
  })

  it('empty queue still evaluates backend selection for devin/opencode', async () => {
    // no verdicts → empty queue → real backend fns selected but never called
    for (const b of ['devin', 'opencode']) {
      process.env.CONCERN_LOOK_BACKEND = b
      try {
        const s = setup([entry()], [])
        await lookMain([...args(s), '--limit', '3'], { devinUp: async () => true })
      } finally { delete process.env.CONCERN_LOOK_BACKEND }
    }
  })

  it('omlxChat falls back to the default base URL', async () => {
    const savedM = process.env.AI_MODEL, savedB = process.env.AI_BASE_URL
    process.env.AI_MODEL = 'm'; delete process.env.AI_BASE_URL
    const orig = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (url: unknown) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}' } }] }))
    }) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const r = await oneshotLook(entry(), verdict(), '1.0.0', { fetchText: async () => 'x' })
      expect(r.resp?.claim_check).toBe('unsupported')
      expect(seen[0]).toBe('http://localhost:8001/v1/chat/completions')
    } finally {
      globalThis.fetch = orig
      if (savedM === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedM
      if (savedB !== undefined) process.env.AI_BASE_URL = savedB
    }
  })

  it('pkgFileList tolerates a meta response with no files key', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: unknown) => String(url).includes('?meta')
      ? new Response('{}')
      : new Response('body')) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
      const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
      const fn = async (msgs: { role: string; content: string }[]) =>
        msgs[1]!.content.includes('judge ONLY') ? J : OK
      const r = await oneshotLook(entry(), { verdict: 'concern' }, null, { chat: fn, fetchText: async () => 'x' })
      expect(r.resp?.claim_check).toBe('unsupported')
    } finally { globalThis.fetch = orig }
  })

  it('default fetchText truncates files over 6KB', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('?meta')) return new Response(JSON.stringify({ files: [{ path: '/big.js' }] }))
      if (u.includes('chat/completions')) {
        // not reached — chat is injected below
      }
      return new Response('x'.repeat(7000))
    }) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
      const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
      const fn = async (msgs: { role: string; content: string }[]) => {
        const u = msgs[1]!.content
        if (u.includes('judge ONLY')) return J
        if (u.includes('Package files:')) return '{"fetch":["big.js"]}'
        return OK
      }
      // NO fetchText opt → default fetch path (truncation branch)
      const r = await oneshotLook(entry(), verdict(), '1.0.0', { chat: fn })
      expect(r.resp?.claim_check).toBe('unsupported')
    } finally { globalThis.fetch = orig }
  })

  it('judge response missing optional reason fields still records', async () => {
    const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
    const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
    const PARTIAL = '{"claim_check":"supported","verdict_suggestion":"concern"}'
    const fn = async (msgs: { role: string; content: string }[]) => {
      const u = msgs[1]!.content
      if (u.includes('judge ONLY')) return J
      if (u.includes('Package files:')) return '{"fetch":[]}'
      return PARTIAL
    }
    const r = await oneshotLook(entry(), verdict(), '1.0.0', { chat: fn, listFiles: async () => [], fetchText: async () => null })
    expect(r.resp?.claim_check).toBe('supported')
    expect(r.resp?.reason_en).toBeUndefined()
  })
})

describe('default fetchText HTTP failure', () => {
  it('non-OK file fetch returns null and judge runs without the block', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('?meta')) return new Response(JSON.stringify({ files: [{ path: '/gone.js' }] }))
      return new Response('no', { status: 404 })
    }) as typeof fetch
    try {
      const { oneshotLook } = await import('../pipeline/ai/concern-look.ts')
      const J = '{"claim_check":"inconclusive","verdict_suggestion":null,"reason_zh":"r","reason_en":"r"}'
      const OK = '{"claim_check":"unsupported","verdict_suggestion":"pass","reason_zh":"r","reason_en":"r"}'
      let judgePrompt = ''
      const fn = async (msgs: { role: string; content: string }[]) => {
        const u = msgs[1]!.content
        if (u.includes('judge ONLY')) return J
        if (u.includes('Package files:')) return '{"fetch":["gone.js"]}'
        judgePrompt = u
        return OK
      }
      const r = await oneshotLook(entry(), verdict(), '1.0.0', { chat: fn })
      expect(r.resp?.claim_check).toBe('unsupported')
      expect(judgePrompt).toContain('(no additional files fetched)')
    } finally { globalThis.fetch = orig }
  })
})
