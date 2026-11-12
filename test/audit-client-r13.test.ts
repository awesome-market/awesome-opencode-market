/** audit #10 (客户端消费流 §10 plugins/market) — 遗留风险清扫轮:
 *  1. hasUpdate — version markers that are ORDERABLE-EQUAL are not updates:
 *     '1.0' vs '1.0.0', 'v1.0' vs '1.0', build-metadata variants used to fire
 *     a pointless reinstall on string !==. Unorderable pairs (commit shas)
 *     and MIXED sem/date pairs keep the honest string-difference answer.
 *  2. enginesSatisfied — ^/~ now desugar to real npm bounds: ^0.2.3 caps at
 *     <0.3.0 (was "same major" → host 0.5.0 passed), ~1 allows <2.0.0 (was
 *     "same major+minor" → host 1.5.0 failed). Unknown operators degrade
 *     to null instead of being read as exact match.
 *  3. fetchIndexCached/fetchOutcome — the index cache records WHICH url it
 *     belongs to: switching catalog URLs inside TTL used to serve the
 *     previous catalog's entries, and the single global outcome let the
 *     last finisher answer for every URL.
 *  4. safeTarRel — Windows device names (CON/NUL/COM1-9/LPT1-9, extension
 *     or not) and trailing '.'/' ' segments are rejected: Windows strips
 *     them silently, so they extract-bomb or collide on that platform. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hasUpdate, enginesSatisfied, fetchIndexCached, fetchOutcome, type MarketEntry } from '../plugins/market/src/catalog.ts'
import { safeTarRel } from '../plugins/market/src/skill-install.ts'

const entry = (over: Partial<MarketEntry>): MarketEntry => ({ name: 'x', ...over }) as MarketEntry

describe('hasUpdate — orderable-equal markers are not updates', () => {
  it('semver-equal-but-textually-different versions do not reinstall', () => {
    expect(hasUpdate(entry({ latestVersion: '1.0.0' }), '1.0')).toBe(false)
    expect(hasUpdate(entry({ latestVersion: '1.0.0' }), 'v1.0')).toBe(false)
    expect(hasUpdate(entry({ latestVersion: '1.0.0' }), '1.0.0+build.7')).toBe(false)
    expect(hasUpdate(entry({ latestVersion: '1.0' }), '1.0.0')).toBe(false)
  })
  it('real version differences still report an update', () => {
    expect(hasUpdate(entry({ latestVersion: '1.0.1' }), '1.0')).toBe(true)
    expect(hasUpdate(entry({ latestVersion: '1.0.0' }), '1.0.0-beta')).toBe(true)
    expect(hasUpdate(entry({ latestVersion: '2.0.0' }), '1.9.9')).toBe(true)
  })
  it('unorderable markers keep the string-difference answer', () => {
    // commit shas can't be proven equal or ordered — any difference counts
    const gh = entry({ source: { kind: 'github', repo: 'o/r', version: 'aaa1111' } as MarketEntry['source'] })
    expect(hasUpdate(gh, 'bbb2222')).toBe(true)
    expect(hasUpdate(gh, 'aaa1111')).toBe(false)
    // a MIXED sem/date pair is unorderable too — versionCmp's 0 means
    // "can't prove", not "equal", so it must not suppress the update
    expect(hasUpdate(entry({ latestVersion: '1.0.0' }), '2024-01-01T00:00:00Z')).toBe(true)
  })
  it('same-instant dates in different formats are equal, not updates', () => {
    const gh = entry({ source: { kind: 'github', repo: 'o/r' } as MarketEntry['source'], modifiedAt: '2024-01-01T00:00:00Z' })
    expect(hasUpdate(gh, '2024-01-01T00:00:00.000Z')).toBe(false)
    expect(hasUpdate(gh, '2024-06-01T00:00:00Z')).toBe(true)
  })
})

describe('enginesSatisfied — ^/~ follow npm bounds', () => {
  it('caret respects the left-most non-zero part', () => {
    expect(enginesSatisfied('0.5.0', 'opencode ^0.2.3')).toBe(false)  // <0.3.0 cap — was true
    expect(enginesSatisfied('0.2.9', 'opencode ^0.2.3')).toBe(true)
    expect(enginesSatisfied('0.3.0', 'opencode ^0.2.3')).toBe(false)
    expect(enginesSatisfied('1.9.9', 'opencode ^1.2.3')).toBe(true)
    expect(enginesSatisfied('2.0.0', 'opencode ^1.2.3')).toBe(false)
    expect(enginesSatisfied('0.0.3', 'opencode ^0.0.3')).toBe(true)
    expect(enginesSatisfied('0.0.4', 'opencode ^0.0.3')).toBe(false)
    expect(enginesSatisfied('0.9.9', 'opencode ^0')).toBe(true)       // ^0 → <1.0.0
    expect(enginesSatisfied('1.0.0', 'opencode ^0')).toBe(false)
  })
  it('tilde allows patch-level when minor pinned, minor-level otherwise', () => {
    expect(enginesSatisfied('1.5.0', 'opencode ~1')).toBe(true)       // ~1 → <2.0.0 — was false
    expect(enginesSatisfied('2.0.0', 'opencode ~1')).toBe(false)
    expect(enginesSatisfied('1.2.9', 'opencode ~1.2.3')).toBe(true)
    expect(enginesSatisfied('1.3.0', 'opencode ~1.2.3')).toBe(false)
    expect(enginesSatisfied('0.2.5', 'opencode ~0.2')).toBe(true)
    expect(enginesSatisfied('0.3.0', 'opencode ~0.2')).toBe(false)
  })
  it('unrecognized operators degrade to null, not a confident verdict', () => {
    expect(enginesSatisfied('2.0.0', 'opencode ~>1.0')).toBeNull()
    expect(enginesSatisfied('2.0.0', 'opencode =>1.0')).toBeNull()
  })
})

describe('index cache + fetchOutcome — per-URL honesty', () => {
  const IDX = (n: string) => JSON.stringify({ version: '1', generatedAt: 'g', categories: {}, removed: [], plugins: [{ name: n, slug: n }] })
  const fakeRes = (url: string) => ({
    ok: true, status: 200, url,
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => new TextEncoder().encode(IDX('p')).buffer as ArrayBuffer,
  }) as unknown as Response
  let store: Record<string, string>
  let fetchCalls: string[]
  const realFetch = globalThis.fetch
  const URL_A = 'https://cat-a.test/index.json'
  const URL_B = 'https://cat-b.test/index.json'
  beforeEach(() => {
    store = {}
    fetchCalls = []
    globalThis.localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    } as unknown as Storage
    globalThis.fetch = (async (u: unknown) => { fetchCalls.push(String(u)); return fakeRes(String(u)) }) as typeof fetch
  })
  afterEach(() => { globalThis.fetch = realFetch; delete (globalThis as Record<string, unknown>).localStorage })

  it('a URL switch inside TTL fetches the new catalog instead of serving the old one', async () => {
    await fetchIndexCached(URL_A)
    await fetchIndexCached(URL_A)                       // TTL hit — no index refetch
    const indexFetches = () => fetchCalls.filter(u => u.endsWith('/index.json')).length
    expect(indexFetches()).toBe(1)
    // switch catalogs — the single global cache slot used to answer B's
    // fetch with A's snapshot for up to an hour
    await fetchIndexCached(URL_B)
    expect(indexFetches()).toBe(2)                      // B really pulled its own index
    const blob = JSON.parse(store['opencode-market.index.v1']!) as { url?: string }
    expect(blob.url).toBe(URL_B)
  })
  it('fetchOutcome is per-URL — the last finisher does not answer for every catalog', async () => {
    await fetchIndexCached(URL_A)
    await fetchIndexCached(URL_A)                       // A → fresh (TTL)
    await fetchIndexCached(URL_B)                       // B → first (cache was A's)
    expect(fetchOutcome(URL_A)).toBe('fresh')           // was 'first' under the global let
    expect(fetchOutcome(URL_B)).toBe('first')
    expect(fetchOutcome()).toBe('first')                // no-arg = most recent (B)
    await fetchIndexCached(URL_A, true)                 // force A → updated? cache is B's → first
    expect(fetchOutcome(URL_A)).toBe('first')
    expect(fetchOutcome(URL_B)).toBe('first')
  })
})

describe('safeTarRel — Windows-hostile names rejected', () => {
  it('device names and trailing dot/space segments never reach disk', () => {
    expect(safeTarRel('package/CON.txt')).toBeNull()
    expect(safeTarRel('package/nul.md')).toBeNull()
    expect(safeTarRel('package/com1/x')).toBeNull()      // device name as a DIR segment
    expect(safeTarRel('package/lpt9.md')).toBeNull()
    expect(safeTarRel('package/AUX')).toBeNull()
    expect(safeTarRel('package/foo./bar.txt')).toBeNull()// Windows strips the dot → collision
    expect(safeTarRel('package/foo /bar.txt')).toBeNull()// same for trailing space
  })
  it('near-misses stay installable', () => {
    expect(safeTarRel('package/com10.md')).toBe('com10.md')   // COM10 is not reserved
    expect(safeTarRel('package/console/x')).toBe('console/x') // 'con' prefix alone is fine
    expect(safeTarRel('package/normal/path.txt')).toBe('normal/path.txt')
    expect(safeTarRel('package/my.con.txt')).toBe('my.con.txt') // device check is on the segment start
  })
})
