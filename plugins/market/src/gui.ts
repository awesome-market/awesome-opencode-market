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
import { fetchIndex, search, sortEntries, categoriesOf, type MarketEntry, type MarketIndex } from './catalog.js'

const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { output: Schema.Unknown },
    installed: { output: Schema.Unknown },
    install: { input: Schema.String, output: Schema.String },
  },
})
type Api = {
  index(): Promise<MarketIndex>
  installed(): Promise<Record<string, string>>
  install(name: string): Promise<string>
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

    safe.index().then(i => setData(i), e => setErr(String(e)))
    safe.installed?.().then(s => setInstalled(s ?? {}), () => {})

    const filtered = () => {
      const all = data()?.plugins ?? []
      const c = cat()
      return sortEntries(search(c ? all.filter(p => p.category?.includes(c)) : all, query()), sort())
    }
    const statusOf = (e: MarketEntry) =>
      installed()[e.name] ? `installed v${installed()[e.name]}`
      : e.verification?.status ?? 'unverified'

    // ---- dom helpers -------------------------------------------------------
    const el = (tag: string, css = '', text = '') => {
      const n = document.createElement(tag)
      if (css) n.style.cssText = css
      if (text) n.textContent = text
      return n
    }
    const badge = (e: MarketEntry) => {
      const s = statusOf(e)
      const b = el('span', 'margin-left:8px;font-size:11px;padding:1px 6px;border-radius:4px', s)
      b.style.background = s.startsWith('installed') ? '#2a5' : s === 'verified' ? '#274' : s === 'failed' ? '#a33' : s === 'skipped' ? '#554' : '#555'
      return b
    }
    const installBtn = (e: MarketEntry) => {
      const b = el('button', 'margin-left:8px;font-size:11px;cursor:pointer', installed()[e.name] ? 'reinstall' : 'add') as HTMLButtonElement
      b.onclick = ev => {
        ev.stopPropagation()
        b.disabled = true; b.textContent = '…'
        safe.install(e.name).then(
          () => { b.textContent = 'installed'; b.style.color = '#4a4'; setInstalled({ ...installed(), [e.name]: e.latestVersion ?? '?' }) },
          (x: unknown) => { b.textContent = 'failed'; b.title = String(x); b.style.color = '#c66' },
        )
      }
      return b
    }
    const row = (e: MarketEntry) => {
      const d = el('div', 'padding:6px 2px;border-bottom:1px solid #ffffff14;cursor:pointer')
      d.onclick = () => setView({ kind: 'detail', e })
      const title = el('div', 'font-weight:600')
      title.append(el('span', '', e.name), badge(e), installBtn(e))
      const desc = el('div', 'opacity:.6;font-size:12px', (e.description?.en ?? '').slice(0, 120))
      d.append(title, desc)
      return d
    }
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
      insert(list, () => filtered().map(row))
      root.appendChild(list)
      return root
    }

    // static chrome — built ONCE so the search input never loses focus to a
    // reactive re-render (the insert below only owns the body region)
    const chrome = () => {
      const root = el('div', 'padding:12px 12px 0;box-sizing:border-box')
      root.append(el('h3', 'margin:0 0 8px', 'opencode market'))
      const controls = el('div', 'display:flex;margin-bottom:8px')
      const q = document.createElement('input')
      q.placeholder = 'search…'
      q.style.cssText = 'flex:1;padding:6px;margin-right:6px;box-sizing:border-box'
      q.oninput = () => setQuery(q.value)
      controls.append(q,
        sel(categoriesOf(data()?.plugins ?? []), cat, setCat, 'all categories'),
        sel([...sorts], sort, setSort))
      root.appendChild(controls)
      return root
    }

    const detailView = (e: MarketEntry) => {
      const root = el('div', 'padding:12px;overflow:auto;height:100%;box-sizing:border-box')
      const back = el('button', 'font-size:12px;cursor:pointer;margin-bottom:10px', '← back')
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
        root.appendChild(el('h4', 'color:#c66;margin:12px 0 4px', 'red flags'))
        for (const f of caps.redFlags.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', `⚠ ${f}`))
      }
      if (caps?.findings.length) {
        root.appendChild(el('h4', 'margin:12px 0 4px', 'findings'))
        for (const f of caps.findings.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', f))
      }
      const btn = installBtn(e); btn.style.marginLeft = '0'
      root.appendChild(btn)
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
        if (!data()) return el('div', 'padding:12px;opacity:.6', 'loading…')
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
    m.provide(Market, {
        index: () => fetchIndex() as Promise<MarketIndex>,
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
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            execFile('opencode', ['plugin', 'add', name], { timeout: 60_000 },
              (e, out, er) => e ? reject(new Error(er || e.message)) : resolve(out || 'installed'))
          }),
      })
  },
})
