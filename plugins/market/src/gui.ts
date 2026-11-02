/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Desktop GUI — real SolidJS reactivity via `insert()` from solid-js/web
 * (function children become reactive computations). No h()/JSX — the host
 * module whitelist only exposes solid-js, solid-js/web, solid-js/store.
 */
import { Plugin, Ipc, Panel, SettingsPage, Command, MenuItem } from '@opencode/plugin/gui'
import { Schema } from 'effect'
import { createSignal, createEffect } from 'solid-js'
import { insert } from 'solid-js/web'
import { fetchIndex, fetchIndexCached, search, sortEntries, categoriesOf, allCategories, inDays, redactLog, keyLines, loadState, saveState, allGroups, hasUpdate, indexAge, t, EMPTY_STATE, type MarketEntry, type MarketIndex, type LocalState } from './catalog.js'

const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { output: Schema.Unknown },
    installed: { output: Schema.Unknown },
    install: { input: Schema.String, output: Schema.String },
    cancelInstall: { input: Schema.String, output: Schema.String },
    verifyActivation: { input: Schema.String, output: Schema.String },
    uninstall: { input: Schema.String, output: Schema.String },
    installSkill: { input: Schema.String, output: Schema.String },
    uninstallSkill: { input: Schema.String, output: Schema.String },
    installSkillDir: { input: Schema.Unknown, output: Schema.String },
    skillSource: { output: Schema.Unknown },
    skillPermission: { input: Schema.Unknown, output: Schema.Unknown },
  },
  events: {
    progress: Schema.Unknown,   // { name, line, done, ok }
  },
})
type Api = {
  index(): Promise<MarketIndex>
  installed(): Promise<Record<string, string>>
  install(name: string): Promise<string>
  cancelInstall(name: string): Promise<string>
  verifyActivation(name: string): Promise<string>
  uninstall(name: string): Promise<string>
  installSkill(name: string): Promise<string>
  uninstallSkill(name: string): Promise<string>
  installSkillDir(p: { name: string; scope: 'global' | 'project' }): Promise<string>
  skillSource(): Promise<{ url: string; enabled: boolean }>
  skillPermission(p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }): Promise<Record<string, string>>
  on(name: 'progress', fn: (d: { name: string; line: string; done?: boolean; ok?: boolean }) => void): () => void
}

type View = { kind: 'list' } | { kind: 'detail'; e: MarketEntry }
const sorts = ['verified', 'downloads', 'stars', 'name'] as const

export default Plugin.define({
  setup(ctx: any): any {
    let api: Api | null = null
    try { api = ctx.main(Market) as Api } catch { /* diagnosed below */ }
    if (!api?.index) return {}
    const safe = api as Api
    const [data, setData] = createSignal<MarketIndex | null>(null)
    const [installed, setInstalled] = createSignal<Record<string, string>>({})
    const [err, setErr] = createSignal('')
    const [query, setQuery] = createSignal('')
    const [cat, setCat] = createSignal('')
    const [sort, setSort] = createSignal<string>('verified')
    const [view, setView] = createSignal<View>({ kind: 'list' })
    const [state, setState] = createSignal<LocalState>(EMPTY_STATE)
    const [favOnly, setFavOnly] = createSignal(false)
    const [groupFilter, setGroupFilter] = createSignal('')
    const [tab, setTab] = createSignal<'discover'|'plugins'|'skills'|'favorites'|'installed'|'advanced'>('discover')
    const [filterOpen, setFilterOpen] = createSignal(false)
    const [sortDir, setSortDir] = createSignal<'desc'|'asc'>('desc')
    const [rangeDays, setRangeDays] = createSignal(0)
    const [prog, setProg] = createSignal<Record<string, { lines: string[]; done?: boolean; ok?: boolean }>>({})
    try { setState(loadState()) } catch { /* storage unavailable */ }
    const put = (patch: Partial<LocalState>) => {
      const s = { ...state(), ...patch }
      setState(s); try { saveState(s) } catch { /* noop */ }
    }
    const toggleFav = (n: string) => {
      const f = { ...state().favorites }
      f[n] ? delete f[n] : f[n] = true
      put({ favorites: f })
    }
    try {
      safe.on?.('progress', (d) => {
        const cur = prog()[d.name] ?? { lines: [] }
        setProg({ ...prog(), [d.name]: d.done ? { ...cur, done: true, ok: d.ok } : { lines: [...cur.lines, d.line].slice(-20) } })
      })
    } catch { /* older host: no events */ }

    safe.index().then(i => setData(i), e => setErr(String(e)))
    safe.installed?.().then(s => setInstalled(s ?? {}), () => {})

    const filtered = () => {
      const all = data()?.plugins ?? []
      const c = cat(); const s = state()
      let list = c ? all.filter(p => categoriesOf(p).includes(c)) : all
      switch (tab()) {
        case 'plugins': list = list.filter(p => !p.contains?.includes('skill')); break
        case 'skills': list = list.filter(p => p.contains?.includes('skill')); break
        case 'installed': list = list.filter(p => installed()[p.name]); break
        case 'advanced': list = list.filter(p => (p.capabilities?.redFlags?.length ?? 0) > 0 || p.verification?.status === 'failed'); break
        case 'discover': default: break
      }
      if (favOnly()) list = list.filter(p => s.favorites[p.name])
      const g = groupFilter()
      if (g) list = list.filter(p => s.groups[p.name] === g)
      if (rangeDays()) list = list.filter(p => inDays(p, rangeDays()))
      const srt = sortEntries(search(list, query()), sort())
      return sortDir() === 'asc' ? [...srt].reverse() : srt
    }
    const statusOf = (e: MarketEntry) =>
      installed()[e.name] ? `${t('installed')} v${installed()[e.name]}`
      : t((e.verification?.status ?? 'unverified') as 'verified')

    // ---- dom helpers -------------------------------------------------------
    const el = (tag: string, css = '', text = '') => {
      const n = document.createElement(tag)
      if (css) n.style.cssText = css
      if (text) n.textContent = text
      return n
    }
    const badge = (e: MarketEntry) => {
      const s = statusOf(e)
      const b = el('span', 'margin-left:8px;font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0', s)
      b.style.color = '#fff'
      b.style.background = s.startsWith(t('installed')) ? '#1a7' : s === t('verified') || s === 'verified' ? '#1a7' : s === 'failed' ? '#c33' : s === 'skipped' ? '#885' : '#666'
      return b
    }
    const installBtn = (e: MarketEntry) => {
      const ver = installed()[e.name]
      const isSkill = e.contains?.includes('skill')
      // dsh parity: installed & no update → text badge only, no dead button
      if (ver && !hasUpdate(e, ver))
        return el('span', 'font-size:11px;color:#1a7;white-space:nowrap;flex-shrink:0', `✓ ${t('installed')}`)
      const label = ver ? `update → v${e.latestVersion}` : 'add'
      const b = el('button', 'font-size:12px;cursor:pointer;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.5);border-radius:6px;padding:2px 14px', label) as HTMLButtonElement
      b.onclick = ev => {
        ev.stopPropagation()
        b.disabled = true; b.textContent = '…'
        const doInstall: () => Promise<string> = isSkill ? () => safe.installSkill(e.name) : () => safe.install(e.name)
        doInstall().then(
          async () => {
            // effectiveness re-check: reload installed list, flag restart need
            const fresh = await safe.installed?.().catch(() => installed())
            if (fresh) setInstalled(fresh)
            const okNow = (fresh ?? installed())[e.name]
            if (isSkill) { b.textContent = `${t('installed')}`; b.style.color = '#4a4' }
            else {
              b.textContent = okNow ? 'verifying…' : `${t('installed')} (verify pending)`
              const verdict = await safe.verifyActivation?.(e.name).catch(() => '')
              b.textContent = verdict === 'activated' ? `${t('installed')} · activated` : okNow ? `${t('installed')} — ${t('restartNeeded')}` : `${t('installed')} (verify pending)`
              b.style.color = verdict === 'activated' ? '#4a4' : '#da3'
            }
          },
          (x: unknown) => { b.textContent = 'failed'; b.title = String(x); b.style.color = '#c66' },
        )
      }
      return b
    }
    const row = (e: MarketEntry) => {
      const d = el('div', 'padding:12px 14px;cursor:pointer;border-radius:8px;display:flex;flex-direction:column;min-height:110px;box-sizing:border-box')
      // official [data-component=settings-list]: bg-layer-01 + 0.5px inset hairline via box-shadow
      d.style.background = 'var(--v2-background-bg-layer-01, color-mix(in srgb, CanvasText 4%, Canvas))'
      d.style.boxShadow = 'inset 0 0 0 0.5px var(--v2-border-border-muted, color-mix(in srgb, CanvasText 14%, transparent))'
      d.onmouseenter = () => { d.style.background = 'var(--v2-background-bg-layer-02, color-mix(in srgb, CanvasText 7%, Canvas))' }
      d.onmouseleave = () => { d.style.background = 'var(--v2-background-bg-layer-01, color-mix(in srgb, CanvasText 4%, Canvas))' }
      d.onclick = () => setView({ kind: 'detail', e })
      const title = el('div', 'font-weight:600;font-size:14px;display:flex;align-items:flex-start;gap:6px')
      const nameBox = el('span', 'flex:1;min-width:0;word-break:break-all;line-height:1.35')
      nameBox.append(e.name, badge(e))
      title.append(nameBox)
      const btn = installBtn(e); btn.style.flexShrink = '0'
      title.appendChild(btn)
      const meta = el('div', 'opacity:.5;font-size:11px;margin-top:1px')
      const dl = e.metrics?.npmDownloads30d, st = e.metrics?.stars
      meta.textContent = [`v${e.latestVersion ?? '?'}`,
        dl != null ? `↓${fmtN(dl)}` : '', st != null ? `★${fmtN(st)}` : '']
        .filter(Boolean).join(' · ')
      const desc = el('div', 'opacity:.6;font-size:12px;margin-top:3px;flex:1', (e.description?.en ?? '').slice(0, 160))
      const bottom = el('div', 'margin-top:6px;display:flex;align-items:center;gap:5px;flex-wrap:wrap')
      for (const ct of categoriesOf(e)) {
        const tg = el('span', 'font-size:10px;padding:1px 8px;border:1px solid rgba(128,128,128,.35);border-radius:10px;opacity:.75', ct)
        tg.onclick = ev => { ev.stopPropagation(); setCat(ct) }
        bottom.appendChild(tg)
      }
      // bottom-right favorite bookmark (dsh style) — localStorage state
      const favBtn = el('button', 'margin-left:auto;font-size:14px;line-height:1;cursor:pointer;border:none;background:transparent;padding:2px 6px', state().favorites[e.name] ? '★' : '☆') as HTMLButtonElement
      const syncFav = () => { favBtn.textContent = state().favorites[e.name] ? '★' : '☆'; favBtn.style.color = state().favorites[e.name] ? '#da3' : 'rgba(128,128,128,.7)' }
      syncFav()
      favBtn.onclick = ev => { ev.stopPropagation(); toggleFav(e.name); syncFav() }
      bottom.appendChild(favBtn)
      const note = state().notes[e.name]
      d.append(title, meta, desc, bottom)
      if (note) d.appendChild(el('div', 'font-size:11px;opacity:.55;font-style:italic', `📝 ${note}`))
      const p = prog()[e.name]
      if (p && !p.done) {
        const bar = el('div', 'font-size:11px;opacity:.6;max-height:60px;overflow:hidden')
        bar.textContent = p.lines[p.lines.length - 1] ?? 'installing…'
        const cx = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', t('cancel'))
        cx.onclick = ev => { ev.stopPropagation(); void safe.cancelInstall(e.name) }
        bar.appendChild(cx)
        d.appendChild(bar)
      }
      if (p?.done && p.ok === false) {
        const errBox = el('div', 'font-size:11px;color:#c66')
        errBox.textContent = keyLines(p.lines.join('\n')).join(' · ').slice(0, 200) || 'install failed'
        const ex = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', t('exportLog'))
        ex.onclick = ev => {
          ev.stopPropagation()
          const txt = redactLog(p.lines.join('\n'))
          void navigator.clipboard?.writeText(txt).catch(() => {})
        }
        errBox.appendChild(ex)
        d.appendChild(errBox)
      }
      return d
    }
    const fmtN = (n: number | null | undefined) =>
      n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
    const sel = (opts: string[], cur: () => string, set: (v: string) => void, label = '') => {
      const s = document.createElement('select')
      s.style.cssText = 'margin-right:6px;font-size:12px'
      if (label) s.append(new Option(label, ''))
      for (const o of opts) s.append(new Option(o, o))
      s.value = cur()
      s.onchange = () => set(s.value)
      return s
    }

    const listView = () => {
      const root = el('div', '')
      const list = el('div')
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-content:start'
      insert(list, () => {
        const items = filtered()
        return items.length ? items.map(row) : [el('div', 'padding:12px;opacity:.6', t('noMatch'))]
      })
      root.appendChild(list)
      return root
    }

    // static chrome — built ONCE so the search input never loses focus to a
    // reactive re-render (the insert below only owns the body region)
    const chrome = () => {
      const root = el('div', 'padding:12px 12px 0;box-sizing:border-box')
      // header: title + pkg version + far-right 全部更新 (hardcoded placeholder)
      const head = el('div', 'display:flex;align-items:baseline;margin-bottom:10px')
      head.appendChild(el('h3', 'margin:0;font-size:15px;font-weight:600', 'opencode market'))
      head.appendChild(el('span', 'margin-left:12px;font-size:12px;opacity:.55', 'opencode-market v0.0.3'))
      const updAll = el('button', 'margin-left:auto;font-size:12px;cursor:pointer;padding:2px 14px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit', '全部更新') as HTMLButtonElement
      updAll.onclick = () => { updAll.textContent = '暂无更新' }   // placeholder per spec
      head.appendChild(updAll)
      root.appendChild(head)
      // functional tabs: 发现/插件/skill/收藏/已安装/高级 (dsh top-nav style)
      const tabs = el('div', 'display:flex;gap:2px;margin-bottom:10px')
      const TABS: [typeof tab extends () => infer V ? V : never, string][] = [
        ['discover', '发现'], ['plugins', '插件'], ['skills', 'skill'],
        ['favorites', '收藏'], ['installed', '已安装'], ['advanced', '高级']]
      for (const [id, label] of TABS) {
        const tb = el('button', 'font-size:13px;cursor:pointer;padding:3px 12px;border:none;border-radius:6px;background:transparent;color:inherit', label) as HTMLButtonElement
        const sync = () => { const on = tab() === id; tb.style.background = on ? 'rgba(128,128,128,.18)' : 'transparent'; tb.style.fontWeight = on ? '600' : '400' }
        sync(); tb.onclick = () => {
          setTab(id); setFavOnly(id === 'favorites')
          for (const x of Array.from(tabs.children) as HTMLButtonElement[]) { const on = x === tb; x.style.background = on ? 'rgba(128,128,128,.18)' : 'transparent'; x.style.fontWeight = on ? '600' : '400' }
        }
        tabs.appendChild(tb)
      }
      root.appendChild(tabs)
      // search row
      const controls = el('div', 'display:flex;align-items:center;margin-bottom:8px')
      // official text-input-v2: leading magnifier icon inside, 32px height, muted icon
      const wrap = el('div', 'position:relative;flex:1;margin-right:6px;display:flex;align-items:center')
      const q = document.createElement('input')
      q.placeholder = t('search')
      q.style.cssText = 'flex:1;height:32px;padding:0 8px 0 28px;box-sizing:border-box;font-size:13px;background:var(--v2-background-bg-layer-01,Canvas);color:inherit;border:1px solid var(--v2-border-border-base,rgba(128,128,128,.35));border-radius:8px;outline:none'
      q.oninput = () => setQuery(q.value)
      const mag = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      mag.setAttribute('width', '14'); mag.setAttribute('height', '14'); mag.setAttribute('viewBox', '0 0 24 24')
      mag.setAttribute('fill', 'none'); mag.setAttribute('stroke', 'currentColor'); mag.setAttribute('stroke-width', '2')
      mag.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'
      const ic = el('span', 'position:absolute;left:8px;display:flex;pointer-events:none')
      ic.style.color = 'var(--v2-icon-icon-muted, rgba(128,128,128,.8))'
      ic.appendChild(mag)
      wrap.append(ic, q)
      controls.appendChild(wrap)
      const filt = el('button', 'font-size:12px;cursor:pointer;padding:4px 12px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit', '筛选') as HTMLButtonElement
      filt.onclick = () => setFilterOpen(!filterOpen())
      controls.appendChild(filt)
      root.appendChild(controls)
      // sectioned dropdown menu (dsh filter style)
      const menu = el('div', 'position:absolute;right:12px;top:96px;z-index:50;min-width:210px;padding:6px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.18)')
      menu.style.background = 'var(--v2-background-bg-layer-01, Canvas)'
      menu.style.border = '1px solid var(--v2-border-border-muted, rgba(128,128,128,.3))'
      menu.style.display = 'none'
      const section = (title: string, items: [string, () => boolean, () => void][]) => {
        const s = el('div', 'padding:4px 2px')
        s.appendChild(el('div', 'font-size:10px;opacity:.5;padding:2px 8px 4px', title))
        for (const [label, on, act] of items) {
          const it = el('div', 'font-size:12px;padding:4px 10px;cursor:pointer;border-radius:6px;display:flex;justify-content:space-between')
          it.onmouseenter = () => { it.style.background = 'rgba(128,128,128,.12)' }
          it.onmouseleave = () => { it.style.background = 'transparent' }
          it.onclick = () => act()
          const check = el('span', 'opacity:.9', '')
          insert(check, () => on() ? '✓' : '')
          it.append(el('span', '', label), check)
          s.appendChild(it)
        }
        return s
      }
      menu.append(
        section('排序字段', [
          ['npm 下载量（近 30 天）', () => sort() === 'downloads', () => setSort('downloads')],
          ['Star 数', () => sort() === 'stars', () => setSort('stars')],
          ['名称', () => sort() === 'name', () => setSort('name')],
          ['验证状态', () => sort() === 'verified', () => setSort('verified')],
        ]),
        section('排序方向', [
          ['降序', () => sortDir() === 'desc', () => setSortDir('desc')],
          ['升序', () => sortDir() === 'asc', () => setSortDir('asc')],
        ]),
        section('发布时间范围', [
          ['全部时间', () => rangeDays() === 0, () => setRangeDays(0)],
          ['最近 1 天', () => rangeDays() === 1, () => setRangeDays(1)],
          ['最近 7 天', () => rangeDays() === 7, () => setRangeDays(7)],
          ['最近 30 天', () => rangeDays() === 30, () => setRangeDays(30)],
          ['最近 90 天', () => rangeDays() === 90, () => setRangeDays(90)],
          ['最近 1 年', () => rangeDays() === 365, () => setRangeDays(365)],
        ]),
      )
      createEffect(() => { menu.style.display = filterOpen() ? '' : 'none' })
      filt.onclick = () => setFilterOpen(!filterOpen())
      document.addEventListener('click', ev => { if (!menu.contains(ev.target as Node) && ev.target !== filt) setFilterOpen(false) })
      root.appendChild(menu)
      // category chips row (dsh style)
      const chips = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px')
      insert(chips, () => {
        const pool = (data()?.plugins ?? []).filter(p =>
          tab() === 'skills' ? p.contains?.includes('skill') : !p.contains?.includes('skill'))
        const mk = (id: string, label: string) => {
          const c = el('button', 'font-size:11px;cursor:pointer;padding:2px 10px;border:1px solid rgba(128,128,128,.4);border-radius:12px;background:transparent;color:inherit', label) as HTMLButtonElement
          if (cat() === id || (id === '' && !cat())) { c.style.background = '#556'; c.style.color = '#fff' }
          c.onclick = () => setCat(id)
          return c
        }
        return [mk('', `全部(${pool.length})`), ...allCategories(pool).slice(0, 12).map(c => mk(c, c))]
      })
      root.appendChild(chips)
      return root
    }

    const detailView = (e: MarketEntry) => {
      const root = el('div', 'padding:12px;overflow:auto;height:100%;box-sizing:border-box')
      const back = el('button', 'font-size:12px;cursor:pointer;margin-bottom:10px')
      back.textContent = t('back')
      back.onclick = () => setView({ kind: 'list' })
      root.append(back, el('h3', 'margin:0', e.name))
      root.appendChild(badge(e))
      const v = e.verification
      const info = el('div', 'font-size:12px;opacity:.8;margin:10px 0')
      const caps = e.capabilities
      info.innerHTML = [
        `version: ${e.latestVersion ?? '?'}`,
        `verified: ${v?.verifiedAt?.slice(0, 10) ?? '—'} (opencode ${v?.opencodeVersion ?? '?'})`,
        `findings: ${caps?.findings.length ?? 0} · redFlags: ${caps?.redFlags.length ?? 0}`,
        `downloads30d: ${e.metrics?.npmDownloads30d ?? '—'} · stars: ${e.metrics?.stars ?? '—'}`,
      ].join('<br>')
      root.appendChild(info)
      root.appendChild(el('p', 'font-size:13px;line-height:1.5', e.description?.en ?? ''))
      if (caps?.redFlags.length) {
        root.appendChild(el('h4', 'color:#c66;margin:12px 0 4px', t('redFlags')))
        for (const f of caps.redFlags.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', `⚠ ${f}`))
      }
      if (caps?.findings.length) {
        root.appendChild(el('h4', 'margin:12px 0 4px', t('findings')))
        for (const f of caps.findings.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', f))
      }
      const btn = installBtn(e); btn.style.marginLeft = '0'
      root.appendChild(btn)
      if (installed()[e.name]) {
        const un = el('button', 'margin-left:8px;font-size:11px;cursor:pointer;color:#eee;background:#633;border:1px solid #855;border-radius:4px;padding:1px 8px', 'uninstall') as HTMLButtonElement
        un.onclick = () => {
          un.disabled = true; un.textContent = '…'
          ;(e.contains?.includes('skill') ? safe.uninstallSkill(e.name) : safe.uninstall(e.name)).then(
            async () => { const f = await safe.installed?.().catch(() => ({})); if (f) setInstalled(f); un.textContent = 'removed' },
            (x: unknown) => { un.textContent = 'failed'; un.title = String(x) },
          )
        }
        root.appendChild(un)
      }
      // local state: group + note
      root.appendChild(el('h4', 'margin:14px 0 4px', 'group'))
      const gi = document.createElement('input')
      gi.placeholder = t('group'); gi.value = state().groups[e.name] ?? ''
      gi.style.cssText = 'padding:4px;font-size:12px;width:200px'
      gi.onchange = () => { const gr = { ...state().groups }; gi.value ? gr[e.name] = gi.value : delete gr[e.name]; put({ groups: gr }) }
      root.appendChild(gi)
      root.appendChild(el('h4', 'margin:14px 0 4px', 'note'))
      const ni = document.createElement('input')
      ni.placeholder = t('note'); ni.value = state().notes[e.name] ?? ''
      ni.style.cssText = 'padding:4px;font-size:12px;width:100%;box-sizing:border-box'
      ni.onchange = () => { const ns = { ...state().notes }; ni.value ? ns[e.name] = ni.value : delete ns[e.name]; put({ notes: ns }) }
      root.appendChild(ni)
      return root
    }

    const mount = (parent: HTMLElement) => {
      const shell = el('div', 'overflow:auto;height:100%')
      const head = chrome()          // built ONCE — signal reads here don't get tracked
      const body = el('div')
      shell.append(head, body)
      createEffect(() => {
        head.style.display = (data() && view().kind === 'list') ? '' : 'none'
      })
      insert(body, () => {
        if (err()) return el('div', 'padding:12px;color:#c66', `error: ${err()}`)
        if (!data()) return el('div', 'padding:12px;opacity:.6', t('loading'))
        const v = view()
        const n = v.kind === 'detail' ? detailView(v.e) : listView()
        n.style.padding = '0 12px 12px'
        return n
      })
      parent.appendChild(shell)
    }

    ctx.add(SettingsPage, {
      id: 'market', title: 'Market', icon: 'marketplace' as any,
      render: () => { const host = el('div', 'height:100%'); mount(host); return host },
    })
    ctx.add(Panel, {
      id: 'market', title: 'Market', region: 'side' as const, transient: true,
      list: () => [{ id: 'market', title: 'Market' }],
      render: () => { const host = el('div', 'height:100%'); mount(host); return host },
    })
    const openMarket = () => {
      const s = ctx.sessions.current()
      if (s) ctx.layout.open('opencode-market:market', s as any)
    }
    ctx.add(Command, {
      id: 'open', title: 'Open Market', palette: true,
      slash: { name: 'market' }, run: openMarket,
    })
    ctx.add(MenuItem, {
      menu: 'session.panel' as const, id: 'market', title: 'Market',
      icon: 'marketplace' as any, description: 'browse verified plugins', order: 1000,
      run: openMarket,
    })
    return {}
  },
  main(m: any) {
    const jobs = new Map<string, import('node:child_process').ChildProcess>()
    m.provide(Market, {
        index: () => fetchIndexCached() as Promise<MarketIndex>,
        installed: async () => {
          const { execFile } = require('node:child_process') as typeof import('node:child_process')
          const out = await new Promise<string>((res, rej) =>
            execFile('opencode', ['plugin', 'list'], { timeout: 15_000 }, (e, o, er) => e ? rej(new Error(er || e.message)) : res(o)))
          const map: Record<string, string> = {}
          for (const ln of out.split('\n').slice(1)) {
            const [id, ver, src] = ln.trim().split(/\s{2,}/)
            if (id) { map[id] = ver ?? '?'; if (src) map[src] = ver ?? '?' }
          }
          return map
        },
        install: (name: string) =>
          new Promise<string>((resolve, reject) => {
            const { spawn } = require('node:child_process') as typeof import('node:child_process')
            const p = spawn('opencode', ['plugin', 'add', name], { env: process.env })
            jobs.set(name, p)
            const push = (line: string) => m.emit?.('progress', { name, line })
            p.stdout?.on('data', (d: Buffer) => push(String(d).trim()))
            p.stderr?.on('data', (d: Buffer) => push(String(d).trim()))
            const kill = setTimeout(() => p.kill('SIGTERM'), 90_000)
            p.on('close', code => {
              clearTimeout(kill); jobs.delete(name)
              m.emit?.('progress', { name, line: '', done: true, ok: code === 0 })
              code === 0 ? resolve('installed') : reject(new Error(`exit ${code}`))
            })
            p.on('error', (e: Error) => { clearTimeout(kill); jobs.delete(name); reject(e) })
          }),
        cancelInstall: async (name: string) => {
          jobs.get(name)?.kill('SIGTERM'); jobs.delete(name); return 'cancelled'
        },
        uninstall: (name: string) =>
          new Promise<string>((resolve, reject) => {
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            execFile('opencode', ['plugin', 'remove', name], { timeout: 30_000 },
              (e, out, er) => e ? reject(new Error(er || e.message)) : resolve(out || 'removed'))
          }),
        // skills are file-system installs: fetch tarball → extract into config/skills/<name>
        installSkill: (name: string) =>
          new Promise<string>((resolve, reject) => {
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            const { homedir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            const { existsSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
            const dir = join(homedir(), '.config', 'opencode', 'skills')
            const script = `set -e; mkdir -p "${dir}/_dl"; cd "${dir}/_dl"; ` +
              `TARBALL=$(npm view "${name}" dist.tarball 2>/dev/null); ` +
              `[ -z "$TARBALL" ] && TARBALL=$(npm view "${name.split('/').pop()}" dist.tarball); ` +
              `curl -fsSL "$TARBALL" -o p.tgz; ` +
              `mkdir -p "${dir}/${name.split('/').pop()}"; ` +
              `tar xzf p.tgz -C "${dir}/${name.split('/').pop()}" --strip-components=1 2>/dev/null || ` +
              `{ mkdir -p "${dir}/${name.split('/').pop()}" && tar xzf p.tgz -C "${dir}/${name.split('/').pop()}"; }; ` +
              `test -f "${dir}/${name.split('/').pop()}/SKILL.md" || find "${dir}/${name.split('/').pop()}" -name SKILL.md | head -1`
            execFile('sh', ['-c', script], { timeout: 45_000 }, (e, out, er) => {
              if (e) return reject(new Error(er || e.message))
              const dest = join(dir, name.split('/').pop()!, 'SKILL.md')
              resolve(existsSync(dest) ? 'installed' : 'installed (no SKILL.md at root)')
            })
          }),
        installSkillDir: (p: { name: string; scope: 'global' | 'project' }) =>
          new Promise<string>((resolve, reject) => {
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            const { homedir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            const base = p.scope === 'project' ? join(process.cwd(), '.opencode', 'skills')
                                                 : join(homedir(), '.config', 'opencode', 'skills')
            const id = p.name.split('/').pop()!
            const script = `mkdir -p "${base}/_dl" && cd "${base}/_dl" && T=$(npm view "${p.name}" dist.tarball 2>/dev/null) && curl -fsSL "$T" -o p.tgz && mkdir -p "${base}/${id}" && tar xzf p.tgz -C "${base}/${id}" --strip-components=1`
            execFile('sh', ['-c', script], { timeout: 45_000 }, e => e ? reject(new Error(String(e))) : resolve(`installed → ${base}/${id}`))
          }),
        skillSource: async () => {
          const { readFileSync, writeFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
          const { homedir } = require('node:os') as typeof import('node:os')
          const { join } = require('node:path') as typeof import('node:path')
          const url = 'https://terry2010.github.io/opencode-market-spike/skills/'
          const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
          const d = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')) : {}
          const list: string[] = d.skills ?? []
          if (!list.includes(url)) { d.skills = [...list, url]; writeFileSync(cfg, JSON.stringify(d, null, 2)) }
          return { url, enabled: true }
        },
        skillPermission: (p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }) =>
          new Promise(resolve => {
            const { readFileSync, writeFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
            const { homedir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
            const d = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')) : {}
            const perms: { action: string; resource: string; effect: string }[] = d.permissions ?? []
            const rest = perms.filter(r => !(r.action === 'skill' && r.resource === p.id))
            if (p.mode) rest.push({ action: 'skill', resource: p.id, effect: p.mode })
            d.permissions = rest
            writeFileSync(cfg, JSON.stringify(d, null, 2))
            resolve(Object.fromEntries(rest.filter(r => r.action === 'skill').map(r => [r.resource, r.effect])))
          }),
        uninstallSkill: (name: string) =>
          new Promise<string>((resolve, reject) => {
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            const { homedir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            execFile('rm', ['-rf', join(homedir(), '.config', 'opencode', 'skills', name.split('/').pop()!)],
              { timeout: 10_000 }, e => e ? reject(e) : resolve('removed'))
          }),
        // self-confirm: isolated serve + API hit → real "did it load" verdict
        verifyActivation: (name: string) =>
          new Promise<string>((resolve) => {
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
            const { tmpdir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            const home = mkdtempSync(join(tmpdir(), 'mkt-verify-'))
            mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
            writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ plugins: [name] }))
            const env = { ...process.env, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache') }
            const boot = `opencode serve --port 0 > serve.out 2>&1 & SPID=$!; for i in $(seq 1 20); do grep -q "server listening" serve.out 2>/dev/null && break; sleep 0.5; done; PORT=$(sed -n 's/.*127.0.0.1:\\([0-9]*\\).*/\\1/p' serve.out | head -1); PW=$(sed -n 's/server password //p' serve.out | head -1); [ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null "http://127.0.0.1:$PORT/api/plugin"; sleep 1; kill $SPID 2>/dev/null; true`
            execFile('sh', ['-c', boot], { env, cwd: home, timeout: 25_000 }, () => {
              const log = join(home, 'data', 'opencode', 'log', 'opencode.log')
              const ok = existsSync(log) && new RegExp(`loading plugin."?\\s+id=${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(readFileSync(log, 'utf8'))
              resolve(ok ? 'activated' : 'not-loaded')
            })
          }),
      })
  },
})
