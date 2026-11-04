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
import { cleanSpec, dedupeToSpec, removeSpec, featuresMap, buildExtras } from './spec.js'
import { fetchIndex, fetchIndexCached, search, sortEntries, categoriesOf, allCategories, inDays, appendLog, readLog, clearLog, redactLog, keyLines, loadState, saveState, sanitizeState, hasUpdate, indexAge, t, tf, descOf, catLabel, setLangMode, langMode, EMPTY_STATE, scanSkillKeys, skillInstalledVer, pinSpec, approvedTarballUrl, type MarketEntry, type MarketIndex, type LocalState } from './catalog.js'
import { installSkillTar, uninstallSkillDir, MAX_SKILL_TGZ } from './skill-install.js'
import { assertPkgName, assertSpecForName, assertSkillId, skillId, readJson, strArrayField, writeJsonAtomic, marketLogPath, appendBounded, restrictedEnv } from './hostx.js'

const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { output: Schema.Unknown },
    refreshIndex: { output: Schema.Unknown },
    installed: { output: Schema.Unknown },
    install: { input: Schema.Unknown, output: Schema.String },
    update: { input: Schema.Unknown, output: Schema.String },
    cancelInstall: { input: Schema.String, output: Schema.String },
    verifyActivation: { input: Schema.String, output: Schema.String },
    uninstall: { input: Schema.String, output: Schema.String },
    writeSkill: { input: Schema.Unknown, output: Schema.String },
    uninstallSkill: { input: Schema.String, output: Schema.String },
    skillSource: { output: Schema.Unknown },
    skillPermission: { input: Schema.Unknown, output: Schema.Unknown },
    devlog: { input: Schema.String, output: Schema.String },
    setDevlog: { input: Schema.Boolean, output: Schema.String },
    readDevlog: { output: Schema.Unknown },
  },
  events: {
    progress: Schema.Unknown,   // { name, line, done, ok }
  },
})
type Api = {
  index(): Promise<MarketIndex>
  refreshIndex(): Promise<MarketIndex>
  installed(): Promise<{ versions: Record<string, string>; extras: { name: string; version: string }[]; features: Record<string, Record<string, true> | undefined> }>
  install(p: { name: string; spec?: string }): Promise<string>
  update(p: { name: string; spec?: string }): Promise<string>
  cancelInstall(name: string): Promise<string>
  verifyActivation(spec: string): Promise<string>
  uninstall(name: string): Promise<string>
  writeSkill(p: { name: string; b64: string }): Promise<string>
  uninstallSkill(name: string): Promise<string>
  skillSource(): Promise<{ url: string; enabled: boolean }>
  skillPermission(p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }): Promise<Record<string, string>>
  devlog(line: string): Promise<string>
  setDevlog(on: boolean): Promise<string>
  readDevlog(): Promise<string>
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
    // single document listener slot — chrome() rebuilds once per mount, so each
    // new build replaces the previous handler instead of accumulating listeners
    let docClick: ((ev: Event) => void) | null = null
    const [data, setData] = createSignal<MarketIndex | null>(null)
    const [installed, setInstalled] = createSignal<Record<string, string>>({})
    const [installedExtra, setInstalledExtra] = createSignal<{ name: string; version: string }[]>([])
    const [refText, setRefText] = createSignal('')
    const [featMap, setFeatMap] = createSignal<Record<string, Record<string, true> | undefined>>({})
    const [featFilter, setFeatFilter] = createSignal<Set<string>>(new Set())
    const toggleFeat = (k: string) => {
      const s = new Set(featFilter())
      s.has(k) ? s.delete(k) : s.add(k)
      setFeatFilter(s)
    }
    const partChips = (compact = false, only?: string[]) => {
      const grp = el('span', `display:inline-flex;border:1px solid rgba(128,128,128,.4);border-radius:12px;overflow:hidden;${compact ? '' : 'margin-left:4px'}`)
      const all = ([['server','server'],['tui','tui'],['gui','gui'],['rpc','rpc']] as const)
      const segs = only ? all.filter(([k]) => only.includes(k)) : all
      for (const [i, [k, label]] of segs.entries()) {
        const seg = el('button', `font-size:${compact ? '10' : '11'}px;cursor:pointer;padding:${compact ? '0 5px' : '2px 8px'};border:none;${i ? 'border-left:1px solid rgba(128,128,128,.35);' : ''}background:transparent;color:inherit;${!only && featFilter().has(k) ? 'background:#556;color:#fff' : ''}`, label) as HTMLButtonElement
        seg.title = tf('partsHint', { k })
        seg.onclick = (ev) => { ev.stopPropagation(); toggleFeat(k) }
        grp.appendChild(seg)
      }
      return grp
    }
    // host inventory features when installed; otherwise infer from scanned file paths
    const featuresOf = (e: MarketEntry): string[] => {
      const real = featMap()[e.name]
      if (real) return Object.keys(real)
      return e.features ?? []
    }
    const [err, setErr] = createSignal('')
    const [query, setQuery] = createSignal('')
    const [cat, setCat] = createSignal('')
    const [sort, setSort] = createSignal<string>('verified')
    const [view, setView] = createSignal<View>({ kind: 'list' })
    const [state, setState] = createSignal<LocalState>(EMPTY_STATE)
    const [favOnly, setFavOnly] = createSignal(false)
    const [tab, setTab] = createSignal<'discover'|'plugins'|'skills'|'favorites'|'installed'|'mySkills'|'advanced'>('discover')
    const [filterOpen, setFilterOpen] = createSignal(false)
    const [sortDir, setSortDir] = createSignal<'desc'|'asc'>('desc')
    const [rangeDays, setRangeDays] = createSignal(0)
    const [prog, setProg] = createSignal<Record<string, { lines: string[]; done?: boolean; ok?: boolean }>>({})
    try { const ls = loadState(); setState(ls); setLangMode(ls.lang ?? 'auto') } catch { /* storage unavailable */ }
    const devlog = () => !!state().devlog
    const log = (msg: string) => { if (devlog()) { appendLog(msg); void safe.devlog?.(msg).catch(() => {}) } }
    // keep the host-side file logger in sync with the toggle — host writes
    // must not happen when the user turned logging off
    void safe.setDevlog?.(devlog()).catch(() => {})
    const put = (patch: Partial<LocalState>) => {
      const s = { ...state(), ...patch }
      setState(s); try { saveState(s) } catch { /* noop */ }
      if ('devlog' in patch) void safe.setDevlog?.(!!s.devlog).catch(() => {})
    }
    const toggleFav = (n: string) => {
      const f = { ...state().favorites }
      f[n] ? delete f[n] : f[n] = true
      put({ favorites: f })
    }
    try {
      safe.on?.('progress', (d) => {
        const cur = prog()[d.name] ?? { lines: [] }
        setProg({ ...prog(), [d.name]: d.done
          ? { ...cur, done: true, ...(d.ok !== undefined ? { ok: d.ok } : {}) }
          : { lines: [...cur.lines, d.line].slice(-20) } })
      })
    } catch { /* older host: no events */ }

    safe.index().then(i => setData(i), e => setErr(String(e)))
    safe.installed?.().then(s => { setInstalled(s?.versions ?? {}); setInstalledExtra(s?.extras ?? []); setFeatMap(s?.features ?? {}) }, () => {})

    // tab scope — shared by filtered() and the 全部(N) category chips so the
    // count always matches what the list actually shows on every tab
    const tabPool = (): MarketEntry[] => {
      const all = data()?.plugins ?? []
      switch (tab()) {
        case 'plugins': return all.filter(p => !p.contains?.includes('skill'))
        case 'skills': return all.filter(p => p.contains?.includes('skill'))
        case 'installed':
          return [...all.filter(p => installed()[p.name]),
            ...installedExtra().map(x => ({ name: x.name, latestVersion: x.version, description: undefined, categories: [], contains: [], uncataloged: true } as unknown as MarketEntry))]
        case 'mySkills': return all.filter(p => p.contains?.includes('skill') && skillInstalledVer(installed(), p.name))
        case 'favorites': return all.filter(p => state().favorites[p.name])
        case 'advanced': return all.filter(p => (p.capabilities?.redFlags?.length ?? 0) > 0 || p.verification?.status === 'failed')
        case 'discover': default: return all
      }
    }
    const filtered = () => {
      const c = cat()
      let list = c ? tabPool().filter(p => categoriesOf(p).includes(c)) : tabPool()
      if (rangeDays()) list = list.filter(p => inDays(p, rangeDays()))
      const ff = featFilter()
      if (ff.size) list = list.filter(p => featuresOf(p).some(f => ff.has(f)))
      const srt = sortEntries(search(list, query()), sort())
      return sortDir() === 'asc' ? [...srt].reverse() : srt
    }
    const statusOf = (e: MarketEntry) =>
      installed()[e.name] ? `${t('installed')} v${installed()[e.name]}`
      // github-kind entries have no npm version — 'skipped' here means there is
      // nothing to run, not "有高危信号没跑" (honest-label rule, AGENTS.md)
      : e.latestVersion == null ? t('noInstallTarget')
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
      // color comes from the raw status, not the localized label — comparing
      // translated text to English literals silently breaks in zh mode
      const st = installed()[e.name] ? 'installed' : e.verification?.status ?? 'unverified'
      b.style.background = st === 'installed' || st === 'verified' ? '#1a7' : st === 'failed' ? '#c33' : st === 'skipped' ? '#885' : '#666'
      return b
    }
    // two-step confirm: first click arms (3s window), second click executes
    const uninstallBtn = (e: MarketEntry) => {
      const isSkill = e.contains?.includes('skill')
      const b = el('button', 'font-size:12px;cursor:pointer;color:#c66;background:transparent;border:1px solid rgba(200,80,80,.5);border-radius:6px;padding:2px 14px;white-space:nowrap;flex-shrink:0', t('uninstall')) as HTMLButtonElement
      let armed = false
      let timer = 0
      b.onclick = ev => {
        ev.stopPropagation()
        if (!armed) {
          armed = true; b.textContent = t('confirmUninstall'); b.style.borderColor = '#c66'
          timer = window.setTimeout(() => { armed = false; b.textContent = t('uninstall'); b.style.borderColor = 'rgba(200,80,80,.5)' }, 3000)
          return
        }
        window.clearTimeout(timer)
        b.disabled = true; b.textContent = '…'
        ;(isSkill ? safe.uninstallSkill(e.name) : safe.uninstall(e.name)).then(
          async () => {
            log(`uninstall ${e.name}`)
            // drop every key this entry could own: plugin id, skill dir, <base>-* lifts
            const base = `__skill_${skillId(e.name)}`
            const next = { ...installed() }
            delete next[e.name]
            for (const k of Object.keys(next)) if (k === base || k.startsWith(`${base}-`)) delete next[k]
            const sv = { ...(state().skillVers ?? {}) }; delete sv[e.name]
            put({ skillVers: sv }); setInstalled(next)
            setInstalledExtra(installedExtra().filter(x => x.name !== e.name))
            // daemon rescans config async — wait, then reconcile; drop the
            // entry from the fresh data too so it can't resurrect
            await new Promise(r => setTimeout(r, 2000))
            const fresh = await safe.installed?.().catch(() => null)
            if (fresh) {
              const v = { ...fresh.versions }; delete v[e.name]
              setInstalled(v)
              setInstalledExtra(fresh.extras.filter(x => x.name !== e.name))
              setFeatMap(fresh.features)
            }
          },
          (x: unknown) => { log(`uninstall fail ${e.name}: ${String(x)}`); b.disabled = false; armed = false; b.textContent = t('failedRetry'); b.title = String(x) },
        )
      }
      return b
    }
    const installBtn = (e: MarketEntry) => {
      const disk = skillInstalledVer(installed(), e.name)
      const ver = disk ? (state().skillVers?.[e.name] ?? disk) : undefined
      const isSkill = e.contains?.includes('skill')
      // progress-driven busy/failed states — a re-render during install must
      // keep showing … instead of resetting the button back to add
      const pr = prog()[e.name]
      if (pr && !pr.done) {
        if (!document.getElementById('oc-mk-spin')) {
          const st = document.createElement('style'); st.id = 'oc-mk-spin'
          st.textContent = '@keyframes oc-mk-spin{to{transform:rotate(360deg)}}'
          document.head.appendChild(st)
        }
        const b = el('button', 'font-size:12px;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.5);border-radius:6px;padding:2px 14px;opacity:.6;white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center')
        b.appendChild(el('span', 'width:10px;height:10px;border:2px solid rgba(128,128,128,.35);border-top-color:currentColor;border-radius:50%;display:inline-block;animation:oc-mk-spin .7s linear infinite'))
        return b
      }
      if (pr?.done && !pr.ok) {
        // inert-looking failure button — clicking opens the detail view where
        // the error context + export-log affordance live (AGENTS: 报错必须有下一步)
        const fb = el('button', 'font-size:12px;cursor:pointer;color:#c66;background:transparent;border:1px solid rgba(200,80,80,.5);border-radius:6px;padding:2px 14px;white-space:nowrap;flex-shrink:0', `${t('failedRetry')}?`) as HTMLButtonElement
        fb.title = pr.lines[pr.lines.length - 1] ?? ''
        fb.onclick = ev => { ev.stopPropagation(); setView({ kind: 'detail', e }) }
        return fb
      }
      // manage tabs get a real uninstall action; other tabs keep the quiet badge
      if (ver && !hasUpdate(e, ver))
        return tab() === 'installed' || tab() === 'mySkills'
          ? uninstallBtn(e)
          : el('span', 'font-size:11px;color:#1a7;white-space:nowrap;flex-shrink:0', `✓ ${t('installed')}`)
      const label = ver ? `${t('update')} → v${e.latestVersion}` : t('add')
      const b = el('button', 'font-size:12px;cursor:pointer;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.5);border-radius:6px;padding:2px 14px', label) as HTMLButtonElement
      b.onclick = ev => {
        ev.stopPropagation()
        b.disabled = true; b.textContent = '…'
        setProg({ ...prog(), [e.name]: { lines: ['installing…'], done: false, ok: false } })
        const failOut = (x: unknown) => {
          b.disabled = false; b.textContent = t('failedRetry'); b.title = String(x); b.style.color = '#c66'
          setProg({ ...prog(), [e.name]: { lines: [String(x)], done: true, ok: false } })
        }
        if (isSkill && typeof safe.writeSkill !== 'function') { log(`installSkill missing on host for ${e.name}`); return failOut('host missing writeSkill — plugin version mismatch') }
        log(`install start ${e.name} skill=${isSkill}`)
        const installSkillNet = async (): Promise<string> => {
          // pin to the catalog-approved version — dist-tags.latest is the
          // pendingUpdate users are NOT allowed to get yet (hold semantics)
          if (!e.latestVersion) throw new Error('no approved version to install')
          const pk = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(e.name)}`, { signal: AbortSignal.timeout(15_000) })).json() as { versions: Record<string, { dist: { tarball: string } }> }
          const url = approvedTarballUrl(pk, e)
          if (!url) throw new Error(`no tarball for approved v${e.latestVersion}`)
          const buf = await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer()
          if (buf.byteLength > MAX_SKILL_TGZ) throw new Error('tarball too large')
          const u8 = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768))
          const b64 = btoa(bin)
          return safe.writeSkill({ name: e.name, b64 })
        }
        const doInstall: () => Promise<string> = isSkill ? installSkillNet : () => (ver && hasUpdate(e, ver) && typeof safe.update === 'function' ? safe.update({ name: e.name, spec: pinSpec(e) }) : safe.install({ name: e.name, spec: pinSpec(e) }))
        try { doInstall().then(
          async () => {
            setProg({ ...prog(), [e.name]: { lines: [], done: true, ok: true } })
            if (isSkill) {
              // optimistic + version bookkeeping → real update detection later
              const v = e.latestVersion ?? 'local'
              setInstalled({ ...installed(), [`__skill_${skillId(e.name)}`]: v })
              put({ skillVers: { ...state().skillVers, [e.name]: v } })
              b.textContent = `${t('installed')}`; b.style.color = '#4a4'
            } else {
              // optimistic mark — daemon rescans config async; refresh after a
              // beat and keep the mark if the inventory still lags
              const expect = e.latestVersion ?? '?'
              setInstalled({ ...installed(), [e.name]: expect })
              await new Promise(r => setTimeout(r, 2000))
              const fresh = await safe.installed?.().catch(() => null)
              if (fresh) {
                if (!fresh.versions[e.name]) fresh.versions[e.name] = expect
                setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features)
              }
              const okNow = (fresh?.versions ?? installed())[e.name]
              b.textContent = okNow ? t('verifying') : t('installedPending')
              const verdict = await safe.verifyActivation?.(pinSpec(e)).catch(() => '')
              b.textContent = verdict === 'activated' ? `${t('installed')} · ${t('activated')}` : okNow ? `${t('installed')} — ${t('restartNeeded')}` : t('installedPending')
              b.style.color = verdict === 'activated' ? '#4a4' : '#da3'
            }
          },
          (x: unknown) => { log(`install fail ${e.name}: ${String(x)}`); failOut(x) },
        ) } catch (x) { log(`install throw ${e.name}: ${String(x)}`); failOut(x) }
      }
      return b
    }
    // repo page when the pipeline knows it, npm page otherwise — always a real landing
    const entryUrl = (e: MarketEntry) => e.source?.repo
      ? `https://github.com/${e.source.repo}`
      : `https://www.npmjs.com/package/${encodeURIComponent(e.name)}`

    const row = (e: MarketEntry) => {
      const d = el('div', 'padding:12px 14px;border-radius:8px;display:flex;flex-direction:column;min-height:110px;box-sizing:border-box;position:relative')
      // official [data-component=settings-list]: bg-layer-01 + 0.5px inset hairline via box-shadow
      d.style.background = 'var(--v2-background-bg-layer-01, color-mix(in srgb, CanvasText 4%, Canvas))'
      d.style.boxShadow = 'inset 0 0 0 0.5px var(--v2-border-border-muted, color-mix(in srgb, CanvasText 14%, transparent))'
      d.onmouseenter = () => {
        d.style.background = 'var(--v2-background-bg-layer-02, color-mix(in srgb, CanvasText 7%, Canvas))'; typeBadge.style.background = d.style.background; expander.style.background = d.style.background
        // card hover marks the action button with the settings-page focus ring
        if (btn.tagName === 'BUTTON') btn.style.boxShadow = 'inset 0 0 0 1.5px var(--v2-border-border-focus, #5b8def)'
      }
      d.onmouseleave = () => {
        d.style.background = 'var(--v2-background-bg-layer-01, color-mix(in srgb, CanvasText 4%, Canvas))'; typeBadge.style.background = d.style.background; expander.style.background = d.style.background
        if (btn.tagName === 'BUTTON') btn.style.boxShadow = ''
      }
      const title = el('div', 'font-weight:600;font-size:14px;display:flex;align-items:flex-start;gap:6px')
      const nameBox = el('span', 'flex:1;min-width:0;word-break:break-all;line-height:1.35')
      nameBox.append(e.name, badge(e))
      nameBox.style.cursor = 'pointer'
      nameBox.title = entryUrl(e)
      nameBox.onmouseenter = () => { nameBox.style.textDecoration = 'underline'; nameBox.style.textDecorationColor = 'rgba(128,128,128,.4)' }
      nameBox.onmouseleave = () => { nameBox.style.textDecoration = 'none' }
      nameBox.onclick = ev => { ev.stopPropagation(); try { ctx.system?.openExternal?.(entryUrl(e)) } catch { /* noop */ } }
      title.append(nameBox)
      const typeBadge = el('span', 'font-size:10px;line-height:16px;color:inherit;opacity:.85;border-radius:8px 8px 0 0;padding:1px 8px 0;position:absolute;top:-8px;right:10px;background:var(--v2-background-bg-layer-01,color-mix(in srgb, CanvasText 4%, Canvas));z-index:1', e.contains?.includes('skill') ? t('skill') : t('plugin'))
      // outline only for the ~9px above the card edge — inside part stays fused
      typeBadge.appendChild(el('span', 'position:absolute;inset:0 0 auto;height:8px;box-sizing:border-box;border:0.5px solid var(--v2-border-border-muted,color-mix(in srgb, CanvasText 14%, transparent));border-bottom:none;border-radius:8px 8px 0 0;pointer-events:none'))
      d.appendChild(typeBadge)
      const btn = installBtn(e); btn.style.flexShrink = '0'
      title.appendChild(btn)
      const meta = el('div', 'opacity:.5;font-size:11px;margin-top:1px')
      const dl = e.metrics?.npmDownloads30d, st = e.metrics?.stars
      meta.textContent = [`v${e.latestVersion ?? '?'}`,
        dl != null ? `↓${fmtN(dl)}` : '', st != null ? `★${fmtN(st)}` : '']
        .filter(Boolean).join(' · ')
      // desc clamps at 2 lines; ⌄ sits at the end of the last visible line and flips to ⌃ once expanded
      const desc = el('div', 'opacity:.6;font-size:12px;margin-top:3px;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;position:relative', descOf(e))
      const expander = el('div', 'font-size:11px;line-height:14px;opacity:.5;cursor:pointer;user-select:none;display:none;position:absolute;right:0;bottom:0;padding-left:6px', '⌄')
      expander.style.background = 'var(--v2-background-bg-layer-01, color-mix(in srgb, CanvasText 4%, Canvas))'
      const setClamp = (on: boolean) => {
        desc.style.display = on ? '-webkit-box' : 'block'
        desc.style.webkitLineClamp = on ? '2' : 'unset'
        desc.style.cursor = on ? 'pointer' : 'default'
        expander.textContent = on ? '⌄' : '⌃'
      }
      desc.onclick = () => { if (desc.style.display !== 'block') setClamp(false) }
      expander.onclick = ev => { ev.stopPropagation(); setClamp(desc.style.display === 'block') }
      desc.appendChild(expander)
      requestAnimationFrame(() => { if (desc.scrollHeight > desc.clientHeight + 2) { expander.style.display = ''; desc.style.cursor = 'pointer' } })
      const bottom = el('div', 'margin-top:6px;display:flex;align-items:center;gap:5px;flex-wrap:wrap')
      if (featuresOf(e).length) bottom.appendChild(partChips(true, featuresOf(e)))
      if (e.uncataloged) {
        bottom.appendChild(el('span', 'font-size:10px;padding:1px 8px;border:1px dashed rgba(128,128,128,.45);border-radius:10px;opacity:.6', t('uncataloged')))
      } else for (const ct of categoriesOf(e)) {
        const tg = el('span', 'font-size:10px;padding:1px 8px;border:1px solid rgba(128,128,128,.35);border-radius:10px;opacity:.75', catLabel(ct))
        tg.onclick = ev => { ev.stopPropagation(); setCat(ct) }
        bottom.appendChild(tg)
      }
      // bottom-right favorite bookmark (dsh style) — localStorage state
      const favBtn = el('button', 'margin-left:auto;font-size:14px;line-height:1;cursor:pointer;border:none;background:transparent;padding:2px 6px', state().favorites[e.name] ? '★' : '☆') as HTMLButtonElement
      const syncFav = () => { favBtn.textContent = state().favorites[e.name] ? '★' : '☆'; favBtn.style.color = state().favorites[e.name] ? '#da3' : 'rgba(128,128,128,.7)' }
      syncFav()
      favBtn.onclick = ev => { ev.stopPropagation(); toggleFav(e.name); syncFav() }
      bottom.appendChild(favBtn)
      d.append(title, meta, desc, bottom)
      const p = prog()[e.name]
      if (p && !p.done) {
        const bar = el('div', 'font-size:11px;opacity:.6;max-height:60px;overflow:hidden')
        bar.textContent = p.lines[p.lines.length - 1] ?? t('installing')
        const cx = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', t('cancel'))
        cx.onclick = ev => { ev.stopPropagation(); void safe.cancelInstall(e.name) }
        bar.appendChild(cx)
        d.appendChild(bar)
      }
      if (p?.done && p.ok === false) {
        const errBox = el('div', 'font-size:11px;color:#c66')
        errBox.textContent = keyLines(p.lines.join('\n')).join(' · ').slice(0, 200) || t('installFailed')
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

    const listView = () => {
      const root = el('div', '')
      const list = el('div')
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-content:start'
      // paged render — a filtered() change used to rebuild ~3000 cards at once;
      // first page + auto-load on scroll (sentinel) keeps tab switches instant
      const PAGE = 60
      const [visible, setVisible] = createSignal(PAGE)
      createEffect(() => { tab(); cat(); query(); sort(); sortDir(); favOnly(); rangeDays(); featFilter(); setVisible(PAGE) })
      insert(list, () => {
        const items = filtered()
        const rows = items.slice(0, visible()).map(row)
        if (items.length > visible()) {
          const more = el('button', `grid-column:1/-1;padding:10px;font-size:13px;cursor:pointer;opacity:.8;background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:8px;color:inherit`,
            `${t('loadMore')} (${items.length - visible()})`) as HTMLButtonElement
          more.onclick = () => setVisible(visible() + PAGE)
          rows.push(more)
        }
        return rows.length ? rows : [el('div', 'padding:12px;opacity:.6', t('noMatch'))]
      })
      // persistent sentinel — scrolling near the bottom appends the next page;
      // 240px rootMargin prefetches before the edge is actually reached
      const sentinel = el('div', 'height:1px')
      // absent in jsdom/server-envs — the load-more button still pages manually
      if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver(
          es => { if (es[0]?.isIntersecting && filtered().length > visible()) setVisible(visible() + PAGE) },
          { rootMargin: '240px' }).observe(sentinel)
      }
      root.appendChild(list)
      root.appendChild(sentinel)
      return root
    }

    // static chrome — built ONCE so the search input never loses focus to a
    // reactive re-render (the insert below only owns the body region)
    const chrome = (surface: 'panel' | 'settings') => {
      const root = el('div', 'padding:12px 12px 0;box-sizing:border-box')
      // header: title + pkg version + far-right 全部更新 (hardcoded placeholder)
      const head = el('div', 'display:flex;align-items:baseline;margin-bottom:10px')
      head.appendChild(el('h3', 'margin:0;font-size:15px;font-weight:600', 'opencode market'))
      head.appendChild(el('span', 'margin-left:12px;font-size:12px;opacity:.55', 'opencode-market v0.0.3'))
      const updAll = el('button', 'margin-left:auto;font-size:12px;cursor:pointer;padding:2px 14px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit', t('updateAll')) as HTMLButtonElement
      updAll.dataset.act = 'updateAll'   // dispatch marker — text changes per state/lang, this doesn't
      const runUpdateAll = async () => {
        if (typeof safe.update !== 'function') { updAll.textContent = t('needRestartDesk'); return }
        const outdated = (data()?.plugins ?? []).filter(e => { const v = installed()[e.name]; return !!v && hasUpdate(e, v) })
        if (!outdated.length) { updAll.textContent = t('allLatest'); setTimeout(() => { updAll.textContent = t('updateAll') }, 3000); return }
        updAll.disabled = true
        let ok = 0, fail = 0
        for (const e of outdated) {
          updAll.textContent = tf('updatingN', { n: ok + fail + 1, total: outdated.length })
          try { await safe.update({ name: e.name, spec: pinSpec(e) }); ok++ } catch { fail++ }
        }
        await new Promise(r => setTimeout(r, 2000))
        const fresh = await safe.installed?.().catch(() => null)
        if (fresh) { setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features) }
        updAll.disabled = false
        updAll.textContent = fail ? tf('updatedMix', { ok, fail }) : tf('updatedOk', { ok })
        setTimeout(() => { updAll.textContent = t('updateAll') }, 4000)
      }
      // same webview quirk as the refresh button — dispatch on the parent
      head.onmousedown = (ev) => { const t = ev.target as HTMLElement; if (t?.dataset?.act === 'updateAll') void runUpdateAll() }
      head.appendChild(updAll)
      root.appendChild(head)
      // panel tabs: two morphing slots + discover + ≡ (right edge)
      // at rest the row shows the long my-* tabs; hovering discover latches catalog mode where the
      // slots flip to plugins/skills — a slot click selects whichever label is showing. a selected
      // catalog tab echoes right of discover once the row settles back; my-*/discover/settings
      // selections highlight in place only.
      // settings surface skips the morphing — all five tabs render plainly in one row.
      const tabs = el('div', 'display:flex;gap:4px;margin-bottom:10px;overflow-x:auto;scrollbar-width:thin')
      const swaps: [HTMLElement, HTMLElement][] = []
      const slots: { tb: HTMLButtonElement; shortId: 'plugins' | 'skills'; longId: 'installed' | 'mySkills' }[] = []
      const fixed: { tb: HTMLButtonElement; id: string }[] = []
      const marker = el('button', 'font-size:13px;padding:3px 12px;border:none;border-radius:6px;background:rgba(128,128,128,.18);color:inherit;white-space:nowrap;font-weight:600;display:none;cursor:default;pointer-events:none;flex-shrink:0', '') as HTMLButtonElement
      let expandLatch = false
      const expanded = () => expandLatch
      const paint = () => {
        const ex = expanded(), id = tab()
        for (const [a, b] of swaps) { a.style.visibility = ex ? 'hidden' : 'visible'; b.style.visibility = ex ? 'visible' : 'hidden' }
        for (const s of slots) { const on = id === (ex ? s.shortId : s.longId); s.tb.style.background = on ? 'rgba(128,128,128,.18)' : 'transparent'; s.tb.style.fontWeight = on ? '600' : '400' }
        for (const f of fixed) { const on = id === f.id; f.tb.style.background = on ? 'rgba(128,128,128,.18)' : 'transparent'; f.tb.style.fontWeight = on ? '600' : '400' }
        const show = !expanded() && (id === 'plugins' || id === 'skills')
        marker.style.display = show ? '' : 'none'
        if (show) marker.textContent = t(id === 'plugins' ? 'tabPlugins' : 'tabSkills')
      }
      const hover = 'var(--v2-overlay-simple-overlay-hover, rgba(128,128,128,.1))'
      if (surface === 'settings') {
        for (const [id, key] of [['discover', 'tabDiscover'], ['plugins', 'tabPlugins'], ['skills', 'tabSkills'], ['installed', 'tabInstalled'], ['mySkills', 'tabMySkills']] as const) {
          const tb = el('button', 'font-size:13px;cursor:pointer;padding:3px 12px;border:none;border-radius:6px;background:transparent;color:inherit;white-space:nowrap;flex-shrink:0', t(key)) as HTMLButtonElement
          tb.onmouseenter = () => { tb.style.background = hover }
          tb.onmouseleave = () => paint()
          tb.onclick = () => { setTab(id); setFavOnly(false); paint() }
          fixed.push({ tb, id }); tabs.appendChild(tb)
        }
      } else {
        for (const [shortId, longId, shortKey, longKey] of [['plugins', 'installed', 'tabPlugins', 'tabInstalled'], ['skills', 'mySkills', 'tabSkills', 'tabMySkills']] as const) {
          const tb = el('button', 'font-size:13px;cursor:pointer;padding:3px 12px;border:none;border-radius:6px;background:transparent;color:inherit;white-space:nowrap;flex-shrink:0;display:grid;justify-items:center', '') as HTMLButtonElement
          const a = el('span', 'grid-area:1/1', t(longKey))                    // long label — default
          const b = el('span', 'grid-area:1/1;visibility:hidden', t(shortKey)) // short label — shown while expanded
          tb.append(a, b); swaps.push([a, b])
          tb.onmouseenter = () => { tb.style.background = hover }
          tb.onmouseleave = () => paint()
          tb.onclick = () => { setTab(expanded() ? shortId : longId); setFavOnly(false); paint() }
          slots.push({ tb, shortId, longId }); tabs.appendChild(tb)
        }
        const dc = el('button', 'font-size:13px;cursor:pointer;padding:3px 12px;border:none;border-radius:6px;background:transparent;color:inherit;white-space:nowrap;flex-shrink:0', t('tabDiscover')) as HTMLButtonElement
        dc.onmouseenter = () => { expandLatch = true; paint(); dc.style.background = hover }
        dc.onmouseleave = () => paint()
        dc.onclick = () => { setTab('discover'); setFavOnly(false); paint() }
        fixed.push({ tb: dc, id: 'discover' }); tabs.appendChild(dc); tabs.appendChild(marker)
      }
      const st = el('button', 'font-size:19px;cursor:pointer;padding:3px 12px;border:none;border-radius:6px;background:transparent;color:inherit;white-space:nowrap;flex-shrink:0;margin-left:auto', '≡') as HTMLButtonElement
      st.title = t('tabAdvanced'); st.setAttribute('aria-label', t('tabAdvanced'))
      st.onmouseenter = () => { st.style.background = hover }
      st.onmouseleave = () => paint()
      st.onclick = () => { setTab('advanced'); setFavOnly(false); paint() }
      fixed.push({ tb: st, id: 'advanced' }); tabs.appendChild(st)
      tabs.onmouseleave = () => { expandLatch = false; paint() }
      paint()
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
      const filt = el('button', 'font-size:12px;cursor:pointer;padding:4px 12px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit', t('filter')) as HTMLButtonElement
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
        section(t('sortField'), [
          [t('sortDownloads'), () => sort() === 'downloads', () => setSort('downloads')],
          [t('sortStars'), () => sort() === 'stars', () => setSort('stars')],
          [t('sortName'), () => sort() === 'name', () => setSort('name')],
          [t('sortVerified'), () => sort() === 'verified', () => setSort('verified')],
        ]),
        section(t('sortDirLabel'), [
          [t('sortDesc'), () => sortDir() === 'desc', () => setSortDir('desc')],
          [t('sortAsc'), () => sortDir() === 'asc', () => setSortDir('asc')],
        ]),
        section(t('publishRange'), [
          [t('rangeAll'), () => rangeDays() === 0, () => setRangeDays(0)],
          [t('range1d'), () => rangeDays() === 1, () => setRangeDays(1)],
          [t('range7d'), () => rangeDays() === 7, () => setRangeDays(7)],
          [t('range30d'), () => rangeDays() === 30, () => setRangeDays(30)],
          [t('range90d'), () => rangeDays() === 90, () => setRangeDays(90)],
          [t('range1y'), () => rangeDays() === 365, () => setRangeDays(365)],
        ]),
      )
      createEffect(() => { menu.style.display = filterOpen() ? '' : 'none' })
      filt.onclick = () => setFilterOpen(!filterOpen())
      if (docClick) document.removeEventListener('click', docClick)
      document.addEventListener('click', docClick = (ev: Event) => {
        // self-unhook once the panel is gone — the host has no unmount hook,
        // so a closed panel's listener would fire (harmlessly but forever)
        // on every document click until remount (N-14)
        if (!menu.isConnected) { document.removeEventListener('click', docClick!); docClick = null; return }
        if (!menu.contains(ev.target as Node) && ev.target !== filt) setFilterOpen(false)
      })
      root.appendChild(menu)
      // category chips row (dsh style)
      const chips = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px')
      insert(chips, () => {
        if (tab() === 'advanced') return []
        const pool = tabPool()
        const mk = (id: string, label: string) => {
          const c = el('button', 'font-size:11px;cursor:pointer;padding:2px 8px;border:1px solid rgba(128,128,128,.4);border-radius:12px;background:transparent;color:inherit', label) as HTMLButtonElement
          if (id && cat() === id) { c.style.background = '#556'; c.style.color = '#fff' }
          c.onclick = () => setCat(cat() === id ? '' : id)  // re-click deselects → 全部
          return c
        }
        const cats = [mk('', tf('allN', { n: pool.length })), partChips() as unknown as HTMLButtonElement,
          ...allCategories(pool).slice(0, 12).map(c => mk(c, catLabel(c)))]
        return cats
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
      for (const line of [
        `version: ${e.latestVersion ?? '?'}`,
        `verified: ${v?.verifiedAt?.slice(0, 10) ?? '—'} (opencode ${v?.opencodeVersion ?? '?'})`,
        `findings: ${caps?.findings?.length ?? 0} · redFlags: ${caps?.redFlags?.length ?? 0}`,
        `downloads30d: ${e.metrics?.npmDownloads30d ?? '—'} · stars: ${e.metrics?.stars ?? '—'}`,
      ]) info.appendChild(el('div', '', line))
      root.appendChild(info)
      root.appendChild(el('p', 'font-size:13px;line-height:1.5', descOf(e)))
      // findings/redFlags stay collapsed into a <details> — AGENTS: 默认收起进详情页
      const fold = (title: string, items: string[], warn: boolean) => {
        const d = document.createElement('details')
        d.style.cssText = 'margin:10px 0'
        const s = el('summary', `cursor:pointer;font-size:13px;${warn ? 'color:#c66' : ''}`, `${title} (${items.length})`)
        d.appendChild(s)
        for (const f of items.slice(0, 20)) d.appendChild(el('div', 'font-size:12px;opacity:.7;padding:2px 0 2px 14px', `${warn ? '⚠ ' : ''}${f}`))
        return d
      }
      if (caps?.redFlags?.length) root.appendChild(fold(t('redFlags'), caps.redFlags, true))
      if (caps?.findings?.length) root.appendChild(fold(t('findings'), caps.findings, false))
      if (!caps?.findings?.length && !caps?.redFlags?.length)
        root.appendChild(el('div', 'font-size:11px;opacity:.55;margin:8px 0', t('notSafe')))
      const btn = installBtn(e); btn.style.marginLeft = '0'
      root.appendChild(btn)
      // detail page keeps an uninstall affordance even on non-manage tabs,
      // where the primary element is just a '✓ installed' span — but never
      // render a second uninstall next to a real uninstall button
      if (btn.tagName !== 'BUTTON') {
        const un = uninstallBtn(e); un.style.marginLeft = '8px'
        root.appendChild(un)
      }
      return root
    }

    // remounting rebuilds the once-built chrome() too — needed when a change
    // affects static labels (e.g. language switch); insert regions re-render
    // on their own via signals
    const remounts = new Map<HTMLElement, () => void>()

    const settingsPanel = () => {
      const root = el('div', 'padding:8px 12px;max-width:520px')
      // button-level handlers don't fire in this webview (clicks bubble to
      // root though) — dispatch from the root listener instead
      root.onmousedown = (ev) => {
        const t = ev.target as HTMLElement
        const hit = t?.dataset?.act === 'refresh'
        void safe.devlog?.(`md root <${t?.tagName}> ${(t?.textContent ?? '').slice(0, 16)} hit=${hit}`).catch(() => {})
        if (hit) void doRefresh()
        const lm = t?.dataset?.lang as 'auto' | 'zh' | 'en' | undefined
        if (lm) { put({ lang: lm }); setLangMode(lm); remounts.forEach(r => r()) }
      }
      // language picker — persisted in localStorage; remount so once-built
      // chrome labels pick up the new mode too (body regions re-render anyway)
      root.appendChild(el('h4', 'margin:0 0 6px;font-weight:600', t('lang')))
      const langRow = el('div', 'display:flex;gap:6px;margin-bottom:14px')
      const langs = [['auto', 'langAuto'], ['zh', 'langZh'], ['en', 'langEn']] as const
      for (const [mode, key] of langs) {
        const b = el('button', 'font-size:12px;cursor:pointer;padding:3px 12px;border-radius:6px;color:inherit;' +
          (langMode() === mode ? 'border:1px solid rgba(128,128,128,.7);background:rgba(128,128,128,.15)' : 'border:1px solid rgba(128,128,128,.3);background:transparent'),
          t(key)) as HTMLButtonElement
        b.dataset.lang = mode
        langRow.appendChild(b)
      }
      root.appendChild(langRow)
      const refStatus = el('div', 'font-size:11px;opacity:.7;margin-bottom:8px')
      refStatus.textContent = refText()
      const refBtn = el('button', 'font-size:12px;cursor:pointer;padding:4px 14px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;margin-bottom:4px', t('refreshData')) as HTMLButtonElement
      refBtn.dataset.act = 'refresh'
      const doRefresh = () => void (async () => {
        void safe.devlog?.('refBtn fire').catch(() => {})
        refBtn.disabled = true; refBtn.textContent = t('refreshing'); setRefText(''); refStatus.textContent = ''
        const to = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t('timeout25'))), 25_000))])
        try {
          const idx = await to(typeof safe.refreshIndex === 'function' ? safe.refreshIndex() : safe.index())
          if (idx) setData(idx)
          const fresh = await safe.installed?.().catch(() => null)
          if (fresh) { setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features) }
          setRefText(`${tf('refreshedN', { n: idx?.plugins?.length ?? '?' })}，${new Date().toLocaleTimeString()}`)
        } catch (x) { setRefText(tf('refreshFailed', { err: String(x) })) } finally {
          refBtn.disabled = false; refBtn.textContent = t('refreshData')
        }
      })()
      root.appendChild(refBtn); root.appendChild(refStatus)
      root.appendChild(el('h4', 'margin:0 0 10px;font-weight:600', t('backupRestore')))
      const desc = el('div', 'font-size:12px;opacity:.6;margin-bottom:12px', t('backupDesc'))
      root.appendChild(desc)
      const status = el('div', 'font-size:11px;opacity:.6;margin-top:8px')
      const exp = el('button', 'font-size:12px;cursor:pointer;padding:4px 14px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;margin-right:8px', t('exportBackup')) as HTMLButtonElement
      exp.onclick = () => {
        const blob = new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = 'opencode-market-backup.json'; a.click()
        status.textContent = tf('exportedN', { file: 'opencode-market-backup.json' })
      }
      const ta = document.createElement('textarea')
      ta.placeholder = t('pasteBackup')
      ta.style.cssText = 'width:100%;height:80px;margin-top:8px;font-size:11px;box-sizing:border-box;background:var(--v2-background-bg-layer-01,Canvas);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:6px'
      const imp = el('button', 'font-size:12px;cursor:pointer;padding:4px 14px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;margin-top:6px', t('restore')) as HTMLButtonElement
      imp.onclick = () => {
        try {
          // field-shape validation — a crafted paste must not corrupt state
          put(sanitizeState(JSON.parse(ta.value)))
          status.textContent = t('restored')
        } catch { status.textContent = t('restoreInvalid') }
      }
      const clr = el('button', 'font-size:12px;cursor:pointer;padding:4px 14px;border:1px solid rgba(200,50,50,.5);border-radius:6px;background:transparent;color:#c55;margin-top:6px;margin-left:8px', t('clearData')) as HTMLButtonElement
      clr.onclick = () => { if (confirm(t('confirmClear'))) { put(EMPTY_STATE); status.textContent = t('cleared') } }
      root.append(exp, ta, imp, clr, status)
      // 开发日志开关（默认关）
      const dv = el('h4', 'margin:20px 0 6px;font-weight:600', t('devlogLabel'))
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = devlog()
      cb.onchange = () => put({ devlog: cb.checked })
      const cbL = el('label', 'font-size:12px;display:flex;gap:6px;align-items:center;cursor:pointer')
      cbL.append(cb, document.createTextNode(t('devlogDesc')))
      const logBox = el('pre', 'font-size:10px;max-height:160px;overflow:auto;margin-top:8px;padding:8px;border:1px solid rgba(128,128,128,.25);border-radius:6px;white-space:pre-wrap;user-select:text;-webkit-user-select:text;cursor:text')
      const refresh = () => { void safe.readDevlog?.().then(txt => { logBox.textContent = txt || t('noLogs') }).catch(() => {}) }
      refresh()
      const clrL = el('button', 'font-size:11px;cursor:pointer;padding:2px 10px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit;margin-top:6px', t('clearLogs')) as HTMLButtonElement
      clrL.onclick = () => { clearLog(); refresh() }
      root.append(dv, cbL, logBox, clrL)
      return root
    }

    const mount = (parent: HTMLElement, surface: 'panel' | 'settings') => {
      const shell = el('div', 'overflow:auto;height:100%')
      const head = chrome(surface)   // built ONCE — signal reads here don't get tracked
      const body = el('div')
      shell.append(head, body)
      createEffect(() => {
        head.style.display = (data() && view().kind === 'list') ? '' : 'none'
      })
      insert(body, () => {
        if (err()) {
          const d = el('div', 'padding:12px;color:#c66', `error: ${err()}`)
          const rb = el('button', 'margin-left:8px;font-size:12px;cursor:pointer', t('retry')) as HTMLButtonElement
          rb.onclick = () => { setErr(''); safe.index().then(i => setData(i), e => setErr(String(e))) }
          d.appendChild(rb)
          return d
        }
        if (!data()) return el('div', 'padding:12px;opacity:.6', t('loading'))
        const v = view()
        if (tab() === 'advanced') return settingsPanel()
        const n = v.kind === 'detail' ? detailView(v.e) : listView()
        n.style.padding = '0 12px 12px'
        return n
      })
      parent.appendChild(shell)
      remounts.set(parent, () => { parent.replaceChildren(); mount(parent, surface) })
    }

    ctx.add(SettingsPage, {
      id: 'market', title: 'Market', icon: 'marketplace' as any,
      render: () => { const host = el('div', 'height:100%'); mount(host, 'settings'); return host },
    })
    ctx.add(Panel, {
      id: 'market', title: 'Market', region: 'side' as const, transient: true,
      list: () => [{ id: 'market', title: 'Market' }],
      render: () => { const host = el('div', 'height:100%'); mount(host, 'panel'); return host },
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
      const specByName: Record<string, string> = {}
      const idByName: Record<string, string> = {}
      const featByName: Record<string, Record<string, true> | undefined> = {}
    // host-side file logging — per-user path, size-bounded, honors the
    // renderer's devlog toggle via setDevlog (no silent writes when off)
    let devlogOn = false
    const lg = (s: string) => {
      if (!devlogOn) return
      void marketLogPath().then(p => appendBounded(p, `${new Date().toLocaleString('sv-SE')} ${s}\n`)).catch(() => {})
    }
    const cfgPath = async () => {
      const { homedir } = require('node:os') as typeof import('node:os')
      const { join } = require('node:path') as typeof import('node:path')
      return join(homedir(), '.config', 'opencode', 'opencode.json')
    }
    m.provide(Market, {
        index: () => fetchIndexCached() as Promise<MarketIndex>,
        refreshIndex: () => fetchIndexCached(undefined, true) as Promise<MarketIndex>,
        installed: async () => {
          const { execFile } = require('node:child_process') as typeof import('node:child_process')
          const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
          const { homedir } = require('node:os') as typeof import('node:os')
          const { join } = require('node:path') as typeof import('node:path')
          const map: Record<string, string> = {}
          // host API first — source.target is the npm package name, which is
          // what catalog entries match on (CLI list reports internal ids)
          try {
            if (m.client?.plugin?.list) {
              const res = await m.client.plugin.list() as { data?: { id?: string; source?: { type?: string; target?: string; version?: string; path?: string } }[] }
              lg(`installed(): host api ${(res.data ?? []).length} items ${JSON.stringify((res.data ?? []).map(p => [p.source?.type, p.source?.target, p.source?.version]))}`)
              Object.assign(featByName, featuresMap(res.data ?? []))
              for (const p of res.data ?? []) {
                if (p.source?.type === 'package' && p.source.target) {
                  const clean = cleanSpec(p.source.target)
                  map[clean] = p.source.version ?? '?'
                  specByName[clean] = p.source.target
                  if (p.id) idByName[clean] = String(p.id)
                } else if (p.source?.type === 'local' && p.id) {
                  const clean = String(p.id)
                  map[clean] = 'local'; specByName[clean] = clean; idByName[clean] = clean
                }
              }
            }
          } catch { /* host api unavailable */ }
          if (!Object.keys(map).length) try {
            const out = await new Promise<string>((res, rej) =>
              execFile('opencode', ['plugin', 'list'], { timeout: 15_000 }, (e, o, er) => e ? rej(new Error(er || e.message)) : res(o)))
            for (const ln of out.split('\n').slice(1)) {
              const [id, ver, src] = ln.trim().split(/\s{2,}/)
              if (id) {
                map[id] = ver ?? '?'
                if (src) {
                  const clean = cleanSpec(src)
                  map[clean] = ver ?? '?'
                  specByName[clean] = src
                  idByName[clean] = id
                }
              }
            }
          } catch { /* plugin list unavailable — skills are still reported */ }
          Object.assign(map, scanSkillKeys(
            [join(homedir(), '.config', 'opencode', 'skills'), join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')],
            d => readdirSync(d), p => existsSync(p)))
          // installed plugins with no catalog entry still get a card
          const idxNames = new Set(((await fetchIndexCached())?.plugins ?? []).map(p => p.name))
          const extras = buildExtras(specByName, idByName, map, idxNames)
          for (const x of extras) map[x.name] = x.version
          return { versions: map, extras, features: featByName }
        },
        install: (p: { name: string; spec?: string }) =>
          new Promise<string>((resolve, reject) => {
            const { spawn } = require('node:child_process') as typeof import('node:child_process')
            try { assertSpecForName(p.name, p.spec) } catch (e) { reject(e); return }
            const spec = p.spec ?? p.name          // catalog-approved pinned spec (name@ver)
            const child = spawn('opencode', ['plugin', 'add', spec], { env: restrictedEnv() })
            jobs.set(p.name, child)
            const push = (line: string) => m.emit?.('progress', { name: p.name, line })
            child.stdout?.on('data', (d: Buffer) => push(String(d).trim()))
            child.stderr?.on('data', (d: Buffer) => push(String(d).trim()))
            const kill = setTimeout(() => child.kill('SIGTERM'), 90_000)
            child.on('close', code => {
              clearTimeout(kill); jobs.delete(p.name)
              m.emit?.('progress', { name: p.name, line: '', done: true, ok: code === 0 })
              code === 0 ? resolve('installed') : reject(new Error(`exit ${code}`))
            })
            child.on('error', (e: Error) => { clearTimeout(kill); jobs.delete(p.name); reject(e) })
          }),
        update: async (p: { name: string; spec?: string }) => {
          assertSpecForName(p.name, p.spec)
          lg(`update ${p.name}: called`)
          const pin = p.spec ?? p.name             // catalog-approved pinned spec
          const clean = cleanSpec(pin)
          lg(`update ${p.name}: pin=${pin} clean=${clean}`)
          const push = (line: string) => m.emit?.('progress', { name: p.name, line })
          const done = (ok: boolean) => m.emit?.('progress', { name: p.name, line: '', done: true, ok })
          try {
            // pinned update: `plugin add` does NOT dedupe — a second spec for the
            // same package appends. Install the pinned spec first, then rewrite
            // config down to exactly that spec. Never plugin.update — it resolves
            // npm latest, which would bypass the approved-version gate.
            push(`install ${pin}`)
            await new Promise<void>((res, rej) => {
              const { spawn } = require('node:child_process') as typeof import('node:child_process')
              const child = spawn('opencode', ['plugin', 'add', pin], { env: restrictedEnv() })
              jobs.set(p.name, child)
              child.stdout?.on('data', (d: Buffer) => push(String(d).trim()))
              child.stderr?.on('data', (d: Buffer) => push(String(d).trim()))
              const kill = setTimeout(() => child.kill('SIGTERM'), 90_000)
              child.on('close', code => { clearTimeout(kill); jobs.delete(p.name); code === 0 ? res() : rej(new Error(`plugin add exit ${code}`)) })
              child.on('error', (e: Error) => { clearTimeout(kill); jobs.delete(p.name); rej(e) })
            })
            {
              const cfg = await cfgPath()
              const d = await readJson(cfg)
              const list = strArrayField(d, 'plugins')
              const before = list.filter(s => cleanSpec(s) === clean)
              d.plugins = dedupeToSpec(list, pin)
              await writeJsonAtomic(cfg, d)
              if (before.length !== 1 || before[0] !== pin) { push(`config deduped ${before.join(',')} → ${pin}`); lg(`update ${p.name}: config rewritten (${before.length} specs → ${pin})`) }
            }
            lg(`update ${p.name}: pinned update ok`); done(true); return 'updated'
          } catch (x) { push(`update failed: ${String(x)}`); lg(`update ${p.name}: FAILED ${String(x)}`); done(false); throw x }
        },
        cancelInstall: async (name: string) => {
          jobs.get(name)?.kill('SIGTERM'); jobs.delete(name); return 'cancelled'
        },
        uninstall: async (name: string) => {
          assertPkgName(name)
          lg(`uninstall ${name}: called`)
          // remove the config spec(s) — daemon rescan unloads; CLI `plugin remove`
          // takes a spec, not the catalog name, and silently misses pinned specs
          const cfg = await cfgPath()
          const d = await readJson(cfg)
          const list = strArrayField(d, 'plugins')
          let keep: string[]
          try { keep = removeSpec(list, name, idByName) }
          catch { lg(`uninstall ${name}: no spec matched (plugins=${JSON.stringify(list)})`); throw new Error(`${name} not found in opencode.json plugins`) }
          d.plugins = keep
          await writeJsonAtomic(cfg, d)
          lg(`uninstall ${name}: removed ${list.length - keep.length} spec(s)`)
          return 'removed'
        },
        // skills are file-system installs: fetch tarball → extract into config/skills/<name>
        writeSkill: async (p: { name: string; b64: string }) => {
          const { homedir } = require('node:os') as typeof import('node:os')
          const { join } = require('node:path') as typeof import('node:path')
          assertSkillId(p.name)
          if (typeof p.b64 !== 'string' || p.b64.length > 64 * 1024 * 1024) throw new Error('invalid skill payload')
          return installSkillTar({ name: p.name, gzipped: Buffer.from(p.b64, 'base64'),
            root: join(homedir(), '.config', 'opencode', 'skills') })
        },
        skillSource: async () => {
          const url = 'https://terry2010.github.io/opencode-market-spike/skills/'
          const cfg = await cfgPath()
          const d = await readJson(cfg)
          const list = strArrayField(d, 'skills')
          if (!list.includes(url)) { d.skills = [...list, url]; await writeJsonAtomic(cfg, d) }
          return { url, enabled: true }
        },
        skillPermission: async (p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }) => {
          if (typeof p.id !== 'string' || !p.id || p.id.length > 200 || /[\\/]/.test(p.id))
            throw new Error('invalid skill id')
          if (p.mode !== 'allow' && p.mode !== 'deny' && p.mode !== 'ask' && p.mode !== null)
            throw new Error('invalid permission mode')
          const cfg = await cfgPath()
          const d = await readJson(cfg)
          const raw = d.permissions
          const perms = (Array.isArray(raw) ? raw : []).filter(
            (r): r is { action: string; resource: string; effect: string } =>
              !!r && typeof r === 'object' && typeof r.action === 'string' && typeof r.resource === 'string' && typeof r.effect === 'string')
          const rest = perms.filter(r => !(r.action === 'skill' && r.resource === p.id))
          if (p.mode) rest.push({ action: 'skill', resource: p.id, effect: p.mode })
          d.permissions = rest
          await writeJsonAtomic(cfg, d)
          return Object.fromEntries(rest.filter(r => r.action === 'skill').map(r => [r.resource, r.effect]))
        },
        readDevlog: async () => {
          try { const { readFileSync } = require('node:fs') as typeof import('node:fs')
            return readFileSync(await marketLogPath(), 'utf8').split('\n').filter(Boolean).slice(-100).join('\n')
          } catch { return '' }
        },
        devlog: async (line: string) => {
          if (!devlogOn) return 'off'
          await appendBounded(await marketLogPath(), `${new Date().toLocaleString('sv-SE')} ${String(line).slice(0, 2000)}\n`)
          return 'ok'
        },
        setDevlog: async (on: boolean) => { devlogOn = !!on; return 'ok' },
        uninstallSkill: (name: string) =>
          new Promise<string>((resolve, reject) => {
            const { homedir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            try { assertSkillId(name); resolve(uninstallSkillDir(name, join(homedir(), '.config', 'opencode', 'skills'))) }
            catch (e) { reject(e instanceof Error ? e : new Error(String(e))) }
          }),
        // self-confirm: isolated serve + API hit → real "did it load" verdict.
        // input is the pinned spec (name@approvedVersion) — a bare name would
        // resolve dist-tags.latest and test a version the user never got.
        verifyActivation: (spec: string) =>
          new Promise<string>((resolve, reject) => {
            let name: string
            try { name = cleanSpec(String(spec)); assertSpecForName(name, spec) } catch (e) { reject(e); return }
            const { execFile } = require('node:child_process') as typeof import('node:child_process')
            const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
            const { tmpdir } = require('node:os') as typeof import('node:os')
            const { join } = require('node:path') as typeof import('node:path')
            const home = mkdtempSync(join(tmpdir(), 'mkt-verify-'))
            mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
            writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ plugins: [spec] }))
            // HOME override is load-bearing on macOS: XDG_* alone leaves opencode
            // resolving config/state via the real ~ (the canary would read the
            // user's real config — false activated if the plugin is already in it,
            // permanent not-loaded otherwise). Same fix as pipeline/verify's xdgEnv.
            const env = restrictedEnv({ HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache') })
            // 2.2.5 loads plugins lazily on session CREATE — a GET alone never
            // triggers the load (same fix as pipeline/verify/verify.ts), then
            // poll the log for the canary instead of a fixed sleep (races writer)
            const boot = `opencode serve --port 0 > serve.out 2>&1 & SPID=$!; for i in $(seq 1 20); do grep -q "server listening" serve.out 2>/dev/null && break; sleep 0.5; done; PORT=$(sed -n 's/.*127.0.0.1:\\([0-9]*\\).*/\\1/p' serve.out | head -1); PW=$(sed -n 's/server password //p' serve.out | head -1); [ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null -X POST "http://127.0.0.1:$PORT/api/session" -H 'content-type: application/json' -d '{}'; for i in $(seq 1 16); do grep -q "loading plugin" "$LOG" 2>/dev/null && break; sleep 0.5; done; kill $SPID 2>/dev/null; true`
            const logEnv = { ...env, LOG: join(home, 'data', 'opencode', 'log', 'opencode.log') }
            execFile('sh', ['-c', boot], { env: logEnv, cwd: home, timeout: 25_000 }, () => {
              const log = join(home, 'data', 'opencode', 'log', 'opencode.log')
              const ok = existsSync(log) && new RegExp(`loading plugin."?\\s+id=${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(readFileSync(log, 'utf8'))
              resolve(ok ? 'activated' : 'not-loaded')
            })
          }),
      })
  },
})
