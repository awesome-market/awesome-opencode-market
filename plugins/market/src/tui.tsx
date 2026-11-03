/**
 * TUI entry — marketplace dialog mirroring the desktop GUI.
 * Opens via ctx.ui.dialog (same as other plugins), not a full route page.
 * Keys: 1-7 tabs · / search · f filter · c category · arrows/hjkl 2D grid
 * nav · enter detail · i install · u uninstall (native confirm) ·
 * * favorite · g group · n note · esc back/close. Mouse: hover selects,
 * click opens detail.
 */
import { Plugin } from '@opencode/plugin/tui'
import { useTerminalDimensions, useKeyboard } from '@opentui/solid'
import { createSignal, createMemo, For, Show, onMount, type JSX } from 'solid-js'
import { spawn, execFile } from 'node:child_process'
import { readdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fetchIndexCached, search, sortEntries, categoriesOf, allCategories, inDays, hasUpdate, indexAge, scanSkillKeys, skillInstalledVer, t, EMPTY_STATE, type MarketEntry, type MarketIndex, type LocalState } from './catalog.js'
import { installSkillTar, uninstallSkillDir, GLOBAL_SKILLS_ROOT } from './skill-install.js'

type Tab = 'discover' | 'plugins' | 'skills' | 'favorites' | 'installed' | 'mySkills' | 'settings'
const TABS: readonly (readonly [Tab, string])[] = [
  ['discover', '发现'], ['plugins', '插件'], ['skills', '技能'],
  ['favorites', '收藏'], ['installed', '我的插件'], ['mySkills', '我的技能'], ['settings', '设置'],
]
const SORTS = [['downloads', '按 npm 下载量'], ['stars', '按 Star'], ['name', '按名称'], ['verified', '按验证状态']] as const
const RANGES = [[0, '全部时间'], [1, '1 天内'], [7, '7 天内'], [30, '30 天内'], [90, '90 天内'], [365, '1 年内']] as const
const CATALOG_URL = 'https://terry2010.github.io/opencode-market-spike/skills/'
const LOG_FILE = '/tmp/opencode-market.log'

interface MarketState extends LocalState { devlog?: boolean }

export default Plugin.define({
  id: 'opencode-market',
  setup(ctx) {
    let pendingQuery = ''
    ctx.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'opencode-market.open',
        title: 'Open plugin market',
        palette: true,
        slash: { name: 'market', arguments: true },
        run: (input) => {
          pendingQuery = typeof input === 'string' ? input : ''
          ctx.ui.dialog.clear()
          ctx.ui.dialog.show(() => <MarketDialog />)
          ctx.ui.dialog.set({ size: 'xlarge', centered: true })
        },
      }],
    }))

    function MarketDialog(): JSX.Element {
      const theme = ctx.theme
      const dims = useTerminalDimensions()
      const [store, mutate] = ctx.storage.store<MarketState>('opencode-market', { initial: EMPTY_STATE as MarketState })
      const [idx, setIdx] = createSignal<MarketIndex | null>(null)
      const [idxErr, setIdxErr] = createSignal('')
      const [installed, setInstalled] = createSignal<Record<string, string>>({})
      const [tab, setTab] = createSignal<Tab>('discover')
      const [query, setQuery] = createSignal(pendingQuery)
      const [cat, setCat] = createSignal('')
      const [sortKey, setSortKey] = createSignal<string>('verified')
      const [asc, setAsc] = createSignal(false)
      const [days, setDays] = createSignal(0)
      const [sel, setSel] = createSignal(0)
      const [detail, setDetail] = createSignal<MarketEntry | null>(null)
      const [status, setStatus] = createSignal('')
      const [searchOn, setSearchOn] = createSignal(!!pendingQuery)
      const [settingsSel, setSettingsSel] = createSignal(0)
      const [findingsOpen, setFindingsOpen] = createSignal(false)
      const jobs = new Map<string, ReturnType<typeof spawn>>()
      let searchInput: { focus(): void; blur(): void } | undefined

      const log = (line: string) => {
        if (!store.devlog) return
        try { appendFileSync(LOG_FILE, `${new Date().toLocaleString('sv-SE')} ${line}\n`) } catch { /* tmp unavailable */ }
      }
      const location = () => ctx.location ?? ctx.data.location.default()
      const refreshInstalled = async () => {
        const map: Record<string, string> = {}
        try {
          const res = await ctx.client.plugin.list({ location: location() })
          for (const p of res.data ?? [])
            if (p.source.type === 'package') map[p.source.target] = p.source.version ?? '?'
        } catch { /* server list unavailable */ }
        try {
          await ctx.data.location.skill.sync(location())
          for (const s of ctx.data.location.skill.list(location()) ?? []) map[`__skill_${s.id}`] = 'local'
        } catch { /* server skill list unavailable */ }
        Object.assign(map, scanSkillKeys(
          [GLOBAL_SKILLS_ROOT, join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')],
          d => readdirSync(d), p => existsSync(p)))
        setInstalled(map)
      }
      onMount(() => {
        fetchIndexCached().then(setIdx, e => setIdxErr(String(e)))
        void refreshInstalled()
        if (searchOn()) setTimeout(() => searchInput?.focus(), 50)
      })
      ctx.data.on('plugin.updated', () => void refreshInstalled())

      const pool = createMemo(() => {
        let list = idx()?.plugins ?? []
        switch (tab()) {
          case 'plugins': list = list.filter(p => !p.contains?.includes('skill')); break
          case 'skills': list = list.filter(p => p.contains?.includes('skill')); break
          case 'favorites': list = list.filter(p => store.favorites[p.name]); break
          case 'installed': list = list.filter(p => installed()[p.name] && !p.contains?.includes('skill')); break
          case 'mySkills': list = list.filter(p => p.contains?.includes('skill') && skillInstalledVer(installed(), p.name)); break
          case 'discover': case 'settings': default: break
        }
        if (days()) list = list.filter(p => inDays(p, days()))
        if (cat()) list = list.filter(p => categoriesOf(p).includes(cat()))
        if (query()) list = search(list, query())
        const s = sortEntries(list, sortKey())
        return asc() ? s.reverse() : s
      })
      const cats = createMemo(() => {
        let list = idx()?.plugins ?? []
        if (tab() === 'plugins' || tab() === 'installed') list = list.filter(p => !p.contains?.includes('skill'))
        if (tab() === 'skills' || tab() === 'mySkills') list = list.filter(p => p.contains?.includes('skill'))
        return allCategories(list)
      })
      // two-column grid: rows of card pairs
      const grid = createMemo(() => {
        const out: MarketEntry[][] = []
        const l = pool()
        for (let i = 0; i < l.length; i += 2) out.push(l.slice(i, i + 2))
        return out
      })
      const verOf = (e: MarketEntry) => {
        const disk = skillInstalledVer(installed(), e.name)
        return disk ? (store.skillVers?.[e.name] ?? disk) : undefined
      }
      const pick = () => pool()[sel()]

      const install = (e: MarketEntry) => {
        const isSkill = e.contains?.includes('skill')
        log(`install start ${e.name} skill=${isSkill}`)
        if (isSkill) { void installSkill(e); return }
        setStatus(`installing ${e.name}…`)
        const p = spawn('opencode', ['plugin', 'add', e.name], { env: process.env })
        jobs.set(e.name, p)
        const push = (d: Buffer) => setStatus(String(d).trim().split('\n').filter(Boolean).pop() ?? '')
        p.stdout?.on('data', push); p.stderr?.on('data', push)
        p.on('close', code => {
          jobs.delete(e.name)
          if (code === 0) { setStatus(`${e.name} ${t('installed')} — ${t('restartNeeded')}`); void refreshInstalled() }
          else { setStatus(`${e.name} install failed (exit ${code})`); log(`install fail ${e.name}: exit ${code}`) }
        })
        p.on('error', x => { jobs.delete(e.name); setStatus(`install throw: ${x.message}`); log(`install throw ${e.name}: ${x}`) })
      }
      const installSkill = async (e: MarketEntry) => {
        try {
          setStatus(`installing ${e.name}…`)
          const pk = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(e.name)}`)).json() as { 'dist-tags': { latest: string }; versions: Record<string, { dist: { tarball: string } }> }
          const url = pk.versions?.[pk['dist-tags']?.latest]?.dist?.tarball
          if (!url) throw new Error('no tarball')
          const buf = new Uint8Array(await (await fetch(url)).arrayBuffer())
          const msg = installSkillTar({ name: e.name, gzipped: buf, root: GLOBAL_SKILLS_ROOT })
          const v = e.latestVersion ?? 'local'
          await mutate(d => { d.skillVers ??= {}; d.skillVers[e.name] = v })
          setInstalled({ ...installed(), [`__skill_${e.name.split('/').pop()}`]: v })
          setStatus(`${e.name} ${t('installed')} (${msg})`)
        } catch (x) { setStatus(`install fail ${e.name}: ${String(x)}`); log(`install fail ${e.name}: ${String(x)}`) }
      }
      const uninstall = (e: MarketEntry) =>
        openMenu(`${e.name} — ${t('confirmUninstall')}`, [
          { label: `✗ ${t('uninstall')}`, run: () => void doUninstall(e) },
          { label: '取消', run: noop },
        ])
      const doUninstall = async (e: MarketEntry) => {
        const isSkill = e.contains?.includes('skill')
        log(`uninstall ${e.name}`)
        if (isSkill) {
          try { uninstallSkillDir(e.name, GLOBAL_SKILLS_ROOT) } catch (x) { setStatus(`uninstall fail: ${String(x)}`); return }
          const base = `__skill_${e.name.split('/').pop()}`
          const next = { ...installed() }
          for (const k of Object.keys(next)) if (k === e.name || k === base || k.startsWith(`${base}-`)) delete next[k]
          await mutate(d => { if (d.skillVers) delete d.skillVers[e.name] })
          setInstalled(next); setStatus(`${e.name} removed`)
        } else {
          execFile('opencode', ['plugin', 'remove', e.name], { timeout: 30_000 }, (err) => {
            if (err) { setStatus(`uninstall fail: ${err.message}`); return }
            const next = { ...installed() }; delete next[e.name]
            setInstalled(next); setStatus(`${e.name} removed`)
          })
        }
      }
      const toggleFav = (e: MarketEntry) =>
        void mutate(d => { if (d.favorites[e.name]) delete d.favorites[e.name]; else d.favorites[e.name] = true })
      const editGroup = (e: MarketEntry) =>
        openPrompt(t('group'), store.groups[e.name] ?? '', v =>
          void mutate(d => { if (v) d.groups[e.name] = v; else delete d.groups[e.name] }))
      const editNote = (e: MarketEntry) =>
        openPrompt(t('note'), store.notes[e.name] ?? '', v =>
          void mutate(d => { if (v) d.notes[e.name] = v; else delete d.notes[e.name] }))
      // host dialogs are a single slot — dialog.select/confirm/prompt would
      // replace (and on close, destroy) the market dialog. Inline overlays
      // keep the market mounted under a floating panel instead.
      interface MenuOpt { label: string; run: () => void }
      const [menu, setMenu] = createSignal<{ title: string; options: MenuOpt[]; sel: number } | null>(null)
      const openMenu = (title: string, options: MenuOpt[]) => setMenu({ title, options, sel: 0 })
      const noop = () => {}
      const [prompt, setPrompt] = createSignal<{ title: string; done: (v: string) => void } | null>(null)
      const [promptVal, setPromptVal] = createSignal('')
      let promptInput: { focus(): void } | undefined
      const openPrompt = (title: string, initial: string, done: (v: string) => void) => {
        setPromptVal(initial); setPrompt({ title, done }); setSearchOn(true)
      }
      const closePrompt = (v: string | null) => {
        const p = prompt(); setPrompt(null); setSearchOn(false)
        if (v !== null && p) p.done(v)
      }
      const pickCategory = () =>
        openMenu('分类', [{ label: '全部', run: () => setCat('') },
          ...cats().map(c => ({ label: c, run: () => setCat(c) }))])
      const pickFilter = () =>
        openMenu('筛选', [
          ...SORTS.map(([k, label]) => ({ label: `${sortKey() === k ? '✓ ' : ''}${label}`, run: () => setSortKey(k) })),
          { label: `${asc() ? '✓ ' : ''}升序`, run: () => setAsc(!asc()) },
          ...RANGES.map(([d, label]) => ({ label: `${days() === d ? '✓ ' : ''}${label}`, run: () => setDays(d) })),
        ])

      const settingsItems: { label: string; run: () => void }[] = [
        { label: '导出备份 → ~/opencode-market-backup.json', run: () => {
          const p = join(homedir(), 'opencode-market-backup.json')
          try { writeFileSync(p, JSON.stringify(store, null, 2)); setStatus(`exported → ${p}`) } catch (x) { setStatus(`export fail: ${String(x)}`) }
        } },
        { label: '恢复（输入备份文件路径）', run: () => openPrompt('恢复', '~/opencode-market-backup.json', v => {
          if (!v) return
          try {
            const d = JSON.parse(readFileSync(v.replace(/^~/, homedir()), 'utf8')) as MarketState
            if (typeof d !== 'object' || !d) throw new Error('bad shape')
            void mutate(x => { Object.assign(x, { favorites: d.favorites ?? {}, groups: d.groups ?? {}, notes: d.notes ?? {}, skillVers: d.skillVers ?? {} }) })
            setStatus('restored')
          } catch (x) { setStatus(`restore fail: ${String(x)}`) }
        }) },
        { label: '清空数据（收藏/分组/备注）', run: () => openMenu('清空数据 — 不可撤销，确认？', [
          { label: '✗ 清空', run: () => void mutate(d => { d.favorites = {}; d.groups = {}; d.notes = {}; d.skillVers = {} }) },
          { label: '取消', run: noop },
        ]) },
        { label: `开发日志: ${store.devlog ? '开' : '关'}（${LOG_FILE}）`, run: () => {
          void mutate(d => { d.devlog = !d.devlog })
          setStatus(`devlog ${store.devlog ? 'off' : 'on'} → ${LOG_FILE}`)
        } },
        { label: '查看日志', run: () => {
          const tail = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-15) : ['(empty)']
          openMenu('开发日志（esc 关闭）', tail.map(line => ({ label: line, run: noop })))
        } },
        { label: `使用 HTTP catalog 源`, run: () => {
          const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
          try {
            const d = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')) as { skills?: string[] } : {}
            const list = d.skills ?? []
            if (!list.includes(CATALOG_URL)) writeFileSync(cfg, JSON.stringify({ ...d, skills: [...list, CATALOG_URL] }, null, 2))
            setStatus(`catalog source ${list.includes(CATALOG_URL) ? 'already enabled' : 'enabled'} — ${t('restartNeeded')}`)
          } catch (x) { setStatus(`catalog fail: ${String(x)}`) }
        } },
      ]

      const actionLabel = (e: MarketEntry) => {
        const ver = verOf(e)
        if (ver && !hasUpdate(e, ver)) return `✓ ${t('installed')}`
        if (ver) return `update → v${e.latestVersion}`
        return 'add'
      }
      const badge = (e: MarketEntry) => {
        if (installed()[e.name] || skillInstalledVer(installed(), e.name)) return `[${t('installed')}]`
        const s = e.verification?.status
        return s ? `[${s === 'verified' ? t('verified') : s === 'failed' ? t('failed') : s === 'skipped' ? t('skipped') : t('unverified')}]` : ''
      }
      const openDetail = (e: MarketEntry) => { setFindingsOpen(false); setDetail(e) }
      // 2D nav: left/right moves 1, up/down moves 2 (columns)
      const move = (d: number) => setSel(i => Math.max(0, Math.min(pool().length - 1, i + d)))

      // dialogs run in the "modal" input mode — a plugin keymap layer must
      // target it explicitly or binds never dispatch (upstream btw.tsx pattern);
      // useKeyboard stays as fallback for hosts that route raw keys instead
      // focus zones: 'grid' (cards) | 'chrome' (menu bar: tabs/search/filter/chips)
      const [zone, setZone] = createSignal<'grid' | 'chrome'>('grid')
      const [chromeRow, setChromeRow] = createSignal(2)
      const [chromeSel, setChromeSel] = createSignal(0)
      // rows: 0 tabs | 1 search+filter | 2 'c'+chips — enter from grid lands on chips
      const chromeItems = (row = chromeRow()) =>
        row === 0 ? TABS.map(t => `tab:${t[0]}` as const) :
        row === 1 ? ['search', 'filter'] as const :
        ['cat', ...cats().slice(0, 6).map(c => `chip:${c}`)]
      const chromeGo = (d: number) =>
        setChromeSel(i => Math.max(0, Math.min(chromeItems().length - 1, i + d)))
      const chromeFocused = (row: number, s: number) =>
        zone() === 'chrome' && chromeRow() === row && chromeSel() === s
      const chromeRun = () => {
        const item = chromeItems()[chromeSel()]
        if (!item) return
        if (item.startsWith('tab:')) { toTab(TABS.findIndex(([id]) => id === item.slice(4))); return }
        if (item === 'search') { setSearchOn(true); searchInput?.focus(); return }
        if (item === 'filter') { pickFilter(); return }
        if (item === 'cat') { pickCategory(); return }
        if (item.startsWith('chip:')) setCat(item.slice(5))
      }
      const toTab = (i: number) => { setTab(TABS[i][0]); setSel(0); setDetail(null); setCat(''); setMenu(null); setZone('grid') }
      const act = (k: string): void => {
        const m = menu()
        if (m) {
          if (k === 'escape' || k === 'q') { setMenu(null); return }
          if (k === 'up' || k === 'k') { setMenu({ ...m, sel: Math.max(0, m.sel - 1) }); return }
          if (k === 'down' || k === 'j') { setMenu({ ...m, sel: Math.min(m.options.length - 1, m.sel + 1) }); return }
          if (k === 'return') { setMenu(null); m.options[m.sel]?.run(); return }
          return  // swallow other keys while a menu is open
        }
        if (k === 'escape') {
          if (zone() === 'chrome') { setZone('grid'); return }
          if (findingsOpen()) { setFindingsOpen(false); return }
          if (detail()) { setDetail(null); return }
          ctx.ui.dialog.clear(); return
        }
        if (zone() === 'chrome') {
          if (k === 'left' || k === 'h') { chromeGo(-1); return }
          if (k === 'right' || k === 'l') { chromeGo(1); return }
          if (k === 'up' || k === 'k') {
            if (chromeRow() > 0) { setChromeRow(r => r - 1); setChromeSel(0) }
            return
          }
          if (k === 'down' || k === 'j') {
            if (chromeRow() < 2) { setChromeRow(r => r + 1); setChromeSel(0) }
            else setZone('grid')
            return
          }
          if (k === 'return') { chromeRun(); return }
          if (k === 'tab') { toTab((TABS.findIndex(([id]) => id === tab()) + 1) % TABS.length); return }
          return
        }
        if (k === 'up' || k === 'k') {
          if (tab() === 'settings') { setSettingsSel(i => Math.max(0, i - 1)); return }
          if (sel() < 2) { setZone('chrome'); setChromeRow(2); setChromeSel(0); return }
          move(-2); return
        }
        if (k === 'down' || k === 'j') { tab() === 'settings' ? setSettingsSel(i => Math.min(settingsItems.length - 1, i + 1)) : move(2); return }
        if ((k === 'left' || k === 'h') && tab() !== 'settings') { move(-1); return }
        if ((k === 'right' || k === 'l') && tab() !== 'settings') { move(1); return }
        if (k === 'return') {
          if (tab() === 'settings') { settingsItems[settingsSel()]?.run(); return }
          const e = pick(); if (e) openDetail(e); return
        }
        if (k === '/') { setSearchOn(true); searchInput?.focus(); return }
        if (k === 'f') { pickFilter(); return }
        if (k === 'c') { pickCategory(); return }
        if (k === 'i') { const e = detail() ?? pick(); if (e && actionLabel(e) !== `✓ ${t('installed')}`) install(e); return }
        if (k === 'u') { const e = detail() ?? pick(); if (e && verOf(e)) void uninstall(e); return }
        if (k === '*') { const e = detail() ?? pick(); if (e) toggleFav(e); return }
        if (k === 'g') { const e = detail() ?? pick(); if (e) editGroup(e); return }
        if (k === 'n') { const e = detail() ?? pick(); if (e) editNote(e); return }
        if (k === 'x') { if (detail()?.capabilities) setFindingsOpen(!findingsOpen()); return }
        if (k === 'r') { setIdxErr(''); fetchIndexCached().then(setIdx, e => setIdxErr(String(e))); void refreshInstalled(); return }
        if (k === 'q') { ctx.ui.dialog.clear(); return }
        if (k === 'tab') { toTab((TABS.findIndex(([id]) => id === tab()) + 1) % TABS.length); return }
        const d = Number(k)
        if (d >= 1 && d <= TABS.length) toTab(d - 1)
      }
      const BINDS = 'escape up k down j left h right l return / f c i u * g n x r q tab 1 2 3 4 5 6 7'
      ctx.keymap.layer(() => ({
        mode: 'modal',
        enabled: () => !searchOn(),
        commands: BINDS.split(' ').map(b => ({ bind: b, run: () => act(b) })),
      }))
      useKeyboard((ev) => { if (!searchOn()) act(ev.name) })

      const wrap2 = (s: string, w: number): string[] => {
        const words = s.split(/\s+/)
        const lines: string[] = ['']
        for (const word of words) {
          const cur = lines[lines.length - 1]
          const next = cur ? `${cur} ${word}` : word
          if (next.length > w && cur) lines.push(word)
          else lines[lines.length - 1] = next
          if (lines.length > 2) break
        }
        if (lines.length > 2 || words.join(' ').length > lines.join(' ').length)
          lines[1] = `${lines[1].slice(0, Math.max(0, w - 1))}…`
        return lines.slice(0, 2)
      }

      const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s
      const Card = (props: { e: MarketEntry; i: number }) => {
        const e = props.e
        const active = () => props.i === sel() && !detail() && zone() === 'grid'
        return (
          <box flexDirection="column" flexGrow={1} flexBasis={0}
               border={['top', 'right', 'bottom', 'left']}
               borderColor={active() ? theme.text.base : theme.border.base}
               paddingLeft={1} paddingRight={1} marginRight={1}
               onMouseOver={() => { setZone('grid'); setSel(props.i) }}
               onMouseDown={(ev) => { if (!ev.defaultPrevented) { setMenu(null); setSel(props.i); openDetail(e) } }}>
            <box flexDirection="row">
              <text fg={active() ? theme.text.base : theme.text.muted}>{active() ? '› ' : '  '}{store.favorites[e.name] ? '★' : '☆'} {e.name} {badge(e)}</text>
              <box flexGrow={1} />
              <text fg={verOf(e) ? theme.text.base : theme.text.muted}
                    onMouseDown={(ev) => {
                      ev.stopPropagation(); ev.preventDefault()
                      const ver = verOf(e)
                      if (ver) uninstall(e); else install(e)
                    }}>{actionLabel(e)}</text>
            </box>
            <text fg={theme.text.muted}>{[`v${e.latestVersion ?? '?'}`, e.metrics?.npmDownloads30d ? `↓${e.metrics.npmDownloads30d}` : '', e.metrics?.stars ? `★${e.metrics.stars}` : ''].filter(Boolean).join(' · ')}</text>
            <For each={wrap2(e.description?.en ?? '', 42)}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>
            <text fg={theme.text.faint}>{categoriesOf(e).join('  ')}</text>
          </box>
        )
      }

      return (
        <box flexGrow={1} flexDirection="column" backgroundColor={theme.background.base}
             onMouseDown={() => { if (menu()) setMenu(null); if (prompt()) closePrompt(null) }}>
          <box flexDirection="column" flexShrink={0}>
            <box flexDirection="row" paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.base}><b>opencode market</b></text>
              <text fg={theme.text.muted}>  oc-market-quail-zephyr-72a0 v0.0.3 · {indexAge(idx())}</text>
              <box flexGrow={1} />
              <text fg={theme.text.muted}>[U] 全部更新</text>
            </box>
            <box flexDirection="row" paddingLeft={1}>
              <For each={TABS}>{([id, label], i) => (
                <box backgroundColor={chromeFocused(0, i()) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(0, i()) ? theme.text.action.primary.focused : id === tab() ? theme.text.base : theme.text.faint}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(0); setChromeSel(i()) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); toTab(i()) }}>
                    {id === tab() || chromeFocused(0, i()) ? `[${i() + 1} ${label}]` : ` ${i() + 1} ${label} `}{' '}
                  </text>
                </box>
              )}</For>
            </box>
            <Show when={!detail() && tab() !== 'settings'}>
              <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                <box backgroundColor={chromeFocused(1, 0) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(1, 0) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(1); setChromeSel(0) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); setSearchOn(true); searchInput?.focus() }}>/ </text>
                </box>
                <input
                  flexGrow={1}
                  placeholder={t('search')}
                  value={query()}
                  onInput={(v: string) => setQuery(v)}
                  ref={(r) => { searchInput = r as unknown as typeof searchInput }}
                  onKeyDown={(ev: { name: string }) => {
                    if (ev.name === 'escape' || ev.name === 'return') { setSearchOn(false); (searchInput as { blur?(): void })?.blur?.() }
                  }}
                />
                <box backgroundColor={chromeFocused(1, 1) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(1, 1) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(1); setChromeSel(1) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); pickFilter() }}> [f]筛选 {[sortKey(), asc() ? '↑' : '↓', days() ? `${days()}d` : ''].filter(Boolean).join('·')} </text>
                </box>
              </box>
              <box flexDirection="row" paddingLeft={1}>
                <box backgroundColor={chromeFocused(2, 0) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(2, 0) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(2); setChromeSel(0) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); pickCategory() }}>[c] </text>
                </box>
                <text fg={!cat() ? theme.text.base : theme.text.muted} onMouseDown={() => setCat('')}>全部({pool().length}) </text>
                <For each={cats().slice(0, 6)}>{(c, i) => (
                  <box backgroundColor={chromeFocused(2, 1 + i()) ? theme.background.action.primary.focused : undefined}>
                    <text fg={chromeFocused(2, 1 + i()) ? theme.text.action.primary.focused : cat() === c ? theme.text.base : theme.text.muted}
                          onMouseOver={() => { setZone('chrome'); setChromeRow(2); setChromeSel(1 + i()) }}
                          onMouseDown={() => setCat(c)}>{c} </text>
                  </box>
                )}</For>
              </box>
            </Show>
          </box>
          <Show
            when={detail()}
            fallback={
              tab() === 'settings'
                ? <box flexDirection="column" paddingLeft={1} flexGrow={1} minHeight={Math.max(6, dims().height - 10)}>
                    <text fg={theme.text.base}><b>设置</b></text>
                    <box height={1} />
                    <For each={settingsItems}>{(item, i) => (
                      <box backgroundColor={i() === settingsSel() ? theme.background.action.primary.focused : undefined}>
                        <text fg={i() === settingsSel() ? theme.text.action.primary.focused : theme.text.muted}
                              onMouseOver={() => setSettingsSel(i())}
                              onMouseDown={(ev) => { ev.stopPropagation(); settingsItems[i()]?.run() }}>
                          {i() === settingsSel() ? '› ' : '  '}{item.label}
                        </text>
                      </box>
                    )}</For>
                  </box>
                : <box flexDirection="column" flexGrow={1} minHeight={0}>
                    <Show when={idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('fetchFailed')}: {idxErr()}</text></Show>
                    <Show when={!idx() && !idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('loading')}</text></Show>
                    <scrollbox flexGrow={1} minHeight={0} height={Math.max(6, dims().height - 12)}>
                      <box flexDirection="column" paddingLeft={1}>
                        <For each={grid()}>{(pair, ri) => (
                          <box flexDirection="row" marginTop={ri() === 0 ? 0 : 1}>
                            <For each={pair}>{(e, ci) => <Card e={e} i={ri() * 2 + ci()} />}</For>
                          </box>
                        )}</For>
                        <Show when={idx() && !pool().length}><text fg={theme.text.muted}>  {t('noMatch')}</text></Show>
                      </box>
                    </scrollbox>
                  </box>
            }>
            {(() => {
              const e = detail()!
              const caps = e.capabilities
              return (
                <scrollbox flexGrow={1} minHeight={0} height={Math.max(6, dims().height - 10)}>
                  <box flexDirection="column" paddingLeft={1} paddingRight={1}>
                    <box flexDirection="row">
                      <text fg={theme.text.base}><b>{store.favorites[e.name] ? '★ ' : '☆ '}{e.name}</b> {badge(e)}</text>
                      <box flexGrow={1} />
                      <text fg={verOf(e) ? theme.text.base : theme.text.muted}>{actionLabel(e)}</text>
                    </box>
                    <text fg={theme.text.muted}>{[`v${e.latestVersion ?? '?'}`, e.metrics?.npmDownloads30d ? `↓${e.metrics.npmDownloads30d}` : '', e.metrics?.stars ? `★${e.metrics.stars}` : '', categoriesOf(e).join(' ')].filter(Boolean).join(' · ')}</text>
                    <box height={1} />
                    <text fg={theme.text.base}>{e.description?.en ?? ''}</text>
                    <Show when={e.description?.zh}><text fg={theme.text.muted}>{e.description?.zh}</text></Show>
                    <box height={1} />
                    <text fg={theme.text.muted}>{t('group')}: {store.groups[e.name] || '—'}   {t('note')}: {store.notes[e.name] || '—'}</text>
                    <text fg={theme.text.base}>[i] install/update   [u] {t('uninstall')}   [*] {t('favorites')}   [g] {t('group')}   [n] {t('note')}</text>
                    <Show when={caps?.redFlags?.length}>
                      <box height={1} />
                      <text fg={theme.text.base}>{t('redFlags')} ({caps!.redFlags.length}){!findingsOpen() ? '  [x] 展开' : ''}</text>
                      <Show when={findingsOpen()}><For each={caps!.redFlags}>{(f) => <text fg={theme.text.muted}>  ! {f}</text>}</For></Show>
                    </Show>
                    <Show when={findingsOpen() && caps?.findings.length}>
                      <text fg={theme.text.base}>{t('findings')}</text>
                      <For each={caps!.findings.slice(0, 20)}>{(f) => <text fg={theme.text.muted}>  · {f}</text>}</For>
                    </Show>
                    <Show when={!caps?.findings?.length && !caps?.redFlags?.length}>
                      <text fg={theme.text.muted}>{t('notSafe')}</text>
                    </Show>
                  </box>
                </scrollbox>
              )
            })()}
          </Show>
          <box flexDirection="row" paddingLeft={1} flexShrink={0}>
            <text fg={theme.text.muted}>
              {status() || '←↑↓→/hjkl 选择 · enter 详情 · i 装 · u 卸 · * 收藏 · / 搜索 · f 筛选 · c 分类 · 1-7/tab 切页 · esc 返回'}
            </text>
          </box>
          <Show when={menu()}>{(m) => (
            <box position="absolute" top={5} right={3} zIndex={100} flexDirection="column" minWidth={38}
                 onMouseDown={(ev) => ev.stopPropagation()}
                 border={['top', 'right', 'bottom', 'left']} borderColor={theme.border.base}
                 backgroundColor={theme.background.base} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.base}><b>{m().title}</b></text>
              <For each={m().options}>{(o, i) => (
                <box backgroundColor={i() === m().sel ? theme.background.action.primary.focused : undefined}>
                  <text fg={i() === m().sel ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => setMenu({ ...m(), sel: i() })}
                        onMouseDown={(ev) => { ev.stopPropagation(); const opt = m().options[i()]; setMenu(null); opt?.run() }}>
                    {i() === m().sel ? '› ' : '  '}{o.label}
                  </text>
                </box>
              )}</For>
            </box>
          )}</Show>
          <Show when={prompt()}>{(p) => (
            <box position="absolute" top={5} left={4} zIndex={101} flexDirection="column" minWidth={46}
                 onMouseDown={(ev) => ev.stopPropagation()}
                 border={['top', 'right', 'bottom', 'left']} borderColor={theme.border.base}
                 backgroundColor={theme.background.base} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.base}><b>{p().title}</b>  (enter 确认 · esc 取消)</text>
              <input
                value={promptVal()}
                onInput={(v: string) => setPromptVal(v)}
                ref={(r) => { promptInput = r; setTimeout(() => r.focus(), 50) }}
                onKeyDown={(ev: { name: string }) => {
                  if (ev.name === 'return') closePrompt(promptVal())
                  if (ev.name === 'escape') closePrompt(null)
                }}
              />
            </box>
          )}</Show>
        </box>
      )
    }
  },
})
