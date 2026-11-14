import { describe, it, expect } from 'vitest'
import { searchByKeyword, discoverNpm } from '../pipeline/discover/npm.ts'
import { searchTopic, searchCode, discoverGithub, normalizeRepoUrl, ghHeaders } from '../pipeline/discover/github.ts'
import { filterByStars, repoToNpm } from '../pipeline/discover/seed.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence, hasRepoEvidence } from '../pipeline/discover/filter.ts'

const mkRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('discover/npm', () => {
  it('maps search objects to candidates', async () => {
    const f = async () => mkRes({
      objects: [{
        package: { name: 'a', version: '1.0.0', description: 'd', keywords: ['opencode'],
          links: { repository: 'https://github.com/o/a' }, date: '2026-01-01' },
      }],
      total: 1,
    })
    const r = await searchByKeyword('opencode', { fetchFn: f as typeof fetch, size: 250 })
    expect(r[0]).toMatchObject({ name: 'a', repoUrl: 'https://github.com/o/a' })
  })
  it('paginates until short page', async () => {
    let calls = 0
    const f = async () => {
      calls++
      return mkRes({ objects: calls === 1
        ? Array.from({ length: 2 }, (_, i) => ({ package: { name: `p${i}`, version: '1', links: {} } }))
        : [] })
    }
    const r = await searchByKeyword('k', { fetchFn: f as typeof fetch, size: 2 })
    expect(r).toHaveLength(2)
    expect(calls).toBe(2)
  })
  it('stops on non-ok', async () => {
    const r = await searchByKeyword('k', { fetchFn: (async () => mkRes({}, 500)) as typeof fetch })
    expect(r).toEqual([])
  })
  it('discoverNpm dedupes across keywords', async () => {
    const f = async () => mkRes({ objects: [{ package: { name: 'same', version: '1', links: {} } }] })
    const m = await discoverNpm(['k1', 'k2'], { fetchFn: f as typeof fetch })
    expect(m.size).toBe(1)
    expect(m.get('same')!.discoveredVia).toEqual(['npm-keyword'])
  })
})

describe('discover/github', () => {
  const gh = (items: unknown[]) => async () => mkRes({ items })
  it('maps repo items', async () => {
    const f = gh([{ full_name: 'o/r', description: 'd', archived: false, fork: false,
      pushed_at: 't', stargazers_count: 5, default_branch: 'main' }])
    const r = await searchTopic('opencode', { fetchFn: f as typeof fetch })
    expect(r[0]).toMatchObject({ fullName: 'o/r', stars: 5 })
  })
  it('dedupes across topics', async () => {
    const f = gh([{ full_name: 'o/r', description: null, archived: false, fork: false,
      pushed_at: null, stargazers_count: 0, default_branch: 'main' }])
    const m = await discoverGithub(['t1', 't2'], { fetchFn: f as typeof fetch })
    expect(m.size).toBe(1)
  })
  it('normalizeRepoUrl handles all forms', () => {
    expect(normalizeRepoUrl('git+https://github.com/o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('git@github.com:o/r.git')).toBe('o/r')
    expect(normalizeRepoUrl('ssh://git@github.com/o/r')).toBe('o/r')
    expect(normalizeRepoUrl('https://github.com/o/r/')).toBe('o/r')
    expect(normalizeRepoUrl('https://gitlab.com/o/r')).toBeNull()
    expect(normalizeRepoUrl(null)).toBeNull()
    expect(normalizeRepoUrl('')).toBeNull()
  })
  it('ghHeaders includes auth when token present', () => {
    expect(ghHeaders('t').Authorization).toBe('Bearer t')
    expect(ghHeaders().Authorization).toBeUndefined()
  })
})

describe('audit#4-residual-2: discovery surfaces degrade malformed docs (run-killer class)', () => {
  // run.ts awaits discoverNpm+discoverGithub bare — any throw here used to
  // reject the whole catalog run, not just one candidate
  const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('searchByKeyword: non-object body / non-array objects / missing package.name degrade, never reject', async () => {
    for (const body of [null, [1], 'x', {}, { objects: 'str' }, { objects: [null, {}, { package: null }, { package: 'x' }] }]) {
      const r = await searchByKeyword('k', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    // nameless/wrong-typed-name hits are dropped (name is the dedupe key);
    // surviving hit gets every field normalized
    const r = await searchByKeyword('k', { fetchFn: (async () => jsonRes({ objects: [
      { package: { name: 42, version: '1' } },
      { package: { version: '1' } },
      { package: { name: 'ok', version: 7, description: {}, keywords: 'x',
        links: 5, date: 9 } },
      { package: { name: 'ok2', version: '2', keywords: ['a', 1, 'b'],
        links: { repository: 42 }, date: 't' } },
    ] })) as typeof fetch })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ name: 'ok', version: '', description: '', keywords: [], repoUrl: null, publishedAt: null })
    expect(r[1]).toMatchObject({ name: 'ok2', version: '2', keywords: ['a', 'b'], repoUrl: null, publishedAt: 't' })
  })

  it('searchByKeyword: fetch throw and invalid JSON warn+truncate instead of rejecting', async () => {
    const r1 = await searchByKeyword('k', { fetchFn: (async () => { throw new Error('net down') }) as typeof fetch })
    expect(r1).toEqual([])
    const r2 = await searchByKeyword('k', { fetchFn: (async () => new Response('not-json{{{', { status: 200 })) as typeof fetch })
    expect(r2).toEqual([])
  })

  it('searchTopic: non-object body/items and nameless hits degrade; fields normalize', async () => {
    for (const body of [null, [1], 'x', {}, { items: 'str' }, { items: [null, {}, { full_name: 42 }, { full_name: null }] }]) {
      const r = await searchTopic('t', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    const r = await searchTopic('t', { fetchFn: (async () => jsonRes({ items: [
      { full_name: 'o/r', description: 9, archived: 'yes', fork: 1,
        pushed_at: 5, stargazers_count: 'many', default_branch: {}, id: 'x',
        created_at: [], license: { spdx_id: 7 }, topics: 'not-array' },
      { full_name: 'o/r2', archived: true, fork: false, stargazers_count: 3,
        default_branch: 'dev', license: { spdx_id: 'MIT' }, topics: ['a', 2] },
    ] })) as typeof fetch })
    expect(r).toHaveLength(2)
    // 'yes'/1 are NOT true — strict-bool like fetchRepoMeta; wrong-typed
    // fields coerce instead of lying downstream
    expect(r[0]).toMatchObject({ fullName: 'o/r', description: '', archived: false, fork: false,
      pushedAt: null, stars: 0, defaultBranch: 'HEAD', id: null, createdAt: null,
      license: null, topics: [] })
    expect(r[1]).toMatchObject({ fullName: 'o/r2', archived: true, stars: 3,
      defaultBranch: 'dev', license: 'MIT', topics: ['a'] })
  })

  it('searchTopic: fetch throw warns+truncates instead of rejecting', async () => {
    const r = await searchTopic('t', { fetchFn: (async () => { throw new Error('boom') }) as typeof fetch })
    expect(r).toEqual([])
  })

  it('searchCode: repository must be an object with string full_name; fields normalize', async () => {
    for (const body of [null, {}, { items: 'x' }, { items: [{}, { repository: null }, { repository: 42 }, { repository: { full_name: {} } }] }]) {
      const r = await searchCode('q', { fetchFn: (async () => jsonRes(body)) as typeof fetch })
      expect(r).toEqual([])
    }
    const r = await searchCode('q', { fetchFn: (async () => jsonRes({ items: [
      { repository: { full_name: 'o/rc', archived: 'yes', fork: 1, stargazers_count: 'n',
        default_branch: 9, pushed_at: null, license: 'MIT', topics: {}, id: 'i' } },
    ] })) as typeof fetch })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ fullName: 'o/rc', archived: false, fork: false, stars: 0,
      defaultBranch: 'HEAD', license: null, topics: [], id: null })
  })

  it('discoverGithub survives a malformed page end-to-end (dedupe still works)', async () => {
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/search/code')) return jsonRes({ items: [{ repository: { full_name: 'o/rc' } }] })
      return jsonRes({ items: [
        { full_name: 'o/r', archived: false, fork: false, stargazers_count: 1, default_branch: 'main' },
        { full_name: 42 },
        'junk',
      ] })
    }) as typeof fetch
    const m = await discoverGithub(['t1'], { token: 'tok', fetchFn: f })
    expect(m.get('o/r')!.fullName).toBe('o/r')
    expect(m.get('o/rc')!.discoveredVia).toContain('code-search')
  })

  it('seed.ts: filterByStars skips non-object bodies; repoToNpm requires string name', async () => {
    const repos = ['o/a', 'o/b', 'o/c']
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/o/a')) return jsonRes(null)
      if (url.includes('/o/b')) return jsonRes({ stargazers_count: 'many', archived: false })
      return jsonRes({ stargazers_count: 60, archived: false, default_branch: 'main' })
    }) as typeof fetch
    const starred = await filterByStars(repos, 50, { fetchFn: f })
    expect(starred).toEqual([{ repo: 'o/c', stars: 60, branch: 'main' }])
    // repoToNpm: truthy non-string name is not an npm name
    const f2 = (async () => jsonRes({ name: 42 })) as typeof fetch
    expect(await repoToNpm('o/x', { fetchFn: f2 })).toBeNull()
    const f3 = (async () => jsonRes({ name: 'real-pkg' })) as typeof fetch
    expect(await repoToNpm('o/x', { fetchFn: f3 })).toBe('real-pkg')
  })
})

describe('discover/filter', () => {
  it('preAdmit rejects archived and fork-only', () => {
    expect(preAdmit({ name: 'a', repoUrl: 'o/a', archived: true }).admit).toBe(false)
    expect(preAdmit({ name: 'a', repoUrl: 'o/a', fork: true, hasOwnCommits: false }).admit).toBe(false)
    expect(preAdmit({ name: 'a', repoUrl: 'o/a' }).admit).toBe(true)
  })
  it('template spam: ≥6 same-stem names', () => {
    expect(looksLikeTemplateSpam(['mp-a1', 'mp-a2', 'mp-a3', 'mp-a4', 'mp-a5', 'mp-a6'])).toBe(true)
    expect(looksLikeTemplateSpam(['a', 'b', 'c'])).toBe(false)
  })
  it('evidence: keyword alone insufficient', () => {
    expect(hasPluginEvidence({ keywords: ['opencode'] }).ok).toBe(false)
    expect(hasPluginEvidence({ keywords: ['opencode'], main: 'dist/index.js' }).ok).toBe(true)
    // an entry point alone is not plugin evidence — any npm package has one
    expect(hasPluginEvidence({ main: 'x.js' }).ok).toBe(false)
    expect(hasPluginEvidence({ keywords: ['opencode'], readme: 'add to opencode.json plugin list' }).ok).toBe(true)
    expect(hasPluginEvidence({}).ok).toBe(false)
  })
  it('evidence: foreign-host keywords demote the opencode keyword', () => {
    // dsh plugins tag 'opencode' because they INTEGRATE with it (adapters,
    // usage meters) — the keyword claims integration, not installability.
    // keyword+entry was the exact pair that admitted ~90 dsh packages
    expect(hasPluginEvidence({ keywords: ['dsh', 'dsh-plugin', 'opencode'], main: 'index.js' }).ok).toBe(false)
    expect(hasPluginEvidence({ keywords: ['deepseek-harness', 'cordis', 'opencode'], main: 'x.js' }).ok).toBe(false)
    // a dsh readme's own install command is `dsh plugin add` — the bare
    // verb can't count, only the host-qualified `opencode plugin add` can
    expect(hasPluginEvidence({
      keywords: ['dsh-plugin', 'opencode'],
      main: 'x.js',
      readme: 'DeepSeek Harness plugin: shows OpenCode Go quota. Install: dsh plugin add this-pkg. Config: "plugins": [...]',
    }).ok).toBe(false)
    // a genuinely dual-host package documents the opencode install path
    expect(hasPluginEvidence({
      keywords: ['dsh-plugin', 'opencode'],
      main: 'index.js',
      readme: 'for opencode: opencode plugin add this-pkg',
    }).ok).toBe(true)
    // foreign tag without any opencode claim — no change, still rejects
    expect(hasPluginEvidence({ keywords: ['dsh-plugin'], main: 'x.js' }).ok).toBe(false)
    // untagged fallbacks: a 'dsh-*' name or a self-declaring readme is the
    // same membership claim as the keyword (@tnnevol/dsh-opencode shipped
    // 'for DeepSeek Harness' with zero dsh keywords)
    expect(hasPluginEvidence({ name: '@tnnevol/dsh-opencode', keywords: ['opencode', 'provider'], main: 'x.js' }).ok).toBe(false)
    expect(hasPluginEvidence({
      keywords: ['opencode'], main: 'x.js',
      readme: 'OpenCode Console login for DeepSeek Harness: usage + models.',
    }).ok).toBe(false)
    // a real opencode plugin whose author just has 'dsh' inside the scope
    // name is unaffected — 'amadshobi' is not a 'dsh-' name prefix
    expect(hasPluginEvidence({ name: '@amadshobi/oh-my-hook', keywords: ['opencode'], main: 'x.js' }).ok).toBe(true)
  })
  it('repo evidence: topic tag alone insufficient', () => {
    const S = (...p: string[]) => new Set(p)
    // generic 'opencode' topic + a bare package.json → just an opencode-related
    // project, not an extension
    expect(hasRepoEvidence(S('package.json', 'README.md'), ['opencode']).ok).toBe(false)
    // extension-specific topic + package.json → installable plugin
    expect(hasRepoEvidence(S('package.json'), ['opencode-plugin']).ok).toBe(true)
    // 'agent-skill' is cross-host generic — not an opencode signal (R-4)
    expect(hasRepoEvidence(S('package.json'), ['agent-skill']).ok).toBe(false)
    // a bare SKILL.md is an artifact but proves nothing about the host (R-4)
    expect(hasRepoEvidence(S('SKILL.md'), []).ok).toBe(false)
    expect(hasRepoEvidence(S('skills/x/SKILL.md'), ['opencode']).ok).toBe(false)
    // opencode-* topic + skill artifact → skill repo for this host
    expect(hasRepoEvidence(S('SKILL.md'), ['opencode-skill']).ok).toBe(true)
    expect(hasRepoEvidence(S('skills/x/SKILL.md', 'package.json'), ['opencode-plugin']).ok).toBe(true)
    // .opencode/ content + package.json → real plugin project
    expect(hasRepoEvidence(S('.opencode/plugin/x.ts', 'package.json'), []).ok).toBe(true)
    // .opencode/ alone without artifact → config share, not installable
    expect(hasRepoEvidence(S('.opencode/notes.txt'), []).ok).toBe(false)
    // opencode.json alone → project config, not an extension
    expect(hasRepoEvidence(S('opencode.json'), []).ok).toBe(false)
    expect(hasRepoEvidence(S('opencode.json', 'package.json'), []).ok).toBe(true)
    // nothing at all → reject
    expect(hasRepoEvidence(S('README.md'), []).ok).toBe(false)
  })
  it('repo evidence: foreign-host topics demote the opencode-* topic', () => {
    const S = (...p: string[]) => new Set(p)
    // dsh plugins tag 'opencode-plugin' for discoverability — topic +
    // package.json admitted dsh-opencode-palette; a foreign-host topic must
    // demote the topic arm, leaving only positive in-tree evidence
    expect(hasRepoEvidence(S('package.json'), ['opencode-plugin', 'dsh-plugin']).ok).toBe(false)
    expect(hasRepoEvidence(S('SKILL.md'), ['opencode-skill', 'dsh', 'deepseek-harness']).ok).toBe(false)
    // a repo that genuinely ships opencode content still passes — the
    // .opencode//opencode.json arms don't depend on topics
    expect(hasRepoEvidence(S('.opencode/plugin/x.ts', 'package.json'), ['dsh-plugin']).ok).toBe(true)
    expect(hasRepoEvidence(S('opencode.json', 'package.json'), ['claude-code']).ok).toBe(true)
    // foreign topic without opencode-* topic — no change either way
    expect(hasRepoEvidence(S('package.json'), ['dsh-plugin']).ok).toBe(false)
    // untagged fallbacks: dsh-* repo names and self-declaring descriptions
    // demote the topic arm the same way
    expect(hasRepoEvidence(S('package.json'), ['opencode-plugin'], 'owner/dsh-opencode-palette').ok).toBe(false)
    expect(hasRepoEvidence(S('SKILL.md'), ['opencode-skill'], 'owner/x', '把任务分给多模型的 DSH Agent Skill').ok).toBe(false)
    expect(hasRepoEvidence(S('opencode.json', 'package.json'), [], 'owner/dsh-tools').ok).toBe(true)
  })
})

describe('discovery: rate-limit & window handling', () => {
  it('searchTopic: total_count over the 1000-window bisects created ranges', async () => {
    const calls: string[] = []
    const f = async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url)
      const q = new URL(url).searchParams.get('q') ?? ''
      if (!q.includes('created:')) {
        return mkRes({ total_count: 2500, items: [{ full_name: 'o/root', stargazers_count: 1 }] })
      }
      // every slice fits its own window → one page each; name encodes the
      // slice's lower bound so coverage is visible
      const lo = q.match(/created:>=([0-9-]+)/)?.[1] ?? 'x'
      return mkRes({ total_count: 40, items: [{ full_name: `o/since-${lo}` }] })
    }
    const r = await searchTopic('t', { fetchFn: f as typeof fetch })
    // root + exactly two half-slices, both carrying the created qualifiers
    expect(calls).toHaveLength(3)
    expect(calls.filter(u => u.includes('created%3A'))).toHaveLength(2)
    expect(calls.filter(u => u.includes('created%3A'))[0]).toContain('created%3A%3E%3D')
    // each half contributed its own repo (name carries the slice lower bound;
    // the midpoint date itself depends on the run day — assert shape only)
    expect(r).toHaveLength(2)
    for (const x of r) expect(x.fullName).toMatch(/^o\/since-\d{4}-\d{2}-\d{2}$/)
  })

  it('searchTopic: ≤window total never emits a created qualifier', async () => {
    const calls: string[] = []
    const f = async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return mkRes({ total_count: 2, items: [{ full_name: 'o/a' }, { full_name: 'o/b' }] })
    }
    const r = await searchTopic('t', { fetchFn: f as typeof fetch })
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('created')
    expect(r).toHaveLength(2)
  })

  it('discoverGithub: code-search fires BEFORE the topic burst', async () => {
    const calls: string[] = []
    const f = async (input: RequestInfo | URL) => { calls.push(String(input)); return mkRes({ items: [] }) }
    await discoverGithub(['t1'], { token: 'tok', fetchFn: f as typeof fetch })
    const firstCode = calls.findIndex(u => u.includes('/search/code'))
    const firstRepo = calls.findIndex(u => u.includes('/search/repositories'))
    expect(firstCode).toBe(0)
    expect(firstRepo).toBeGreaterThan(firstCode)
  })

  it('searchCode: no fork: qualifier is emitted (endpoint 422s on it)', async () => {
    const calls: string[] = []
    const f = async (input: RequestInfo | URL) => { calls.push(String(input)); return mkRes({ items: [] }) }
    const { CODE_QUERIES } = await import('../pipeline/discover/github.ts')
    for (const q of CODE_QUERIES) {
      expect(q).not.toContain('fork')
      await searchCode(q, { fetchFn: f as typeof fetch })
    }
    for (const u of calls) expect(decodeURIComponent(u)).not.toContain('fork:')
  })

  it('searchByKeyword: 429 retried once then recovers; persistent 429 truncates', async () => {
    let calls = 0
    const f = async () => {
      calls++
      return calls === 1 ? mkRes({}, 429) : mkRes({ objects: [{ package: { name: 'ok', version: '1', links: {} } }] })
    }
    const r = await searchByKeyword('k', { fetchFn: f as typeof fetch })
    expect(calls).toBe(2)
    expect(r.map(x => x.name)).toEqual(['ok'])

    let calls2 = 0
    const r2 = await searchByKeyword('k', { fetchFn: (async () => { calls2++; return mkRes({}, 429) }) as typeof fetch })
    expect(calls2).toBe(2) // one retry, no endless hammering
    expect(r2).toEqual([])
  })

  it('searchCode: 403 retried once then truncates', async () => {
    let calls = 0
    const r = await searchCode('q', { fetchFn: (async () => { calls++; return mkRes({}, 403) }) as typeof fetch })
    expect(calls).toBe(2)
    expect(r).toEqual([])
  })
})
