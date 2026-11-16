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
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { isMain } from '../main-guard.ts'

const execFileP = promisify(execFile)

export interface GuiCheck {
  ok: boolean
  /** 'evaluate' | 'setup' | 'render' | 'whitelist' — stage that failed */
  stage?: string
  error?: string
  registrations?: string[]
  rendered?: number
}

/** The gui-eval subprocess runs UNTRUSTED bundle code as the sandbox uid —
 *  but the harness itself (gui.ts, tsx, jsdom) lived under the repo checkout,
 *  which the sandbox uid cannot necessarily read: `node --import tsx` from
 *  the checkout resolved ERR_MODULE_NOT_FOUND on every render check (83/83
 *  failed/render in the catalog). Stage a minimal runtime under os.tmpdir()
 *  — world-traversable — once per shard process: our two pipeline files plus
 *  tsx/jsdom/effect/solid-js installed at the versions this checkout actually
 *  uses. Returns
 *  null on any staging failure so the caller falls back to repo paths
 *  (local dev, where the uid can read the checkout, keeps working). */
export interface GuiRuntime { cwd: string; guiEntry: string }
export type GuiExecFn = (cmd: string, args: string[], o?: { timeout?: number; maxBuffer?: number }) => Promise<{ stdout: string; stderr: string }>
let runtimePromise: Promise<GuiRuntime | null> | null = null
export function guiRuntime(exec: GuiExecFn = execFileP as GuiExecFn): Promise<GuiRuntime | null> {
  const p = runtimePromise ?? (async (): Promise<GuiRuntime | null> => {
    try {
      const rt = join(tmpdir(), `om-gui-rt-${process.pid}`)
      const vdir = join(rt, 'pipeline', 'verify')
      mkdirSync(vdir, { recursive: true })
      copyFileSync(fileURLToPath(import.meta.url), join(vdir, 'gui.ts'))
      copyFileSync(fileURLToPath(new URL('../main-guard.ts', import.meta.url)), join(rt, 'pipeline', 'main-guard.ts'))
      // pin to the versions THIS checkout resolved — the harness behavior
      // (tsx transpile, jsdom DOM, and the host modules the whitelist maps:
      // effect + solid-js*) should match what the repo tests against. A
      // staged runtime WITHOUT them makes every solid-js gui bundle fail
      // 'module not in gui host whitelist' — a harness false-failure, not a
      // package defect (the first staged-runtime wave: 80/80 render fails).
      const req = createRequire(import.meta.url)
      const ver = (p: string) => (req(`${p}/package.json`) as { version: string }).version
      await exec('npm', ['install', '--prefix', rt, '--no-save', '--no-audit', '--no-fund',
        '--ignore-scripts', '--loglevel=error',
        `tsx@${ver('tsx')}`, `jsdom@${ver('jsdom')}`, `effect@${ver('effect')}`, `solid-js@${ver('solid-js')}`],
        { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
      return { cwd: rt, guiEntry: join(vdir, 'gui.ts') }
    } catch { return null }
  })()
  runtimePromise = p
  // a failed stage (npm blip) must not disable staging for the whole shard —
  // clear the cache so the next gui target retries
  return p.then(r => { if (r === null) runtimePromise = null; return r })
}

const GUI_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement',
  'HTMLTextAreaElement', 'Node', 'Element', 'SVGElement', 'DocumentFragment', 'CustomEvent',
  'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'DOMParser', 'XMLSerializer',
  // constructors real bundles instanceof/extend against
  'Document', 'Range', 'NodeFilter', 'XPathEvaluator', 'XPathResult', 'ShadowRoot',
  'DOMTokenList', 'HTMLCollection', 'NodeList', 'FileReader', 'Blob', 'File', 'FormData',
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
/** Untrusted bundle size bound: nothing upstream caps an individual gui
 *  entrypoint — a multi-MB file can hang `new vm.Script` compilation (the
 *  eval timeout only covers runInContext, not compile) or OOM the shard.
 *  Real gui bundles are far smaller; refuse honestly instead of dying
 *  mid-shard and taking the lane's remaining targets with it. */
const GUI_BUNDLE_MAX = 8 * 1024 * 1024

/** Reject if `p` doesn't settle within `ms` — bounds async hangs inside
 *  untrusted setup()/render() (sync loops are already bound by the vm timeout). */
function deadline<T>(p: Promise<T> | T, ms: number, label: string): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<never>((_, rj) => setTimeout(() => rj(new Error(`${label} timed out`)), ms))])
}

/** Error→string that digs through `.cause`. Solid-js wraps errors thrown
 *  inside reactive computations via castError() — and errors created inside
 *  the vm realm are NOT instanceof the host realm's Error, so a vm-realm
 *  TypeError surfaces as 'Unknown error' with the REAL message hiding in
 *  .cause. Duck-type (message:string) rather than instanceof for exactly
 *  that cross-realm reason. */
export function errorDetail(e: unknown): string {
  const parts: string[] = []
  let cur: unknown = e
  for (let i = 0; i < 3 && cur != null; i++) {
    const msg = typeof (cur as { message?: unknown }).message === 'string' ? (cur as { message: string }).message : String(cur)
    if (!parts.includes(msg)) parts.push(msg)
    cur = (cur as { cause?: unknown }).cause
  }
  return parts.join(' (cause: ') + (parts.length > 1 ? ')'.repeat(parts.length - 1) : '')
}

/** Run a gui bundle's setup+render inside a fresh jsdom, evaluated in a
 *  node:vm realm so the module whitelist is REAL: the bundle has no
 *  process/require/import()/node builtins — only the globals we inject.
 *  (A `new Function` eval would leave all host globals reachable.)
 *  No globalThis mutation in the default path — the old swap/restore
 *  machinery is gone. The dedicated subprocess entry passes domGlobals:true:
 *  solid-js/web's BROWSER build (selected via --conditions=browser) resolves
 *  `document`/`window` on Node's globalThis at CALL time, so the jsdom globals
 *  must exist there too — pollution is contained because the subprocess
 *  evaluates exactly one bundle then hard-exits.
 *  ONLY GUI_GLOBALS are installed: HOST_GLOBALS (setTimeout & friends) must
 *  stay Node's — jsdom's window.setTimeout internally calls the bare global
 *  setTimeout, so clobbering it recurses until stack overflow. */
export async function checkGuiBundle(bundleSrc: string, opts: { domGlobals?: boolean } = {}): Promise<GuiCheck> {
  const dom = new JSDOM('', { pretendToBeVisual: true, url: 'https://verify.local/' })
  const w = dom.window as unknown as Record<string, unknown>
  if (opts.domGlobals) {
    const g = globalThis as Record<string, unknown>
    for (const k of GUI_GLOBALS) {
      let v: unknown
      try { v = w[k] } catch { continue } // e.g. localStorage on opaque origins
      if (v === undefined) continue
      try { g[k] = v } catch {
        // Node 21+ ships getter-only globals (navigator…) — plain assignment
        // throws; redefine when configurable, else keep the host value
        try { Object.defineProperty(g, k, { value: v, writable: true, configurable: true }) } catch { /* keep host */ }
      }
    }
  }
  const registrations: { kind: string; contrib: Record<string, unknown> }[] = []
  try {
    // ---- whitelist require ----
    // deep stub: every unmodeled host-API method resolves a self-similar stub
    // that never crashes on access/call, iterates empty, length 0 —
    // plugin-specific fixtures don't scale, so gui code exercises its
    // empty-data render path. Defined before the host-module proxies below —
    // they reference it lazily through closures.
    // Two-tier stubs: solid's insertExpression unwraps JSX functions with
    // `while (typeof v === 'function') v = v()` — if a stub value lands in a
    // JSX slot and stub() returns another FUNCTION, the host's own unwrapper
    // loops forever (observed: every 'render timed out' was this). deepStub
    // is callable but its apply returns objStub — a non-callable object whose
    // property access still returns deepStub, so a.b().c.d() chains keep
    // working while the unwrapper terminates after one call.
    const objStub: unknown = new Proxy({}, {
      get(_t, k) {
        if (k === Symbol.iterator) return function* () { /* empty */ }
        if (k === 'length' || k === 'size') return 0
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => ''
        if (k === 'then') return undefined
        // solid checks `value.nodeType` before insertBefore — a truthy stub
        // here makes the host's own DOM code throw 'not of type Node';
        // falsy falls through to the ignored-value branch, which is what a
        // stub in a JSX slot should do (renders nothing, keeps going)
        if (k === 'nodeType') return undefined
        return deepStub
      },
      has: () => true,
    })
    const deepStub: unknown = new Proxy(function () {}, {
      get(_t, k) {
        if (k === Symbol.iterator) return function* () { /* empty */ }
        if (k === 'length' || k === 'size') return 0
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => ''
        if (k === 'then') return undefined // keep the stub non-thenable
        return deepStub
      },
      apply: () => objStub,
      has: () => true,
    })
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
    // @opencode/plugin/rpc re-exports Rpc from @opencode/schema/rpc — same
    // define-tag shape as Ipc; 35/52 whitelist fails in the first honest
    // render wave were bundles legitimately requiring it
    const Rpc = { define: (desc: unknown) => desc }
    // The real @opencode/plugin/gui surface is far larger than the modeled
    // contract (Badge/FileTree/Pairing/usePlugin/usePanel/createKeyed/...).
    // A bundle requiring an unmodeled export used to die 'cname of undefined'
    // inside ctx.add — a harness false-fail. Unknown names get a callable
    // stub that also carries a cname tag so ctx.add(Whatever, f) registers;
    // known keys keep their precise stubs (Plugin.define MUST stay identity —
    // a deepStub return would silently eat the plugin definition).
    const contribStub = (name: string): unknown => new Proxy(function () {}, {
      get(_t, k) {
        if (k === 'cname' || k === 'name') return name
        if (k === Symbol.iterator) return function* () { /* empty */ }
        if (k === 'length' || k === 'size') return 0
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => name
        if (k === 'then') return undefined
        return deepStub
      },
      apply: () => deepStub,
      construct: () => deepStub as object,
      has: () => true,
    })
    const hostModule = (base: Record<string, unknown>): unknown => new Proxy(base, {
      // 'then' must stay undefined — a truthy callable then makes the module
      // object a thenable and `await require('@opencode/plugin/gui')` hangs
      // until the stage timeout instead of resolving
      get(t, k) { return k === 'then' ? undefined : (k in t ? t[k as string] : contribStub(String(k))) },
      has: () => true,
    })
    const effectModule = await import('effect').catch(() => null)
    const solidModule = await import('solid-js').catch(() => null)
    const solidWeb = await import('solid-js/web').catch(() => null)
    // the store API is a SEPARATE module from the reactive root — mapping it to
    // solidModule leaves createStore/produce/reconcile/unwrap undefined and a
    // legit store-using bundle fails setup() for a harness mistake
    const solidStore = await import('solid-js/store').catch(() => null)
    const reqmap: Record<string, unknown> = {
      '@opencode/plugin': hostModule({}),
      '@opencode/plugin/gui': hostModule({
        Plugin, Ipc, Panel, SettingsPage, Command, MenuItem, Tab,
      }),
      '@opencode/plugin/rpc': hostModule({ Rpc }),
      // the solid client bindings gui plugins use to reach the host — same
      // unmodeled-surface problem, same fallback (1 whitelist fail observed)
      '@opencode/client/solid': hostModule({}),
    }
    if (effectModule) {
      reqmap['effect'] = effectModule
      // @opencode/plugin/effect re-exports the host's effect — give bundles
      // the REAL module, not a stub
      reqmap['@opencode/plugin/effect'] = effectModule
    }
    if (solidModule) {
      reqmap['solid-js'] = solidModule
      if (solidWeb) reqmap['solid-js/web'] = solidWeb
      if (solidStore) reqmap['solid-js/store'] = solidStore
    }
    // @opencode/plugin@2.3.0's real export surface: '.' + './*' wildcard over
    // every dist file, while './gui/*' is null-blocked except the explicit
    // subpaths. Model that exactly — a require outside either list is NOT
    // importable on the real host either, so the whitelist error stands.
    const PLUGIN_SUBS = new Set([
      'rpc', 'tui', 'host', 'effect', 'runtime', 'runtime-modules', 'app',
      'options', 'permission', 'storage', 'worktree', 'promise',
      'source', 'source.node', 'source.bun', 'source.package',
    ])
    const GUI_SUBS = new Set(['review', 'main', 'vite', 'browser', 'builtin', 'updater', 'file'])
    const req = (name: string): unknown => {
      if (name in reqmap) return reqmap[name]
      if (name.startsWith('@opencode/plugin/gui/')) {
        if (GUI_SUBS.has(name.slice(21))) return hostModule({})
        throw new Error(`module not in gui host whitelist: ${name}`)
      }
      if (name.startsWith('@opencode/plugin/') && PLUGIN_SUBS.has(name.slice(17))) return hostModule({})
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
    let script: vm.Script
    try {
      script = new vm.Script(bundleSrc, {
        filename: 'gui-bundle.cjs',
        importModuleDynamically: () => Promise.reject(new Error('module not in gui host whitelist: (dynamic import)')),
      })
    } catch (e) {
      // a syntactically broken bundle must record 'failed', not crash the
      // whole verify shard — compile errors land here, evaluate errors below
      return { ok: false, stage: 'evaluate', error: (e as Error).message }
    }
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
    // The real SetupContext is a large surface (layout/sessions/screen/t/ui/
    // toasts/dialogs/storage/provide/use/… — every host API is a property);
    // a bundle reading an unmodeled one died 'X of undefined' at setup.
    // Same fix as the module proxies: modeled keys stay real, unknown keys
    // resolve callable contrib stubs.
    const ctx = hostModule({
      main: () => new Proxy({}, { get: () => async () => deepStub }),
      // real signature is overloaded: add(registry, () => item) OR
      // add(registry, item) — and the factory may return undefined for
      // conditional registrations (core.d.ts: `() => (shown() ? pill :
      // undefined)`). Returns a Cleanup like the host.
      add: (kind: { cname?: string; name: string } | undefined, item: unknown) => {
        const contrib = typeof item === 'function' ? (item as () => unknown)() : item
        registrations.push({ kind: kind?.cname ?? kind?.name ?? 'unknown', contrib: (contrib ?? {}) as Record<string, unknown> })
        return () => {}
      },
      // current() must return a stub, not null — bundles read
      // `ctx.sessions.current().session` inside reactive memos and a null
      // here masquerades as a plugin crash in render()
      sessions: { current: () => deepStub, all: () => [] },
      config: () => ({}),
      log: () => {},
    })
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
      return { ok: false, stage: 'setup', error: errorDetail(e), registrations: registrations.map(r => r.kind) }
    }
    if (registrations.length === 0) {
      return { ok: false, stage: 'setup', error: 'setup() registered no contributions', registrations: [] }
    }

    // ---- let async IPC settle, then render every contribution ----
    await new Promise(r => setTimeout(r, 500))
    let rendered = 0
    // contributions' render(props) receives real props on the host
    // (PanelProps.tab/session are reactive getters, screen/focus/close…);
    // passing nothing crashes every bundle that reads them. A deepStub prop
    // object covers the whole PanelProps surface.
    sandbox.__props = deepStub
    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i]!
      const render = reg.contrib['render']
      if (typeof render !== 'function') continue
      sandbox.__contrib = reg.contrib
      let el: unknown
      try {
        el = await deadline(vm.runInContext('__contrib.render(__props)', vctx, { timeout: STAGE_TIMEOUT }) as Promise<unknown>, STAGE_TIMEOUT, `${reg.kind}.render`)
      } catch (e) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render threw: ${errorDetail(e)}`, registrations: registrations.map(r => r.kind) }
      }
      // JSX.Element legitimately includes a component function — mount it
      // through the real Solid renderer instead of failing on typeof
      if (typeof el === 'function' && solidWeb) {
        const mount = dom.window.document.createElement('div')
        try {
          (solidWeb as { render: (code: () => unknown, into: unknown) => unknown }).render(el as () => unknown, mount)
        } catch (e) {
          return { ok: false, stage: 'render', error: `${reg.kind}.render component mount threw: ${errorDetail(e)}`, registrations: registrations.map(r => r.kind) }
        }
        el = mount
      }
      // Node covers HTMLElement, DocumentFragment, Text — all valid JSX output
      if (!(el instanceof dom.window.Node)) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render() returned ${typeof el}, not a DOM Node`, registrations: registrations.map(r => r.kind) }
      }
      const elem = el as InstanceType<typeof dom.window.HTMLElement>
      if (elem.querySelectorAll('*').length === 0 && !(elem.textContent ?? '').trim()) {
        return { ok: false, stage: 'render', error: `${reg.kind}.render() produced an empty element`, registrations: registrations.map(r => r.kind) }
      }
      rendered++
    }
    // setup succeeded and ≥1 contribution registered but none are renderable
    // (Command/MenuItem/Style-only plugins have nothing to render — that is
    // a legal shape per registries.d.ts, not a package defect). Failing here
    // would call valid command-only plugins broken.
    return { ok: true, registrations: registrations.map(r => r.kind), rendered }
  } finally {
    dom.window.close()
  }
}

/** opencode's npm-cache key for a git spec — mirrors the host's install
 *  layout (util/npm.ts `key()`): `git-<basename>-<sha256(spec).hex[0:12]>`.
 *  Compute it so `plugin add owner/repo#sha` installs are found — the
 *  name@version dirs only ever cover registry specs. */
function gitSpecDir(spec: string): string {
  let target = spec.split('#')[0] ?? spec
  try { target = decodeURIComponent(target) } catch { /* keep raw */ }
  const slug = target.replace(/\.git$/i, '').split(/[/:\\]/).at(-1)
    ?.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repository'
  return `git-${slug}-${createHash('sha256').update(spec).digest('hex').slice(0, 12)}`
}

/** Under an installed tree's node_modules, find packages carrying a gui
 *  export — a git install nests under the package's OWN package.json name,
 *  which needn't equal the repo name the entry is catalogued under. */
function scanForGuiPackage(nm: string): string[] {
  if (!existsSync(nm)) return []
  const roots: string[] = []
  // every readdirSync is inside the installed tree — plugin-influenced
  // content (a file named '@scope', a deleted dir raced mid-read) throwing
  // ENOTDIR/ENOENT would escape findGuiBundle as a shard-level crash, which
  // the lane records as harness:true — the package is then unverifiable
  // forever (every retry crashes identically) instead of failing honestly
  const safeReaddir = (d: string): string[] => {
    try { return readdirSync(d) } catch { return [] }
  }
  for (const top of safeReaddir(nm)) {
    if (top.startsWith('.')) continue
    if (top.startsWith('@')) for (const s of safeReaddir(join(nm, top))) roots.push(join(top, s))
    else roots.push(top)
  }
  return roots.filter(r => {
    try {
      const pj = JSON.parse(readFileSync(join(nm, r, 'package.json'), 'utf8')) as { exports?: Record<string, unknown> }
      return Object.keys(pj.exports ?? {}).some(k => /gui/.test(k))
    } catch { return false }
  }).map(r => join(nm, r))
}

/** Resolve a conditional-exports target to a runnable file. The naive pick
 *  (Object.values(target)[0]) breaks two real layouts: "types"-first objects
 *  resolve to a .d.ts declaration (guaranteed vm compile failure), and NESTED
 *  conditions ({import:{default:"./x.js"}}) yield a non-string value that
 *  crashes path.join entirely — the slot then re-queues forever because merge
 *  never sees a result for it. Prefer the runtime conditions, skip 'types'
 *  (compile-time metadata, never the executable bundle), recurse into nested
 *  condition objects and fallback arrays. */
export function resolveExportTarget(t: unknown, depth = 0): string | null {
  if (typeof t === 'string') return /\.d\.[cm]?ts$/.test(t) ? null : t
  if (depth > 4 || !t || typeof t !== 'object') return null
  if (Array.isArray(t)) {
    for (const v of t) { const r = resolveExportTarget(v, depth + 1); if (r) return r }
    return null
  }
  const o = t as Record<string, unknown>
  for (const k of ['browser', 'import', 'default', 'node', 'require', 'worker']) {
    const r = resolveExportTarget(o[k], depth + 1)
    if (r) return r
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'types') continue
    const r = resolveExportTarget(v, depth + 1)
    if (r) return r
  }
  return null
}

/** Locate the installed package dir under XDG_CACHE_HOME/opencode/npm and read
 *  its gui entrypoint (package.json exports key matching /gui/). `spec` is
 *  the install spec actually given to `plugin add` — for git targets the
 *  cache dir keys on it, not on the entry name. */
export function findGuiBundle(home: string, name: string, spec?: string): { path: string; src: string } | { error: string } {
  const npmRoot = join(home, 'cache', 'opencode', 'npm')
  if (!existsSync(npmRoot)) return { error: `no plugin cache at ${npmRoot}` }
  // spec dirs are named by the bare package segment — a scoped '@s/p@ver'
  // spec dir can't exist ('/' isn't a valid path segment). opencode ≥2.3
  // nests scoped installs one level deep: npm/@scope/<name@ver>/<ts>/… —
  // flatten that level so 'opencode-cost@latest' is seen as a candidate.
  const norm = name.split('/').pop() ?? name
  const gitDir = spec ? gitSpecDir(spec) : null
  let pkgDir: string | null = null
  const safeReaddir = (d: string): string[] => {
    try { return readdirSync(d) } catch { return [] }
  }
  for (const dir of safeReaddir(npmRoot)) {
    // name-prefix dirs pin the package name — a 'p@x' dir that turns out to
    // hold package 'p' must NOT vouch for '@s/p'. The any-package scan only
    // applies inside the git spec dir, where the installed package name
    // legitimately differs from the entry name.
    const isGit = gitDir !== null && dir === gitDir
    const inner = !isGit && dir.startsWith('@')
      ? safeReaddir(join(npmRoot, dir)).map(s => `${dir}/${s}`)
      : [dir]
    for (const d of inner) {
      const base = d.split('/').pop() ?? d
      if (!isGit && !base.startsWith(`${name}@`) && !base.startsWith(`${norm}@`)) continue
      for (const ts of safeReaddir(join(npmRoot, d))) {
        const nm = join(npmRoot, d, ts, 'node_modules')
        const cand = join(nm, name)
        if (existsSync(join(cand, 'package.json'))) { pkgDir = cand; break }
        if (isGit) {
          // every gui-export package under the install tree is a candidate —
          // including DEPENDENCIES, which can carry a gui export and sort ahead
          // of the real one. Prefer the package whose name matches the repo's
          // basename; several non-matching candidates = unprovable which one is
          // the plugin — honest error over measuring the wrong bundle.
          const hits = scanForGuiPackage(nm)
          if (hits.length > 1) {
            const repoBase = spec?.split('#')[0]?.split('/').pop()?.toLowerCase()
            const hit = repoBase
              ? hits.find(h => h.split('/').pop()?.toLowerCase() === repoBase)
              : undefined
            pkgDir = hit ?? null
            if (!pkgDir) return { error: `ambiguous gui bundle under ${d}: ${hits.map(h => h.split('/').pop()).join(', ')} — cannot identify the plugin's own` }
          } else {
            pkgDir = hits[0] ?? null
          }
          if (pkgDir) break
        }
      }
      if (pkgDir) break
    }
    if (pkgDir) break
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
  const rel = resolveExportTarget(exportsMap[guiKey])
  if (!rel) return { error: `gui export ${guiKey} has no file target` }
  const file = join(pkgDir, rel)
  // exports targets are package-relative — a crafted "../" must not read
  // outside the installed package dir (the host wouldn't resolve it either)
  if (!file.startsWith(`${pkgDir}/`)) return { error: `gui export ${guiKey} escapes the package dir` }
  if (!existsSync(file)) return { error: `gui entrypoint missing: ${rel}` }
  const bytes = statSync(file).size
  if (bytes > GUI_BUNDLE_MAX) {
    return { error: `gui entrypoint too large to evaluate (${bytes} bytes > ${GUI_BUNDLE_MAX}-byte cap)` }
  }
  return { path: file, src: readFileSync(file, 'utf8') }
}

/* v8 ignore next 14 — subprocess entry: sandboxed gui eval prints one JSON line */
if (isMain(import.meta.url)) {
  // The parent takes the LAST stdout line as the verdict. Untrusted bundle
  // code shares this process's console/setTimeout (HOST_GLOBALS) — a pending
  // timer could print a forged '{"ok":true}' AFTER our result and win the
  // `.at(-1)` parse, or keep the process alive to the 90s urun timeout.
  // Synchronous write + hard exit leaves no async gap: the harness result is
  // always the final line and leftover untrusted timers never fire.
  const out = (r: unknown) => {
    writeSync(1, JSON.stringify(r) + '\n')
    process.exit(0)
  }
  checkGuiBundle(readFileSync(process.argv[2]!, 'utf8'), { domGlobals: true })
    .then(out, e => out({ ok: false, stage: 'evaluate', error: String(e) }))
}
