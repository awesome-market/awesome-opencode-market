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
import { fetchIndex, fetchIndexCached, search, sortEntries, categoriesOf, redactLog, keyLines, loadState, saveState, allGroups, hasUpdate, indexAge, t, EMPTY_STATE, type MarketEntry, type MarketIndex, type LocalState } from './catalog.js'

const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { output: Schema.Unknown },
    installed: { output: Schema.Unknown },
    install: { input: Schema.String, output: Schema.String },
    cancelInstall: { input: Schema.String, output: Schema.String },
    verifyActivation: { input: Schema.String, output: Schema.String },
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
      let list = c ? all.filter(p => p.category?.includes(c)) : all
      if (favOnly()) list = list.filter(p => s.favorites[p.name])
      const g = groupFilter()
      if (g) list = list.filter(p => s.groups[p.name] === g)
      return sortEntries(search(list, query()), sort())
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
      const b = el('span', 'margin-left:8px;font-size:11px;padding:1px 6px;border-radius:4px', s)
      b.style.color = '#fff'
      b.style.background = s.startsWith(t('installed')) ? '#1a7' : s === t('verified') || s === 'verified' ? '#1a7' : s === 'failed' ? '#c33' : s === 'skipped' ? '#885' : '#666'
      return b
    }
    const installBtn = (e: MarketEntry) => {
      const ver = installed()[e.name]
      const label = ver && hasUpdate(e, ver) ? `update → v${e.latestVersion}` : ver ? 'reinstall' : 'add'
      const b = el('button', 'margin-left:8px;font-size:11px;cursor:pointer;color:#eee;background:#333;border:1px solid #555;border-radius:4px;padding:1px 8px', label) as HTMLButtonElement
      b.onclick = ev => {
        ev.stopPropagation()
        b.disabled = true; b.textContent = '…'
        safe.install(e.name).then(
          async () => {
            // effectiveness re-check: reload installed list, flag restart need
            const fresh = await safe.installed?.().catch(() => installed())
            if (fresh) setInstalled(fresh)
            const okNow = (fresh ?? installed())[e.name]
            b.textContent = okNow ? 'verifying…' : `${t('installed')} (verify pending)`
            const verdict = await safe.verifyActivation?.(e.name).catch(() => '')
            b.textContent = verdict === 'activated' ? `${t('installed')} · activated` : okNow ? `${t('installed')} — restart to activate` : `${t('installed')} (verify pending)`
            b.style.color = verdict === 'activated' ? '#4a4' : '#da3'
          },
          (x: unknown) => { b.textContent = 'failed'; b.title = String(x); b.style.color = '#c66' },
        )
      }
      return b
    }
    const row = (e: MarketEntry) => {
      const d = el('div', 'padding:6px 2px;border-bottom:1px solid #ffffff14;cursor:pointer')
      d.onclick = () => setView({ kind: 'detail', e })
      const title = el('div', 'font-weight:600')
      const star = el('span', 'cursor:pointer;margin-right:4px', state().favorites[e.name] ? '★' : '☆')
      star.style.color = '#da3'
      star.onclick = ev => { ev.stopPropagation(); toggleFav(e.name); star.textContent = state().favorites[e.name] ? '★' : '☆' }
      title.append(star, el('span', '', e.name), badge(e), installBtn(e))
      const desc = el('div', 'opacity:.6;font-size:12px', (e.description?.en ?? '').slice(0, 120))
      const note = state().notes[e.name]
      d.append(title, desc)
      if (note) d.appendChild(el('div', 'font-size:11px;opacity:.55;font-style:italic', `📝 ${note}`))
      const p = prog()[e.name]
      if (p && !p.done) {
        const bar = el('div', 'font-size:11px;opacity:.6;max-height:60px;overflow:hidden')
        bar.textContent = p.lines[p.lines.length - 1] ?? 'installing…'
        const cx = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', 'cancel')
        cx.onclick = ev => { ev.stopPropagation(); void safe.cancelInstall(e.name) }
        bar.appendChild(cx)
        d.appendChild(bar)
      }
      if (p?.done && p.ok === false) {
        const errBox = el('div', 'font-size:11px;color:#c66')
        errBox.textContent = keyLines(p.lines.join('\n')).join(' · ').slice(0, 200) || 'install failed'
        const ex = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', 'export log')
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
      root.append(el('h3', 'margin:0 0 8px', `opencode market · ${indexAge(data())}`))
      const controls = el('div', 'display:flex;margin-bottom:8px')
      const q = document.createElement('input')
      q.placeholder = t('search')
      q.style.cssText = 'flex:1;padding:6px;margin-right:6px;box-sizing:border-box'
      q.oninput = () => setQuery(q.value)
      const favChip = el('button', 'font-size:11px;cursor:pointer;margin-right:6px', favOnly() ? '★ favorites' : '☆ favorites')
      favChip.onclick = () => { setFavOnly(!favOnly()); favChip.textContent = favOnly() ? '★ favorites' : '☆ favorites' }
      controls.append(q,
        sel(categoriesOf(data()?.plugins ?? []), cat, setCat, 'all categories'),
        sel(allGroups(state()), groupFilter, setGroupFilter, 'all groups'),
        sel([...sorts], sort, setSort), favChip)
      root.appendChild(controls)
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
        root.appendChild(el('h4', 'color:#c66;margin:12px 0 4px', 'red flags'))
        for (const f of caps.redFlags.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', `⚠ ${f}`))
      }
      if (caps?.findings.length) {
        root.appendChild(el('h4', 'margin:12px 0 4px', 'findings'))
        for (const f of caps.findings.slice(0, 20)) root.appendChild(el('div', 'font-size:12px;opacity:.7', f))
      }
      const btn = installBtn(e); btn.style.marginLeft = '0'
      root.appendChild(btn)
      // local state: group + note
      root.appendChild(el('h4', 'margin:14px 0 4px', 'group'))
      const gi = document.createElement('input')
      gi.placeholder = 'group name…'; gi.value = state().groups[e.name] ?? ''
      gi.style.cssText = 'padding:4px;font-size:12px;width:200px'
      gi.onchange = () => { const gr = { ...state().groups }; gi.value ? gr[e.name] = gi.value : delete gr[e.name]; put({ groups: gr }) }
      root.appendChild(gi)
      root.appendChild(el('h4', 'margin:14px 0 4px', 'note'))
      const ni = document.createElement('input')
      ni.placeholder = 'why did you install this…'; ni.value = state().notes[e.name] ?? ''
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
