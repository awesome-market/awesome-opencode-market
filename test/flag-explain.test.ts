import { describe, it, expect } from 'vitest'
import { explainFlag } from '../pipeline/scan/flagExplain.ts'
import { pickFailLine, unwrapLogLine, explainVerifyFail, isHarnessNoise, egressBlockedExcerpt, EGRESS_BLOCKED } from '../pipeline/verify/failExplain.ts'

describe('explainFlag', () => {
  it('wraps sec-delta flags with the inner rule explainer when known', () => {
    const ex = explainFlag('sec-delta:prepare-script:package.json — L1: x')
    expect(ex?.zh).toContain('版本增量扫描命中规则 prepare-script')
    expect(ex?.zh).toContain('git/tarball 安装时自动执行')
  })
  it('wraps sec-delta with an unknown inner rule — still named, no gloss invented', () => {
    const ex = explainFlag('sec-delta:novel-rule:x.ts')
    expect(ex?.zh).toContain('novel-rule')
    expect(ex?.zh).not.toContain('——')
  })
  it('sec:* identity flags resolve by id ignoring :value/@version payloads', () => {
    expect(explainFlag('sec:integrity-drift')?.zh).toContain('字节指纹')
    expect(explainFlag('sec:evidence-regressed@1.2.3')?.zh).toContain('证据链')
    expect(explainFlag('sec:repo-moved-since-release:abc')?.en).toContain('HEAD moved')
  })
  it('scanner rules resolve; unknown ids return null', () => {
    expect(explainFlag('obfuscation:x.js — L1: y')?.zh).toContain('混淆')
    expect(explainFlag('totally-unknown:x') ).toBeNull()
  })
})

describe('failExplain helpers', () => {
  it('pickFailLine skips JSON blob lines, markers, and harness noise', () => {
    const log = '--- errors ---\n{"registry":"dump"}\nfailed to watch directory EACCES\nreal SyntaxError: bad'
    expect(pickFailLine(log)).toBe('real SyntaxError: bad')
    expect(pickFailLine('--- errors ---\nall quiet')).toBe('')
  })
  it('isHarnessNoise detects ambient lines', () => {
    expect(isHarnessNoise('Failed to fetch models.dev')).toBe(true)
    expect(isHarnessNoise('real SyntaxError')).toBe(false)
  })
  it('unwrapLogLine extracts message and cause fields, falls back raw', () => {
    expect(unwrapLogLine('ts level=E message="boom" cause="c1"')).toBe('boom — c1')
    expect(unwrapLogLine('ts message="only-msg"')).toBe('only-msg')
    expect(unwrapLogLine('ts cause="only-cause"')).toBe('— only-cause')
    expect(unwrapLogLine('plain line')).toBe('plain line')
  })
  it('explainVerifyFail covers signatures, interactive fallback, and unknown', () => {
    expect(explainVerifyFail('load', 'PluginModule.LoadError: x')).toContain('无法被宿主加载')
    expect(explainVerifyFail('load', 'Cannot find module "./x"')).toContain('依赖缺失')
    expect(explainVerifyFail('interactive', 'mystery')).toContain('交互式启动检查未通过')
    expect(explainVerifyFail('load', 'mystery')).toBe('')
  })
  it('EGRESS_BLOCKED covers the policy signatures, not ambient noise', () => {
    expect(EGRESS_BLOCKED.test('fetch https://x ECONNREFUSED')).toBe(true)
    expect(EGRESS_BLOCKED.test('ENOTFOUND api.example.com')).toBe(true)
    expect(EGRESS_BLOCKED.test('TypeError: fetch failed')).toBe(true)
    expect(EGRESS_BLOCKED.test('PluginModule.LoadError: contract')).toBe(false)
  })
  it('explainVerifyFail maps network signatures to the egress explanation', () => {
    expect(explainVerifyFail('load', 'fetch https://api.x ECONNREFUSED')).toContain('egress')
  })
  it('egressBlockedExcerpt: network-only failures route to review; hard crashes stay mechanical', () => {
    // pure network failure — sandbox policy, not package evidence
    expect(egressBlockedExcerpt(
      '--- errors ---\nplugin init failed: fetch https://api.example.com ECONNREFUSED\nserve reports the plugin failed to load')).toBe(true)
    // models.dev noise does not count as the plugin's own network error
    expect(egressBlockedExcerpt(
      'Failed to fetch models.dev ECONNREFUSED\nfailed to watch directory EACCES')).toBe(false)
    // a LoadError NOT caused by network is real package evidence
    expect(egressBlockedExcerpt(
      'PluginModule.LoadError: export did not satisfy contract\nserve reports the plugin failed to load')).toBe(false)
    // network noise PLUS an independent crash — the crash wins
    expect(egressBlockedExcerpt(
      'fetch https://cdn.example.com ECONNRESET\nSyntaxError: Unexpected token')).toBe(false)
    // LoadError WRAPPING a fetch failure — network caused the load error
    expect(egressBlockedExcerpt(
      'PluginModule.LoadError: fetch failed ECONNREFUSED')).toBe(true)
    // no error lines at all
    expect(egressBlockedExcerpt('all quiet')).toBe(false)
  })
})
