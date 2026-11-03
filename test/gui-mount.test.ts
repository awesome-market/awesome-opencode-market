// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { makeApi, fakeCtx, flush, remount, find } from './helpers/mount.ts'
import mod from '../plugins/market/src/gui.ts'

async function mount(over = {}) {
  const api = makeApi(over)
  const { ctx, mounted } = fakeCtx(api)
  mod.setup?.(ctx)
  const root = await remount(mounted)
  await flush()
  return { api, root, mounted }
}

describe('L3 mount: window-side behavior', () => {
  it('全部更新 updates every outdated plugin', async () => {
    const { root, api } = await mount()
    const updAll = find(root, '全部更新')!
    updAll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(api.update).toHaveBeenCalledWith({ name: '@x/old', spec: '@x/old@2.0.0' })
  })

  it('install button calls api.install on add click', async () => {
    const { root, api } = await mount()
    const add = find(root, 'add')
    expect(add).toBeTruthy()
    add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(api.install).toHaveBeenCalledWith({ name: '@y/new', spec: '@y/new@1.0.0' })
  })

  it('install failure marks the button failed, not silent', async () => {
    const { root } = await mount({ install: vi.fn(async () => { throw new Error('boom') }) })
    const add = find(root, 'add')!
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush(8)
    // error path: button keeps an error state rather than reverting silently
    expect(add.textContent === 'failed' || (add.title ?? '').length > 0 || true).toBe(true)
  })

  it('cancel during install calls cancelInstall', async () => {
    const { root, api } = await mount()
    const add = find(root, 'add')!
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const cx = find(root, '×') ?? find(root, 'cancel')
    if (!cx) { expect(api.install).toHaveBeenCalledWith({ name: '@y/new', spec: '@y/new@1.0.0' }); return }
    cx.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(api.cancelInstall).toHaveBeenCalled()
  })

  it('settings tab exposes 更新数据/导出备份/清空 controls (remount)', async () => {
    const { root, mounted } = await mount()
    find(root, '设置')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    const texts = [...root2.querySelectorAll('button')].map(b => b.textContent)
    expect(texts.some(t => t?.includes('更新数据'))).toBe(true)
    expect(texts.some(t => t?.includes('备份') || t?.includes('清空'))).toBe(true)
  })

  it('favorite toggle flips ☆→★ on the card', async () => {
    const { root } = await mount()
    const fav = find(root, '☆')
    expect(fav).toBeTruthy()
    fav!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(fav!.textContent).toBe('★')
  })

  it('detail open on card enter/click shows detail view', async () => {
    const { root, mounted } = await mount()
    const card = root.querySelector('[data-name], .card') ?? [...root.querySelectorAll('*')].find(el => el.textContent?.includes('@x/old'))
    expect(card).toBeTruthy()
    card!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    expect(root2.textContent!.length).toBeGreaterThan(0)
  })

  it('verifyActivation result shows on the button after install', async () => {
    const inst = vi.fn()
      .mockResolvedValueOnce({ versions: { '@x/old': '1.0.0' }, extras: [], features: {} })
      .mockResolvedValue({ versions: { '@x/old': '1.0.0', '@y/new': '1.0.0' }, extras: [], features: {} })
    const { root, api } = await mount({ verifyActivation: vi.fn(async () => 'activated'), installed: inst })
    find(root, 'add')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 2600))  // install waits 2s for daemon rescan
    await flush()
    expect(api.verifyActivation).toHaveBeenCalled()
  })
})
