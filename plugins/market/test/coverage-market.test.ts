import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sha256Hex, sha256HexBytes, enginesSatisfied, assertApprovedPin, pinSpec,
  search, skillsUrl, healthUrl, sanitizeState, versionCmp, fmtN, readBodyBounded,
} from '../src/catalog.ts'
import type { MarketEntry, MarketIndex } from '../src/catalog.ts'
import {
  assertPkgName, assertSpecForName, strArrayField, marketLogPath, skillsRoot,
  withConfigLock, appendBounded,
} from '../src/hostx.ts'
import { safeTarRel, installSkillTar, globalSkillsRoot, MAX_SKILL_TGZ } from '../src/skill-install.ts'

const mkEntry = (name: string, over: Record<string, unknown> = {}): MarketEntry =>
  ({ name, slug: name, type: 'plugin', category: [], ...over }) as MarketEntry

describe('catalog.ts integrity/version helpers', () => {
  it('sha256Hex/Bytes → lowercase digest; crypto-less runtime → null', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256HexBytes(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no crypto'))
    try {
      expect(await sha256Hex('x')).toBeNull()
      expect(await sha256HexBytes(new Uint8Array(1))).toBeNull()
    } finally { spy.mockRestore() }
  })

  it('pinSpec — name@version, bare name when unversioned, unsafe version throws', () => {
    expect(pinSpec({ name: 'a', latestVersion: '1.2.3' })).toBe('a@1.2.3')
    expect(pinSpec({ name: 'a', latestVersion: null })).toBe('a')
    expect(() => pinSpec({ name: 'a', latestVersion: '1;rm -rf' })).toThrow('unsafe version')
  })

  it('assertApprovedPin — fresh entry, moved catalog, absent entry', async () => {
    const e = mkEntry('p', { latestVersion: '2' })
    const idx = { plugins: [e] } as MarketIndex
    expect(await assertApprovedPin(async () => idx, 'p', 'p@2')).toBe(e)
    await expect(assertApprovedPin(async () => idx, 'p', 'p@1')).rejects.toThrow('catalog moved')
    await expect(assertApprovedPin(async () => idx, 'ghost', 'ghost')).rejects.toThrow('not in catalog')
    await expect(assertApprovedPin(async () => null, 'p', 'p@2')).rejects.toThrow('not in catalog')
  })

  it('enginesSatisfied — opencode clause, bare range, operators, wildcard, unparseable', () => {
    expect(enginesSatisfied('1.2.3', 'opencode >=1 <2')).toBe(true)
    expect(enginesSatisfied('2.0.0', 'opencode >=1 <2')).toBe(false)
    expect(enginesSatisfied('0.9', 'opencode >=1 || >=3')).toBe(false)
    expect(enginesSatisfied('3.1', 'opencode >=1 || >=3')).toBe(true)
    expect(enginesSatisfied('1.2.3', '>=1 <2')).toBe(true)           // lone bare range = opencode clause
    expect(enginesSatisfied('v1.2.3', 'opencode >=1')).toBe(true)    // v-prefix stripped
    expect(enginesSatisfied('1.10', 'opencode >1.9')).toBe(true)     // numeric, not lexical
    expect(enginesSatisfied('1.2.3', 'node >=1; opencode >=1')).toBe(true)
    expect(enginesSatisfied('1.2.3', 'opencode ^1.0')).toBe(true)
    expect(enginesSatisfied('2.0.0', 'opencode ^1.0')).toBe(false)
    expect(enginesSatisfied('1.5.9', 'opencode ~1.5.0')).toBe(true)
    expect(enginesSatisfied('1.6.0', 'opencode ~1.5.0')).toBe(false)
    expect(enginesSatisfied('1.9.0', 'opencode 1.x')).toBe(true)
    expect(enginesSatisfied('2.0.0', 'opencode 1.x')).toBe(false)
    expect(enginesSatisfied('1.2.3', 'opencode =1.2.3')).toBe(true)
    expect(enginesSatisfied('1.2.4', 'opencode 1.2.3')).toBe(false)
    expect(enginesSatisfied('1.2.3', 'opencode 1.2.3-beta')).toBe(true)
    expect(enginesSatisfied('1.2.3', 'node >=1')).toBeNull()         // no opencode clause
    expect(enginesSatisfied('1.2.3', 'opencode @1')).toBeNull()      // unparseable → honest null
    expect(enginesSatisfied('abc', 'opencode >=1')).toBeNull()       // bad host
    expect(enginesSatisfied('1.2.3', 'opencode <=1.x')).toBeNull()   // wildcard + range op = unknown
    expect(enginesSatisfied('1.2.3', '')).toBeNull()
  })

  it('readBodyBounded — non-streaming body, oversized post-hoc check, stream cap', async () => {
    const small = new Response('hi')
    expect(new TextDecoder().decode(await readBodyBounded(small, 10, 't'))).toBe('hi')
    await expect(readBodyBounded(new Response('too-big-payload'), 4, 't')).rejects.toThrow('too large')
    // streaming arm — a body the runtime still streams
    const stream = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); c.close() },
    })
    await expect(readBodyBounded(new Response(stream), 10, 't')).rejects.toThrow('too large')
  })

  it('skillsUrl/healthUrl — fallback when the index url is unusable', () => {
    expect(skillsUrl('https://x.test/idx.json')).toBe('https://x.test/skills/')
    expect(skillsUrl('not a url')).toContain('github.io')
    expect(healthUrl('not a url')).toBe('')
    expect(healthUrl('https://x.test/a/idx.json')).toBe('https://x.test/a/health.json')
  })

  it('search — name > alias/slug > description ranking', () => {
    const es = [
      mkEntry('zzz', { description: { en: 'has session word' } }),
      mkEntry('other', { aliases: ['session-alias'] }),
      mkEntry('session-core'),
    ]
    const r = search(es, 'session')
    expect(r.map(x => x.name)).toEqual(['session-core', 'other', 'zzz'])
    expect(search(es, '   ')).toBe(es)
    expect(search(es, 'nomatch')).toEqual([])
  })

  it('sanitizeState — non-object, truthy favorites, strMap filter, lang/devlog', () => {
    expect(sanitizeState(null)).toEqual({ favorites: {} })
    expect(sanitizeState('x').favorites).toEqual({})
    const s = sanitizeState({ favorites: { a: true, b: 0 }, skillVers: { p: '1', q: 7 }, devlog: true, lang: 'zh' })
    expect(s.favorites).toEqual({ a: true })
    expect(s.skillVers).toEqual({ p: '1' })
    expect(s.devlog).toBe(true)
    expect(s.lang).toBe('zh')
    expect(sanitizeState({ lang: 'fr' }).lang).toBeUndefined()
  })

  it('versionCmp — semver, date fallback, non-comparable', () => {
    expect(versionCmp('1.0.0', '1.0.1')).toBe(-1)
    expect(versionCmp('1.10.0', '1.9.0')).toBe(1)
    expect(versionCmp('x', 'x')).toBe(0)
    expect(versionCmp('2026-01-01', '2026-01-02')).toBeLessThan(0)
    expect(versionCmp('abc', 'def')).toBe(0)
    expect(versionCmp('1.0-alpha', '1.0-beta')).toBe(-1)
  })

  it('fmtN compact counts', () => {
    expect(fmtN(null)).toBe('—')
    expect(fmtN(999)).toBe('999')
    expect(fmtN(1200)).toBe('1.2k')
    expect(fmtN(15_000)).toBe('15k')
  })
})

describe('hostx.ts input guards + env/log helpers', () => {
  it('assertPkgName / assertSpecForName — argv-flag, traversal, mismatch, bad version', () => {
    expect(() => assertPkgName('ok-pkg')).not.toThrow()
    expect(() => assertPkgName('@scope/pkg')).not.toThrow()
    for (const bad of ['-flag', '../x', 'a..b', 'a b', 'a;rm', 5, null]) expect(() => assertPkgName(bad)).toThrow('invalid package name')
    expect(() => assertSpecForName('pkg', undefined)).not.toThrow()
    expect(() => assertSpecForName('pkg', 'pkg@1.2.3')).not.toThrow()
    expect(() => assertSpecForName('pkg', 'other@1')).toThrow('does not match')
    expect(() => assertSpecForName('pkg', 'pkg@1;evil')).toThrow('invalid version')
    expect(() => assertSpecForName('pkg', '--registry=evil')).toThrow()
  })

  it('strArrayField — absent, malformed, mixed filtering', () => {
    expect(strArrayField({}, 'f')).toEqual([])
    expect(strArrayField({ f: ['a', 1, 'b', null] }, 'f')).toEqual(['a', 'b'])
    expect(() => strArrayField({ f: 'nope' }, 'f')).toThrow('not an array')
  })

  it('marketLogPath/skillsRoot — env resolution', async () => {
    expect(await marketLogPath()).toContain('market.log')
    const keep = { ...process.env }
    try {
      process.env.OPENCODE_CONFIG = '/tmp/custom/oc.json'
      expect(await skillsRoot()).toBe(join('/tmp/custom', 'skills'))
      delete process.env.OPENCODE_CONFIG
      process.env.XDG_CONFIG_HOME = '/tmp/xdg'
      expect(await skillsRoot()).toBe(join('/tmp/xdg', 'opencode', 'skills'))
      expect(await marketLogPath()).toBe(join('/tmp/xdg', 'opencode', 'market.log'))
    } finally { Object.assign(process.env, keep) }
  })

  it('withConfigLock serializes writers and survives a rejection', async () => {
    const order: string[] = []
    await withConfigLock(async () => { order.push('a-start'); await new Promise(r => setTimeout(r, 10)); order.push('a-end') })
    const p1 = withConfigLock(async () => { order.push('b') })
    const p2 = withConfigLock(async () => { order.push('c') })
    await Promise.all([p1, p2])
    expect(order).toEqual(['a-start', 'a-end', 'b', 'c'])
    await expect(withConfigLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await withConfigLock(async () => { order.push('d') })   // chain unwedged
    expect(order.at(-1)).toBe('d')
  })

  it('appendBounded — appends, rotates past 256KB, never throws on io errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-'))
    const p = join(dir, 'm.log')
    await appendBounded(p, 'line1\n')
    expect(readFileSync(p, 'utf8')).toBe('line1\n')
    // rotation: pre-seed an oversized log
    writeFileSync(p, 'x'.repeat(300 * 1024))
    await appendBounded(p, 'new\n')
    expect(existsSync(`${p}.old`)).toBe(true)
    expect(readFileSync(p, 'utf8')).toBe('new\n')
    // io failure (dir is a file) → swallowed
    const fileAsDir = join(dir, 'f'); writeFileSync(fileAsDir, 'x')
    await appendBounded(join(fileAsDir, 'sub', 'm.log'), 'x')
  })
})

describe('skill-install.ts helpers', () => {
  it('safeTarRel — strips package/ and ./, rejects traversal/absolute/empty segments', () => {
    expect(safeTarRel('package/a/b.js')).toBe('a/b.js')
    expect(safeTarRel('./x')).toBe('x')
    expect(safeTarRel('pkg\\dir\\f')).toBe('pkg/dir/f')
    expect(safeTarRel('a/../b')).toBeNull()
    expect(safeTarRel('/abs')).toBeNull()
    expect(safeTarRel('a//b')).toBeNull()
    expect(safeTarRel('package/')).toBeNull()
    expect(safeTarRel('a/./b')).toBeNull()
  })

  it('installSkillTar — over-cap compressed payload rejected before gunzip', async () => {
    await expect(installSkillTar({ name: 'p', gzipped: new Uint8Array(MAX_SKILL_TGZ + 1), root: '/tmp/x' }))
      .rejects.toThrow('too large')
  })

  it('globalSkillsRoot delegates to skillsRoot', async () => {
    expect(await globalSkillsRoot()).toContain('skills')
  })
})
