/** audit #9 (站点发布流 §9, 第 6 轮) — independent re-audit of site.yml +
 *  build.ts against DATA-FLOWS §9 found the verify-status label lying for
 *  github-kind skill entries, plus a base-path edge:
 *
 *  1. verifyLabel keyed "nothing to install" on latestVersion===null — but
 *     github-kind rows ALWAYS carry latestVersion:null (run.ts) while a
 *     'skill' part + usable repo IS installable (skills catalog / client
 *     codeload installPlan.skill='github') and its verification status is
 *     real (git-sha targets run unverified→verified/failed). A failed
 *     github skill displayed "没有可安装的包" — hiding the failure AND
 *     contradicting installHint's skills-catalog link on the same page.
 *     The label now routes through the same installPlan-parity predicate
 *     as installHint (installPaths/hasInstallPath): path-less rows keep the
 *     muted label, installable rows show their true verify state.
 *  2. siteBasePath derived the repo segment via split('/').pop() — a
 *     trailing-slash remote ('…/r/') yielded '' → project page silently
 *     degraded to base '/' and every absolute 404 link died. repoNameOf
 *     now runs the remote through normalizeRepoUrl (scp/ssh collapse,
 *     .git + trailing-slash strip) first.
 *  3. buildSkillCatalog silently skipped version-less skill rows while
 *     every sibling corrupt-data branch warns — now warns too. */
import { describe, it, expect } from 'vitest'
import { verifyLabel, installHint, detailPage, repoNameOf } from '../pipeline/site/build.ts'
import type { PluginEntry } from '../src/schema.ts'

const mk = (over: Partial<PluginEntry> = {}): PluginEntry => ({
  name: 'p', slug: 'o/p', aliases: [], type: 'plugin', discoveredVia: [],
  source: { kind: 'npm', id: 'p' }, description: { en: 'desc' }, category: [],
  license: 'MIT', deprecated: false, replacement: null, deprecatedMessage: null, createdAt: null, modifiedAt: null, maintainers: [], distTags: {},
  firstSeenAt: '2026-01-01T00:00:00Z', latestVersion: '1.0.0', publishedAt: null,
  metrics: { stars: 5, npmDownloads30d: 100, checkedAt: 't' },
  capabilities: { scannedAt: null, findings: [], redFlags: [] },
  verification: { status: 'unverified' }, compat: {},
  approval: 'approved',
  ...over,
})

const ghSkill = (ver: PluginEntry['verification'], over: Partial<PluginEntry> = {}) =>
  mk({ latestVersion: null, type: 'skill', contains: ['skill'],
    source: { kind: 'github', id: 'o/s', repo: 'o/s', version: 'a'.repeat(40) },
    verification: ver, ...over })

describe('§9 verifyLabel — install-path parity, not version-slot', () => {
  it('github-kind skill entry shows its REAL verify status (failed)', () => {
    const e = ghSkill({ status: 'failed', level: 'install' })
    expect(verifyLabel(e).text).toContain('verification failed')
    expect(verifyLabel(e).text).not.toBe('nothing to install')
    expect(verifyLabel(e).cls).toBe('bad')
  })
  it('github-kind skill entry shows verified / unverified honestly', () => {
    expect(verifyLabel(ghSkill({ status: 'verified', level: 'install' })).text).toContain('verified')
    expect(verifyLabel(ghSkill({ status: 'unverified' })).text).toBe('unverified')
  })
  it('github-kind skill skipped WITH red flags reports high risk, not "nothing"', () => {
    // installable payload + flags → 'skipped (high risk)' is the honest state
    // (was previously masked as "nothing to install", hiding the risk signal)
    const e = ghSkill({ status: 'skipped' },
      { capabilities: { scannedAt: 't', findings: [], redFlags: ['sec:x'] } })
    expect(verifyLabel(e).text).toContain('skipped')
    expect(verifyLabel(e).text).toContain('high risk')
  })
  it('github-kind skill with malformed repo → nothing to install (client parity)', () => {
    const e = ghSkill({ status: 'failed' },
      { source: { kind: 'github', id: 'x', repo: 'not a repo' } })
    expect(verifyLabel(e).text).toBe('nothing to install')
  })
  it('github-kind plugin-only → nothing to install (client has no route)', () => {
    const e = mk({ latestVersion: null, contains: ['plugin'],
      source: { kind: 'github', id: 'o/r', repo: 'o/r' },
      verification: { status: 'verified', level: 'install' } })
    expect(verifyLabel(e).text).toBe('nothing to install')
  })
  it('npm entry with contains:[] → nothing to install (canInstall=false parity)', () => {
    // has a version but zero installable parts — client shows noInstallTarget;
    // the site must not keep claiming "unverified" forever
    const e = mk({ contains: [], verification: { status: 'unverified' } })
    expect(verifyLabel(e).text).toBe('nothing to install')
  })
  it('parts-empty type (mcp) with version → nothing to install', () => {
    const e = mk({ type: 'mcp', verification: { status: 'unverified' } })
    expect(verifyLabel(e).text).toBe('nothing to install')
  })
  it('npm plugin entry still shows verify status (path exists)', () => {
    expect(verifyLabel(mk({ verification: { status: 'unverified' } })).text).toBe('unverified')
    expect(verifyLabel(mk({ verification: { status: 'failed' } })).cls).toBe('bad')
  })
  it('detailPage: failed github skill no longer contradicts its install hint', () => {
    const html = detailPage(ghSkill({ status: 'failed', level: 'install', runUrl: 'https://x.dev/r' }))
    expect(html).toContain('verification failed')
    expect(html).toContain('skills catalog')
    expect(html).not.toContain('nothing to install')
    expect(html).not.toContain('没有可安装的包')
  })
})

describe('§9 installHint/installPaths — single installPlan-parity rule', () => {
  it('github + latestVersion + malformed repo + skill → browse only (aligned edge)', () => {
    // previously `(latestVersion || ghRepo)` promised a catalog slot the
    // client cannot use; installPlan requires a VALID repo for github skills
    const e = mk({ latestVersion: '1.0.0', contains: ['skill'],
      source: { kind: 'github', id: 'x', repo: 'not a repo' } })
    expect(installHint(e)).toContain('browse only')
    expect(installHint(e)).not.toContain('skills catalog')
  })
  it('npm skill without version → browse only; with version → catalog link', () => {
    expect(installHint(mk({ contains: ['skill'], latestVersion: null }))).toContain('browse only')
    expect(installHint(mk({ contains: ['skill'], latestVersion: '2.0.0' }))).toContain('skills catalog')
  })
})

describe('§9 repoNameOf — Pages base-path segment', () => {
  it('handles https/.git/scp/ssh/trailing-slash/org-page forms', () => {
    expect(repoNameOf('https://github.com/o/r')).toBe('r')
    expect(repoNameOf('https://github.com/o/r.git')).toBe('r')
    expect(repoNameOf('https://github.com/o/r/')).toBe('r')          // was '' → base '/'
    expect(repoNameOf('git@github.com:o/r.git')).toBe('r')
    expect(repoNameOf('ssh://git@github.com/o/r.git')).toBe('r')
    expect(repoNameOf('https://github.com/o/r.git/')).toBe('r')
    expect(repoNameOf('https://gitlab.com/o/r')).toBe('r')           // host-agnostic
    expect(repoNameOf('')).toBe('')
    expect(repoNameOf('not a url')).toBe('')
  })
})
