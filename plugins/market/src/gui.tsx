/**
 * GUI entry — exports["./gui-experimental"], evaluated by desktop windows + main process.
 * Data path: window ctx.main(Market) → main ctx.provide impl → fetchIndex (main has network).
 * Whitelist: only solid-js, @opencode/*, effect, @opencode/client requireable.
 */
import { Plugin, Panel, Command, SettingsPage, Ipc } from '@opencode/plugin/gui'
import { Schema } from 'effect'
import { createResource, For, Show } from 'solid-js'
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

/** The market list view — reads prefetched snapshot (h-props are eager). */
export function MarketView(props: { api: Api }) {
  void props
  const r = snapshot
  return (
    <div style={{ padding: '12px', 'overflow-y': 'auto', height: '100%' }} data-scrollable>
      <h3 style={{ margin: '0 0 8px' }}>opencode market</h3>
      {r === null
        ? <p>loading… (revisit after data arrives)</p>
        : !r.ok
          ? <p style={{ color: '#c66' }}>fetch failed: {r.err}</p>
          : <>
              <p style={{ opacity: 0.6, 'font-size': '12px' }}>
                {r.i.plugins.length} entries · not affiliated · findings ≠ proof of safety
              </p>
              <For each={rows(r.i.plugins)}>
                {(e) => <EntryRow e={e} />}
              </For>
            </>}
    </div>
  )
}

function EntryRow(props: { e: MarketEntry }) {
  const e = props.e
  const flag = () => (e.capabilities?.redFlags.length ? '⚠' : '')
  const v = () => e.verification?.status ?? 'unverified'
  const color = () =>
    v() === 'verified' ? '#4a4' : e.capabilities?.redFlags.length ? '#c66' : '#888'
  return (
    <div style={{ padding: '6px 0', 'border-bottom': '1px solid #3333', 'font-size': '13px' }}>
      <b>{e.name}</b> {flag()} <span style={{ color: color(), 'font-size': '11px' }}>{v()}</span>
      <div style={{ opacity: 0.7, 'font-size': '12px' }}>{e.description?.en ?? ''}</div>
      <code style={{ 'font-size': '11px', opacity: 0.6 }}>opencode plugin add {e.name}</code>
    </div>
  )
}
