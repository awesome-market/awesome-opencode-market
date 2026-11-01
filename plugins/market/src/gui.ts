/**
 * GUI entry — exports["./gui-experimental"], evaluated by desktop windows + main process.
 * Data path: window ctx.main(Market) → main ctx.provide impl → fetchIndex (main has network).
 * Whitelist: only solid-js, @opencode/*, effect, @opencode/client requireable.
 */
import { Plugin, Panel, Command, SettingsPage, Ipc } from '@opencode/plugin/gui'
import { Schema } from 'effect'
import { fetchIndex, rows, type MarketEntry, type MarketIndex } from './catalog.js'

/** Contract: window calls index(), main process serves it. */
const Market = Ipc.define({
  id: 'opencode-market',
  methods: {
    index: { output: Schema.Unknown },
  },
})

type Api = { index(): Promise<MarketIndex> }

let snapshot: { ok: true; i: MarketIndex } | { ok: false; err: string } | null = null

export default Plugin.define({
  setup(ctx) {
    // defensive: surface Ipc failure in-page instead of crashing setup
    let api: Api
    try {
      api = ctx.main(Market) as unknown as Api
      if (!api) throw new Error('ctx.main returned no client')
    } catch (e) {
      const err = e as Error
      api = { index: () => Promise.reject(err) }
    }
    // solid-js/h props are eager — prefetch into snapshot; view reads it on mount
    api.index().then(
      (i) => { snapshot = { ok: true, i: i as MarketIndex } },
      (e: unknown) => { snapshot = { ok: false, err: String(e) } },
    )
    ctx.add(Panel, () => ({
      id: 'market',
      region: 'side' as const,
      list: () => [{ id: 'market', title: 'Market' } as never],
      render: () => MarketView({ api }),
    }))
    ctx.add(SettingsPage, () => ({
      id: 'market',
      title: 'Market',
      render: () => MarketView({ api }),
    }))
    ctx.add(Command, () => ({
      id: 'open-market',
      title: 'Open Market',
      slash: { name: 'market' },
      run: () => {},
    }))
  },
  /** Main-process entry: real network lives here. */
  main(ctx) {
    ctx.provide(Market, {
      // SPIKE: stub data first — proves Ipc connect independent of fetch-in-main
      index: () => Promise.resolve({
        version: '1', generatedAt: 'stub', categories: {},
        plugins: [
          { name: 'ipc-stub-verified', slug: 's/a', type: 'plugin',
            verification: { status: 'verified' }, capabilities: { redFlags: [], findings: [], scannedAt: 't' },
            description: { en: 'ipc channel works' } } as unknown as MarketEntry,
          { name: 'ipc-stub-flagged', slug: 's/b', type: 'plugin',
            verification: { status: 'skipped' }, capabilities: { redFlags: ['x'], findings: [], scannedAt: 't' },
            description: { en: 'if you see this, fetch-in-main is the bug' } } as unknown as MarketEntry,
        ],
      }),
    })
  },
})

/** The market list view — DOM builder (whitelist has no jsx-runtime; h props are eager anyway). */
export function MarketView(props: { api: Api }) {
  void props
  const root = document.createElement('div')
  root.style.cssText = 'padding:12px;overflow-y:auto;height:100%'
  root.dataset.scrollable = ''
  const h3 = document.createElement('h3')
  h3.textContent = 'opencode market'
  h3.style.margin = '0 0 8px'
  root.appendChild(h3)
  const r = snapshot
  if (r === null) {
    const p = document.createElement('p')
    p.textContent = 'loading… (revisit after data arrives)'
    root.appendChild(p)
    return root
  }
  if (!r.ok) {
    const p = document.createElement('p')
    p.style.color = '#c66'
    p.textContent = `fetch failed: ${r.err}`
    root.appendChild(p)
    return root
  }
  const meta = document.createElement('p')
  meta.style.cssText = 'opacity:.6;font-size:12px'
  meta.textContent = `${r.i.plugins.length} entries · not affiliated · findings ≠ proof of safety`
  root.appendChild(meta)
  for (const e of rows(r.i.plugins)) root.appendChild(entryRow(e))
  return root
}

function entryRow(e: MarketEntry): HTMLElement {
  const v = e.verification?.status ?? 'unverified'
  const flag = e.capabilities?.redFlags.length ? ' ⚠' : ''
  const color = v === 'verified' ? '#4a4' : e.capabilities?.redFlags.length ? '#c66' : '#888'
  const div = document.createElement('div')
  div.style.cssText = 'padding:6px 0;border-bottom:1px solid #3333;font-size:13px'
  const b = document.createElement('b')
  b.textContent = e.name + flag
  const span = document.createElement('span')
  span.style.cssText = `color:${color};font-size:11px;margin-left:6px`
  span.textContent = v
  const desc = document.createElement('div')
  desc.style.cssText = 'opacity:.7;font-size:12px'
  desc.textContent = e.description?.en ?? ''
  const code = document.createElement('code')
  code.style.cssText = 'font-size:11px;opacity:.6'
  code.textContent = `opencode plugin add ${e.name}`
  div.append(b, span, desc, code)
  return div
}


