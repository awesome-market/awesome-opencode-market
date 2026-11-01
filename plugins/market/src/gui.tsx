/**
 * GUI entry — exports["./gui-experimental"], evaluated by desktop windows.
 * Real implementation per packages/plugin/src/gui/registries.ts Panel contract.
 * Whitelist: only solid-js, @opencode/*, effect, @opencode/client requireable.
 */
import { Plugin, Panel } from '@opencode/plugin/gui'
import { createResource, For, Show } from 'solid-js'
import { fetchIndex, rows, type MarketEntry } from './catalog.js'

export default Plugin.define({
  setup(ctx) {
    ctx.add(Panel, () => ({
      id: 'market',
      region: 'side' as const,
      // one launcher tab; content fetched lazily in render
      list: () => [{ id: 'market', title: 'Market', transient: true } as never],
      render: () => MarketView(),
    }))
  },
})

/** The market list view — verified first, red-flagged last, honest status per row. */
export function MarketView() {
  const [idx] = createResource(() => fetchIndex().catch(() => null))
  return (
    <div style={{ padding: '12px', 'overflow-y': 'auto', height: '100%' }} data-scrollable>
      <h3 style={{ margin: '0 0 8px' }}>opencode market</h3>
      <Show when={idx()} fallback={<p>loading…</p>}>
        {(i) => (
          <>
            <p style={{ opacity: 0.6, 'font-size': '12px' }}>
              {i().plugins.length} entries · not affiliated · findings ≠ proof of safety
            </p>
            <For each={rows(i().plugins)}>
              {(e) => <EntryRow e={e} />}
            </For>
          </>
        )}
      </Show>
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
