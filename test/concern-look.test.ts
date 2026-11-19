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
  const chatSeq = (plan: string, judge: string) => {
    const calls: { role: string; content: string }[][] = []
    const fn = async (msgs: { role: string; content: string }[]) => {
      calls.push(msgs)
      return calls.length === 1 ? plan : judge
    }
    return { fn, calls }
  }

  it('plan → fetch → judge: fetched evidence reaches the judge prompt', async () => {
    const { fn, calls } = chatSeq('{"fetch":["src/client.js"]}', JUDGE_OK)
    const fetched: string[] = []
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn,
      listFiles: async () => ['src/client.js', 'src/other.js'],
      fetchText: async (url) => { fetched.push(url); return 'export const x = 1' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/client.js'])
    expect(calls).toHaveLength(2)
    expect(calls[1]![1]!.content).toContain('[fetched src/client.js]')
    expect(calls[1]![1]!.content).toContain('export const x = 1')
  })

  it('drops fetch picks outside the allowed set', async () => {
    const { fn, calls } = chatSeq('{"fetch":["../etc/passwd","notreal.js","src/client.js"]}', JUDGE_OK)
    const fetched: string[] = []
    await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn,
      listFiles: async () => ['src/client.js'],
      fetchText: async (url) => { fetched.push(url); return 'x' },
    })
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/client.js'])
    expect(calls[1]![1]!.content).not.toContain('passwd')
  })

  it('empty file list falls back to flagged paths from capabilities', async () => {
    const e = entry({ capabilities: { scannedAt: 't', findings: ['network-call:src/net.js — L4: fetch(u)'], redFlags: [] } })
    const { fn } = chatSeq('{"fetch":["src/net.js"]}', JUDGE_OK)
    const fetched: string[] = []
    const r = await oneshotLook(e, verdict(), '1.0.0', {
      chat: fn, listFiles: async () => [],
      fetchText: async (url) => { fetched.push(url); return 'const u = "https://api.example.com"' },
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(fetched).toEqual(['https://unpkg.com/pkg@1.0.0/src/net.js'])
  })

  it('fetch failure skips the block; judge still runs on material alone', async () => {
    const { fn, calls } = chatSeq('{"fetch":["src/gone.js"]}', JUDGE_OK)
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => ['src/gone.js'],
      fetchText: async () => null,
    })
    expect(r.resp?.claim_check).toBe('unsupported')
    expect(calls[1]![1]!.content).toContain('(no additional files fetched)')
  })

  it('unparseable judge output records parse-failed', async () => {
    const { fn } = chatSeq('{"fetch":[]}', 'I cannot determine this.')
    const r = await oneshotLook(entry(), verdict(), '1.0.0', {
      chat: fn, listFiles: async () => [], fetchText: async () => null,
    })
    expect(r.resp).toBeNull()
    expect(r.note).toBe('parse-failed')
  })
})
