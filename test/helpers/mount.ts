/** L3 mount infra — fake ctx + real jsdom DOM for gui.ts setup(). */
import { vi } from 'vitest'

export function makeApi(over: Record<string, unknown> = {}) {
  return {
    index: vi.fn(async () => ({ plugins: [{ name: '@x/old', latestVersion: '2.0.0', categories: [], contains: [] }, { name: '@y/new', latestVersion: '1.0.0', categories: [], contains: [] }] })),
    refreshIndex: vi.fn(async () => ({ plugins: [] })),
    installed: vi.fn(async () => ({ versions: { '@x/old': '1.0.0' }, extras: [], features: {} })),
    install: vi.fn(async () => 'ok'), update: vi.fn(async () => 'updated'),
    cancelInstall: vi.fn(async () => 'ok'), verifyActivation: vi.fn(async () => 'activated'),
    uninstall: vi.fn(async () => 'removed'),
    writeSkill: vi.fn(async () => 'ok'), uninstallSkill: vi.fn(async () => 'ok'),
    skillSource: vi.fn(async () => ({ url: '', enabled: false })),
    skillPermission: vi.fn(async () => ({})), devlog: vi.fn(async () => 'ok'), readDevlog: vi.fn(async () => ''),
    ...over,
  }
}
export function fakeCtx(api: ReturnType<typeof makeApi>) {
  const mounted: { content?: () => HTMLElement } = {}
  let dispose: (() => void) | undefined
  const render = () => {
    // insert/createEffect need an owner to track — wrap in createRoot
    const { createRoot } = require('solid-js') as typeof import('solid-js')
    let out!: HTMLElement
    createRoot(d => { dispose = d; out = mounted.content!() })
    return { el: out, dispose: dispose! }
  }
  const ctx = {
    client: { plugin: { list: async () => ({ data: [] }), update: async () => {} } },
    main: () => api,
    add: (_m: unknown, o: { render?: () => HTMLElement }) => { if (o?.render) mounted.content = o.render },
    on: () => {},
    options: {},
    sessions: { current: () => null },
    layout: { open: () => {} },
    system: { openExternal: vi.fn() },
  }
  return { ctx, mounted }
}
export const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 10)) }

/** Solid's runtime under vitest resolves SSR-side so signal-driven re-renders
 *  don't flush. Signals persist at module level — remount a fresh tree after
 *  an action to assert the new state. */
export async function remount(mounted: { content?: () => HTMLElement }) {
  const { createRoot } = await import('solid-js')
  let root!: HTMLElement
  createRoot(() => { root = mounted.content!() })
  return root
}
export const find = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text) || b.title === text || b.getAttribute('aria-label') === text) as HTMLButtonElement | undefined
