/**
 * TUI entry — marketplace dialog mirroring the desktop GUI.
 * Opens via ctx.ui.dialog (same as other plugins), not a full route page.
 * Keys: 1-7 tabs · / search · f filter · c category · arrows/hjkl 2D grid
 * nav · enter detail · i install · u uninstall (native confirm) ·
 * * favorite · esc back/close. Mouse: hover selects,
 * click opens detail.
 */
import { Plugin } from '@opencode/plugin/tui'
import { useTerminalDimensions, useKeyboard } from '@opentui/solid'
import { createSignal, createMemo, createEffect, For, Show, onMount, type JSX } from 'solid-js'
import { fetchIndexCached, fetchOutcome, search, sortEntries, categoriesOf, allCategories, inDays, hasUpdate, verMarker, canInstall, installPlan, fetchPkgVersionMeta, integrityMatches, resolveIndexUrl, skillsUrl, indexAge, scanSkillKeys, skillInstalledVer, t, tf, descOf, catLabel, setLangMode, EMPTY_STATE, sanitizeState, pinSpec, fmtN, type MarketEntry, type MarketIndex, type LocalState, type InstallPlan } from './catalog.js'
import { dedupeToSpec, removeSpec } from './spec.js'
import { installSkillTar, uninstallSkillDir, globalSkillsRoot, MAX_SKILL_TGZ } from './skill-install.js'
import { assertSpecForName, skillId, readJson, strArrayField, writeJsonAtomic, marketLogPath, appendBounded, restrictedEnv } from './hostx.js'
import { PKG_VERSION } from './version.js'

type Tab = 'discover' | 'plugins' | 'skills' | 'favorites' | 'installed' | 'mySkills' | 'settings'
// labels go through t() — must be functions, not module consts, or they'd
// freeze at import-time language
const TABS = (): readonly (readonly [Tab, string])[] => [
  ['discover', t('tabDiscover')], ['plugins', t('tabPlugins')], ['skills', t('tabSkills')],
  ['favorites', t('tabFavorites')], ['installed', t('tabInstalled')], ['mySkills', t('tabMySkills')], ['settings', t('tabAdvanced')],
]
const SORTS = () => [['downloads', t('sortDownloads')], ['stars', t('sortStars')], ['name', t('sortName')], ['verified', t('sortVerified')]] as const
const RANGES = () => [[0, t('rangeAll')], [1, t('range1d')], [7, t('range7d')], [30, t('range30d')], [90, t('range90d')], [365, t('range1y')]] as const
// catalog endpoints resolve inside setup() — plugin options > env > default
// per-user debug log (not a predictable world-writable /tmp path) — resolved
// lazily; the label falls back to the display form until the real path is in
let LOG_FILE = '~/.config/opencode/market.log'

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
      // catalog endpoint — plugin options (opencode.json) > env > default
      const INDEX_URL = resolveIndexUrl((ctx as { options?: { indexUrl?: unknown } }).options)
      const CATALOG_URL = skillsUrl(INDEX_URL)
      const [store, mutate] = ctx.storage.store<MarketState>('opencode-market', { initial: EMPTY_STATE as MarketState })
      const [idx, setIdx] = createSignal<MarketIndex | null>(null)
      const [idxErr, setIdxErr] = createSignal('')
      const [installed, setInstalled] = createSignal<Record<string, string>>({})
      const [tab, setTab] = createSignal<Tab>('discover')
      const [query, setQuery] = createSignal(pendingQuery)
      const [cat, setCat] = createSignal('')
      const toggleCat = (c: string) => setCat(cat() === c ? '' : c)  // re-select deselects → 全部
      const [sortKey, setSortKey] = createSignal<string>('verified')
      const [asc, setAsc] = createSignal(false)
      const [days, setDays] = createSignal(0)
      const [sel, setSel] = createSignal(0)
      const [detail, setDetail] = createSignal<MarketEntry | null>(null)
      const [status, setStatus] = createSignal('')
      const [searchOn, setSearchOn] = createSignal(!!pendingQuery)
      const [settingsSel, setSettingsSel] = createSignal(0)
      const [findingsOpen, setFindingsOpen] = createSignal(false)
      const jobs = new Map<string, unknown>()
      let searchInput: { focus(): void; blur(): void } | undefined

      const log = (line: string) => {
        if (!store.devlog) return
        void marketLogPath().then(p => { LOG_FILE = p; return appendBounded(p, `${new Date().toLocaleString('sv-SE')} ${line}\n`) }).catch(() => {})
      }
      const location = () => ctx.location ?? ctx.data.location.default()
      const refreshInstalled = async () => {
        const map: Record<string, string> = {}
        try {
          const res = await ctx.client.plugin.list({ location: location() })
          for (const p of res.data ?? [])
            if (p.source.type === 'package') {
              const clean = p.source.target.replace(/^((?:@[^/]+\/)?[^@]+)@.*$/, '$1')
              map[clean] = p.source.version ?? '?'
            }
        } catch { /* server list unavailable */ }
        try {
          await ctx.data.location.skill.sync(location())
          for (const s of ctx.data.location.skill.list(location()) ?? []) map[`__skill_${s.id}`] = 'local'
        } catch { /* server skill list unavailable */ }
        const { readdirSync, existsSync } = await import('node:fs')
        const { homedir } = await import('node:os')
        const { join } = await import('node:path')
        Object.assign(map, scanSkillKeys(
          [await globalSkillsRoot(), join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')],
          d => readdirSync(d), p => existsSync(p)))
        setInstalled(map)
      }
      onMount(() => {
        setLangMode(store.lang ?? 'auto')
        fetchIndexCached(INDEX_URL).then(setIdx, e => setIdxErr(String(e)))
        void refreshInstalled()
        if (searchOn()) setTimeout(() => searchInput?.focus(), 50)
      })
      ctx.data.on('plugin.updated', () => void refreshInstalled())

      // installed-but-uncataloged plugins get synthetic cards (GUI parity)
      const extras = createMemo<MarketEntry[]>(() => {
        const names = new Set((idx()?.plugins ?? []).map(p => p.name))
        return Object.keys(installed())
          .filter(k => !k.startsWith('__skill_') && !names.has(k))
          .map(k => ({ name: k, slug: k, latestVersion: installed()[k], type: 'plugin', category: [], uncataloged: true, contains: ['plugin'] }) as MarketEntry)
      })
      const pool = createMemo(() => {
        let list = idx()?.plugins ?? []
        switch (tab()) {
          case 'plugins': list = list.filter(p => !p.contains?.includes('skill')); break
          case 'skills': list = list.filter(p => p.contains?.includes('skill')); break
          case 'favorites': list = list.filter(p => store.favorites[p.name]); break
          case 'installed': list = [...list.filter(p => installed()[p.name]), ...extras()]; break
          case 'mySkills': list = list.filter(p => p.contains?.includes('skill') && skillInstalledVer(installed(), p.name)); break
          case 'discover': case 'settings': default: break
        }
        if (days()) list = list.filter(p => inDays(p, days()))
        if (cat()) list = list.filter(p => categoriesOf(p).includes(cat()))
        if (query()) list = search(list, query())
        const s = sortEntries(list, sortKey())
        return asc() ? s.reverse() : s
      })
      // render cap — thousands of cards mount lazily; selection growth pages in more
      const [cap, setCap] = createSignal(120)
      createEffect(() => { pool(); setCap(120) })
      const shown = () => pool().slice(0, cap())
      const cats = createMemo(() => {
        let list = idx()?.plugins ?? []
        if (tab() === 'plugins' || tab() === 'installed') list = list.filter(p => !p.contains?.includes('skill'))
        if (tab() === 'skills' || tab() === 'mySkills') list = list.filter(p => p.contains?.includes('skill'))
        return allCategories(list)
      })
      // card grid adapts to terminal width — 2 cols only when a card still
      // gets ~48 chars; narrow screens collapse to a single column
      const cols = () => (dims().width ?? 120) >= 104 ? 2 : 1
      const descW = () => cols() === 2 ? 42 : Math.max(20, (dims().width ?? 120) - 14)
      const grid = createMemo(() => {
        const out: MarketEntry[][] = []
        const l = shown()
        const c = cols()
        for (let i = 0; i < l.length; i += c) out.push(l.slice(i, i + c))
        return out
      })
      const verOf = (e: MarketEntry) => {
        const disk = skillInstalledVer(installed(), e.name)
        return disk ? (store.skillVers?.[e.name] ?? disk) : undefined
      }
      const pick = () => pool()[sel()]
      let listScroll: { scrollTop: number; scrollTo(y: number): void } | undefined
      // selection near the render edge pulls the next page in
      const growCap = (i: number) => { if (i >= cap() - cols() * 2) setCap(c => Math.min(pool().length, c + 120)) }
      createEffect(() => {
        sel()
        setTimeout(() => {
          const r = listScroll
          if (!r) return
          const top = Math.floor(sel() / cols()) * 8
          const vp = Math.max(6, dims().height - 12)
          if (top < r.scrollTop) r.scrollTo(top)
          else if (top + 8 > r.scrollTop + vp) r.scrollTo(top + 8 - vp)
        }, 0)
      })

      const install = async (e: MarketEntry) => {
        const plan = installPlan(e)
        log(`install start ${e.name} plugin=${plan.plugin} skill=${plan.skill}`)
        if (!plan.plugin) { if (plan.skill) void installSkill(e, plan); return }
        // dual-nature entries deliver BOTH parts — skill install runs async
        // alongside the plugin spawn (independent surfaces)
        if (plan.skill) void installSkill(e, plan)
        setStatus(tf('installingN', { name: e.name }))
        const { spawn } = await import('node:child_process')
        const ver = installed()[e.name]
        // pin to the catalog-approved version — `plugin add` accepts name@ver
        // and never silently resolves past what review allowed
        const pin = pinSpec(e)
        try { assertSpecForName(e.name, pin) } catch (x) { setStatus(`install fail ${e.name}: ${String(x)}`); return }
        const updating = !!(ver && hasUpdate(e, ver))
        const afterAdd = async () => {
          if (!updating) return
          // `plugin add` appends rather than dedupes — rewrite config down to
          // exactly the pinned spec so no stale/duplicate specs linger
          const { homedir } = await import('node:os')
          const { join } = await import('node:path')
          const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
          const d = await readJson(cfg)
          const list = strArrayField(d, 'plugins')
          d.plugins = dedupeToSpec(list, pin)
          await writeJsonAtomic(cfg, d)
        }
        if (updating) setStatus(`${t('update')} ${e.name} → ${e.latestVersion ?? '?'}…`)
        const p = spawn('opencode', ['plugin', 'add', pin], { env: restrictedEnv() })
        jobs.set(e.name, p)
        // 90s ceiling — a wedged `plugin add` must not hold the dialog status
        // forever (GUI main already kills at 90s; the TUI had none)
        let timedOut = false
        const kill = setTimeout(() => { timedOut = true; p.kill('SIGTERM') }, 90_000)
        const push = (d: Buffer) => setStatus(String(d).trim().split('\n').filter(Boolean).pop() ?? '')
        p.stdout?.on('data', push); p.stderr?.on('data', push)
        p.on('close', code => {
          clearTimeout(kill); jobs.delete(e.name)
          if (timedOut) { setStatus(tf('installFailN', { name: e.name, exit: ' (timeout 90s)', key: 'i' })); log(`install fail ${e.name}: timeout`) }
          else if (code === 0) {
            void afterAdd().then(() => {
              setStatus(updating ? tf('updatedN', { name: e.name }) : `${e.name} ${t('installed')} — ${t('restartNeeded')}`)
              void refreshInstalled()
            }).catch(x => setStatus(tf('updateFail', { err: String(x) })))
          }
          else { setStatus(tf('installFailN', { name: e.name, exit: ` (exit ${code})`, key: 'i' })); log(`install fail ${e.name}: exit ${code}`) }
        })
        p.on('error', x => { clearTimeout(kill); jobs.delete(e.name); setStatus(tf('installFailN', { name: e.name, exit: `: ${x.message}`, key: 'i' })); log(`install throw ${e.name}: ${x}`) })
      }
      const installSkill = async (e: MarketEntry, plan: InstallPlan) => {
        try {
          setStatus(tf('installingN', { name: e.name }))
          let url: string
          let integrity: string | null = null
          if (plan.skill === 'github') {
            // repo skills ship via codeload at HEAD — pushedAt (modifiedAt) is
            // the version marker; no SRI exists for git archives
            url = `https://codeload.github.com/${e.source!.repo}/tar.gz/HEAD`
          } else {
            // pin to the catalog-approved version — dist-tags.latest is the
            // pendingUpdate users are NOT allowed to get yet (hold semantics)
            if (!e.latestVersion) throw new Error('no approved version to install')
            const meta = await fetchPkgVersionMeta(e.name, e.latestVersion)
            if (!meta.tarball) throw new Error(`no tarball for approved v${e.latestVersion}`)
            url = meta.tarball
            integrity = e.integrity ?? meta.integrity
          }
          // zip-bomb guard: refuse before buffering the whole body; the
          // decompressed ceiling inside installSkillTar is the second wall
          const tgz = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!tgz.ok) throw new Error(`tarball fetch failed: ${tgz.status}`)
          const cl = Number(tgz.headers.get('content-length') ?? 0)
          if (cl > MAX_SKILL_TGZ) throw new Error(`skill tarball too large (${cl} bytes)`)
          const buf = new Uint8Array(await tgz.arrayBuffer())
          // fail closed on a KNOWN mismatch — bytes must equal the artifact
          // the pipeline scanned (null = unverifiable, proceed honestly)
          const okI = await integrityMatches(buf, integrity)
          if (okI === false) throw new Error(t('integrityFail'))
          const msg = await installSkillTar({ name: e.name, gzipped: buf, root: await globalSkillsRoot() })
          const v = verMarker(e) ?? 'local'
          await mutate(d => { d.skillVers ??= {}; d.skillVers[e.name] = v })
          setInstalled({ ...installed(), [`__skill_${skillId(e.name)}`]: v })
          setStatus(`${e.name} ${t('installed')} (${msg})`)
        } catch (x) { setStatus(tf('installFailN', { name: e.name, exit: `: ${String(x)}`, key: 'i' })); log(`install fail ${e.name}: ${String(x)}`) }
      }
      const uninstall = (e: MarketEntry) =>
        openMenu(`${e.name} — ${t('confirmUninstall')}`, [
          { label: `✗ ${t('uninstall')}`, run: () => void doUninstall(e) },
          { label: t('cancel'), run: noop },
        ])
      const doUninstall = async (e: MarketEntry) => {
        log(`uninstall ${e.name}`)
        // uninstall what is actually installed — a dual-nature entry can own
        // both a plugin spec and skill dirs. Check __skill_ keys directly:
        // skillInstalledVer also matches the PLUGIN key and would fire the
        // skill-dir sweep on every pure plugin uninstall (deletes <name>-* dirs)
        const sBase = `__skill_${skillId(e.name)}`
        const sBare = `__skill_${e.name.split('/').pop() ?? e.name}`
        const hasSkillDir = Object.keys(installed()).some(k => k === sBase || k === sBare || k.startsWith(`${sBase}-`) || k.startsWith(`${sBare}-`))
        const hasPlugin = !!installed()[e.name]
        const doSkill = hasSkillDir || (!hasPlugin && !!e.contains?.includes('skill'))
        const doPlugin = hasPlugin || (!hasSkillDir && !e.contains?.includes('skill'))
        if (doSkill) {
          try { await uninstallSkillDir(e.name, await globalSkillsRoot()) } catch (x) { setStatus(tf('uninstallFail', { err: String(x), key: 'u' })); return }
          const base = `__skill_${skillId(e.name)}`
          const next = { ...installed() }
          for (const k of Object.keys(next)) if (k === base || k.startsWith(`${base}-`)) delete next[k]
          await mutate(d => { if (d.skillVers) delete d.skillVers[e.name] })
          setInstalled(next); setStatus(tf('removedN', { name: e.name }))
        }
        if (doPlugin) {
          // rewrite config plugins[] directly — CLI `plugin remove` takes a
          // spec, not the catalog name, and silently misses pinned specs
          // (same fix as the GUI host uninstall)
          try {
            const { homedir } = await import('node:os')
            const { join } = await import('node:path')
            const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
            const d = await readJson(cfg)
            const list = strArrayField(d, 'plugins')
            d.plugins = removeSpec(list, e.name)
            await writeJsonAtomic(cfg, d)
          } catch (x) { setStatus(tf('uninstallFail', { err: String(x), key: 'u' })); return }
          const next = { ...installed() }; delete next[e.name]
          setInstalled(next); setStatus(tf('removedN', { name: e.name }))
        }
      }
      const toggleFav = (e: MarketEntry) =>
        void mutate(d => { if (d.favorites[e.name]) delete d.favorites[e.name]; else d.favorites[e.name] = true })

      // host dialogs are a single slot — dialog.select/confirm/prompt would
      // replace (and on close, destroy) the market dialog. Inline overlays
      // keep the market mounted under a floating panel instead.
      interface MenuOpt { label: string; run: () => void }
      const [menu, setMenu] = createSignal<{ title: string; options: MenuOpt[]; sel: number } | null>(null)
      const openMenu = (title: string, options: MenuOpt[]) => setMenu({ title, options, sel: 0 })
      const noop = () => {}
      const [prompt, setPrompt] = createSignal<{ title: string; done: (v: string) => void } | null>(null)
      const [promptVal, setPromptVal] = createSignal('')
      const openPrompt = (title: string, initial: string, done: (v: string) => void) => {
        setPromptVal(initial); setPrompt({ title, done })
      }
      const closePrompt = (v: string | null) => {
        const p = prompt(); setPrompt(null)
        if (v !== null && p) p.done(v)
      }
      const pickCategory = () =>
        openMenu(t('cat'), [{ label: t('all'), run: () => setCat('') },
          ...cats().map(c => ({ label: catLabel(c), run: () => toggleCat(c) }))])
      const pickFilter = () =>
        openMenu(t('filter'), [
          ...SORTS().map(([k, label]) => ({ label: `${sortKey() === k ? '✓ ' : ''}${label}`, run: () => setSortKey(k) })),
          { label: `${asc() ? '✓ ' : ''}${t('sortAsc')}`, run: () => setAsc(!asc()) },
          ...RANGES().map(([d, label]) => ({ label: `${days() === d ? '✓ ' : ''}${label}`, run: () => setDays(d) })),
        ])

      const langLabel = () => store.lang === 'zh' ? t('langZh') : store.lang === 'en' ? t('langEn') : t('langAuto')
      const setLang = (m: 'auto' | 'zh' | 'en') => { void mutate(d => { d.lang = m }); setLangMode(m) }
      const settingsItems = createMemo<{ label: string; run: () => void }[]>(() => [
        { label: `${t('lang')}: [${langLabel()}]`, run: () => openMenu(t('lang'), [
          { label: t('langAuto'), run: () => setLang('auto') },
          { label: t('langZh'), run: () => setLang('zh') },
          { label: t('langEn'), run: () => setLang('en') },
        ]) },
        { label: t('exportBackupTui'), run: () => void (async () => {
          const { homedir } = await import('node:os')
          const { join } = await import('node:path')
          const fs = await import('node:fs')
          const p = join(homedir(), 'opencode-market-backup.json')
          try { fs.writeFileSync(p, JSON.stringify(store, null, 2)); setStatus(`exported → ${p}`) } catch (x) { setStatus(tf('exportFail', { err: String(x) })) }
        })() },
        { label: t('restoreTui'), run: () => openPrompt(t('restorePrompt'), '~/opencode-market-backup.json', async v => {
          if (!v) return
          try {
            const { readFileSync } = await import('node:fs')
            const { homedir } = await import('node:os')
            // field-shape validation — a crafted backup file must not corrupt state
            const d = sanitizeState(JSON.parse(readFileSync(v.replace(/^~/, homedir()), 'utf8')) as unknown) as MarketState
            void mutate(x => { Object.assign(x, { favorites: d.favorites, skillVers: d.skillVers }) })
            setStatus(t('restored'))
          } catch (x) { setStatus(tf('restoreFail', { err: String(x) })) }
        }) },
        { label: t('clearDataTui'), run: () => openMenu(t('confirmClearTui'), [
          { label: t('clearConfirm'), run: () => void mutate(d => { d.favorites = {}; d.skillVers = {} }) },
          { label: t('cancel'), run: noop },
        ]) },
        { label: `${t('devlogTui')}: [${store.devlog ? t('devlogOn') : t('devlogOff')}]（${LOG_FILE}）`, run: () => {
          void mutate(d => { d.devlog = !d.devlog })
          setStatus(`devlog ${store.devlog ? 'off' : 'on'} → ${LOG_FILE}`)
        } },
        { label: t('viewLogs'), run: () => void (async () => {
          const { existsSync, readFileSync } = await import('node:fs')
          const p = await marketLogPath()
          const tail = existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').slice(-15) : [t('noLogs')]
          openMenu(t('devlogMenu'), tail.map(line => ({ label: line, run: noop })))
        })() },
        { label: t('useHttpCatalog'), run: () => void (async () => {
          const { homedir } = await import('node:os')
          const { join } = await import('node:path')
          const cfg = join(homedir(), '.config', 'opencode', 'opencode.json')
          try {
            const d = await readJson(cfg)
            const list = strArrayField(d, 'skills')
            if (!list.includes(CATALOG_URL)) await writeJsonAtomic(cfg, { ...d, skills: [...list, CATALOG_URL] })
            setStatus(`catalog source ${list.includes(CATALOG_URL) ? t('catalogAlready') : t('catalogEnabled')} — ${t('restartNeeded')}`)
          } catch (x) { setStatus(tf('catalogFail', { err: String(x), cfg })) }
        })() },
      ])

      // github-kind entries carry no npm version — their marker is pushedAt
      const dispVer = (e: MarketEntry) => e.latestVersion ? `v${e.latestVersion}` : (e.modifiedAt ?? '?').slice(0, 10)
      const actionLabel = (e: MarketEntry) => {
        const ver = verOf(e)
        if (ver && !hasUpdate(e, ver)) return `✓ ${t('installed')}`
        if (ver) return `${t('update')} → ${dispVer(e)}`
        return t('add')
      }
      const badge = (e: MarketEntry) => {
        if (installed()[e.name] || skillInstalledVer(installed(), e.name)) return `[${t('installed')}]`
        // nothing this client can deliver gets the honest "no target" label —
        // not a fake verification status (honest-label rule, AGENTS.md)
        if (!canInstall(e)) return `[${t('noInstallTarget')}]`
        const s = e.verification?.status
        return s ? `[${s === 'verified' ? t('verified') : s === 'failed' ? t('failed') : s === 'skipped' ? t('skipped') : t('unverified')}]` : ''
      }
      const openDetail = (e: MarketEntry) => { setFindingsOpen(false); setDetail(e) }
      // 2D nav: left/right moves 1, up/down moves 2 (columns)
      const move = (d: number) => setSel(i => { const n = Math.max(0, Math.min(pool().length - 1, i + d)); growCap(n); return n })
      const updateAll = () => {
        const targets = (idx()?.plugins ?? []).filter(e => { const v = verOf(e); return v && hasUpdate(e, v) })
        if (!targets.length) { setStatus(t('allLatest')); return }
        setStatus(tf('updateN', { n: targets.length }))
        targets.forEach(install)
      }

      // dialogs run in the "modal" input mode — a plugin keymap layer must
      // target it explicitly or binds never dispatch (upstream btw.tsx pattern);
      // useKeyboard stays as fallback for hosts that route raw keys instead
      // focus zones: 'grid' (cards) | 'chrome' (menu bar: tabs/search/filter/chips)
      const [zone, setZone] = createSignal<'grid' | 'chrome'>('grid')
      const [chromeRow, setChromeRow] = createSignal(2)
      const [chromeSel, setChromeSel] = createSignal(0)
      // rows: 0 全部更新 | 1 tabs | 2 search+filter | 3 'c'+chips — enter from grid lands on chips
      const chromeItems = (row = chromeRow()) =>
        row === 0 ? ['updateAll'] as const :
        row === 1 ? TABS().map(t => `tab:${t[0]}` as const) :
        row === 2 ? ['search', 'filter'] as const :
        ['cat', ...cats().slice(0, 6).map(c => `chip:${c}`)]
      const chromeGo = (d: number) =>
        setChromeSel(i => { const n = chromeItems().length; return n ? ((i + d) % n + n) % n : 0 })
      const chromeFocused = (row: number, s: number) =>
        zone() === 'chrome' && chromeRow() === row && chromeSel() === s
      const chromeRun = () => {
        const item = chromeItems()[chromeSel()]
        if (!item) return
        if (item.startsWith('tab:')) { toTab(TABS().findIndex(([id]) => id === item.slice(4))); return }
        if (item === 'updateAll') { updateAll(); return }
        if (item === 'search') { setSearchOn(true); searchInput?.focus(); return }
        if (item === 'filter') { pickFilter(); return }
        if (item === 'cat') { pickCategory(); return }
        if (item.startsWith('chip:')) toggleCat(item.slice(5))
      }
      const toTab = (i: number) => { setTab(TABS()[i][0]); setSel(0); setDetail(null); setCat(''); setMenu(null); setZone('grid') }
      const act = (k: string): void => {
        if (prompt()) {
          if (k === 'escape' || k === 'q') { closePrompt(null); return }
          if (k === 'return') { closePrompt(promptVal()); return }
          if (k === 'backspace' || k === 'delete') { setPromptVal(v => v.slice(0, -1)); return }
          if (k === 'space') { setPromptVal(v => v + ' '); return }
          if (k.length === 1) setPromptVal(v => v + k)
          return  // every key is consumed while the prompt is open
        }
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
          if (k === 'right' || k === 'l') {
            // right past the last chip drops back into the card grid
            if (chromeRow() === 3 && chromeSel() === chromeItems(3).length - 1) {
              setZone('grid'); setSel(0); return
            }
            chromeGo(1); return
          }
          if (k === 'up' || k === 'k') {
            if (chromeRow() > 0) { setChromeRow(r => r - 1); setChromeSel(0) }
            return
          }
          if (k === 'down' || k === 'j') {
            // settings tab only exposes the tabs row — down always re-enters the list
            if (tab() === 'settings') { setZone('grid'); return }
            if (chromeRow() < 3) { setChromeRow(r => r + 1); setChromeSel(0) }
            else setZone('grid')
            return
          }
          if (k === 'return') { chromeRun(); return }
          if (k === 'tab') { toTab((TABS().findIndex(([id]) => id === tab()) + 1) % TABS().length); return }
          return
        }
        if (k === 'up' || k === 'k') {
          if (tab() === 'settings') {
            // top of the settings list -> hand focus to the tabs row, on 设置 itself
            if (settingsSel() === 0) { setZone('chrome'); setChromeRow(1); setChromeSel(6); return }
            setSettingsSel(i => Math.max(0, i - 1)); return
          }
          if (sel() < cols()) { setZone('chrome'); setChromeRow(3); setChromeSel(0); return }
          move(-cols()); return
        }
        if (k === 'down' || k === 'j') { tab() === 'settings' ? setSettingsSel(i => Math.min(settingsItems().length - 1, i + 1)) : move(cols()); return }
        if ((k === 'left' || k === 'h') && tab() !== 'settings') {
          if (sel() === 0) {
            const items = chromeItems(3)
            setZone('chrome'); setChromeRow(3); setChromeSel(items.length - 1); return
          }
          move(-1); return
        }
        if ((k === 'right' || k === 'l') && tab() !== 'settings') {
          move(1); return  // move() clamps at the last card
        }
        if (k === 'return') {
          if (tab() === 'settings') { settingsItems()[settingsSel()]?.run(); return }
          const e = pick(); if (e) openDetail(e); return
        }
        if (k === 'pageup') { tab() === 'settings' ? setSettingsSel(i => Math.max(0, i - 6)) : move(-10); return }
        if (k === 'pagedown') { tab() === 'settings' ? setSettingsSel(i => Math.min(settingsItems().length - 1, i + 6)) : move(10); return }
        if (k === '/') { setSearchOn(true); searchInput?.focus(); return }
        if (k === 'f') { pickFilter(); return }
        if (k === 'c') { pickCategory(); return }
        if (k === 'i') { const e = detail() ?? pick(); if (e && actionLabel(e) !== `✓ ${t('installed')}`) { if (canInstall(e)) install(e); else setStatus(t('noInstallTarget')) } return }
        if (k === 'u') { const e = detail() ?? pick(); if (e && verOf(e)) void uninstall(e); return }
        if (k === '*') { const e = detail() ?? pick(); if (e) toggleFav(e); return }

        if (k === 'x') { if (detail()?.capabilities) setFindingsOpen(!findingsOpen()); return }
        // r = force refresh — TTL must not swallow a user-initiated reload;
        // the outcome label distinguishes "still fresh" from "actually pulled"
        if (k === 'r') { setIdxErr(''); fetchIndexCached(INDEX_URL, true).then(i => { setIdx(i); setStatus(fetchOutcome() === 'fresh' ? t('dataFresh') : tf('refreshedN', { n: i.plugins.length })) }, e => setIdxErr(String(e))); void refreshInstalled(); return }
        if (k === 'U') { updateAll(); return }
        if (k === 'q') { ctx.ui.dialog.clear(); return }
        if (k === 'tab') { toTab((TABS().findIndex(([id]) => id === tab()) + 1) % TABS().length); return }
        const d = Number(k)
        if (d >= 1 && d <= TABS().length) toTab(d - 1)
      }
      const BINDS = 'escape up down left right return tab backspace delete space pageup pagedown ' +
        'a b c d e f g h i j k l m n o p q r s t u v w x y z ' +
        '0 1 2 3 4 5 6 7 8 9 / * - _ . : ~ @ U'
      ctx.keymap.layer(() => ({
        mode: 'modal',
        enabled: () => !searchOn(),
        commands: BINDS.split(' ').map(b => ({ bind: b, run: () => act(b) })),
      }))
      // nav keys go through the modal keymap layer only — re-dispatching them
      // here double-fired moves. useKeyboard stays for host-side fallback input.
      useKeyboard((ev) => {
        if (prompt()) {
          if (ev.name === 'escape') closePrompt(null)
          else if (ev.name === 'return') closePrompt(promptVal())
        } else if (searchOn() && (ev.name === 'escape' || ev.name === 'return')) {
          setSearchOn(false); (searchInput as { blur?(): void })?.blur?.()
        }
      })

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
              <box backgroundColor={active() ? theme.background.action.primary.focused : undefined}>
                <text fg={active() ? theme.text.action.primary.focused : verOf(e) ? theme.text.base : theme.text.muted}
                      onMouseDown={(ev) => {
                        ev.stopPropagation(); ev.preventDefault()
                        const ver = verOf(e)
                        if (ver) uninstall(e); else install(e)
                      }}>{actionLabel(e)}</text>
              </box>
            </box>
            <text fg={theme.text.muted}>{[dispVer(e), e.metrics?.npmDownloads30d ? `↓${fmtN(e.metrics.npmDownloads30d)}` : '', e.metrics?.stars ? `★${fmtN(e.metrics.stars)}` : ''].filter(Boolean).join(' · ')}</text>
            <For each={wrap2(descOf(e), descW())}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>
            <text fg={theme.text.faint}>{categoriesOf(e).map(catLabel).join('  ')}</text>
          </box>
        )
      }

      return (
        <box flexGrow={1} flexDirection="column" backgroundColor={theme.background.base}
             onMouseDown={() => { if (menu()) setMenu(null); if (prompt()) closePrompt(null) }}>
          <box flexDirection="column" flexShrink={0}>
            <box flexDirection="row" paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.base}><b>opencode market</b></text>
              <text fg={theme.text.muted}>  oc-market-quail-zephyr-72a0 v{PKG_VERSION} · {indexAge(idx())}</text>
              <box flexGrow={1} />
              <box backgroundColor={chromeFocused(0, 0) ? theme.background.action.primary.focused : undefined}>
                <text fg={chromeFocused(0, 0) ? theme.text.action.primary.focused : theme.text.muted}
                      onMouseOver={() => { setZone('chrome'); setChromeRow(0); setChromeSel(0) }}
                      onMouseDown={(ev) => { ev.stopPropagation(); updateAll() }}>[U] {t('updateAll')}</text>
              </box>
            </box>
            <box flexDirection="row" paddingLeft={1}>
              <For each={TABS()}>{([id, label], i) => (
                <box backgroundColor={chromeFocused(1, i()) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(1, i()) ? theme.text.action.primary.focused : id === tab() ? theme.text.base : theme.text.faint}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(1); setChromeSel(i()) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); toTab(i()) }}>
                    {id === tab() || chromeFocused(1, i()) ? `[${i() + 1} ${label}]` : ` ${i() + 1} ${label} `}{' '}
                  </text>
                </box>
              )}</For>
            </box>
            <Show when={!detail() && tab() !== 'settings'}>
              <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                <box backgroundColor={chromeFocused(2, 0) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(2, 0) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(2); setChromeSel(0) }}
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
                <box backgroundColor={chromeFocused(2, 1) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(2, 1) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(2); setChromeSel(1) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); pickFilter() }}> [f]{t('filter')} {[sortKey(), asc() ? '↑' : '↓', days() ? `${days()}d` : ''].filter(Boolean).join('·')} </text>
                </box>
              </box>
              <box flexDirection="row" paddingLeft={1}>
                <box backgroundColor={chromeFocused(3, 0) ? theme.background.action.primary.focused : undefined}>
                  <text fg={chromeFocused(3, 0) ? theme.text.action.primary.focused : theme.text.muted}
                        onMouseOver={() => { setZone('chrome'); setChromeRow(3); setChromeSel(0) }}
                        onMouseDown={(ev) => { ev.stopPropagation(); pickCategory() }}>[c] </text>
                </box>
                <text fg={!cat() ? theme.text.base : theme.text.muted} onMouseDown={() => setCat('')}>{tf('allN', { n: pool().length })} </text>
                <For each={cats().slice(0, 6)}>{(c, i) => (
                  <box backgroundColor={chromeFocused(3, 1 + i()) ? theme.background.action.primary.focused : undefined}>
                    <text fg={chromeFocused(3, 1 + i()) ? theme.text.action.primary.focused : cat() === c ? theme.text.base : theme.text.muted}
                          onMouseOver={() => { setZone('chrome'); setChromeRow(3); setChromeSel(1 + i()) }}
                          onMouseDown={() => toggleCat(c)}>{c} </text>
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
                    <text fg={theme.text.base}><b>{t('tabAdvanced')}</b></text>
                    <box height={1} />
                    <For each={settingsItems()}>{(item, i) => (
                      <box backgroundColor={i() === settingsSel() && zone() === 'grid' ? theme.background.action.primary.focused : undefined}>
                        <text fg={i() === settingsSel() && zone() === 'grid' ? theme.text.action.primary.focused : theme.text.muted}
                              onMouseOver={() => { setZone('grid'); setSettingsSel(i()) }}
                              onMouseDown={(ev) => { ev.stopPropagation(); settingsItems()[i()]?.run() }}>
                          {i() === settingsSel() && zone() === 'grid' ? '› ' : '  '}{item.label}
                        </text>
                      </box>
                    )}</For>
                  </box>
                : <box flexDirection="column" flexGrow={1} minHeight={0}>
                    <Show when={idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('fetchFailed')}: {idxErr()} — {tf('retryKey', { key: 'r' })}</text></Show>
                    <Show when={!idx() && !idxErr()}><text fg={theme.text.muted} paddingLeft={1}>{t('loading')}</text></Show>
                    <scrollbox flexGrow={1} minHeight={0} height={Math.max(6, dims().height - 12)}
                               onMouseDown={(ev) => ev.stopPropagation()}
                               ref={(r) => { listScroll = r as unknown as typeof listScroll }}>
                      <box flexDirection="column" paddingLeft={1}>
                        <For each={grid()}>{(pair, ri) => (
                          <box flexDirection="row" marginTop={ri() === 0 ? 0 : 1}>
                            <For each={pair}>{(e, ci) => <Card e={e} i={ri() * cols() + ci()} />}</For>
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
                    <text fg={theme.text.muted}>{[dispVer(e), e.metrics?.npmDownloads30d ? `↓${fmtN(e.metrics.npmDownloads30d)}` : '', e.metrics?.stars ? `★${fmtN(e.metrics.stars)}` : '', categoriesOf(e).map(catLabel).join(' ')].filter(Boolean).join(' · ')}</text>
                    <Show when={e.pendingUpdate?.version}><text fg={theme.text.muted}>{tf('heldReview', { v: e.pendingUpdate!.version! })}</text></Show>
                    <Show when={e.source?.version}><text fg={theme.text.muted}>tree: {(e.source!.version ?? '').slice(0, 12)}</text></Show>
                    <box height={1} />
                    <text fg={theme.text.base}>{e.description?.en ?? ''}</text>
                    <Show when={e.description?.zh}><text fg={theme.text.muted}>{e.description?.zh}</text></Show>
                    <box height={1} />
                    <text fg={theme.text.base}>[i] {t('add')}/{t('update')}   [u] {t('uninstall')}   [*] {t('favorites')}</text>
                    <Show when={caps?.redFlags?.length}>
                      <box height={1} />
                      <text fg={theme.text.base}>{t('redFlags')} ({caps!.redFlags.length}){!findingsOpen() ? `  [x] ${t('expand')}` : ''}</text>
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
              {status() || t('keysHint')}
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
              <text fg={theme.text.base}><b>{p().title}</b>  ({t('confirmEnter')})</text>
              <text fg={theme.text.base}>{promptVal()}▌</text>
            </box>
          )}</Show>
        </box>
      )
    }
  },
})
