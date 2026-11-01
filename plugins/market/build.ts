/** Build: server/tui → ESM dist/*.js; gui → single-file CJS bundle (host whitelist requires all deps inlined). */
import { build } from 'esbuild'

const shared = {
  bundle: true,
  external: ['@opencode/plugin', '@opencode/plugin/*', 'effect', 'effect/*', 'solid-js', 'solid-js/*'],
  target: 'es2022',
  logLevel: 'warning' as const,
}

await Promise.all([
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/server.js', format: 'esm', platform: 'node' }),
  build({ ...shared, entryPoints: ['src/tui.ts'], outfile: 'dist/tui.js', format: 'esm', platform: 'node' }),
  // GUI must be CJS text the host evaluates (host.ts: entry only accepted if .cjs/.js + CommonJS-evaluable)
  build({
    ...shared,
    entryPoints: ['src/gui.ts'],
    outfile: 'dist/gui.cjs',
    format: 'cjs',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'solid-js/h',
  }),
])
console.log('dist/: server.js tui.js gui.cjs')
