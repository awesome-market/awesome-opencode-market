// guiRuntime stages the sandboxed gui-eval harness (gui.ts + main-guard.ts +
// tsx/jsdom) under tmpdir — the sandbox uid can't necessarily read the repo
// checkout, which is what killed every render check with ERR_MODULE_NOT_FOUND.
// Contract: stage once per process, fall back to null on failure, and RETRY
// after a failure so one npm blip doesn't disable staging for the shard.
// Tests run in order: the failing stage MUST come first — a cached success
// would make the failure path unreachable within this module instance.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { guiRuntime, type GuiExecFn } from '../pipeline/verify/gui.ts'

const okExec: GuiExecFn = async () => ({ stdout: '', stderr: '' })
const failExec: GuiExecFn = async () => { throw new Error('npm exploded') }

describe('guiRuntime staging', () => {
  it('a failed stage returns null and clears the cache for retry', async () => {
    expect(await guiRuntime(failExec)).toBeNull()
  })
  it('the next call re-stages instead of serving the cached failure', async () => {
    const rt = await guiRuntime(okExec)
    expect(rt).not.toBeNull()
    expect(rt!.cwd).toContain('om-gui-rt-')
    expect(existsSync(join(rt!.cwd, 'pipeline', 'verify', 'gui.ts'))).toBe(true)
    expect(existsSync(join(rt!.cwd, 'pipeline', 'main-guard.ts'))).toBe(true)
    // the staged gui.ts is a real copy — its isMain entry must still work
    expect(readFileSync(join(rt!.cwd, 'pipeline', 'verify', 'gui.ts'), 'utf8')).toContain('checkGuiBundle')
    // and the singleton is now sticky — a later failing exec is ignored
    expect(await guiRuntime(failExec)).toEqual(rt)
  })
})
