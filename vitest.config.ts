import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
// fileURLToPath (not .pathname): non-ASCII checkout paths percent-encode and
// the aliased targets silently miss → "Cannot find package 'solid-js'".
export default defineConfig({
  resolve: {
    conditions: ['browser', 'solid', 'development'],
    // fileURLToPath, not .pathname — URL.pathname stays percent-encoded, so
    // a checkout under a non-ASCII path breaks every alias (CJK/accents in
    // the dir name → "Cannot find package 'solid-js'" on any file that
    // imports it). fileURLToPath decodes back to the real filesystem path.
    alias: {
      '@opencode/plugin/gui': fileURLToPath(new URL('./test/helpers/host-stub.ts', import.meta.url)),
      // subpath aliases must precede the bare 'solid-js' key — prefix matching
      // would otherwise mangle 'solid-js/store' into '<root dist>/store'
      'solid-js/store': fileURLToPath(new URL('./plugins/market/node_modules/solid-js/store/dist/store.js', import.meta.url)),
      'solid-js/web': fileURLToPath(new URL('./plugins/market/node_modules/solid-js/web/dist/web.js', import.meta.url)),
      'solid-js': fileURLToPath(new URL('./plugins/market/node_modules/solid-js/dist/solid.js', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'plugins/market/test/**/*.test.ts'],
    setupFiles: ['test/helpers/setup.ts'],
    deps: { optimizer: { ssr: { include: ['solid-js', 'solid-js/web'] } } },
    coverage: {
      provider: 'v8',
      include: ['pipeline/**/*.ts', 'src/**/*.ts', 'plugins/market/src/**/*.ts*'],
      thresholds: {
        // vitest applies the global bar to ALL included files (even glob-matched
        // ones), so it can only be a regression floor for the combined set —
        // the real gates live on the per-directory globs below
        lines: 74, functions: 56, branches: 67, statements: 67,
        // original gate: pipeline+src held at 90 as before
        '{pipeline,src}/**/*.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        // market pure-logic files hold roughly the same bar (spec trivially
        // full; catalog/skill-install sit at ~97/~99 lines)
        'plugins/market/src/{catalog,skill-install,spec}.ts': { lines: 90, functions: 85, branches: 75, statements: 85 },
        'plugins/market/src/version.ts': { lines: 0, functions: 0, branches: 0, statements: 0 },
        // host-main glue is partly exercised by unit tests — floor at current
        // level so it can't silently regress; the rest is e2e-covered
        'plugins/market/src/hostx.ts': { lines: 55, functions: 55, branches: 50, statements: 55 },
        // UI bundles have no unit harness (desktop/tui e2e covers them) —
        // included for report visibility, not gated
        'plugins/market/src/{gui.ts,tui.tsx,server.ts}': { lines: 0, functions: 0, branches: 0, statements: 0 },
      }
    }
  }
})
