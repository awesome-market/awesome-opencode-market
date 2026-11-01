/**
 * TUI entry — exports["./tui"], loaded by the terminal client.
 * Spike demo: /market slash command → panel listing index.json entries.
 * TODO(P5a): verify exact context API surface against installed @opencode/plugin version.
 */
import { Plugin } from '@opencode/plugin/tui'
import { fetchIndex } from './catalog.js'

export default Plugin.define({
  id: 'opencode-market',
  setup(ctx) {
    // Register a slash command that opens the market list.
    // API names follow packages/plugin/src/tui/context.ts (commands/panel surface).
    const anyCtx = ctx as unknown as {
      commands?: { add?: (c: unknown) => void }
      ui?: { panel?: { open?: (name: string, render: unknown) => void }; toast?: (m: string) => void }
      render?: (node: unknown) => void
    }
    anyCtx.commands?.add?.({
      id: 'market',
      title: 'Open plugin market',
      run: async () => {
        try {
          const idx = await fetchIndex()
          const lines = idx.plugins.map(
            p => `${p.name.padEnd(36)} ${p.verification?.status ?? '?'}  ${p.description?.en ?? ''}`.slice(0, 120),
          )
          anyCtx.ui?.panel?.open?.('market', lines.join('\n'))
        } catch (e) {
          anyCtx.ui?.toast?.(`market fetch failed: ${(e as Error).message}`)
        }
      },
    })
  },
})
