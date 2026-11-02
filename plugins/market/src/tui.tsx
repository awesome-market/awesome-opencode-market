/**
 * TUI entry — full-page marketplace mirroring the desktop GUI layout.
 * Page: router.register + JSX via @opentui/solid (host-provided runtime).
 * Keys: 1-7 tabs · / search · f filter · c category · enter detail ·
 * i/a install · u uninstall (native confirm) · * favorite · g group · n note.
 */
import { Plugin } from '@opencode/plugin/tui'
import { useTerminalDimensions } from '@opentui/solid'
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
    const open = (data?: Record<string, unknown>) =>
      ctx.ui.router.navigate({ type: 'plugin', name: 'market', ...(data ? { data } : {}) })

    ctx.ui.router.register({
      name: 'market',
      render: (input) => <MarketPage input={input} />,
    })

    ctx.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'opencode-market.open',
        title: 'Open plugin market',
        palette: true,
        slash: { name: 'market', arguments: true },
        run: (input) => { ctx.ui.dialog.clear(); open(typeof input === 'string' && input ? { q: input } : undefined) },
      }],
    }))

    function MarketPage(props: { input: { data?: Record<string, unknown> } }): JSX.Element {
      const theme = ctx.theme
      const dims = useTerminalDimensions()
      const [store, mutate] = ctx.storage.store<MarketState>('opencode-market', { initial: EMPTY_STATE as MarketState })
      const put = (fn: (d: MarketState) => void) => void mutate(fn)
      const [idx, setIdx] = createSignal<MarketIndex | null>(null)
      const [idxErr, setIdxErr] = createSignal('')
      const [installed, setInstalled] = createSignal<Record<string, string>>({})
      const [tab, setTab] = createSignal<Tab>('discover')
      const [query, setQuery] = createSignal(String(props.input.data?.q ?? ''))
      const [cat, setCat] = createSignal('')
      const [sortKey, setSortKey] = createSignal<string>('verified')
      const [asc, setAsc] = createSignal(false)
      const [days, setDays] = createSignal(0)
      const [sel, setSel] = createSignal(0)
      const [detail, setDetail] = createSignal<MarketEntry | null>(null)
      const [status, setStatus] = createSignal('')
      const [searchOn, setSearchOn] = createSignal(!!props.input.data?.q)
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
          if (code === 0) { setStatus(`${e.name} ${t('installed')} — ${t('restartNeeded')}`); void refreshInstalled(); void verify(e.name) }
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
      const verify = (name: string) =>
        new Promise<void>((resolve) => {
          const { mkdtempSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
          const { tmpdir } = require('node:os') as typeof import('node:os')
          const home = mkdtempSync(join(tmpdir(), 'mkt-verify-'))
          mkdirSync(join(home, '.config', 'opencode'), { recursive: true })
          writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ plugins: [name] }))
          const env = { ...process.env, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache') }
          const boot = `opencode serve --port 0 > serve.out 2>&1 & SPID=$!; for i in $(seq 1 20); do grep -q "server listening" serve.out 2>/dev/null && break; sleep 0.5; done; PORT=$(sed -n 's/.*127.0.0.1:\\([0-9]*\\).*/\\1/p' serve.out | head -1); PW=$(sed -n 's/server password //p' serve.out | head -1); [ -n "$PORT" ] && curl -s -u "opencode:$PW" -o /dev/null "http://127.0.0.1:$PORT/api/plugin"; sleep 1; kill $SPID 2>/dev/null; true`
          execFile('sh', ['-c', boot], { env, cwd: home, timeout: 25_000 }, () => {
            const lg = join(home, 'data', 'opencode', 'log', 'opencode.log')
            const ok = existsSync(lg) && new RegExp(`loading plugin."?\\s+id=${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(readFileSync(lg, 'utf8'))
            setStatus(`${name} ${ok ? t('activated') : t('restartNeeded')}`)
            resolve()
          })
        })
      const uninstall = async (e: MarketEntry) => {
        const ok = await ctx.ui.dialog.confirm({ title: t('uninstall'), message: `${e.name} — ${t('confirmUninstall')}`, label: { confirm: t('uninstall') } })
        if (!ok) return
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
        void ctx.ui.dialog.prompt({ title: t('group'), value: store.groups[e.name] ?? '' }).then(v => {
          if (v === undefined) return
          void mutate(d => { if (v) d.groups[e.name] = v; else delete d.groups[e.name] })
        })
      const editNote = (e: MarketEntry) =>
        void ctx.ui.dialog.prompt({ title: t('note'), value: store.notes[e.name] ?? '' }).then(v => {
          if (v === undefined) return
          void mutate(d => { if (v) d.notes[e.name] = v; else delete d.notes[e.name] })
        })
      const pickCategory = () =>
        void ctx.ui.dialog.select<string>({
          title: '分类',
          options: [{ title: `全部`, value: '' }, ...cats().map(c => ({ title: c, value: c }))],
          current: cat(),
        }).then(v => { if (v !== undefined) setCat(v) })
      const pickFilter = () =>
        void ctx.ui.dialog.select<string>({
          title: '筛选',
          options: [
            ...SORTS.map(([k, label]) => ({ title: `${sortKey() === k ? '✓ ' : ''}${label}`, value: `sort:${k}` })),
            { title: `${asc() ? '✓ ' : ''}升序`, value: 'asc' },
            ...RANGES.map(([d, label]) => ({ title: `${days() === d ? '✓ ' : ''}${label}`, value: `days:${d}` })),
          ],
        }).then(v => {
          if (v === undefined) return
          if (v === 'asc') { setAsc(!asc()); return }
          const [kind, x] = v.split(':')
          if (kind === 'sort') setSortKey(x); else setDays(Number(x))
        })

      const settingsItems: { label: string; run: () => void }[] = [
        { label: '导出备份 → ~/opencode-market-backup.json', run: () => {
          const p = join(homedir(), 'opencode-market-backup.json')
          try { writeFileSync(p, JSON.stringify(store, null, 2)); setStatus(`exported → ${p}`) } catch (x) { setStatus(`export fail: ${String(x)}`) }
        } },
        { label: '恢复（输入备份文件路径）', run: () => void ctx.ui.dialog.prompt({ title: '恢复', placeholder: '~/opencode-market-backup.json' }).then(v => {
          if (!v) return
          try {
            const d = JSON.parse(readFileSync(v.replace(/^~/, homedir()), 'utf8')) as MarketState
            if (typeof d !== 'object' || !d) throw new Error('bad shape')
            void mutate(x => { Object.assign(x, { favorites: d.favorites ?? {}, groups: d.groups ?? {}, notes: d.notes ?? {}, skillVers: d.skillVers ?? {} }) })
            setStatus('restored')
          } catch (x) { setStatus(`restore fail: ${String(x)}`) }
        }) },
        { label: '清空数据（收藏/分组/备注）', run: () => void ctx.ui.dialog.confirm({ title: '清空数据', message: '不可撤销，确认？' }).then(ok => {
          if (ok) void mutate(d => { d.favorites = {}; d.groups = {}; d.notes = {}; d.skillVers = {} })
        }) },
        { label: `开发日志: ${store.devlog ? '开' : '关'}（${LOG_FILE}）`, run: () => {
          void mutate(d => { d.devlog = !d.devlog })
          setStatus(`devlog ${store.devlog ? 'off' : 'on'} → ${LOG_FILE}`)
        } },
        { label: '查看日志', run: () => {
          const tail = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-20).join('\n') : '(empty)'
          void ctx.ui.dialog.alert({ title: '开发日志', message: tail })
        } },
        { label: `使用 HTTP catalog 源（${CATALOG_URL}）`, run: () => {
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

      ctx.keymap.layer(() => ({
        enabled: () => !searchOn(),
        commands: [
          { bind: 'escape', title: 'back', group: 'Market', run: () => {
            if (findingsOpen()) { setFindingsOpen(false); return }
            if (detail()) { setDetail(null); return }
            ctx.ui.router.navigate({ type: 'home' })
          } },
          { bind: 'up,k', title: 'up', group: 'Market', run: () => {
            if (tab() === 'settings') setSettingsSel(i => Math.max(0, i - 1))
            else setSel(i => Math.max(0, i - 1))
          } },
          { bind: 'down,j', title: 'down', group: 'Market', run: () => {
            if (tab() === 'settings') setSettingsSel(i => Math.min(settingsItems.length - 1, i + 1))
            else setSel(i => Math.min(pool().length - 1, i + 1))
          } },
          { bind: 'return', title: 'detail/run', group: 'Market', run: () => {
            if (tab() === 'settings') { settingsItems[settingsSel()]?.run(); return }
            const e = pick(); if (e) { setFindingsOpen(false); setDetail(e) }
          } },
          { bind: '/', title: 'search', group: 'Market', run: () => { setSearchOn(true); searchInput?.focus() } },
          { bind: 'f', title: 'filter', group: 'Market', run: pickFilter },
          { bind: 'c', title: 'category', group: 'Market', run: pickCategory },
          { bind: 'i', title: 'install', group: 'Market', run: () => { const e = detail() ?? pick(); if (e && actionLabel(e) !== `✓ ${t('installed')}`) install(e) } },
          { bind: 'u', title: 'uninstall', group: 'Market', run: () => { const e = detail() ?? pick(); if (e && verOf(e)) void uninstall(e) } },
          { bind: '*', title: 'favorite', group: 'Market', run: () => { const e = detail() ?? pick(); if (e) toggleFav(e) } },
          { bind: 'g', title: 'group', group: 'Market', run: () => { const e = detail() ?? pick(); if (e) editGroup(e) } },
          { bind: 'n', title: 'note', group: 'Market', run: () => { const e = detail() ?? pick(); if (e) editNote(e) } },
          { bind: 'x', title: 'findings', group: 'Market', run: () => { if (detail()?.capabilities) setFindingsOpen(!findingsOpen()) } },
          { bind: 'r', title: 'refresh', group: 'Market', run: () => { setIdxErr(''); fetchIndexCached().then(setIdx, e => setIdxErr(String(e))); void refreshInstalled() } },
          { bind: 'U', title: '全部更新', group: 'Market', run: () => setStatus('暂无更新（占位）') },
          { bind: 'q', title: 'quit', group: 'Market', run: () => ctx.ui.router.navigate({ type: 'home' }) },
          ...TABS.map(([id, label], i) => ({
            bind: String(i + 1), title: label, group: 'Market',
            run: () => { setTab(id); setSel(0); setDetail(null); setCat('') },
          })),
          { bind: 'tab', title: 'next tab', group: 'Market', run: () => {
            const i = TABS.findIndex(([id]) => id === tab())
            const [id] = TABS[(i + 1) % TABS.length]
            setTab(id); setSel(0); setDetail(null); setCat('')
          } },
        ],
      }))

      const Header = (): JSX.Element => (
        <box flexDirection="column" paddingLeft={1}>
          <box flexDirection="row">
            <text fg={theme.text.base}><b>opencode market</b></text>
            <text fg={theme.text.muted}>  oc-market-quail-zephyr-72a0 v0.0.3   {indexAge(idx())}   [U] 全部更新</text>
          </box>
          <box flexDirection="row">
            <For each={TABS}>{([id, label], i) => (
              <text fg={id === tab() ? theme.text.base : theme.text.muted}>
                {id === tab() ? `[${i() + 1} ${label}]` : ` ${i() + 1} ${label} `}{' '}
              </text>
            )}</For>
          </box>
        </box>
      )

      const List = (): JSX.Element => (
        <box flexDirection="column" flexGrow={1} minHeight={0}>
          <box flexDirection="row" paddingLeft={1}>
            <input
              flexGrow={1}
              placeholder={t('search')}
              value={query()}
              onInput={(v: string) => setQuery(v)}
              ref={(r) => { searchInput = r as unknown as typeof searchInput }}
              onKeyDown={(ev) => {
                if (ev.name === 'escape' || ev.name === 'return') { setSearchOn(false); (searchInput as { blur?(): void })?.blur?.() }
              }}
            />
            <text fg={theme.text.muted}> [f]筛选 {[sortKey(), asc() ? '↑' : '↓', days() ? `${days()}d` : ''].filter(Boolean).join('·')} </text>
          </box>
          <box flexDirection="row" paddingLeft={1}>
            <text fg={theme.text.muted}>[c] </text>
            <text fg={!cat() ? theme.text.base : theme.text.muted}>全部({pool().length}) </text>
            <For each={cats().slice(0, 6)}>{(c) => (
              <text fg={cat() === c ? theme.text.base : theme.text.muted}>{c} </text>
            )}</For>
          </box>
          <Show when={idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('fetchFailed')}: {idxErr()}</text></Show>
          <Show when={!idx() && !idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('loading')}</text></Show>
          <scrollbox flexGrow={1} minHeight={0}>
            <box flexDirection="column" paddingLeft={1} paddingRight={1}>
              <For each={pool()}>{(e, i) => {
                const active = () => i() === sel() && !detail()
                return (
                  <box flexDirection="column" marginTop={i() === 0 ? 0 : 1} border={active() ? ['left'] : undefined} borderColor={theme.text.base} paddingLeft={1}>
                    <box flexDirection="row">
                      <text fg={active() ? theme.text.base : theme.text.muted}>{active() ? '› ' : '  '}{store.favorites[e.name] ? '★' : '☆'}</text>
                      <text fg={active() ? theme.text.base : theme.text.muted}> {e.name} {badge(e)}</text>
                      <box flexGrow={1} />
                      <text fg={verOf(e) ? theme.text.base : theme.text.muted}>{actionLabel(e)}</text>
                    </box>
                    <text fg={theme.text.muted}>    {[`v${e.latestVersion ?? '?'}`, e.metrics?.npmDownloads30d ? `↓${e.metrics.npmDownloads30d}` : '', e.metrics?.stars ? `★${e.metrics.stars}` : ''].filter(Boolean).join(' · ')}   {categoriesOf(e).join(' ')}</text>
                    <text fg={theme.text.muted}>    {(e.description?.en ?? '').slice(0, 100)}</text>
                  </box>
                )
              }}</For>
              <Show when={idx() && !pool().length}><text fg={theme.text.muted}>  {t('noMatch')}</text></Show>
            </box>
          </scrollbox>
        </box>
      )

      const Detail = (): JSX.Element => {
        const e = detail()!
        const caps = e.capabilities
        return (
          <scrollbox flexGrow={1} minHeight={0}>
            <box flexDirection="column" paddingLeft={1}>
              <text fg={theme.text.base}><b>{store.favorites[e.name] ? '★ ' : '☆ '}{e.name}</b> {badge(e)}</text>
              <text fg={theme.text.muted}>{[`v${e.latestVersion ?? '?'}`, e.metrics?.npmDownloads30d ? `↓${e.metrics.npmDownloads30d}` : '', e.metrics?.stars ? `★${e.metrics.stars}` : '', categoriesOf(e).join(' ')].filter(Boolean).join(' · ')}</text>
              <box height={1} />
              <text fg={theme.text.base}>{e.description?.en ?? ''}</text>
              <Show when={e.description?.zh}><text fg={theme.text.muted}>{e.description?.zh}</text></Show>
              <box height={1} />
              <text fg={theme.text.muted}>{t('group')}: {store.groups[e.name] || '—'}   {t('note')}: {store.notes[e.name] || '—'}</text>
              <text fg={theme.text.base}>action: {actionLabel(e)}   [i] install/update   [u] {t('uninstall')}   [*] {t('favorites')}   [g] {t('group')}   [n] {t('note')}</text>
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
      }

      const Settings = (): JSX.Element => (
        <box flexDirection="column" paddingLeft={1} flexGrow={1}>
          <text fg={theme.text.base}><b>设置</b></text>
          <box height={1} />
          <For each={settingsItems}>{(item, i) => (
            <text fg={i() === settingsSel() ? theme.text.base : theme.text.muted}>
              {i() === settingsSel() ? '› ' : '  '}{item.label}
            </text>
          )}</For>
        </box>
      )

      return (
        <box width={dims().width} height={dims().height} flexDirection="column" backgroundColor={theme.background.base}>
          <Header />
          <Show when={detail()} fallback={tab() === 'settings' ? <Settings /> : <List />}><Detail /></Show>
          <box flexDirection="row" paddingLeft={1}>
            <text fg={theme.text.muted}>
              {status() || '↑↓/jk 选择 · enter 详情 · i 装 · u 卸 · * 收藏 · / 搜索 · f 筛选 · c 分类 · 1-7/tab 切页 · esc 返回'}
            </text>
          </box>
        </box>
      )
    }
  },
})
