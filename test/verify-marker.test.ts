/** Serve-marker trust regression tests (F-3/F-4).
 *
 *  The load canary scrapes `server listening`/`server password` from serve's
 *  stdout — trusted only because the pinned host loads plugins LAZILY (no
 *  plugin code has run when those lines print). The pin test below forces a
 *  re-audit of that SECURITY ASSUMPTION whenever OPENCODE_VERSION is bumped;
 *  the marker tests pin the fail-closed behaviors around it. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPackage, type ExecFn, type SpawnFn } from '../pipeline/verify/verify.ts'
import { OPENCODE_VERSION } from '../pipeline/publish/merge.ts'

/** The SECURITY ASSUMPTION in verify.ts was audited against this host version.
 *  A bump here must fail until the lazy-load marker trust is re-verified.
 *
 *  Re-audit log:
 *  - 2.3.0 (2026-11-15): serve marker format identical (`server listening on
 *    http://127.0.0.1:N` / `server password X`). Live test with a plugin whose
 *    module prints forged listener lines at import: plugin load logs show it
 *    ran INSIDE the session-create request (lazy — no plugin code before the
 *    markers), AND plugin stdout/stderr never reaches serve's output at all
 *    (it goes to the opencode log file) — forging a marker is impossible even
 *    if a plugin ran early. `/api/plugin` shape verified compatible with
 *    apiPluginState: package entries carry source.type='package' +
 *    source.target=<install spec>. Plugin contract unchanged (both binaries
 *    enforce `export default {id, setup|effect}`). */
it('OPENCODE_VERSION stays pinned to the version the marker-trust was audited under', () => {
  expect(OPENCODE_VERSION,
    'host bumped — re-audit the SECURITY ASSUMPTION in pipeline/verify/verify.ts: ' +
    'the serve marker scrape trusts that no plugin code can run before the ' +
    'listening/password lines print (lazy load). If the new host loads eagerly, ' +
    'a plugin can print a forged listener pointing at its own socket.')
    .toBe('2.3.1')
})

const spawnOf = (out: string): SpawnFn => (() => ({
  stdout: { on: (_e: 'data', cb: (d: unknown) => void) => { cb(out) } },
  stderr: { on: () => {} },
  on: () => {},
  kill: () => {},
})) as unknown as SpawnFn

/** Install/lookup calls succeed; every curl fails like a dead socket. */
const deadApiExec = (async (cmd: string, args: string[]) => {
  if (cmd === 'curl') throw new Error('curl: (7) failed to connect — connection refused')
  if (cmd === 'opencode' && args[0] === '--version') return { stdout: 'opencode v2.3.0\n', stderr: '' }
  return { stdout: '', stderr: '' }
}) as unknown as ExecFn

const fast = { bootWaitMs: 60, apiWaitMs: 60 }

describe('serve marker trust (F-3/F-4)', () => {
  const vHome = () => mkdtempSync(join(tmpdir(), 'vmk-'))
  const LISTEN = 'server listening on http://127.0.0.1:4567\nserver password pw\n'

  it('a listener line with no answering socket is harness breakage, never a verdict', async () => {
    // today's shape of "marker scraped but socket dead" — the regression that
    // must hold: a marker alone can NEVER mint 'verified' OR 'failed'.
    await expect(verifyPackage('pkg', {
      version: '1.0.0', home: vHome(), execFn: deadApiExec,
      spawnFn: spawnOf(LISTEN), ...fast,
    })).rejects.toThrow(/never answered \/api\/plugin/)
  })

  it('conflicting listener/password markers → harness throw (F-4)', async () => {
    // an eagerly-loaded plugin (or upstream drift) printing a second listener
    // makes the scrape unprovable — both candidates are refused.
    const dual = 'server listening on http://127.0.0.1:4567\nserver password aaa\n' +
      'server listening on http://127.0.0.1:9999\nserver password bbb\n'
    await expect(verifyPackage('pkg', {
      version: '1.0.0', home: vHome(), execFn: deadApiExec,
      spawnFn: spawnOf(dual), ...fast,
    })).rejects.toThrow(/conflicting serve markers/)
  })

  it('two DISTINCT passwords alone also conflict', async () => {
    const dual = 'server listening on http://127.0.0.1:4567\nserver password aaa\nserver password bbb\n'
    await expect(verifyPackage('pkg', {
      version: '1.0.0', home: vHome(), execFn: deadApiExec,
      spawnFn: spawnOf(dual), ...fast,
    })).rejects.toThrow(/conflicting serve markers/)
  })

  it('identical repeated markers dedupe — a legit reprint is not a conflict', async () => {
    // passes the provenance check, then dies on the dead socket — the error
    // must NOT be the conflict one.
    await expect(verifyPackage('pkg', {
      version: '1.0.0', home: vHome(), execFn: deadApiExec,
      spawnFn: spawnOf(LISTEN + LISTEN), ...fast,
    })).rejects.toThrow(/never answered \/api\/plugin/)
  })
})
