/** L3a GUI verification: evaluate a plugin's gui bundle inside a jsdom DOM with
 *  a stubbed @opencode/plugin/gui host. Asserts the real failure modes —
 *  module crashes on import, requires a module the host whitelist doesn't
 *  provide, setup()/render() throws — without needing the desktop app.
 *  (serve web UI does NOT mount plugin guis; see docs/AI-DIAGNOSIS §5.)
 *
 *  Host contract the harness models:
 *    default export = Plugin.define({ setup(ctx), main(ctx) })
 *    setup: ctx.main(IpcDesc) → async client; ctx.add(Panel|SettingsPage|Command, factory)
 *    contribution factory → { render(): HTMLElement }
 *  Whitelisted requires: @opencode/plugin/gui (stub), effect, solid-js* (real,
 *  renderer-side modules the host provides). Anything else → load failure. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

export interface GuiCheck {
  ok: boolean
  /** 'evaluate' | 'setup' | 'render' | 'whitelist' — stage that failed */
  stage?: string
  error?: string
  registrations?: string[]
  rendered?: number
}

const GUI_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement',
  'HTMLTextAreaElement', 'Node', 'Element', 'SVGElement', 'DocumentFragment', 'CustomEvent',
  'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'DOMParser', 'XMLSerializer',
] as const
// host-provided conveniences a legit gui bundle may use — still NOT process,
// require, dynamic import(), or any node builtin
const HOST_GLOBALS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'console', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'structuredClone',
  'fetch', 'AbortSignal', 'AbortController', 'btoa', 'atob', 'performance',
] as const

const EVAL_TIMEOUT = 5_000
const STAGE_TIMEOUT = 8_000

/** Reject if `p` doesn't settle within `ms` — bounds async hangs inside
 *  untrusted setup()/render() (sync loops are already bound by the vm timeout). */
function deadline<T>(p: Promise<T> | T, ms: number, label: string): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<never>((_, rj) => setTimeout(() => rj(new Error(`${label} timed out`)), ms))])
}

/** Run a gui bundle's setup+render inside a fresh jsdom, evaluated in a
 *  node:vm realm so the module whitelist is REAL: the bundle has no
 *  process/require/import()/node builtins — only the globals we inject.
 *  (A `new Function` eval would leave all host globals reachable.)
 *  No globalThis mutation either — the old swap/restore machinery is gone. */
export async function checkGuiBundle(bundleSrc: string): Promise<GuiCheck> {
  const dom = new JSDOM('', { pretendToBeVisual: true, url: 'https://verify.local/' })
  const w = dom.window as unknown as Record<string, unknown>
  const registrations: { kind: string; contrib: Record<string, unknown> }[] = []
  try {
    // ---- whitelist require ----
    let Plugin: unknown, Ipc: unknown, contributionKinds: Record<string, { name: string }>
    class Contrib { static cname = 'Contribution' }
    class Panel extends Contrib { static override cname = 'Panel' }
    class SettingsPage extends Contrib { static override cname = 'SettingsPage' }
    class Command extends Contrib { static override cname = 'Command' }
    class MenuItem extends Contrib { static override cname = 'MenuItem' }
    class Tab extends Contrib { static override cname = 'Tab' }
    contributionKinds = { Panel, SettingsPage, Command, MenuItem, Tab }
    Plugin = { define: (def: unknown) => def }
    Ipc = { define: (desc: unknown) => desc }
    const effectModule = await import('effect').catch(() => null)
    const solidModule = await import('solid-js').catch(() => null)
    const solidWeb = await import('solid-js/web').catch(() => null)
    const reqmap: Record<string, unknown> = {
      '@opencode/plugin/gui': {
        Plugin, Ipc, Panel, SettingsPage, Command, MenuItem, Tab,
      },
    }
    if (effectModule) reqmap['effect'] = effectModule
    if (solidModule) {
      reqmap['solid-js'] = solidModule
      if (solidWeb) reqmap['solid-js/web'] = solidWeb
      reqmap['solid-js/store'] = solidModule
    }
    const req = (name: string): unknown => {
      if (name in reqmap) return reqmap[name]
      throw new Error(`module not in gui host whitelist: ${name}`)
    }

    // ---- sandbox: a fresh vm realm containing only what we inject ----
    const mod: { exports: Record<string, unknown> } = { exports: {} }
    const sandbox: Record<string, unknown> = { module: mod, exports: mod.exports, require: req }
    for (const k of GUI_GLOBALS) sandbox[k] = w[k]
    for (const k of HOST_GLOBALS) sandbox[k] = (w[k] ?? (globalThis as Record<string, unknown>)[k])
    const vctx = vm.createContext(sandbox)

    // ---- evaluate the bundle (CJS shape; ESM bundles arrive pre-wrapped) ----
    // importModuleDynamically: a bundle's dynamic import() fails with the same
    // deterministic whitelist error as require() instead of an obscure
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING (fire-and-forget import() would
    // otherwise surface as a stray unhandled rejection — see verifyShard's
    // process-level guard)
    const script = new vm.Script(bundleSrc, {
      filename: 'gui-bundle.cjs',
      importModuleDynamically: () => Promise.reject(new Error('module not in gui host whitelist: (dynamic import)')),
    })
    let def: { setup?: (ctx: unknown) => unknown } | undefined
    try {
      script.runInContext(vctx, { timeout: EVAL_TIMEOUT })
      def = (mod.exports.default ?? mod.exports) as typeof def
    } catch (e) {
      const msg = (e as Error).message
      return { ok: false, stage: msg.includes('whitelist') ? 'whitelist' : 'evaluate', error: msg }
    }
    if (typeof def?.setup !== 'function') {
      return { ok: false, stage: 'setup', error: 'default export has no setup(ctx)' }
    }

    // ---- run setup against the fake host ----
    // deep stub: every IPC method resolves a self-similar stub that never
    // crashes on access/call, iterates empty, length 0 — plugin-specific
    // fixtures don't scale, so gui code exercises its empty-data render path.
    const deepStub: unknown = new Proxy(function () {}, {
      get(_t, k) {
        if (k === Symbol.iterator) return function* () { /* empty */ }
        if (k === 'length' || k === 'size') return 0
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => ''
        if (k === 'then') return undefined // keep the stub non-thenable
        return deepStub
      },
      apply: () => deepStub,
      has: () => true,
    })
    const ctx = {
      main: () => new Proxy({}, { get: () => async () => deepStub }),
      add: (kind: { cname?: string; name: string }, factory: () => Record<string, unknown>) => {
        registrations.push({ kind: kind.cname ?? kind.name ?? String(kind), contrib: factory() })
      },
      sessions: { current: () => null, all: () => [] },
      config: () => ({}),
      log: () => {},
    }
    // run setup inside the realm too — a sync `while(1)` in plugin code must
    // die by the vm timeout, not hang the shard (Promise.race can't preempt
    // a blocked event loop)
    sandbox.__def = def
    sandbox.__ctx = ctx
    try {
      // async setups are legal — a contribution registered after an await
      // must still count, or every async plugin fails this gate falsely
      await deadline(vm.runInContext('__def.setup(__ctx)', vctx, { timeout: STAGE_TIMEOUT }) as Promise<unknown>, STAGE_TIMEOUT, 'setup')
    } catch (e) {
      return { ok: false, stage: 'setup', error: (e as Error).message, registrations: registrations.map(r => r.kind) }
    }
    if (registrations.length === 0) {
      return { ok: false, stage: 'setup', error: 'setup() registered no contributions', registrations: [] }
    }

    // ---- let async IPC settle, then render every contribution ----
    await new Promise(r => setTimeout(r, 500))
    let rendered = 0
    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i]!
      const render = reg.contrib['render']
      if (typeof render !== 'function') continue
      sandbox.__contrib = reg.contrib
      let el: unknown
      try {
        el = await deadline(vm.runInContext('__contrib.render()', vctx, { timeout: STAGE_TIMEOUT }) as Promise<unknown>, STAGE_TIMEOUT, `${reg.kind}.render`)
      } catch (e) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render threw: ${(e as Error).message}`, registrations: registrations.map(r => r.kind) }
      }
      if (!(el instanceof dom.window.HTMLElement)) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render() returned ${typeof el}, not HTMLElement`, registrations: registrations.map(r => r.kind) }
      }
      const elem = el as InstanceType<typeof dom.window.HTMLElement>
      if (elem.querySelectorAll('*').length === 0 && !(elem.textContent ?? '').trim()) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render() produced an empty element`, registrations: registrations.map(r => r.kind) }
      }
      rendered++
    }
    if (rendered === 0) {
      return { ok: false, stage: 'render', error: 'no contribution exposed a render() function', registrations: registrations.map(r => r.kind) }
    }
    return { ok: true, registrations: registrations.map(r => r.kind), rendered }
  } finally {
    dom.window.close()
  }
}

/** Locate the installed package dir under XDG_CACHE_HOME/opencode/npm and read
 *  its gui entrypoint (package.json exports key matching /gui/). */
export function findGuiBundle(home: string, name: string): { path: string; src: string } | { error: string } {
  const npmRoot = join(home, 'cache', 'opencode', 'npm')
  if (!existsSync(npmRoot)) return { error: `no plugin cache at ${npmRoot}` }
  // spec dirs are named by the bare package segment — a scoped '@s/p@ver'
  // spec dir can't exist ('/' isn't a valid path segment), it's 'p@ver'
  const norm = name.split('/').pop() ?? name
  let pkgDir: string | null = null
  for (const spec of readdirSync(npmRoot)) {
    if (!spec.startsWith(`${name}@`) && !spec.startsWith(`${norm}@`)) continue
    for (const ts of readdirSync(join(npmRoot, spec))) {
      const cand = join(npmRoot, spec, ts, 'node_modules', name)
      if (existsSync(join(cand, 'package.json'))) pkgDir = cand
      // scoped npm dir: node_modules/@scope/name
      const scoped = join(npmRoot, spec, ts, 'node_modules', ...name.split('/'))
      if (!pkgDir && existsSync(join(scoped, 'package.json'))) pkgDir = scoped
    }
  }
  if (!pkgDir) return { error: `installed package dir not found under ${npmRoot}` }
  let exportsMap: Record<string, unknown> = {}
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
    exportsMap = pj.exports ?? {}
  } catch (e) {
    return { error: `package.json unreadable: ${(e as Error).message}` }
  }
  const guiKey = Object.keys(exportsMap).find(k => /gui/.test(k))
  if (!guiKey) return { error: 'no gui export key in package.json' }
  const target = exportsMap[guiKey]
  const rel = typeof target === 'string' ? target
    : typeof target === 'object' && target ? (Object.values(target)[0] as string) : null
  if (!rel) return { error: `gui export ${guiKey} has no file target` }
  const file = join(pkgDir, rel)
  if (!existsSync(file)) return { error: `gui entrypoint missing: ${rel}` }
  return { path: file, src: readFileSync(file, 'utf8') }
}

/* v8 ignore next 8 — subprocess entry: sandboxed gui eval prints one JSON line */
if (import.meta.url === `file://${process.argv[1]}`) {
  checkGuiBundle(readFileSync(process.argv[2]!, 'utf8'))
    .then(r => { console.log(JSON.stringify(r)) })
    .catch(e => { console.log(JSON.stringify({ ok: false, stage: 'evaluate', error: String(e) })) })
}
