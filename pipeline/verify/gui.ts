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

/** Run a gui bundle's setup+render inside a fresh jsdom. Self-contained by
 *  design — never leaves mutated globals behind (finally-restore). */
export async function checkGuiBundle(bundleSrc: string): Promise<GuiCheck> {
  const dom = new JSDOM('', { pretendToBeVisual: true, url: 'https://verify.local/' })
  const w = dom.window as unknown as Record<string, unknown>
  // descriptor-level swap: several globals (navigator…) are getter-only in Node
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const k of GUI_GLOBALS) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k))
    Object.defineProperty(globalThis, k, { value: w[k], writable: true, configurable: true, enumerable: true })
  }
  const registrations: { kind: string; contrib: Record<string, unknown> }[] = []
  try {
    // ---- whitelist require ----
    let Plugin: unknown, Ipc: unknown, contributionKinds: Record<string, { name: string }>
    const guiHost = {
      get Plugin() { return Plugin },
      get Ipc() { return Ipc },
      get kinds() { return contributionKinds },
    }
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

    // ---- evaluate the bundle (CJS shape; ESM bundles arrive pre-wrapped) ----
    const mod: { exports: Record<string, unknown> } = { exports: {} }
    let def: { setup?: (ctx: unknown) => void } | undefined
    try {
      new Function('module', 'exports', 'require', bundleSrc)(mod, mod.exports, req)
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
    try {
      def.setup(ctx)
    } catch (e) {
      return { ok: false, stage: 'setup', error: (e as Error).message, registrations: registrations.map(r => r.kind) }
    }
    if (registrations.length === 0) {
      return { ok: false, stage: 'setup', error: 'setup() registered no contributions', registrations: [] }
    }

    // ---- let async IPC settle, then render every contribution ----
    await new Promise(r => setTimeout(r, 500))
    let rendered = 0
    for (const reg of registrations) {
      const render = reg.contrib['render']
      if (typeof render !== 'function') continue
      let el: unknown
      try {
        el = (render as () => unknown).call(reg.contrib)
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
    for (const k of GUI_GLOBALS) {
      const d = saved.get(k)
      if (d) Object.defineProperty(globalThis, k, d)
      else delete (globalThis as Record<string, unknown>)[k]
    }
    dom.window.close()
  }
}

/** Locate the installed package dir under XDG_CACHE_HOME/opencode/npm and read
 *  its gui entrypoint (package.json exports key matching /gui/). */
export function findGuiBundle(home: string, name: string): { path: string; src: string } | { error: string } {
  const npmRoot = join(home, 'cache', 'opencode', 'npm')
  if (!existsSync(npmRoot)) return { error: `no plugin cache at ${npmRoot}` }
  const norm = name.startsWith('@') ? name : name.split('/').pop() ?? name
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
