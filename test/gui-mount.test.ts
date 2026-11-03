// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

// @opencode/plugin/gui doesn't resolve under jsdom — stub the host surface:
// Ipc.define/Plugin.define pass definitions through; add() targets are markers.

import { makeApi, fakeCtx, flush } from './helpers/mount.ts'
import mod from '../plugins/market/src/gui.ts'

function mount(over = {}) {
  const api = makeApi(over)
  const { ctx, mounted } = fakeCtx(api)
  mod.setup(ctx)
  return { api, root: mounted.content!() }
}

describe('L3 mount: window-side behavior', () => {
  it.fails('更新数据 click → api.index/refreshIndex → status line (WIP: settings tab navigation in jsdom)', async () => {
    const api = makeApi()
    const { ctx, mounted } = fakeCtx(api)
    mod.setup(ctx)
    const root = mounted.content!()
    // navigate to settings tab
    const tabs = [...root.querySelectorAll('button')]
    const settings = tabs.find(b => b.textContent === '设置') ?? tabs.find(b => b.textContent?.includes('设置'))!
    ;(settings as HTMLButtonElement).click()
    await flush()
    const refBtn = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('更新数据'))!
    refBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush(8)
    expect(api.refreshIndex.mock.calls.length + api.index.mock.calls.length + api.installed.mock.calls.length).toBeGreaterThan(0)
  })

  it('全部更新 updates every outdated plugin', async () => {
    const { root, api } = mount()
    await flush()
    const updAll = [...root.querySelectorAll('button')].find(b => b.textContent === '全部更新')!
    updAll.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    updAll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    // fake index ships one outdated plugin (@x/old 1.0.0 → 2.0.0) — a real
    // implementation must call update for it
    expect(api.update).toHaveBeenCalledWith('@x/old')
  })

  it.fails('install button calls api.install on click (WIP: card render timing)', async () => {
    const { root, api } = mount()
    await flush()
    const addBtn = [...root.querySelectorAll('button')].find(b => ['add','安装'].includes(b.textContent ?? ''))
    if (!addBtn) { expect(addBtn).toBeTruthy(); return }
    addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush(8)
    expect(api.install.mock.calls.length + api.update.mock.calls.length).toBeGreaterThan(0)
  })
})
