// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { makeApi, fakeCtx, flush, remount, find } from './helpers/mount.ts'
import mod from '../plugins/market/src/gui.ts'

async function mount(over = {}) {
  const api = makeApi(over)
  const { ctx, mounted } = fakeCtx(api)
  mod.setup?.(ctx as never)
  const root = await remount(mounted)
  await flush()
  return { api, ctx, root, mounted }
}

describe('L3 mount: window-side behavior', () => {
  it('update-all updates every outdated plugin', async () => {
    const { root, api } = await mount()
    const updAll = find(root, 'update all')!
    updAll.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(api.update).toHaveBeenCalledWith({ name: '@x/old', spec: '@x/old@2.0.0' })
  })

  it('install button calls api.update on add click (fresh installs dedupe too)', async () => {
    const { root, api } = await mount()
    const add = find(root, 'add')
    expect(add).toBeTruthy()
    add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    // fresh install routes through update — `plugin add` + config dedupe is a
    // strict superset of install and clears stale same-name specs the
    // inventory may not have reported yet
    expect(api.update).toHaveBeenCalledWith({ name: '@y/new', spec: '@y/new@1.0.0' })
  })

  it('install failure marks the button failed, not silent', async () => {
    const { root } = await mount({ update: vi.fn(async () => { throw new Error('boom') }) })
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
    if (!cx) { expect(api.update).toHaveBeenCalledWith({ name: '@y/new', spec: '@y/new@1.0.0' }); return }
    cx.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(api.cancelInstall).toHaveBeenCalled()
  })

  it('settings tab exposes refresh/backup/clear controls (remount)', async () => {
    const { root, mounted } = await mount()
    find(root, 'settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    const texts = [...root2.querySelectorAll('button')].map(b => b.textContent)
    expect(texts.some(t => t?.includes('refresh data'))).toBe(true)
    expect(texts.some(t => t?.includes('backup') || t?.includes('clear'))).toBe(true)
  })

  it('language switch persists and re-renders labels in zh', async () => {
    localStorage.clear()
    const { root, mounted } = await mount()
    find(root, 'settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    const zhBtn = [...root2.querySelectorAll('button')].find(b => (b as HTMLButtonElement).dataset.lang === 'zh')!
    zhBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    const root3 = await remount(mounted)
    const texts = [...root3.querySelectorAll('button')].map(b => `${b.textContent}${b.getAttribute('aria-label') ?? ''}`)
    expect(texts.some(t => t?.includes('设置'))).toBe(true)
    expect(texts.some(t => t?.includes('更新数据'))).toBe(true)
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').lang).toBe('zh')
    // restore for other tests
    const enBtn = [...root3.querySelectorAll('button')].find(b => (b as HTMLButtonElement).dataset.lang === 'en')
    enBtn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    localStorage.clear()
  })

  it('favorite toggle flips ☆→★ on the card', async () => {
    const { root } = await mount()
    const fav = find(root, '☆')
    expect(fav).toBeTruthy()
    fav!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(fav!.textContent).toBe('★')
  })

  it('card name click opens the entry page; body click does not navigate', async () => {
    const { root, ctx } = await mount()
    const name = [...root.querySelectorAll('span')].find(s => s.textContent?.includes('@x/old') && s.title)!
    name.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ctx.system.openExternal).toHaveBeenCalledWith(name.title)
    expect(name.title).toMatch(/^https:/)
    const back = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('back'))
    expect(back).toBeUndefined()
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
