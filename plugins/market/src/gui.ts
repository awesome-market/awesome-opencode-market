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
import { fetchIndexCached, indexSnapshot, fetchOutcome, search, sortEntries, categoriesOf, allCategories, inDays, appendLog, clearLog, redactLog, keyLines, loadState, saveState, sanitizeState, hasUpdate, isDowngrade, verMarker, versionCmp, canInstall, installPlan, halvesToSync, halfState, fetchPkgVersionMeta, fetchPkgVersions, integrityMatches, resolveIndexUrl, isIndexUrl, isSkillsUrl, skillsUrl, indexAge, siteDetailUrl, removedReasonLabel, t, tf, descOf, catLabel, setLangMode, langMode, EMPTY_STATE, scanSkillKeys, skillInstalledVer, pinSpec, fmtN, gitPinRef, readBodyBounded, assertApprovedPin, assertFetchFinalUrl, enginesSatisfied, type MarketEntry, type MarketIndex, type RemovedEntry, type LocalState } from './catalog.js'
import { installSkillTar, uninstallSkillDir, MAX_SKILL_TGZ } from './skill-install.js'
import { assertUninstallRef, assertSpecForName, assertSkillId, skillId, readJson, strArrayField, writeJsonAtomic, marketLogPath, appendBounded, restrictedEnv, configPath, skillsRoot, writeSkillPermission, withConfigLock, probeActivation, overlayConfigPins } from './hostx.js'
import { PKG_VERSION } from './version.js'

const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { input: Schema.Unknown, output: Schema.Unknown },
    refreshIndex: { input: Schema.Unknown, output: Schema.Unknown },
    indexOutcome: { input: Schema.Unknown, output: Schema.String },
    installed: { output: Schema.Unknown },
    install: { input: Schema.Unknown, output: Schema.String },
    update: { input: Schema.Unknown, output: Schema.String },
    cancelInstall: { input: Schema.String, output: Schema.String },
    verifyActivation: { input: Schema.String, output: Schema.String },
    uninstall: { input: Schema.String, output: Schema.String },
    writeSkill: { input: Schema.Unknown, output: Schema.String },
    uninstallSkill: { input: Schema.String, output: Schema.String },
    skillSource: { input: Schema.Unknown, output: Schema.Unknown },
    skillPermission: { input: Schema.Unknown, output: Schema.Unknown },
    devlog: { input: Schema.String, output: Schema.String },
    setDevlog: { input: Schema.Boolean, output: Schema.String },
    readDevlog: { output: Schema.Unknown },
    clearDevlog: { output: Schema.String },
  },
  events: {
    progress: Schema.Unknown,   // { name, line, done, ok, cancelled }
    index: Schema.Unknown,      // MarketIndex — pushed when a background
                                // revalidation actually changed the catalog
  },
})
type Api = {
  index(p?: { url?: string }): Promise<MarketIndex>
  refreshIndex(p?: { url?: string }): Promise<MarketIndex>
  indexOutcome(p?: { url?: string }): Promise<string>
  installed(p?: { names?: string[] | undefined }): Promise<{ versions: Record<string, string>; extras: { name: string; version: string }[]; features: Record<string, Record<string, true> | undefined>; degraded?: boolean }>
  install(p: { name: string; spec?: string; dev?: boolean }): Promise<string>
  update(p: { name: string; spec?: string; dev?: boolean }): Promise<string>
  cancelInstall(name: string): Promise<string>
  verifyActivation(spec: string): Promise<string>
  uninstall(name: string): Promise<string>
  writeSkill(p: { name: string }): Promise<string>
  uninstallSkill(name: string): Promise<string>
  skillSource(p?: { url?: string; enable?: boolean }): Promise<{ url: string; enabled: boolean }>
  skillPermission(p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }): Promise<Record<string, string>>
  devlog(line: string): Promise<string>
  setDevlog(on: boolean): Promise<string>
  readDevlog(): Promise<string>
  clearDevlog(): Promise<string>
  on(name: 'progress', fn: (d: { name: string; line: string; done?: boolean; ok?: boolean; cancelled?: boolean }) => void): () => void
  on(name: 'index', fn: (d: MarketIndex) => void): () => void
}

type View = { kind: 'list' } | { kind: 'detail'; e: MarketEntry }
const sorts = ['verified', 'downloads', 'stars', 'name'] as const

export default Plugin.define({
  setup(ctx: any): any {
    let api: Api | null = null
    try { api = ctx.main(Market) as Api } catch { /* diagnosed below */ }
    if (!api?.index) return {}
    const safe = api as Api
    // catalog endpoint — plugin options (opencode.json) > OPENCODE_MARKET_INDEX
    // env > dev-source settings toggle > published default. Resolved per call
    // (state() is read lazily) so the settings toggle re-targets every
    // index-facing IPC call; the host follows whatever url the renderer sends.
    const indexUrl = () => resolveIndexUrl(ctx?.options, state().devSource)
    const skillsEndpoint = () => skillsUrl(indexUrl())
    // single document listener slot — chrome() rebuilds once per mount, so each
    // new build replaces the previous handler instead of accumulating listeners
    let docClick: ((ev: Event) => void) | null = null
    const [data, setData] = createSignal<MarketIndex | null>(null)
    // tombstone lookup — an installed entry whose name is in removed[] has
    // left the catalog (npm-404 / filtered / manual …). Index rebuilt every
    // setData so refreshes pick up new tombstones.
    let removedIdx = new Map<string, RemovedEntry>()
    const removedOf = (name: string) => removedIdx.get(name)
    const setDataWrap = (i: MarketIndex) => {
      setData(i)
      removedIdx = new Map((i?.removed ?? []).filter(r => r.name).map(r => [r.name!, r]))
    }
    const [installed, setInstalled] = createSignal<Record<string, string>>({})
    // dev-mode version picker: name → chosen version (plain map — the install
    // click re-reads it). pickTick is the re-render trigger: picking a
    // version rebuilds rows so the button label follows the choice.
    const verPicks = new Map<string, string>()
    const [pickTick, setPickTick] = createSignal(0)
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
    // pre-install compat check — the catalog declares engines; the host app
    // reports its own version, so an unsatisfiable requirement is a warning
    // BEFORE the user clicks install, not a load failure after
    const hostVersion = String(ctx.app?.version ?? '')
    const compatWarnOf = (e: MarketEntry): string | null => {
      const eng = e.compat?.engines
      if (!eng || !hostVersion) return null
      return enginesSatisfied(hostVersion, eng) === false ? tf('compatWarn', { req: eng, cur: hostVersion }) : null
    }
    const [err, setErr] = createSignal('')
    const [query, setQuery] = createSignal('')
    // catalog entry names the renderer already fetched — passed to
    // installed() so the host doesn't pull the whole index a second time
    // just to split cataloged vs uncataloged specs (index double-cache fix)
    const catalogNames = () => data()?.plugins?.map(p => p.name)
    const [cat, setCat] = createSignal('')
    const [sort, setSort] = createSignal<string>('verified')
    const [view, setView] = createSignal<View>({ kind: 'list' })
    const [state, setState] = createSignal<LocalState>(EMPTY_STATE)
    const [favOnly, setFavOnly] = createSignal(false)
    const [tab, setTab] = createSignal<'discover'|'plugins'|'skills'|'favorites'|'installed'|'mySkills'|'advanced'>('discover')
    const [filterOpen, setFilterOpen] = createSignal(false)
    const [sortDir, setSortDir] = createSignal<'desc'|'asc'>('desc')
    const [rangeDays, setRangeDays] = createSignal(0)
    const [prog, setProg] = createSignal<Record<string, { lines: string[]; done?: boolean; ok?: boolean; cancelled?: boolean }>>({})
    let verTaps = 0   // version-tap counter — setup scope so a settingsPanel rebuild can't zero it mid-sequence
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
          ? { ...cur, done: true, ...(d.ok !== undefined ? { ok: d.ok } : {}), ...(d.cancelled ? { cancelled: true } : {}) }
          : { lines: [...cur.lines, d.line].slice(-20) } })
      })
      safe.on?.('index', (i) => setDataWrap(i))
    } catch { /* older host: no events */ }

    safe.index({ url: indexUrl() }).then(i => setDataWrap(i), e => setErr(String(e)))
    // inventory health — the list degrades to uncataloged-only when the host
    // inventory is unreachable, and the UI says so instead of pretending
    // nothing is installed
    const [invDown, setInvDown] = createSignal(false)
    const pullInventory = () => void safe.installed?.({ names: catalogNames() })
      .then(s => { setInstalled(s?.versions ?? {}); setInstalledExtra(s?.extras ?? []); setFeatMap(s?.features ?? {}); setInvDown(!!s?.degraded) },
        () => setInvDown(true))
    pullInventory()
    // external installs (CLI, other windows) never reach this renderer —
    // the TUI gets ctx.data.on('plugin.updated'), the GUI window has no
    // such bus; a periodic reconcile keeps the inventory honest. Skips
    // hidden windows so an idle panel costs nothing.
    setInterval(() => { if (typeof document === 'undefined' || !document.hidden) pullInventory() }, 30 * 60_000)

    // tab scope — shared by filtered() and the 全部(N) category chips so the
    // count always matches what the list actually shows on every tab
    const tabPool = (): MarketEntry[] => {
      const all = data()?.plugins ?? []
      switch (tab()) {
        case 'plugins': return all.filter(p => !p.contains?.includes('skill'))
        case 'skills': return all.filter(p => p.contains?.includes('skill'))
        case 'installed':
          return [...all.filter(p => installed()[p.name]),
            ...installedExtra().map(x => ({ name: x.name, latestVersion: x.version, description: undefined, category: [], contains: [], uncataloged: true } as unknown as MarketEntry))]
        case 'mySkills': return all.filter(p => p.contains?.includes('skill') && skillInstalledVer(installed(), p.name))
        case 'favorites': return all.filter(p => state().favorites[p.name])
        case 'advanced': return []   // settings panel renders controls, not cards
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
    // installed marker: plugin key wins; skill dirs resolve through
    // skillInstalledVer, preferring the manifest-recorded version over 'local'
    const installedVer = (e: MarketEntry): string | undefined => {
      if (installed()[e.name]) return installed()[e.name]
      const disk = skillInstalledVer(installed(), e.name)
      return disk ? (state().skillVers?.[e.name] ?? disk) : undefined
    }
    const statusOf = (e: MarketEntry) => {
      const iv = installedVer(e)
      // 'local' = dir install without a version, '?' = host didn't report one —
      // neither is a version, so don't render "installed vlocal"/"v?"
      return iv ? (iv === 'local' || iv === '?' ? t('installed') : `${t('installed')} v${iv}`)
      // nothing this client can deliver (github plugin parts, malformed repos)
      // gets the honest "no target" label — not a fake verification status
      : !canInstall(e) ? t('noInstallTarget')
      : t((e.verification?.status ?? 'unverified') as 'verified')
    }

    // ---- dom helpers -------------------------------------------------------
    const el = (tag: string, css = '', text = '') => {
      const n = document.createElement(tag)
      if (css) n.style.cssText = css
      if (text) n.textContent = text
      return n
    }
    const badge = (e: MarketEntry) => {
      const wrap = el('span', 'display:inline-flex;gap:4px;align-items:center;flex-shrink:0')
      const s = statusOf(e)
      const b = el('span', 'margin-left:8px;font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0', s)
      b.style.color = '#fff'
      // color comes from the raw status, not the localized label — comparing
      // translated text to English literals silently breaks in zh mode
      const st = installed()[e.name] || skillInstalledVer(installed(), e.name) ? 'installed' : e.verification?.status ?? 'unverified'
      b.style.background = st === 'installed' || st === 'verified' ? '#1a7' : st === 'failed' ? '#c33' : st === 'skipped' ? '#885' : '#666'
      wrap.appendChild(b)
      // tombstone: the installed name left the catalog — stronger than a
      // status chip because the reason may be 'manual' (blocklisted)
      const rm = removedOf(e.name)
      if (rm) {
        const rb = el('span', 'font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0', `${t('removedFrom')}: ${removedReasonLabel(rm.reason)}`)
        rb.style.color = '#fff'
        rb.style.background = rm.reason === 'manual' ? '#c33' : '#885'
        wrap.appendChild(rb)
      }
      if (e.deprecated) wrap.appendChild(el('span', 'font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;background:#a74;color:#fff', t('deprecated')))
      if (e.approval === 'legacy') wrap.appendChild(el('span', 'font-size:10px;padding:1px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;opacity:.55;border:1px solid rgba(128,128,128,.45)', t('legacy')))
      return wrap
    }
    // download + SRI enforcement live in the main process: the renderer only
    // names the entry — the host resolves URL/commit-sha and the index-announced
    // SRI itself, so a compromised renderer can't fetch arbitrary tarballs or
    // skip the digest by passing integrity:null (was the url-mode hole).
    const installSkillNet = async (e: MarketEntry): Promise<string> => safe.writeSkill({ name: e.name })
    // two-step confirm: first click arms (3s window), second click executes
    const uninstallBtn = (e: MarketEntry) => {
      const isSkill = e.contains?.includes('skill') && !installed()[e.name]
      const b = el('button', 'font-size:12px;cursor:pointer;color:#c66;background:transparent;border:1px solid rgba(200,80,80,.5);border-radius:6px;padding:2px 14px;white-space:nowrap;flex-shrink:0', t('uninstall')) as HTMLButtonElement
      b.dataset.act = 'uninstall'
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
        // uninstall what is actually installed, not what the type says — a
        // dual-nature entry may have both a plugin spec and skill dirs.
        // __skill_ keys directly: skillInstalledVer also matches the plugin
        // key, which would fire the skill sweep on every plugin uninstall.
        // The two legs settle INDEPENDENTLY: a foreign (non-market) skill dir
        // refusing deletion must not mask a successful plugin-spec removal —
        // and vice versa (allSettled, not Promise.all).
        const sBase = `__skill_${skillId(e.name)}`
        const sBare = `__skill_${e.name.split('/').pop() ?? e.name}`
        const hasSkillDir = Object.keys(installed()).some(k => k === sBase || k === sBare || k.startsWith(`${sBase}-`) || k.startsWith(`${sBare}-`))
        const wantPlugin = !!installed()[e.name] || !(hasSkillDir || isSkill)
        const wantSkill = hasSkillDir || isSkill
        const pluginP = wantPlugin
          ? safe.uninstall(e.name).then(() => 'ok' as const, (x: unknown) => `ERR:${String(x)}`)
          : Promise.resolve('skip' as const)
        const skillP = wantSkill
          ? safe.uninstallSkill(e.name).then(() => 'ok' as const, (x: unknown) => `ERR:${String(x)}`)
          : Promise.resolve('skip' as const)
        void Promise.all([pluginP, skillP]).then(async ([pRes, sRes]) => {
          const pOk = pRes === 'ok' || pRes === 'skip'
          const sOk = sRes === 'ok' || sRes === 'skip'
          const sErr = String(sRes).startsWith('ERR:') ? String(sRes).slice(4) : null
          const pErr = String(pRes).startsWith('ERR:') ? String(pRes).slice(4) : null
          if (!pOk) {
            log(`uninstall fail ${e.name}: ${pErr}${sErr ? ` (skill: ${sErr})` : ''}`)
            b.disabled = false; armed = false; b.textContent = t('failedRetry'); b.title = pErr ?? ''
            setProg({ ...prog(), [e.name]: { lines: [pErr ?? 'uninstall failed', ...(sErr ? [`skill: ${sErr}`] : [])], done: true, ok: false } })
            return
          }
          // plugin leg done (or nothing to do) — reconcile installed state;
          // skill keys are dropped ONLY when the skill leg actually succeeded,
          // so a refused foreign dir keeps showing its honest "installed"
          log(`uninstall ${e.name}${sErr ? ` — skill kept: ${sErr}` : ''}`)
          const base = `__skill_${skillId(e.name)}`
          const bare = `__skill_${e.name.split('/').pop() ?? e.name}`
          const next = { ...installed() }
          delete next[e.name]
          if (sOk) for (const k of Object.keys(next)) if (k === base || k === bare || k.startsWith(`${base}-`) || k.startsWith(`${sBare}-`)) delete next[k]
          if (sOk) { const sv = { ...(state().skillVers ?? {}) }; delete sv[e.name]; put({ skillVers: sv }) }
          setInstalled(next)
          setInstalledExtra(installedExtra().filter(x => x.name !== e.name))
          if (sErr) {
            // partial success — surface the kept dir instead of pretending all gone
            setProg({ ...prog(), [e.name]: { lines: [sErr], done: true, ok: false } })
            b.disabled = false; armed = false; b.textContent = t('uninstall'); b.title = sErr
          }
          // daemon rescans config async — poll the inventory until the spec
          // is actually gone (bounded ~9s) instead of a blind 2s sleep that
          // could report removal before the rescan even ran
          for (let tries = 0; tries < 6; tries++) {
            await new Promise(r => setTimeout(r, 1500))
            const fresh = await safe.installed?.({ names: catalogNames() }).catch(() => null)
            if (!fresh) continue
            const still = !!fresh.versions[e.name]
            const v = { ...fresh.versions }; delete v[e.name]
            setInstalled(v)
            setInstalledExtra(fresh.extras.filter(x => x.name !== e.name))
            setFeatMap(fresh.features)
            if (!still) break
          }
        })
      }
      return b
    }
    const installBtn = (e: MarketEntry) => {
      const hs = halfState(e, installed(), state().skillVers)
      const ver = hs.ver
      const plan = installPlan(e)
      const isSkill = plan.skill !== null
      // which halves this click may touch — fresh install delivers every
      // deliverable half; an update touches only installed-and-outdated halves
      // (a current plugin half must not mask a stale skill half, and a missing
      // half must not be silently resurrected by an unrelated update)
      const sync = halvesToSync(e, hs)
      const doPlugin = sync.plugin, doSkill = sync.skill
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
      // a user-cancelled op is done but NOT a failure — it must not render
      // the failedRetry affordance or the red error box (AGENTS: honest state)
      if (pr?.done && !pr.ok && !pr.cancelled) {
        // inert-looking failure button — clicking opens the detail view where
        // the error context + export-log affordance live (AGENTS: 报错必须有下一步)
        const fb = el('button', 'font-size:12px;cursor:pointer;color:#c66;background:transparent;border:1px solid rgba(200,80,80,.5);border-radius:6px;padding:2px 14px;white-space:nowrap;flex-shrink:0', `${t('failedRetry')}?`) as HTMLButtonElement
        fb.title = pr.lines[pr.lines.length - 1] ?? ''
        fb.onclick = ev => { ev.stopPropagation(); setView({ kind: 'detail', e }) }
        return fb
      }
      // dev-mode version pick — verPicks is a plain map, re-read at click
      // time too (the dropdown's onchange rebuilds the list, but the click
      // must not trust render-time state). There is no downgrade op: a pick
      // is a live target only when strictly newer than the installed version
      // (or when nothing is installed). A stale pick at/below installed is
      // inert — the button judges by latestVersion like any other card
      // ('local' can't be ordered → inert).
      const pick = state().devVerPick ? verPicks.get(e.name) : undefined
      const usePick = !!pick && !!e.latestVersion && pick !== e.latestVersion
        && (!ver || versionCmp(pick, ver) > 0)
      // manage tabs get a real uninstall action; other tabs keep the quiet badge
      if (ver && !hs.anyOut && !usePick)
        return tab() === 'installed' || tab() === 'mySkills'
          ? uninstallBtn(e)
          : el('span', 'font-size:11px;color:#1a7;white-space:nowrap;flex-shrink:0', `✓ ${t('installed')}`)
      // entries with no deliverable part get an inert label — a button that
      // only errors on click is a trap, not an affordance
      if (!canInstall(e))
        return el('span', 'font-size:11px;opacity:.55;white-space:nowrap;flex-shrink:0', t('noInstallTarget'))
      // installed > approved = a revert to the reviewed artifact, not an
      // "update" — label it honestly (hold semantics, AGENTS: 好理解).
      // usePick names the chosen target instead — 'update' would be a lie
      // for an arbitrary older version.
      const label = usePick ? `${ver ? t('update') : t('add')} → v${pick}` : ver
        ? `${isDowngrade(e, ver) ? t('revertTo') : t('update')} → ${e.latestVersion ? `v${e.latestVersion}` : (e.modifiedAt ?? '?').slice(0, 10)}`
        : t('add')
      const b = el('button', 'font-size:12px;cursor:pointer;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.5);border-radius:6px;padding:2px 14px', label) as HTMLButtonElement
      b.dataset.act = 'install'
      b.onclick = ev => {
        ev.stopPropagation()
        b.disabled = true; b.textContent = '…'
        // compat warning rides the progress lines — visible in the card and
        // the detail log, never silently dropped
        const cw = compatWarnOf(e)
        setProg({ ...prog(), [e.name]: { lines: [...(cw ? [cw] : []), 'installing…'], done: false, ok: false } })
        const failOut = (x: unknown) => {
          // a cancel is not a failure — restore the actionable label and mark
          // the prog entry cancelled so the card doesn't render failedRetry
          const wasCancelled = x instanceof Error ? x.message === 'cancelled' : String(x) === 'cancelled'
          b.disabled = false
          b.textContent = wasCancelled ? label : t('failedRetry')
          b.title = String(x); b.style.color = wasCancelled ? '' : '#c66'
          setProg({ ...prog(), [e.name]: { lines: [wasCancelled ? t('cancelled') : String(x)], done: true, ok: false, ...(wasCancelled ? { cancelled: true } : {}) } })
        }
        if (isSkill && typeof safe.writeSkill !== 'function') { log(`installSkill missing on host for ${e.name}`); return failOut('host missing writeSkill — plugin version mismatch') }
        log(`install start ${e.name} plugin=${plan.plugin} skill=${plan.skill}`)
        // re-read the pick at click time — a stale render must not pin a
        // version the user already changed in the dropdown
        const clkPick = state().devVerPick ? verPicks.get(e.name) : undefined
        const clkPickOn = !!clkPick && !!e.latestVersion && clkPick !== e.latestVersion
          && (!ver || versionCmp(clkPick, ver) > 0)
        const spec = clkPickOn ? `${e.name}@${clkPick}` : pinSpec(e)
        // dual-nature entries deliver BOTH parts — installing only the skill
        // side silently drops the plugin half the package ships. `update`
        // (add pinned + config dedupe) is used for fresh installs too: it is
        // a strict superset of install and also clears stale same-name specs
        // the inventory may not have reported yet.
        const doInstall = async (): Promise<string> => {
          // halves are independent surfaces (TUI parity): a failing half must
          // not stop the sibling from attempting, and a half-success must be
          // named in the error instead of hiding behind a bare 'failed'.
          // A cancel still aborts the whole op immediately.
          const outs: string[] = []
          const errs: string[] = []
          const wasCancel = (x: unknown) => x instanceof Error ? x.message === 'cancelled' : String(x) === 'cancelled'
          if (doPlugin) {
            // dev is omitted when off — the normal path stays byte-identical
            // to pre-feature calls (no flag leak into the host protocol)
            const arg = clkPickOn ? { name: e.name, spec, dev: true as const } : { name: e.name, spec }
            try { outs.push(await (typeof safe.update === 'function' ? safe.update(arg) : safe.install(arg))) }
            catch (x) { if (wasCancel(x)) throw x; errs.push(`plugin: ${String(x)}`) }
          }
          if (doSkill) {
            // the catalog only ships the APPROVED skill bundle — installing
            // it beside a picked older plugin would pair mismatched halves
            if (clkPickOn) outs.push('skill: skipped')
            else try { outs.push(await installSkillNet(e)) } catch (x) { if (wasCancel(x)) throw x; errs.push(`skill: ${String(x)}`) }
          }
          if (errs.length) throw new Error(`${outs.length ? `${outs.join(' + ')} · ` : ''}${errs.join(' · ')}`)
          return outs.join(' + ') || 'installed'
        }
        try { doInstall().then(
          async () => {
            setProg({ ...prog(), [e.name]: { lines: [], done: true, ok: true } })
            if (doSkill) {
              // optimistic + version bookkeeping → real update detection later;
              // github skills record the pushedAt marker they shipped at
              const v = verMarker(e) ?? 'local'
              setInstalled({ ...installed(), [`__skill_${skillId(e.name)}`]: v })
              put({ skillVers: { ...state().skillVers, [e.name]: v } })
            }
            if (!doPlugin) {
              b.textContent = `${t('installed')}`; b.style.color = '#4a4'
            } else {
              // optimistic mark — daemon rescans config async; refresh after a
              // beat and keep the mark if the inventory still lags. A picked
              // version is the expected pin, not the catalog latest.
              const expect = clkPickOn ? clkPick! : (e.latestVersion ?? '?')
              setInstalled({ ...installed(), [e.name]: expect })
              await new Promise(r => setTimeout(r, 2000))
              const fresh = await safe.installed?.({ names: catalogNames() }).catch(() => null)
              if (fresh) {
                if (!fresh.versions[e.name]) fresh.versions[e.name] = expect
                setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features)
              }
              const okNow = (fresh?.versions ?? installed())[e.name]
              b.textContent = okNow ? t('verifying') : t('installedPending')
              const verdict = await safe.verifyActivation?.(spec).catch(() => '')
              // 'not-loaded' is a confident negative; 'unknown' means the probe
              // itself couldn't run — don't dress uncertainty as a diagnosis
              b.textContent = verdict === 'activated' ? `${t('installed')} · ${t('activated')}`
                : verdict === 'not-loaded' && okNow ? `${t('installed')} — ${t('restartNeeded')}`
                : okNow ? `${t('installed')} — ${t('restartNeeded')}` : t('installedPending')
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

    // ---- keyboard navigation ------------------------------------------------
    // j/k/↑↓ move by row · h/l/←→ step · enter opens detail · i install/update
    // · u uninstall (same two-step arm as the mouse) · * favorite · / search ·
    // esc back. The webview is mouse-first, but a keyboard path keeps the
    // panel usable without a pointer and matches the TUI's keymap spirit.
    const [selIdx, setSelIdx] = createSignal(-1)
    let keyShell: HTMLElement | null = null
    let searchEl: HTMLInputElement | null = null
    const gridCols = () => {
      const w = (keyShell?.querySelector('[data-list]') as HTMLElement | null)?.clientWidth ?? 620
      return Math.max(1, Math.floor((w + 10) / 310))
    }
    // outline follows the selection without rebuilding cards — rows are
    // recreated on every prog/installed change, so re-apply after each
    createEffect(() => {
      const i = selIdx()
      if (i < 0 || !keyShell) return
      void filtered(); void installed(); void prog(); void state()
      keyShell.querySelectorAll('[data-mi]').forEach(n => {
        const on = Number((n as HTMLElement).dataset.mi) === i
        ;(n as HTMLElement).style.outline = on ? '1.5px solid var(--v2-border-border-focus, #5b8def)' : ''
        ;(n as HTMLElement).style.outlineOffset = '-1.5px'
      })
    })
    const actBtn = (act: string): HTMLElement | null => {
      if (!keyShell) return null
      if (view().kind === 'detail') return keyShell.querySelector(`[data-act="${act}"]`)
      const i = selIdx()
      return i >= 0 ? keyShell.querySelector(`[data-mi="${i}"] [data-act="${act}"]`) : null
    }
    const onDocKey = (ev: KeyboardEvent) => {
      const sh = keyShell
      if (!sh || !sh.isConnected) { document.removeEventListener('keydown', onDocKey); return }
      const tgt = ev.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
        if (ev.key === 'Escape') (tgt as HTMLInputElement).blur?.()
        return
      }
      if (view().kind === 'detail') {
        if (ev.key === 'Escape') { ev.preventDefault(); setView({ kind: 'list' }); return }
        if (ev.key === 'i') { actBtn('install')?.click(); return }
        if (ev.key === 'u') { actBtn('uninstall')?.click(); return }
        if (ev.key === '*') { actBtn('fav')?.click(); return }
        return
      }
      if (tab() === 'advanced') return   // settings surface — inputs own the keys
      const items = filtered()
      if (!items.length) return
      const move = (d: number) => {
        ev.preventDefault()
        const n = Math.max(0, Math.min(items.length - 1, (selIdx() < 0 ? 0 : selIdx()) + d))
        setSelIdx(n)
        requestAnimationFrame(() => {
          const card = keyShell?.querySelector(`[data-mi="${n}"]`)
          if (card) (card as HTMLElement).scrollIntoView?.({ block: 'nearest' })
          else if (keyShell) keyShell.scrollTop += 320   // past the rendered page — sentinel loads more
        })
      }
      switch (ev.key) {
        case 'j': case 'ArrowDown': move(gridCols()); return
        case 'k': case 'ArrowUp': move(-gridCols()); return
        case 'h': case 'ArrowLeft': move(-1); return
        case 'l': case 'ArrowRight': move(1); return
        case 'Enter': {
          ev.preventDefault()
          const i = selIdx() >= 0 ? selIdx() : 0
          const e = items[i]
          if (e) { setSelIdx(i); setView({ kind: 'detail', e }) }
          return
        }
        case 'i': case 'I': {
          const e = items[selIdx()]
          if (!e) return
          const b = actBtn('install')
          if (b && !b.hasAttribute('disabled')) b.click()
          else setView({ kind: 'detail', e })   // installed/no-target → show state
          return
        }
        case 'u': {
          const e = items[selIdx()]
          if (!e) return
          const b = actBtn('uninstall')
          if (b && !b.hasAttribute('disabled')) b.click()
          else setView({ kind: 'detail', e })
          return
        }
        case '*': { const e = items[selIdx()]; if (e) toggleFav(e.name); return }
        case '/': searchEl?.focus(); ev.preventDefault(); return
      }
    }
    if (typeof document !== 'undefined') document.addEventListener('keydown', onDocKey)

    const row = (e: MarketEntry, idx: number) => {
      const d = el('div', 'padding:12px 14px;border-radius:8px;display:flex;flex-direction:column;min-height:110px;box-sizing:border-box;position:relative')
      d.dataset.mi = String(idx)   // keyboard-nav anchor — index into filtered()
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
      // dual-nature packages get a compound badge — showing only 'skill'
      // hides the plugin half the entry also delivers
      const hasP = e.contains ? e.contains.includes('plugin') : e.type !== 'skill'
      const hasS = e.contains ? e.contains.includes('skill') : e.type === 'skill'
      const typeBadge = el('span', 'font-size:10px;line-height:16px;color:inherit;opacity:.85;border-radius:8px 8px 0 0;padding:1px 8px 0;position:absolute;top:-8px;right:10px;background:var(--v2-background-bg-layer-01,color-mix(in srgb, CanvasText 4%, Canvas));z-index:1', hasP && hasS ? `${t('plugin')}+${t('skill')}` : hasS ? t('skill') : t('plugin'))
      // outline only for the ~9px above the card edge — inside part stays fused
      typeBadge.appendChild(el('span', 'position:absolute;inset:0 0 auto;height:8px;box-sizing:border-box;border:0.5px solid var(--v2-border-border-muted,color-mix(in srgb, CanvasText 14%, transparent));border-bottom:none;border-radius:8px 8px 0 0;pointer-events:none'))
      d.appendChild(typeBadge)
      const btn = installBtn(e); btn.style.flexShrink = '0'
      title.appendChild(btn)
      const meta = el('div', 'opacity:.5;font-size:11px;margin-top:1px')
      const dl = e.metrics?.npmDownloads30d, st = e.metrics?.stars
      // github-kind entries carry no npm version — their marker is pushedAt;
      // 'local'/'?' are install-kind markers, not versions — never "vlocal"
      const verText = e.latestVersion ? (e.latestVersion === 'local' || e.latestVersion === '?' ? e.latestVersion : `v${e.latestVersion}`) : (e.modifiedAt ?? '?').slice(0, 10)
      // dev-mode version picker: the version label becomes a dropdown over
      // every published version (npm entries only — github-kind keeps text).
      // Lazy — the packument pull fires on first mousedown, not on render.
      const pickable = pickTick() >= 0 && state().devVerPick && hasP && !!e.latestVersion && e.latestVersion !== 'local' && e.latestVersion !== '?' && e.source?.kind !== 'github'
      if (pickable) {
        const cur = verPicks.get(e.name) ?? e.latestVersion!
        // no downgrade op — versions at/below the installed one are shown
        // but disabled, so the picker itself says "not an install target"
        const iv = halfState(e, installed(), state().skillVers).ver
        const sel = el('select', 'font-size:11px;color:inherit;background:transparent;border:none;opacity:1;max-width:140px;padding:0;margin:0') as HTMLSelectElement
        const mk = (ver: string, at?: string) => { const o = el('option', '', `v${ver}${at ? ` ${at.slice(0, 10)}` : ''}`) as HTMLOptionElement; o.value = ver; o.disabled = !!iv && versionCmp(ver, iv) <= 0; return o }
        sel.appendChild(mk(cur))
        const fill = async () => {
          try {
            const vs = await fetchPkgVersions(e.name)
            sel.replaceChildren(...vs.map(v => mk(v.ver, v.at)))
            if (!vs.some(v => v.ver === cur)) sel.appendChild(mk(cur))
            sel.value = cur
          } catch { /* packument unreachable — keep the single current option */ }
        }
        sel.onmousedown = ev => { ev.stopPropagation(); if (sel.options.length <= 1) void fill() }
        sel.onclick = ev => ev.stopPropagation()
        sel.onchange = () => { verPicks.set(e.name, sel.value); setPickTick(pickTick() + 1) }
        meta.appendChild(sel)
        const rest = [dl != null ? `↓${fmtN(dl)}` : '', st != null ? `★${fmtN(st)}` : ''].filter(Boolean).join(' · ')
        if (rest) meta.appendChild(document.createTextNode(` · ${rest}`))
      } else {
        meta.textContent = [verText, dl != null ? `↓${fmtN(dl)}` : '', st != null ? `★${fmtN(st)}` : '']
          .filter(Boolean).join(' · ')
      }
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
      // bottom-right favorite bookmark (dsh style) — localStorage state;
      // reactive so keyboard '*' toggles repaint without a list rebuild
      const favBtn = el('button', 'margin-left:auto;font-size:14px;line-height:1;cursor:pointer;border:none;background:transparent;padding:2px 6px') as HTMLButtonElement
      favBtn.dataset.act = 'fav'
      createEffect(() => {
        const on = !!state().favorites[e.name]
        favBtn.textContent = on ? '★' : '☆'
        favBtn.style.color = on ? '#da3' : 'rgba(128,128,128,.7)'
      })
      favBtn.onclick = ev => { ev.stopPropagation(); toggleFav(e.name) }
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
      if (p?.done && p.ok === false && !p.cancelled) {
        const errBox = el('div', 'font-size:11px;color:#c66')
        errBox.textContent = keyLines(p.lines.join('\n')).join(' · ').slice(0, 200) || t('installFailed')
        const ex = el('button', 'margin-left:6px;font-size:10px;cursor:pointer', t('exportLog'))
        ex.onclick = ev => {
          ev.stopPropagation()
          const txt = redactLog(p.lines.join('\n'))
          // silent clipboard failure left the button looking like a no-op —
          // flip the label either way (next-step affordance, not a trap)
          void navigator.clipboard?.writeText(txt).then(() => { ex.textContent = '✓' }, () => { ex.textContent = '✗' })
        }
        errBox.appendChild(ex)
        d.appendChild(errBox)
      }
      return d
    }

    const listView = () => {
      const root = el('div', '')
      if (invDown()) root.appendChild(el('div', 'font-size:11px;opacity:.6;padding:4px 2px', t('invDown')))
      const list = el('div')
      list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;align-content:start'
      // paged render — a filtered() change used to rebuild ~3000 cards at once;
      // first page + auto-load on scroll (sentinel) keeps tab switches instant
      const PAGE = 60
      const [visible, setVisible] = createSignal(PAGE)
      createEffect(() => { tab(); cat(); query(); sort(); sortDir(); favOnly(); rangeDays(); featFilter(); setVisible(PAGE); setSelIdx(-1) })
      list.dataset.list = ''   // keyboard nav measures column count off this
      insert(list, () => {
        const items = filtered()
        const rows = items.slice(0, visible()).map((e, i) => row(e, i))
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
      head.appendChild(el('span', 'margin-left:12px;font-size:12px;opacity:.55', `opencode-market v${PKG_VERSION}`))
      const updAll = el('button', 'margin-left:auto;font-size:12px;cursor:pointer;padding:2px 14px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit', t('updateAll')) as HTMLButtonElement
      updAll.dataset.act = 'updateAll'   // dispatch marker — text changes per state/lang, this doesn't
      // passive "N updatable" badge — users used to have to open the sweep to
      // learn anything was outdated at all
      const [updBusy, setUpdBusy] = createSignal(false)
      const outdatedCount = () => (data()?.plugins ?? []).filter(e => halfState(e, installed(), state().skillVers).anyOut).length
      createEffect(() => {
        if (updBusy()) return
        const n = outdatedCount()
        updAll.textContent = n ? `${t('updateAll')} (${n})` : t('updateAll')
      })
      const markSkillInstalled = (e: MarketEntry) => {
        const v = verMarker(e) ?? 'local'
        setInstalled({ ...installed(), [`__skill_${skillId(e.name)}`]: v })
        put({ skillVers: { ...state().skillVers, [e.name]: v } })
      }
      const runUpdateAll = async () => {
        // no catalog = nothing to diff — say fetch failed, not 'all latest'
        if (!data()) { updAll.textContent = t('fetchFailed'); setTimeout(() => { updAll.textContent = t('updateAll') }, 3000); return }
        if (typeof safe.update !== 'function' && typeof safe.writeSkill !== 'function') { updAll.textContent = t('needRestartDesk'); return }
        // per-half targeting: only halves that are installed AND outdated —
        // a current plugin half must not mask a stale skill half (the old
        // merged-version check did exactly that)
        const jobs = (data()?.plugins ?? [])
          .map(e => {
            const hs = halfState(e, installed(), state().skillVers)
            if (!hs.anyOut) return null
            const sync = halvesToSync(e, hs)
            return { e, sync }
          })
          .filter((j): j is { e: MarketEntry; sync: { plugin: boolean; skill: boolean } } => !!j && (j.sync.plugin || j.sync.skill))
        if (!jobs.length) { updAll.textContent = t('allLatest'); setTimeout(() => { setUpdBusy(false); updAll.textContent = t('updateAll') }, 3000); return }
        updAll.disabled = true; setUpdBusy(true)
        const total = jobs.reduce((n, j) => n + (j.sync.plugin ? 1 : 0) + (j.sync.skill ? 1 : 0), 0)
        let done = 0, ok = 0, fail = 0, cancelled = 0, okPlugin = 0
        const bump = () => { updAll.textContent = tf('updatingN', { n: ++done, total }) }
        // a user-cancelled half is not a failure — counting it as one made a
        // deliberate 'cancel' read as 'N failed' in the sweep summary
        const wasCancelled = (x: unknown) => x instanceof Error && x.message === 'cancelled'
        // two serial lanes — plugin adds rewrite opencode.json (must serialize
        // against each other), skill installs write the skills root (serialize
        // for lift-collision checks). The lanes overlap: tarball downloads no
        // longer block config writes, halving wall time on mixed sweeps.
        const pluginLane = (async () => {
          for (const j of jobs) if (j.sync.plugin) {
            bump()
            try { await safe.update({ name: j.e.name, spec: pinSpec(j.e) }); ok++; okPlugin++ } catch (x) { wasCancelled(x) ? cancelled++ : fail++ }
          }
        })()
        const skillLane = (async () => {
          const canSkill = typeof safe.writeSkill === 'function'
          for (const j of jobs) if (j.sync.skill) {
            bump()
            try {
              if (!canSkill) throw new Error('host missing writeSkill')
              await installSkillNet(j.e); markSkillInstalled(j.e); ok++
            } catch (x) { wasCancelled(x) ? cancelled++ : fail++ }
          }
        })()
        await Promise.all([pluginLane, skillLane])
        await new Promise(r => setTimeout(r, 2000))
        const fresh = await safe.installed?.({ names: catalogNames() }).catch(() => null)
        if (fresh) { setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features) }
        updAll.disabled = false; setUpdBusy(false)
        // config is pinned but the RUNNING daemon still executes the old
        // bytes — 'updated' without the restart hint reads as "new code is
        // live", which is exactly the false-success the user reported
        const restart = okPlugin > 0 ? ` — ${t('restartNeeded')}` : ''
        updAll.textContent = (cancelled
          ? (fail ? tf('sweepCancelFail', { ok, fail, c: cancelled }) : tf('sweepCancel', { ok, c: cancelled }))
          : fail ? tf('updatedMix', { ok, fail }) : tf('updatedOk', { ok })) + restart
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
      searchEl = q   // '/' focuses this from the keyboard handler
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
        // github-kind entries have no npm version — fall back to the pushedAt
        // marker like the card meta does, never a bare '?'
        `version: ${e.latestVersion ? `v${e.latestVersion}` : (e.modifiedAt ?? '?').slice(0, 10)}`,
        // held-back newer version — the index knows it exists; review hasn't
        // cleared it, so the client must never install it (hold semantics)
        ...(e.pendingUpdate?.version ? [tf('heldReview', { v: e.pendingUpdate.version })] : []),
        ...(e.pendingUpdate?.heldAt ? [`  ${t('heldAtLabel')}: ${e.pendingUpdate.heldAt.slice(0, 10)}`] : []),
        ...(e.pendingUpdate?.reason ? [`  ${t('heldReason')}: ${e.pendingUpdate.reason}`] : []),
        ...(e.pendingUpdate?.verification?.status ? [`  ${t('verifyLevel')}: ${e.pendingUpdate.verification.status}`] : []),
        // tombstone: installed name left the catalog — say why, don't
        // silently treat it as a normal uncataloged plugin
        ...(() => { const rm = removedOf(e.name); return rm ? [`${t('removedFrom')}: ${removedReasonLabel(rm.reason)}${rm.disappearedAt ? ` · ${rm.disappearedAt.slice(0, 10)}` : ''}`] : [] })(),
        // deprecated upstream + the suggested replacement the pipeline parsed
        ...(e.deprecated ? [`${t('deprecated')}${e.deprecatedMessage ? `: ${e.deprecatedMessage}` : ''}`] : []),
        ...(e.replacement ? [tf('replacedBy', { name: e.replacement })] : []),
        ...(e.license ? [`license: ${e.license}`] : []),
        ...(e.createdAt ? [`created: ${e.createdAt.slice(0, 10)}`] : []),
        // first catalog sighting + prior package names — context the index
        // already carries but the detail page never showed
        ...(e.firstSeenAt ? [`first seen: ${e.firstSeenAt.slice(0, 10)}`] : []),
        ...(e.aliases?.length ? [`aka: ${e.aliases.join(', ')}`] : []),
        // registry dist-tags beyond latest (beta/next/…) — informational only;
        // installs always pin latestVersion, never a dist-tag
        ...(e.distTags && Object.keys(e.distTags).length ? [`dist-tags: ${Object.entries(e.distTags).map(([k, v]) => `${k}=${v}`).join(' · ')}`] : []),
        ...(e.maintainers?.length ? [`maintainers: ${e.maintainers.join(', ')}`] : []),
        ...(e.compat?.engines || e.compat?.peer
          ? [`${t('compat')}: ${[e.compat.engines ? `opencode ${e.compat.engines}` : '', e.compat.peer ? `peer ${e.compat.peer}` : ''].filter(Boolean).join(' · ')}`]
          : []),
        // requirements the running host can't satisfy — data was already on
        // the page; now it's an actual pre-install warning, not trivia
        ...(() => { const w = compatWarnOf(e); return w ? [w] : [] })(),
        // github-kind identity: source.version is the pinned COMMIT sha the
        // scan reviewed (§15: git/trees/{ref} resolves to commit sha) — never
        // shown for npm entries where the same field holds a semver
        ...(e.source?.kind === 'github' && e.source?.version ? [`commit: ${e.source.version.slice(0, 12)}`] : []),
        ...(e.integrity ? [`integrity: ${e.integrity.slice(0, 32)}…`] : []),
        `verify: ${v?.status ?? 'unverified'}${v?.level ? ` · ${t('verifyLevel')}: ${v.level}` : ''}`,
        `verified: ${v?.verifiedAt?.slice(0, 10) ?? '—'} (opencode ${v?.opencodeVersion ?? '?'})${v?.status === 'verified' && v.opencodeVersion && v.opencodeVersion !== 'unknown' && hostVersion && v.opencodeVersion !== hostVersion ? ` — ${t('verifyOldHost')}` : ''}`,
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
      // verify-log excerpt — the failed/skipped story in the pipeline's own
      // words; collapsed like findings (AGENTS: 默认收起进详情页)
      if (v?.logExcerpt) root.appendChild(fold(t('verifyLog'), [v.logExcerpt], v.status === 'failed'))
      // "not found ≠ safe" has two honest variants: never-scanned entries
      // (scannedAt null/absent) vs entries the scan actually covered and
      // cleared — AGENTS forbids dressing the second as the first
      if (!caps?.findings?.length && !caps?.redFlags?.length)
        root.appendChild(el('div', 'font-size:11px;opacity:.55;margin:8px 0', caps?.scannedAt ? t('scannedClean') : t('notSafe')))
      // audit-trail links: pipeline verify run + the site detail page that
      // aggregates evidence — https-only so a crafted runUrl can't open file:
      const links = el('div', 'display:flex;gap:10px;margin:8px 0;flex-wrap:wrap')
      const linkBtn = (label: string, url: string | null | undefined) => {
        if (!url || !/^https:\/\//.test(url)) return
        const lb = el('button', 'font-size:11px;cursor:pointer;background:transparent;border:1px solid rgba(128,128,128,.4);border-radius:6px;padding:2px 10px;color:inherit', label) as HTMLButtonElement
        lb.onclick = ev => { ev.stopPropagation(); try { ctx.system?.openExternal?.(url) } catch { /* noop */ } }
        links.appendChild(lb)
      }
      linkBtn(t('verifyRun'), v?.runUrl)
      linkBtn(t('viewOnSite'), siteDetailUrl(e, indexUrl()))
      if (links.childElementCount) root.appendChild(links)
      const btn = installBtn(e); btn.style.marginLeft = '0'
      root.appendChild(btn)
      // detail page keeps an uninstall affordance even on non-manage tabs,
      // where the primary element is just a '✓ installed' span — but never
      // render a second uninstall next to a real uninstall button, and never
      // offer it on an entry with nothing installed (a noInstallTarget card
      // used to get one → click → 'not found' error for no reason)
      if (btn.tagName !== 'BUTTON' && installedVer(e)) {
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
        // the version-tap easter egg MUST dispatch from here too — element-level
        // onclick never fires in this webview, so ver.onclick silently dropped
        // every tap (devUnlocked could never toggle from the GUI)
        const act = t?.dataset?.act
        if (act === 'devtap') devTap()
        else if (act === 'devsrc' || act === 'devpick') devToggle(act)
        else if (act === 'skillsrc') void safe.skillSource?.({ url: skillsEndpoint(), enable: !ssOn }).then(ssRefresh).catch(() => {})
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
        const to = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t('refreshTimeout'))), 45_000))])
        try {
          const idx = await to(typeof safe.refreshIndex === 'function' ? safe.refreshIndex({ url: indexUrl() }) : safe.index({ url: indexUrl() }))
          if (idx) setDataWrap(idx)
          // honest refresh result — only a real pull counts as "refreshed N".
          // 'stale'/'mismatch' mean the host SERVED THE OLD SNAPSHOT (fetch
          // failed / sha disagreement), not that data was refreshed — the
          // old code labeled them refreshed anyway
          const oc = await safe.indexOutcome?.({ url: indexUrl() }).catch(() => '') as string
          const fresh = await safe.installed?.({ names: catalogNames() }).catch(() => null)
          if (fresh) { setInstalled(fresh.versions); setInstalledExtra(fresh.extras); setFeatMap(fresh.features) }
          const time = new Date().toLocaleTimeString()
          setRefText(oc === 'fresh' ? `${t('dataFresh')}，${time}`
            : oc === 'mismatch' ? t('refreshMismatch')
            : oc === 'stale' ? t('refreshStale')
            : `${tf('refreshedN', { n: idx?.plugins?.length ?? '?' })}，${time}`)
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
      // logBox renders the HOST file (readDevlog) — clearing only the renderer
      // localStorage buffer made the button a no-op (P0 bug)
      clrL.onclick = () => { clearLog(); void safe.clearDevlog?.().then(refresh).catch(() => {}) }
      root.append(dv, cbL, logBox, clrL)
      // dev catalog source — the maintainer fork's Pages, used while the
      // upstream catalog isn't being published (pre-release development).
      // Hidden behind the version-tap easter egg below, but ALWAYS visible
      // while devSource is on: a dev source you can't see is one you can't
      // turn off. Switching refetches on the new source immediately;
      // explicit indexUrl/env config still outranks the toggle.
      const dsWrap = el('div', state().devUnlocked || state().devSource || state().devVerPick ? '' : 'display:none')
      const dsh = el('h4', 'margin:20px 0 6px;font-weight:600', t('devSource'))
      const dsNote = el('div', 'font-size:11px;opacity:.6;margin-top:4px', indexUrl())
      // toggles ride root-mousedown dispatch like every other settings
      // control — checkbox onchange is just as dead as onclick here.
      // [x]/[ ] text stands in for the checkbox glyph.
      const dsc = el('span', 'font-family:monospace;user-select:none')
      const paintDsc = () => { dsc.textContent = state().devSource ? '[x]' : '[ ]' }
      paintDsc()
      const dscL = el('div', 'font-size:12px;display:flex;gap:6px;align-items:center;cursor:pointer')
      dscL.dataset.act = 'devsrc'
      dscL.append(dsc, document.createTextNode(t('devSourceDesc')))
      dsWrap.append(dsh, dscL, dsNote)
      // version picker — card version labels become dropdowns over every
      // published version; a picked install skips the approved-pin gate
      // (dev flag — the name check still applies). Same visibility rule:
      // it's inside the dev-gated wrap and the wrap stays visible while on.
      const vph = el('h4', 'margin:20px 0 6px;font-weight:600', t('devVerPick'))
      const vpc = el('span', 'font-family:monospace;user-select:none')
      const paintVpc = () => { vpc.textContent = state().devVerPick ? '[x]' : '[ ]' }
      paintVpc()
      const vpcL = el('div', 'font-size:12px;display:flex;gap:6px;align-items:center;cursor:pointer')
      vpcL.dataset.act = 'devpick'
      vpcL.append(vpc, document.createTextNode(t('devVerPickDesc')))
      dsWrap.append(vph, vpcL)
      const devToggle = (act: 'devsrc' | 'devpick') => {
        if (act === 'devsrc') {
          put({ devSource: !state().devSource })
          paintDsc()
          dsNote.textContent = indexUrl()
          setErr('')
          safe.index({ url: indexUrl() }).then(i => setDataWrap(i), e => setErr(String(e)))
        } else {
          put({ devVerPick: !state().devVerPick })
          paintVpc()
          setPickTick(pickTick() + 1)
        }
      }
      // skill permissions — developer surface: per installed skill id,
      // allow/ask/deny written to opencode.json permissions[]; 'clear'
      // returns to the default (ask). Lives INSIDE the dev-gated wrap —
      // regular users don't need raw permission editing.
      if (typeof safe.skillPermission === 'function') {
        dsWrap.appendChild(el('h4', 'margin:20px 0 6px;font-weight:600', t('permTitle')))
        const permBox = el('div', 'font-size:12px')
        const paintPerms = async () => {
          const [perms, inv] = await Promise.all([
            safe.skillPermission({ id: '', mode: null }).catch(() => ({}) as Record<string, string>),
            safe.installed?.({ names: catalogNames() }).catch(() => null),
          ])
          const ids = Object.keys(inv?.versions ?? {})
            .filter(k => k.startsWith('__skill_')).map(k => k.slice('__skill_'.length))
          permBox.replaceChildren()
          if (!ids.length) { permBox.appendChild(el('div', 'opacity:.6', t('noMatch'))); return }
          for (const id of ids) {
            const r = el('div', 'display:flex;align-items:center;gap:6px;padding:3px 0')
            r.appendChild(el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', id))
            const cur = el('span', 'font-size:10px;opacity:.6;min-width:32px;text-align:right', perms[id] ?? '')
            r.appendChild(cur)
            for (const [mode, key] of [['allow', 'permAllow'], ['ask', 'permAsk'], ['deny', 'permDeny'], [null, 'permOff']] as const) {
              const mb = el('button', 'font-size:10px;cursor:pointer;padding:1px 8px;border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit', t(key)) as HTMLButtonElement
              mb.onclick = ev => { ev.stopPropagation(); void safe.skillPermission({ id, mode }).then(() => { cur.textContent = mode ?? '' }).catch(() => {}) }
              r.appendChild(mb)
            }
            permBox.appendChild(r)
          }
        }
        void paintPerms()
        dsWrap.appendChild(permBox)
      }
      root.appendChild(dsWrap)
      // HTTP skill catalog — developer surface: lets opencode itself
      // discover/refresh repo skills from the same site root the index came
      // from. Hidden with the other dev toggles, EXCEPT while the
      // subscription is actually enabled — an active skills[] entry in
      // opencode.json must stay visible so it can be turned off.
      const ssWrap = el('div', state().devUnlocked || state().devSource || state().devVerPick ? '' : 'display:none')
      ssWrap.appendChild(el('h4', 'margin:20px 0 6px;font-weight:600', t('useHttpCatalog')))
      const ssStatus = el('div', 'font-size:11px;opacity:.7;margin-bottom:6px')
      const ssBtn = el('button', 'font-size:12px;cursor:pointer;padding:4px 14px;border:1px solid rgba(128,128,128,.4);border-radius:6px;background:transparent;color:inherit', t('useHttpCatalog')) as HTMLButtonElement
      // reversible toggle — enable writes the skills[] url, disable removes it
      // (leaving any other entries untouched). One-way 'enable' used to lock
      // users into a remote source with no off switch. Rides root dispatch —
      // element onclick is dead in this webview.
      ssBtn.dataset.act = 'skillsrc'
      let ssOn = false
      const ssRefresh = () => void safe.skillSource?.().then(r => {
        ssOn = !!r.enabled
        if (r.enabled) ssWrap.style.display = ''
        ssStatus.textContent = r.enabled ? `${r.url} — ${t('catalogEnabled')}` : `${skillsEndpoint()} — ${t('catalogDisabled')}`
        ssBtn.textContent = r.enabled ? t('disable') : t('useHttpCatalog')
      }).catch(() => { ssStatus.textContent = skillsEndpoint() })
      ssRefresh()
      ssWrap.append(ssStatus, ssBtn)
      root.appendChild(ssWrap)
      // footer — copyright + version. The version is also the dev-settings
      // easter egg: 10 clicks toggle devUnlocked (Android build-number
      // convention — entering AND leaving both take 10).
      const foot = el('div', 'margin-top:28px;padding-top:12px;border-top:1px solid rgba(128,128,128,.2);font-size:11px;opacity:.55;display:flex;gap:6px;align-items:baseline')
      foot.appendChild(el('span', '', '© 2026 awesome-market contributors · MIT ·'))
      // version text doubles as the dev-settings easter egg: 10 silent clicks
      // TOGGLE devUnlocked — Android build-number convention, bidirectional.
      // Zero affordance while locked (no pointer cursor, no progress); once
      // unlocked the label carries a visible " (dev)" — the dev marker is
      // both the confirmation it engaged and the reminder it is still on.
      const ver = el('span', 'user-select:none;-webkit-user-select:none')
      ver.dataset.act = 'devtap'   // dispatched by root.onmousedown — onclick is dead in this webview
      const paintVer = () => { ver.textContent = `v${PKG_VERSION}${state().devUnlocked ? ' (dev)' : ''}` }
      paintVer()
      const devTap = () => {
        if (++verTaps >= 10) {
          verTaps = 0
          const on = !state().devUnlocked
          if (on) { put({ devUnlocked: true }); dsWrap.style.display = ''; ssWrap.style.display = ''; paintVer(); return }
          // leaving dev mode turns the dev features OFF, not just hidden —
          // a hidden devSource would keep pulling the fork catalog, a hidden
          // devVerPick would keep the card dropdowns alive
          const wasSource = state().devSource
          put({ devUnlocked: false, devSource: false, devVerPick: false })
          verPicks.clear(); setPickTick(pickTick() + 1)
          paintDsc(); paintVpc()
          dsWrap.style.display = 'none'
          // the skill-source block stays visible ONLY if the subscription is
          // really on — it's config state, not a dev flag we can just clear
          ssWrap.style.display = ssOn ? '' : 'none'
          paintVer()
          if (wasSource) {
            dsNote.textContent = indexUrl()
            setErr('')
            safe.index({ url: indexUrl() }).then(i => setDataWrap(i), e => setErr(String(e)))
          }
        }
      }
      foot.appendChild(ver)
      root.appendChild(foot)
      return root
    }

    const mount = (parent: HTMLElement, surface: 'panel' | 'settings') => {
      const shell = el('div', 'overflow:auto;height:100%')
      keyShell = shell   // keyboard nav scopes queries to the live shell
      const head = chrome(surface)   // built ONCE — signal reads here don't get tracked
      const body = el('div')
      shell.append(head, body)
      createEffect(() => {
        // chrome (tabs incl. ≡ settings) must stay visible under fetch
        // failure — it's the only path to the dev-source toggle. Hiding it
        // when data is null used to wall the whole panel behind the error.
        head.style.display = view().kind === 'list' ? '' : 'none'
      })
      insert(body, () => {
        const v = view()
        // settings panel BEFORE the error/loading walls — the dev-source
        // toggle and the version easter egg live there. Walling them behind
        // a fetch failure is a dead end: broken catalog → can't reach the
        // toggle that points at the working source → stuck forever.
        if (v.kind === 'list' && tab() === 'advanced') return settingsPanel()
        if (err()) {
          const d = el('div', 'padding:12px;color:#c66', `error: ${err()}`)
          const rb = el('button', 'margin-left:8px;font-size:12px;cursor:pointer', t('retry')) as HTMLButtonElement
          rb.onclick = () => { setErr(''); safe.index({ url: indexUrl() }).then(i => setDataWrap(i), e => setErr(String(e))) }
          d.appendChild(rb)
          return d
        }
        if (!data()) return el('div', 'padding:12px;opacity:.6', t('loading'))
        const n = v.kind === 'detail' ? detailView(v.e) : listView()
        n.style.padding = '0 12px 12px'
        // keyboard path discoverability — the webview is mouse-first, but
        // the keymap exists and users can't find what isn't advertised.
        // NOTE: must live inside THIS insert's node — a second insert() on
        // the same parent clobbers the first region's anchor in the
        // plain-DOM runtime (settings panel rendered empty)
        if (v.kind === 'list') n.appendChild(el('div', 'font-size:10px;opacity:.4;padding-top:8px', t('keysHintGui')))
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
    // skill downloads own AbortControllers — cancelInstall reaches them too
    const skillJobs = new Map<string, AbortController>()
    // names that passed the jobs.has guard but haven't spawned yet — the
    // pin-recheck await sits in that gap, and without a claimed slot a
    // second IPC inside it would double-start the install. AbortControllers
    // (not just a Set) so cancelInstall can reach a claimed-but-childless
    // op — the pending half checks its signal before spawning
    const pendingInstall = new Map<string, AbortController>()
    // same window for skill installs — the index re-pull + packument fetch
    // sit between entry and skillJobs.set
    const pendingSkill = new Map<string, AbortController>()
    // names whose child was killed BY cancelInstall — the close event can't
    // tell a user-cancel from a crash (both arrive as code=null), so the
    // cancel path marks the name and the close handler reads it back.
    // Entries are consumed on close and cleared at each op's start.
    const cancelled = new Set<string>()
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
    // env-aware resolution (OPENCODE_CONFIG > XDG_CONFIG_HOME > ~/.config) —
    // spawned `opencode` commands inherit the same vars via restrictedEnv, so
    // CLI writes and our direct read-modify-writes land in the same file
    const cfgPath = () => configPath()
    // renderer-supplied catalog URL (plugin options) validated + env fallback;
    // lastIndexUrl keeps installed()'s extras lookup on the SAME catalog the
    // renderer asked for — a second fetch at the default would double-pull
    let lastIndexUrl = resolveIndexUrl(null)
    const urlOrDefault = (u: unknown) => isIndexUrl(u) ? u : lastIndexUrl
    m.provide(Market, {
        index: (p: { url?: unknown }) => {
          const u = urlOrDefault(p?.url)
          lastIndexUrl = u
          const run = fetchIndexCached(u) as Promise<MarketIndex>
          const snap = indexSnapshot(u)
          if (!snap) return run   // nothing cached — cold load, keep blocking
          // stale-while-revalidate: serve the snapshot now; push the fresh
          // index only when the revalidation really wrote new content — a
          // TTL/sha-hit leaves the cached object untouched (same reference)
          void run.then(() => {
            if (u !== lastIndexUrl) return   // source switched mid-flight — don't clobber the new view
            const now = indexSnapshot(u)
            if (now && now.index !== snap.index) m.emit?.('index', now.index)
          }, () => { /* snapshot already painted — failed revalidate just leaves it */ })
          return Promise.resolve(snap.index)
        },
        refreshIndex: (p: { url?: unknown }) => { lastIndexUrl = urlOrDefault(p?.url); return fetchIndexCached(lastIndexUrl, true) as Promise<MarketIndex> },
        indexOutcome: (p?: { url?: unknown }) => fetchOutcome(urlOrDefault(p?.url)),
        installed: async (p?: { names?: unknown }) => {
          const { execFile } = require('node:child_process') as typeof import('node:child_process')
          const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
          const { homedir } = require('node:os') as typeof import('node:os')
          const { join } = require('node:path') as typeof import('node:path')
          // rebuild per call — these grew monotonically so an uninstalled
          // entry's spec/id lingered for the rest of the process lifetime
          for (const k of Object.keys(specByName)) delete specByName[k]
          for (const k of Object.keys(idByName)) delete idByName[k]
          for (const k of Object.keys(featByName)) delete featByName[k]
          const map: Record<string, string> = {}
          // host API first — source.target is the npm package name, which is
          // what catalog entries match on (CLI list reports internal ids)
          // inventory reachability: apiOk/cliOk mean the plugin inventory
          // could actually be READ (empty is fine) — both failing means the
          // installed badges we're about to report are silently incomplete
          let apiOk = false, cliOk = false
          try {
            if (m.client?.plugin?.list) {
              const res = await m.client.plugin.list() as { data?: { id?: string; source?: { type?: string; target?: string; version?: string; path?: string } }[] }
              apiOk = true   // set only after the call lands — a throwing
              // list() must still count as inventory-unreachable (degraded)
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
                } else if ((p.source?.type === 'git' || p.source?.type === 'github') && p.source?.target) {
                  // git-spec installs (owner/repo, github:, git urls) — shown
                  // as 'local' unless the host reports a pinned version; never
                  // claimed catalog-verified (unpinned refs move)
                  const clean = cleanSpec(p.source.target) || String(p.source.target)
                  map[clean] = p.source.version ?? 'local'
                  specByName[clean] = p.source.target
                  if (p.id) idByName[clean] = String(p.id)
                }
              }
            }
          } catch { /* host api unavailable */ }
          if (!Object.keys(map).length) try {
            const out = await new Promise<string>((res, rej) =>
              // restrictedEnv for parity with install/update — the fallback
              // must not leak ambient secrets into a spawned process either
              execFile('opencode', ['plugin', 'list'], { timeout: 15_000, env: restrictedEnv() }, (e, o, er) => e ? rej(new Error(er || e.message)) : res(o)))
            cliOk = true
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
            [await skillsRoot(), join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills')],
            d => readdirSync(d), p => existsSync(p)))
          // plugin.list reports the daemon's LOADED version — a pin we just
          // wrote still reads old until restart and would resurrect the
          // outdated badge. Config pins win; overlayConfigPins documents why.
          await overlayConfigPins(map)
          // installed plugins with no catalog entry still get a card — but a
          // catalog outage must NOT blank the whole inventory: degrade extras
          // (can't tell installed-but-uncataloged from installed-and-listed)
          // and keep the versions/skills already gathered
          let idxNames = new Set<string>()
          let extras: { name: string; version: string }[] = []
          try {
            // renderer already fetched+sanitized the index for display — reuse
            // its name list instead of pulling the multi-MB catalog a second
            // time just to split cataloged vs uncataloged specs
            const given = Array.isArray(p?.names) ? p.names.filter((x): x is string => typeof x === 'string') : null
            idxNames = given ? new Set(given) : new Set(((await fetchIndexCached(lastIndexUrl))?.plugins ?? []).map(p => p.name))
            extras = buildExtras(specByName, idByName, map, idxNames)
            for (const x of extras) map[x.name] = x.version
          } catch { lg('installed(): catalog unreachable — extras degraded (no uncataloged split)') }
          // degraded = every plugin-inventory path failed — skills may still
          // be reported from disk, but plugin-side "installed" badges are
          // unverifiable and the renderer must say so (invDown)
          return { versions: map, extras, features: featByName, degraded: !(apiOk || cliOk) }
        },
        install: async (p: { name: string; spec?: string; dev?: boolean }) => {
          const { spawn } = require('node:child_process') as typeof import('node:child_process')
          assertSpecForName(p.name, p.spec)
          // double-click / retry-during-flight guard — jobs.set would orphan
          // the first child while its stdout handlers still emit progress.
          // pendingInstall closes the pin-recheck await window between the
          // guard and jobs.set (two rapid IPC calls could both see empty).
          if (jobs.has(p.name) || pendingInstall.has(p.name)) throw new Error(t('installRunning'))
          const pac = new AbortController()
          pendingInstall.set(p.name, pac)
          const spec = p.spec ?? p.name          // catalog-approved pinned spec (name@ver)
          // the renderer's entry can lag the publication by up to TTL — a
          // version concern'd inside that window must NOT install. Health-
          // cheap recheck: a moved manifest sha forces a real re-pull.
          // p.dev skips it: the dev-mode version picker deliberately installs
          // versions the catalog never approved — assertSpecForName still
          // pins the name; the chosen version is the dev's own responsibility.
          if (!p.dev) try { await assertApprovedPin(() => fetchIndexCached(lastIndexUrl, true), p.name, spec) }
          catch (x) { pendingInstall.delete(p.name); throw new Error(/catalog moved|not in catalog/.test(String(x)) ? t('catalogMoved') : String(x)) }
          else lg(`install ${p.name}: dev override — skipping approved-pin check for ${spec}`)
          const clean = cleanSpec(spec)
          const push = (line: string) => m.emit?.('progress', { name: p.name, line })
          const done = (ok: boolean, wasCancelled = false) => m.emit?.('progress', { name: p.name, line: '', done: true, ok, ...(wasCancelled ? { cancelled: true } : {}) })
          const isCancelled = (x: unknown) => x instanceof Error && x.message === 'cancelled'
          // NO withConfigLock around the spawn — the lock guards config
          // read-modify-write sections, and `plugin add` writes config in the
          // CLI process outside our lock either way. Holding it across a
          // 90s spawn queued every other config op behind the sweep. The
          // claim stays through spawn AND the dedupe below: the close→dedupe
          // gap used to release both jobs and pendingInstall, letting a
          // second op (or uninstall) slip between `plugin add` and the
          // config rewrite.
          try {
            if (pac.signal.aborted) throw new Error('cancelled')
            push(`install ${spec}`)
            cancelled.delete(p.name)   // clear a stale mark from a prior op
            await new Promise<void>((res, rej) => {
              const child = spawn('opencode', ['plugin', 'add', spec], { env: restrictedEnv() })
              jobs.set(p.name, child)
              child.stdout?.on('data', (d: Buffer) => push(String(d).trim()))
              child.stderr?.on('data', (d: Buffer) => push(String(d).trim()))
              let timedOut = false
              let spawnFailed = false
              const kill = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 90_000)
              child.on('close', (code, signal) => {
                clearTimeout(kill); jobs.delete(p.name)
                // spawn-failed children also emit 'close' — without this the
                // error path's rejection and this handler's resolution both run
                if (spawnFailed) return
                // user-cancel and watchdog-timeout are not failures — report
                // them as such instead of 'exit null' (a killed child arrives
                // with code=null, indistinguishable from a crash without this)
                if (cancelled.has(p.name)) { cancelled.delete(p.name); rej(new Error('cancelled')); return }
                if (timedOut) { rej(new Error('timeout 90s')); return }
                code === 0 ? res() : rej(new Error(`exit ${code ?? signal ?? '?'}`))
              })
              child.on('error', (e: Error) => { clearTimeout(kill); jobs.delete(p.name); spawnFailed = true; rej(e) })
            })
            // `plugin add` APPENDS rather than dedupes — a same-name spec in
            // another form (installed() lag, manual edits, prior failed
            // dedupe) would linger forever. Same rewrite update() runs,
            // under the lock that exists for exactly this RMW.
            await withConfigLock(async () => {
              const cfg = await cfgPath()
              const d = await readJson(cfg)
              const list = strArrayField(d, 'plugins')
              const before = list.filter(s => cleanSpec(s) === clean)
              d.plugins = dedupeToSpec(list, spec)
              await writeJsonAtomic(cfg, d)
              if (before.length !== 1 || before[0] !== spec) { push(`config deduped ${before.join(',')} → ${spec}`); lg(`install ${p.name}: config rewritten (${before.length} specs → ${spec})`) }
            })
            lg(`install ${p.name}: ok`); done(true); return 'installed'
          } catch (x) {
            push(`install ${isCancelled(x) ? 'cancelled' : `failed: ${String(x)}`}`)
            lg(`install ${p.name}: ${isCancelled(x) ? 'cancelled' : `FAILED ${String(x)}`}`)
            done(false, isCancelled(x)); throw x
          } finally { pendingInstall.delete(p.name) }
        },
        update: async (p: { name: string; spec?: string; dev?: boolean }) => {
          assertSpecForName(p.name, p.spec)
          // pendingInstall closes the same pre-spawn window as install —
          // a sweep lane and a manual click must not double-start a spec
          if (jobs.has(p.name) || pendingInstall.has(p.name)) throw new Error(t('installRunning'))
          const pac = new AbortController()
          pendingInstall.set(p.name, pac)
          lg(`update ${p.name}: called`)
          const pin = p.spec ?? p.name             // catalog-approved pinned spec
          const clean = cleanSpec(pin)
          // same stale-window guard as install — pin must still equal the
          // catalog-approved spec before spawn/config writes happen.
          // p.dev skips it (version picker): name check already ran above.
          if (!p.dev) try { await assertApprovedPin(() => fetchIndexCached(lastIndexUrl, true), p.name, pin) }
          catch (x) { pendingInstall.delete(p.name); throw new Error(/catalog moved|not in catalog/.test(String(x)) ? t('catalogMoved') : String(x)) }
          else lg(`update ${p.name}: dev override — skipping approved-pin check for ${pin}`)
          lg(`update ${p.name}: pin=${pin} clean=${clean}`)
          const push = (line: string) => m.emit?.('progress', { name: p.name, line })
          const done = (ok: boolean, wasCancelled = false) => m.emit?.('progress', { name: p.name, line: '', done: true, ok, ...(wasCancelled ? { cancelled: true } : {}) })
          const isCancelled = (x: unknown) => x instanceof Error && x.message === 'cancelled'
          // claim released + abort checked BEFORE the spawn — the same
          // atomic hand-off install() uses, except the claim is NOT released
          // here: it stays through spawn AND the dedupe RMW (finally below),
          // closing the close→dedupe window where a second op could start
          // while this one's config rewrite was still pending. The spawn
          // itself must NOT sit inside withConfigLock: the mutex exists for
          // config RMW sections, and holding it across a 90s `plugin add`
          // queued every other config op (uninstall, skillSource,
          // skillPermission, other updates' dedupe) behind the sweep. Only
          // the dedupe below locks.
          try {
            if (pac.signal.aborted) throw new Error('cancelled')
            // pinned update: `plugin add` does NOT dedupe — a second spec for the
            // same package appends. Install the pinned spec first, then rewrite
            // config down to exactly that spec. Never plugin.update — it resolves
            // npm latest, which would bypass the approved-version gate.
            push(`install ${pin}`)
            cancelled.delete(p.name)   // clear a stale mark from a prior op
            await new Promise<void>((res, rej) => {
              const { spawn } = require('node:child_process') as typeof import('node:child_process')
              const child = spawn('opencode', ['plugin', 'add', pin], { env: restrictedEnv() })
              jobs.set(p.name, child)
              child.stdout?.on('data', (d: Buffer) => push(String(d).trim()))
              child.stderr?.on('data', (d: Buffer) => push(String(d).trim()))
              let timedOut = false
              const kill = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 90_000)
              child.on('close', (code, signal) => {
                clearTimeout(kill); jobs.delete(p.name)
                // cancelled/timeout surface through the catch below, which
                // emits the done event exactly once (cancelled flag included)
                if (cancelled.has(p.name)) { cancelled.delete(p.name); rej(new Error('cancelled')); return }
                if (timedOut) { rej(new Error('timeout 90s')); return }
                code === 0 ? res() : rej(new Error(`plugin add exit ${code ?? signal ?? '?'}`))
              })
              child.on('error', (e: Error) => { clearTimeout(kill); jobs.delete(p.name); rej(e) })
            })
            // config dedupe is the ONLY section that needs the lock — it is a
            // fast read-modify-write, and serializing it against other config
            // writers is what the mutex is for
            await withConfigLock(async () => {
              const cfg = await cfgPath()
              const d = await readJson(cfg)
              const list = strArrayField(d, 'plugins')
              const before = list.filter(s => cleanSpec(s) === clean)
              d.plugins = dedupeToSpec(list, pin)
              await writeJsonAtomic(cfg, d)
              if (before.length !== 1 || before[0] !== pin) { push(`config deduped ${before.join(',')} → ${pin}`); lg(`update ${p.name}: config rewritten (${before.length} specs → ${pin})`) }
            })
            lg(`update ${p.name}: pinned update ok`); done(true); return 'updated'
          } catch (x) {
            push(`update ${isCancelled(x) ? 'cancelled' : `failed: ${String(x)}`}`)
            lg(`update ${p.name}: ${isCancelled(x) ? 'cancelled' : `FAILED ${String(x)}`}`)
            done(false, isCancelled(x)); throw x
          } finally { pendingInstall.delete(p.name) }
        },
        cancelInstall: async (name: string) => {
          // mark BEFORE killing — the child's close handler reads this to
          // tell a user-cancel (code=null too) apart from a real failure
          if (jobs.has(name)) cancelled.add(name)
          jobs.get(name)?.kill('SIGTERM'); jobs.delete(name)
          // a skill-half download owns an AbortController instead of a child —
          // 'cancel' must reach it too (was spawn-only: skill fetches ran on)
          skillJobs.get(name)?.abort(); skillJobs.delete(name)
          // a claimed-but-childless op (pin recheck / index re-pull in
          // flight) has nothing to kill yet — its abort signal makes it
          // stop at the next step instead of spawning past the cancel
          pendingInstall.get(name)?.abort(); pendingInstall.delete(name)
          pendingSkill.get(name)?.abort(); pendingSkill.delete(name)
          return 'cancelled'
        },
        uninstall: async (name: string) => {
          // broader than assertPkgName on purpose: git-spec installs record
          // owner/repo, git urls, scp syntax etc. in plugins[] — removeSpec
          // only string-compares, so any well-formed spec ref is safe here
          // (assertPkgName rejected every git install → GUI couldn't remove it)
          assertUninstallRef(name)
          // in-flight guard — an install/update spawn rewriting opencode.json
          // must not interleave with this RMW (spec resurrect / lost update).
          // jobs/pending* key on the catalog name; cleanSpec normalizes a
          // spec-shaped ref to the same key
          const ref = cleanSpec(name)
          if (jobs.has(ref) || pendingInstall.has(ref) || pendingSkill.has(ref)) throw new Error(t('installRunning'))
          lg(`uninstall ${name}: called`)
          // remove the config spec(s) — daemon rescan unloads; CLI `plugin remove`
          // takes a spec, not the catalog name, and silently misses pinned specs
          return withConfigLock(async () => {
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
          })
        },
        // skills are file-system installs: extract tarball → config/skills/<name>.
        // The renderer only NAMES the entry — the host resolves the download
        // URL (github: the scanned commit sha, never HEAD) and the SRI (index-
        // announced, packument fallback) from the cached catalog itself, so a
        // compromised renderer can't fetch arbitrary tarballs or pass
        // integrity:null to skip the digest.
        writeSkill: async (p: { name: string }) => {
          assertSkillId(p.name)
          // duplicate-call guard — a manual install and an updateAll lane
          // reaching the same entry would race installSkillTar on the same
          // dest dir (manifest written by one, files by the other). Owns a
          // separate claim domain from pendingInstall so a dual entry's two
          // halves never lock each other out.
          if (pendingSkill.has(p.name)) throw new Error(t('installRunning'))
          const pac = new AbortController()
          pendingSkill.set(p.name, pac)
          try {
          const entry = (await fetchIndexCached(lastIndexUrl, true))?.plugins?.find(e => e.name === p.name)
          if (!entry) throw new Error(`not in catalog: ${p.name}`)
          if (pac.signal.aborted) throw new Error('cancelled')
          const plan = installPlan(entry)
          let url: string
          let integrity: string | null = null
          if (plan.skill === 'github') {
            // source.version is the scanned tree sha — gitPinRef validates the
            // pin is hex (a malformed ref in a crafted/custom index fails
            // closed instead of sliding a branch name past the scan)
            url = `https://codeload.github.com/${entry.source!.repo}/tar.gz/${gitPinRef(entry.source?.version)}`
          } else if (plan.skill === 'npm') {
            if (!entry.latestVersion) throw new Error('no approved version to install')
            const meta = await fetchPkgVersionMeta(entry.name, entry.latestVersion)
            if (!meta.tarball) throw new Error(`no tarball for approved v${entry.latestVersion}`)
            url = meta.tarball
            integrity = entry.integrity ?? meta.integrity
          } else throw new Error('no skill part to install')
          const ac = new AbortController()
          skillJobs.set(p.name, ac)
          let bytes: Uint8Array
          try {
            try {
              const res = await fetch(url, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(30_000)]) })
              if (!res.ok) throw new Error(`skill fetch failed: ${res.status}`)
              // redirects must not downgrade past the https-pinned tarball URL
              assertFetchFinalUrl(res, 'skill tarball')
              // stream-bounded read — a lying/absent content-length can't push
              // the whole tarball through memory before the size check runs
              bytes = await readBodyBounded(res, MAX_SKILL_TGZ, 'skill tarball')
            } catch (x) {
              // a user-cancel abort must surface as 'cancelled', not a raw
              // AbortError the renderer would dress up as a failure — the
              // 30s timeout abort leaves pac un-aborted and keeps its own
              // honest error
              if (pac.signal.aborted) throw new Error('cancelled')
              throw x
            }
          } finally { skillJobs.delete(p.name) }
          // fail closed on a KNOWN mismatch; null = unverifiable (no SRI /
          // no subtle crypto) and proceeds — github repo tarballs carry none
          const ok = await integrityMatches(bytes, integrity)
          if (ok === false) throw new Error('integrity mismatch — downloaded bytes do not match the reviewed artifact')
          // last cancel checkpoint before touching the disk
          if (pac.signal.aborted) throw new Error('cancelled')
          return installSkillTar({ name: p.name, gzipped: bytes, root: await skillsRoot() })
          } finally { pendingSkill.delete(p.name) }
        },
        // read when no input; enable:true appends the url, enable:false strips
        // it — other skills[] entries are preserved either way
        skillSource: async (p: { url?: unknown; enable?: unknown } = {}) => {
          // loopback-http counts (isSkillsUrl) — a dev index derives a
          // loopback skills url; rejecting it silently toggled the DEFAULT
          // published catalog instead of the one the user asked for
          const url = isSkillsUrl(p?.url) ? p.url : skillsUrl(urlOrDefault(null))
          return withConfigLock(async () => {
            const cfg = await cfgPath()
            const d = await readJson(cfg)
            const list = strArrayField(d, 'skills')
            const wasEnabled = list.includes(url)
            if (p?.enable === true && !wasEnabled) { d.skills = [...list, url]; await writeJsonAtomic(cfg, d) }
            if (p?.enable === false && wasEnabled) { d.skills = list.filter(u => u !== url); await writeJsonAtomic(cfg, d) }
            return { url, enabled: p?.enable === true ? true : p?.enable === false ? false : wasEnabled }
          })
        },
        skillPermission: async (p: { id: string; mode: 'allow' | 'deny' | 'ask' | null }) => {
          const cfg = await cfgPath()
          // empty id = read-only listing (renderer enumerates installed skills
          // then asks which permissions are set)
          if (!p?.id) {
            const d = await readJson(cfg)
            const perms = (Array.isArray(d.permissions) ? d.permissions : [])
              .filter((r): r is { action: string; resource: string; effect: string } =>
                !!r && typeof r === 'object' &&
                typeof (r as { action?: unknown }).action === 'string' &&
                typeof (r as { resource?: unknown }).resource === 'string' &&
                typeof (r as { effect?: unknown }).effect === 'string')
            return Object.fromEntries(perms.filter(r => r.action === 'skill').map(r => [r.resource, r.effect]))
          }
          return withConfigLock(() => writeSkillPermission(cfg, p.id, p.mode ?? null))
        },
        readDevlog: async () => {
          try { const { readFileSync } = require('node:fs') as typeof import('node:fs')
            return readFileSync(await marketLogPath(), 'utf8').split('\n').filter(Boolean).slice(-100).join('\n')
          } catch { return '' }
        },
        clearDevlog: async () => {
          try { const { writeFileSync } = require('node:fs') as typeof import('node:fs')
            writeFileSync(await marketLogPath(), '')
          } catch { /* nothing to clear */ }
          return 'ok'
        },
        devlog: async (line: string) => {
          if (!devlogOn) return 'off'
          await appendBounded(await marketLogPath(), `${new Date().toLocaleString('sv-SE')} ${String(line).slice(0, 2000)}\n`)
          return 'ok'
        },
        setDevlog: async (on: boolean) => { devlogOn = !!on; return 'ok' },
        uninstallSkill: async (name: string) => {
          try {
            assertSkillId(name)
            // same in-flight guard as uninstall — a skill install mid-flight
            // owns this dest dir; deleting under it would orphan its manifest
            if (pendingSkill.has(name) || skillJobs.has(name)) throw new Error(t('installRunning'))
            return await uninstallSkillDir(name, await skillsRoot())
          } catch (e) { throw e instanceof Error ? e : new Error(String(e)) }
        },
        // self-confirm: isolated serve + API hit → real "did it load" verdict.
        // input is the pinned spec (name@approvedVersion) — a bare name would
        // resolve dist-tags.latest and test a version the user never got.
        verifyActivation: (spec: string) => {
          const name = cleanSpec(String(spec))
          assertSpecForName(name, spec)
          return probeActivation(name, spec)
        },
      })
  },
})
