import { describe, it, expect } from 'vitest'
import { explainFlag } from '../pipeline/scan/flagExplain.ts'
import { pickFailLine, unwrapLogLine, explainVerifyFail, isHarnessNoise } from '../pipeline/verify/failExplain.ts'

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
})
