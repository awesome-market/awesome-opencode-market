/**
 * GUI entry — exports["./gui-experimental"], evaluated by desktop windows.
 * Registers a session.panel menu item "Market" backed by the catalog index.
 * Whitelist constraint: only solid-js, opencode SDK, effect, opencode/client modules are requireable —
 * everything else must be bundled in by the build (esbuild → single CJS file).
 */
import { Plugin, MenuItem } from '@opencode/plugin/gui'
import { fetchIndex, type MarketEntry } from './catalog.js'

export default Plugin.define({
  setup(ctx) {
    ctx.add(MenuItem, () => ({
      menu: 'session.panel',
      id: 'market',
      title: 'Market',
      run: () => void openMarketPanel(),
    }))
  },
})

let cached: MarketEntry[] | null = null

async function openMarketPanel(): Promise<void> {
  // TODO(P5a): wire to host panel registry — open a tab listing `rows()`.
  cached ??= (await fetchIndex()).plugins
}

/** Sorted rows for the panel view (verified first, then unverified, redFlag last). */
export function rows(entries: MarketEntry[]): MarketEntry[] {
  const rank = (e: MarketEntry) =>
    e.verification?.status === 'verified' ? 0 : e.capabilities?.redFlags.length ? 2 : 1
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
