/** audit #10 (客户端消费流 §10 plugins/market) — 第 N 轮回归:
 *  1. enginesSatisfied — engines ranges serialize "name range; name range"
 *     and EVERY opencode clause must hold ('opencode >=2; opencode <3' used
 *     to evaluate only the first → host 4.0 passed a <3 ceiling). The
 *     boundary lookahead keeps 'opencode-beta' (a different package) out.
 *  2. versionCmp — semver prerelease numeric ids compare by VALUE: '01'
 *     and '1' are equal and comparison continues to the next id.
 *  3. catLabel — cross-language fallback: a zh-only dictionary entry must
 *     not render as the bare category id for en users (and vice versa).
 *  4. pluginLoadRe — the activation canary matches BOTH the quoted
 *     `loading plugin" id=` and bare `loading plugin id=` log forms
 *     (pipeline/verify's loadedSignal family); the plugin name is
 *     regex-escaped so 'a.b' can't match 'aXb'. */
import { describe, it, expect } from 'vitest'
import { enginesSatisfied, versionCmp, catLabel, setCatDict, setLangMode } from '../plugins/market/src/catalog.ts'
import { pluginLoadRe } from '../plugins/market/src/hostx.ts'

describe('enginesSatisfied — every opencode clause must hold', () => {
  it('a second opencode clause is not silently dropped', () => {
    // 'opencode >=2; opencode <3' on host 4.0: the <3 ceiling used to be
    // ignored → confident true for a host the range excludes
    expect(enginesSatisfied('4.0.0', 'opencode >=2; opencode <3')).toBe(false)
    expect(enginesSatisfied('2.5.0', 'opencode >=2; opencode <3')).toBe(true)
    expect(enginesSatisfied('1.5.0', 'opencode >=2; opencode <3')).toBe(false)
  })
  it('opencode-beta is a different package — never read as the opencode clause', () => {
    // 'opencode-beta >=2' alone: no opencode clause → not ours to judge
    expect(enginesSatisfied('4.0.0', 'opencode-beta >=2')).toBeNull()
    // mixed: the REAL opencode clause still decides
    expect(enginesSatisfied('4.0.0', 'opencode-beta >=9; opencode >=2; opencode <3')).toBe(false)
    expect(enginesSatisfied('2.5.0', 'opencode-beta >=9; opencode >=2; opencode <3')).toBe(true)
  })
  it('unrelated named clauses still do not gate the verdict', () => {
    expect(enginesSatisfied('2.2.5', 'node >=18; opencode >=2.0.0')).toBe(true)
    expect(enginesSatisfied('1.0.0', 'node >=18; opencode >=2.0.0')).toBe(false)
    expect(enginesSatisfied('2.2.5', 'npm >=9; yarn >=1')).toBeNull()
  })
  it('an unparseable clause among opencode clauses degrades to null, not false', () => {
    expect(enginesSatisfied('2.2.5', 'opencode >=2; opencode latest')).toBeNull()
    // but a definite fail still wins over an unknown sibling
    expect(enginesSatisfied('1.0.0', 'opencode <1; opencode latest')).toBe(false)
  })
})

describe('versionCmp — prerelease numeric ids compare by value', () => {
  it('lexically different but numerically equal ids tie and continue', () => {
    expect(versionCmp('1.0.0-01', '1.0.0-1')).toBe(0)
    expect(versionCmp('1.0.0-01.2', '1.0.0-1.2')).toBe(0)
    // numeric ordering inside the id list
    expect(versionCmp('1.0.0-1.2', '1.0.0-1.10')).toBe(-1)
    expect(versionCmp('1.0.0-2', '1.0.0-10')).toBe(-1)
  })
  it('semver prerelease ordering still holds around the tie fix', () => {
    expect(versionCmp('1.0.0', '1.0.0-beta')).toBe(1)      // release > prerelease
    expect(versionCmp('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)  // shorter id list loses
    expect(versionCmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1)     // alpha < beta
    expect(versionCmp('1.0.0-1', '1.0.0-alpha')).toBe(-1)        // numeric < alphanumeric
  })
})

describe('catLabel — cross-language fallback before the raw id', () => {
  it('a zh-only dictionary entry renders its zh text for en users, not the bare id', () => {
    setCatDict({ 'audit-zh-only': { zh: '审计专用' } })
    setLangMode('en')
    expect(catLabel('audit-zh-only')).toBe('审计专用')
    setLangMode('zh')
    expect(catLabel('audit-zh-only')).toBe('审计专用')
    setLangMode('auto')
    // an entry with BOTH languages still picks the active one
    setCatDict({ 'audit-both': { en: 'Audit', zh: '审计' } })
    setLangMode('en')
    expect(catLabel('audit-both')).toBe('Audit')
    setLangMode('zh')
    expect(catLabel('audit-both')).toBe('审计')
    setLangMode('auto')
    // truly unknown ids still pass through untouched
    expect(catLabel('no-such-category')).toBe('no-such-category')
  })
})

describe('pluginLoadRe — the activation canary, both log forms', () => {
  it('matches the quoted msg form and the bare variant', () => {
    const re = pluginLoadRe('my-plugin')
    expect(re.test('time=.. level=info msg="loading plugin" id=my-plugin')).toBe(true)
    expect(re.test('time=.. level=info msg="loading plugin" id=my-plugin version=1.0.0')).toBe(true)
    expect(re.test('loading plugin id=my-plugin')).toBe(true)
    expect(re.test('loading plugin" id=my-plugin')).toBe(true)
  })
  it('does not match near-misses or a different plugin id', () => {
    const re = pluginLoadRe('my-plugin')
    expect(re.test('loading plugins id=my-plugin')).toBe(false)
    expect(re.test('loading plugin id=my-plugin-extra')).toBe(false)
    expect(re.test('loading plugin id=other-plugin')).toBe(false)
    expect(re.test('plugin loaded id=my-plugin')).toBe(false)
  })
  it('the plugin name is regex-escaped — dots cannot act as wildcards', () => {
    const re = pluginLoadRe('a.b')
    expect(re.test('loading plugin id=a.b')).toBe(true)
    expect(re.test('loading plugin id=aXb')).toBe(false)
    expect(re.test('loading plugin id=a/b')).toBe(false)
  })
})
