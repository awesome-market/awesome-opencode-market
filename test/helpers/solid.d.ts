// Type shim — solid-js resolves at runtime via vitest alias (plugins/market
// node_modules), but root tsc has no declarations for it.
declare module 'solid-js' {
  export function createRoot<T>(fn: (dispose?: () => void) => T): T
  export function createSignal<T>(v: T): [() => T, (v: T) => T]
  export function createEffect(fn: () => void): void
}
