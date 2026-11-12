/** Build: server/tui → ESM dist/*.js; gui → single-file CJS bundle (host whitelist requires all deps inlined). */
import { build } from 'esbuild'
import { solidPlugin } from 'esbuild-plugin-solid'
import { readFileSync } from 'node:fs'

// header version stamp — compiled in so the UI label can't drift from the
// published package.json (was a hardcoded 'v0.0.3' that went stale at 0.0.4)
const pkgVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

const shared = {
  bundle: true,
  external: ['@opencode/plugin', '@opencode/plugin/*', '@opentui/*', 'effect', 'effect/*', 'solid-js', 'solid-js/*', 'node:*'],
  target: 'es2022',
  logLevel: 'warning' as const,
  define: { __PKG_VERSION__: JSON.stringify(pkgVersion) },
}

await Promise.all([
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/server.js', format: 'esm', platform: 'node' }),
  build({
    ...shared,
    entryPoints: ['src/tui.tsx'],
    outfile: 'dist/tui.js',
    format: 'esm',
    platform: 'node',
    // Solid needs its own transform: props must compile to getters or
    // Show/For children and signal reads are eagerly evaluated (wrong + crashes)
    plugins: [solidPlugin({ solid: { generate: 'universal', moduleName: '@opentui/solid' } })],
  }),
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
