/** L3 mount infra — fake ctx + real jsdom DOM for gui.ts setup(). */
import { vi } from 'vitest'

export function makeApi(over: Record<string, unknown> = {}) {
  return {
    index: vi.fn(async () => ({ plugins: [{ name: '@x/old', latestVersion: '2.0.0', categories: [], contains: [] }] })),
    refreshIndex: vi.fn(async () => ({ plugins: [] })),
    installed: vi.fn(async () => ({ versions: { '@x/old': '1.0.0' }, extras: [], features: {} })),
    install: vi.fn(async () => 'ok'), update: vi.fn(async () => 'updated'),
    cancelInstall: vi.fn(async () => 'ok'), verifyActivation: vi.fn(async () => 'activated'),
    uninstall: vi.fn(async () => 'removed'),
    writeSkill: vi.fn(async () => 'ok'), uninstallSkill: vi.fn(async () => 'ok'),
    installSkillDir: vi.fn(async () => 'ok'), skillSource: vi.fn(async () => ({ url: '', enabled: false })),
    skillPermission: vi.fn(async () => ({})), devlog: vi.fn(async () => 'ok'), readDevlog: vi.fn(async () => ''),
    ...over,
  }
}
export function fakeCtx(api: ReturnType<typeof makeApi>) {
  const mounted: { content?: () => HTMLElement } = {}
  const ctx = {
    client: { plugin: { list: async () => ({ data: [] }), update: async () => {} } },
    main: () => api,
    add: (_m: unknown, o: { render?: () => HTMLElement }) => { if (o?.render) mounted.content = o.render },
    on: () => {},
    options: {},
    sessions: { current: () => null },
    layout: { open: () => {} },
  }
  return { ctx: ctx as never, mounted }
}
export const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 10)) }
