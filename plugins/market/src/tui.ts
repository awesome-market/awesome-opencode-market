/**
 * TUI entry — exports["./tui"], loaded by the terminal client.
 * Real API: ctx.keymap.layer() + KeymapCommand.slash (packages/plugin/src/tui/context.ts).
 */
import { Plugin } from '@opencode/plugin/tui'
import { fetchIndex } from './catalog.js'

export default Plugin.define({
  id: 'opencode-market',
  setup(ctx) {
    ctx.keymap.layer(() => ({
      id: 'opencode-market',
      commands: [{
        id: 'opencode-market.open',
        title: 'Open plugin market',
        slash: { name: 'market' },
        run: () => {
          fetchIndex()
            .then(idx => {
              const lines = idx.plugins
                .slice(0, 50)
                .map(p => `${p.name.padEnd(36)} ${p.verification?.status ?? '?'}  ${p.description?.en ?? ''}`)
              ctx.ui.dialog.show({ title: `Market (${idx.plugins.length})`, body: lines.join('\n') })
            })
            .catch(e => ctx.ui.toast(`market fetch failed: ${(e as Error).message}`))
        },
      }],
    }))
  },
})
