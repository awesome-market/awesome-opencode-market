/**
 * TUI entry — exports["./tui"], loaded by the terminal client.
 * Real API: ctx.keymap.layer() + KeymapCommand.slash (packages/plugin/src/tui/context.ts).
 */
import { Plugin } from '@opencode/plugin/tui'
import { fetchIndex, search } from './catalog.js'

export default Plugin.define({
  id: 'opencode-market',
  setup(ctx) {
    ctx.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'opencode-market.open',
        title: 'Open plugin market',
        palette: true,
        slash: { name: 'market', arguments: true },
        run: (input) => {
          fetchIndex()
            .then(idx => {
              const hits = search(idx.plugins, String(input ?? ''))
              const options = hits.slice(0, 40).map(p => ({
                title: `${p.name} — ${p.verification?.status ?? '?'}`,
                value: p.name,
                description: p.description?.en ?? '',
              }))
              if (!options.length) { ctx.ui.toast.show({ message: `market: no match for "${input}"` }); return }
              void ctx.ui.dialog.select<string>({ title: `Market (${hits.length})`, options })
                .then(name => { if (name) void ctx.ui.dialog.alert({
                  title: name, message: `install: opencode plugin add ${name}` }) })
            })
            .catch(e => ctx.ui.toast.show({ message: `market fetch failed: ${(e as Error).message}` }))
        },
      }],
    }))
  },
})
