import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    conditions: ['browser', 'solid', 'development'],
    alias: {
      '@opencode/plugin/gui': new URL('./test/helpers/host-stub.ts', import.meta.url).pathname,
      'solid-js/web': new URL('./plugins/market/node_modules/solid-js/web/dist/web.js', import.meta.url).pathname,
      'solid-js': new URL('./plugins/market/node_modules/solid-js/dist/solid.js', import.meta.url).pathname,
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'plugins/market/test/**/*.test.ts'],
    setupFiles: ['test/helpers/setup.ts'],
    deps: { optimizer: { ssr: { include: ['solid-js', 'solid-js/web'] } } },
    coverage: {
      provider: 'v8',
      include: ['pipeline/**/*.ts', 'src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
})
