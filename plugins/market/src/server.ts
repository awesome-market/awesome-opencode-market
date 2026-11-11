/**
 * Server entry — v2 module shape {id, setup}.
 * The market is mostly a UI plugin; server side only provides identity + options.
 */
export default {
  id: 'opencode-market',
  setup(_ctx: { options?: { indexUrl?: string } }) {
    // ctx.options.indexUrl is the catalog endpoint override — resolved by the
    // GUI/TUI surfaces via resolveIndexUrl() (options > env > devSource
    // toggle > published default)
  },
}
