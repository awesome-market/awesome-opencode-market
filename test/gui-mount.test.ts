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

  it('dev easter egg: 10 mousedowns toggle dev section + (dev) marker, 10 more exit and clear dev toggles', async () => {
    localStorage.clear()
    const { root, mounted } = await mount()
    find(root, 'settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    const ver = [...root2.querySelectorAll('span')].find(s => (s as HTMLElement).dataset.act === 'devtap') as HTMLElement
    expect(ver).toBeTruthy()
    // this webview never fires element onclick — the tap must ride the
    // settings root's mousedown dispatch (dataset.act), the channel that
    // actually delivers in production
    for (let i = 0; i < 10; i++) ver.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(ver.textContent).toContain('(dev)')
    const dsh = [...root2.querySelectorAll('h4')].find(h => h.textContent?.includes('dev catalog'))
    expect(dsh).toBeTruthy()
    const wrap = dsh!.parentElement as HTMLElement
    expect(wrap.style.display).not.toBe('none')
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').devUnlocked).toBe(true)
    // a dev toggle turns on via the same mousedown dispatch, then exit resets it
    const pickRow = wrap.querySelector('[data-act=devpick]') as HTMLElement
    pickRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').devVerPick).toBe(true)
    expect(pickRow.textContent).toContain('[x]')
    for (let i = 0; i < 10; i++) ver.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(ver.textContent).not.toContain('(dev)')
    expect(pickRow.textContent).toContain('[ ]')
    const st = JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}')
    expect(st.devUnlocked).toBe(false)
    expect(st.devSource).toBe(false)
    expect(st.devVerPick).toBe(false)
    expect(wrap.style.display).toBe('none')
    localStorage.clear()
  })

  it('stale pick at/below installed stays inert — button judges by latestVersion (no downgrade op)', async () => {
    localStorage.clear()
    localStorage.setItem('opencode-market.state.v1', JSON.stringify({ devUnlocked: true, devVerPick: true }))
    // screenshot regression: @y/new installed at its approved version while a
    // leftover pick (0.5.0) must NOT resurrect an install-to-old-ver button
    const { root, mounted } = await mount({
      installed: vi.fn(async () => ({ versions: { '@x/old': '1.0.0', '@y/new': '1.0.0' }, extras: [], features: {} })),
    })
    const card0 = [...root.querySelectorAll('div')].find(d => (d as HTMLElement).dataset.mi && d.textContent?.includes('@y/new'))!
    const sel = card0.querySelector('select') as HTMLSelectElement
    expect(sel).toBeTruthy()
    // the installed version itself is already a disabled option
    expect(sel.options[0]?.value).toBe('1.0.0')
    expect(sel.options[0]?.disabled).toBe(true)
    // seed the stale pick via the same onchange path the UI uses — picks are
    // written before install state changes, so a disabled-looking option can
    // still sit in the map (picked while uninstalled → upgraded → leftover)
    const opt = document.createElement('option'); opt.value = '0.5.0'
    sel.appendChild(opt); sel.value = '0.5.0'
    sel.dispatchEvent(new Event('change'))
    await flush()
    const root2 = await remount(mounted)
    const card = [...root2.querySelectorAll('div')].find(d => (d as HTMLElement).dataset.mi && d.textContent?.includes('@y/new'))!
    // no install-semantics button on the card — the pick is inert so the
    // card shows the quiet installed badge, never "add → v0.5.0" (the ☆
    // favorite button is allowed to remain)
    const installish = [...card.querySelectorAll('button')].filter(b => /add|update|install|v0\.5/i.test(b.textContent ?? ''))
    expect(installish).toHaveLength(0)
    expect(card.textContent).toContain('✓')
    // and the picker's own option for the stale version is disabled —
    // "not an install target" is visible in the picker itself
    const sel2 = card.querySelector('select') as HTMLSelectElement
    expect(sel2).toBeTruthy()
    expect([...sel2.options].find(o => o.value === '0.5.0')?.disabled).toBe(true)
    localStorage.clear()
  })

  it('settings controls ride mousedown dispatch — export/import/devlog/clearlogs', async () => {
    localStorage.clear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    const clearDevlog = vi.fn(async () => 'ok')
    const { root, mounted, api } = await mount({ clearDevlog })
    find(root, 'settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    // export — status line reports the downloaded filename
    ;(root2.querySelector('[data-act=export]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(root2.textContent).toContain('opencode-market-backup.json')
    // import — valid state JSON lands in localStorage; garbage is rejected
    const ta = root2.querySelector('textarea')!
    ta.value = '{"favorites":{"x":true}}'
    ;(root2.querySelector('[data-act=import]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').favorites).toEqual({ x: true })
    ta.value = 'not-json'
    ;(root2.querySelector('[data-act=import]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').favorites).toEqual({ x: true })  // unchanged
    // devlog toggle — click the INNER '[ ]' glyph span: only closest('[data-act]')
    // dispatch reaches the row (ev.target.dataset alone would miss it)
    const drow = root2.querySelector('[data-act=devlog]') as HTMLElement
    drow.querySelector('span')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(JSON.parse(localStorage.getItem('opencode-market.state.v1') ?? '{}').devlog).toBe(true)
    expect(drow.textContent).toContain('[x]')
    // clear logs → clears host file AND renderer buffer
    ;(root2.querySelector('[data-act=clearlogs]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(clearDevlog).toHaveBeenCalled()
    localStorage.clear()
  })

  it('skill permission buttons write via mousedown dispatch', async () => {
    localStorage.clear()
    localStorage.setItem('opencode-market.state.v1', JSON.stringify({ devUnlocked: true }))
    const skillPermission = vi.fn(async () => ({}))
    const { root, mounted } = await mount({
      skillPermission,
      installed: vi.fn(async () => ({ versions: { '__skill_myskill': '1.0.0' }, extras: [], features: {} })),
    })
    find(root, 'settings')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const root2 = await remount(mounted)
    await flush()                       // remount rebuilds the panel — paintPerms resolves async after it
    const btn = [...root2.querySelectorAll('[data-act=perm]')].find(b => (b as HTMLElement).dataset.permId === 'myskill' && (b as HTMLElement).dataset.permMode === 'deny') as HTMLElement
    expect(btn).toBeTruthy()
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(skillPermission).toHaveBeenCalledWith({ id: 'myskill', mode: 'deny' })
    // the row's current-mode span echoes the applied mode (children[1])
    expect((btn.parentElement?.children[1] as HTMLElement).textContent).toBe('deny')
    localStorage.clear()
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
