import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    alias: {
      '@opencode/plugin/gui': new URL('./test/helpers/host-stub.ts', import.meta.url).pathname,
      'solid-js/web': 'solid-js/web/dist/web.js',
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['pipeline/**/*.ts', 'src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
})
