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
import { existsSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { isMain } from '../main-guard.ts'

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
    // the store API is a SEPARATE module from the reactive root — mapping it to
    // solidModule leaves createStore/produce/reconcile/unwrap undefined and a
    // legit store-using bundle fails setup() for a harness mistake
    const solidStore = await import('solid-js/store').catch(() => null)
    const reqmap: Record<string, unknown> = {
      '@opencode/plugin/gui': {
        Plugin, Ipc, Panel, SettingsPage, Command, MenuItem, Tab,
      },
    }
    if (effectModule) reqmap['effect'] = effectModule
    if (solidModule) {
      reqmap['solid-js'] = solidModule
      if (solidWeb) reqmap['solid-js/web'] = solidWeb
      if (solidStore) reqmap['solid-js/store'] = solidStore
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
  // spec dir can't exist ('/' isn't a valid path segment), it's 'p@ver'
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
    if (!dir.startsWith(`${name}@`) && !dir.startsWith(`${norm}@`) && !isGit) continue
    for (const ts of safeReaddir(join(npmRoot, dir))) {
      const nm = join(npmRoot, dir, ts, 'node_modules')
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
          if (!pkgDir) return { error: `ambiguous gui bundle under ${dir}: ${hits.map(h => h.split('/').pop()).join(', ')} — cannot identify the plugin's own` }
        } else {
          pkgDir = hits[0] ?? null
        }
        if (pkgDir) break
      }
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
  checkGuiBundle(readFileSync(process.argv[2]!, 'utf8'))
    .then(out, e => out({ ok: false, stage: 'evaluate', error: String(e) }))
}
