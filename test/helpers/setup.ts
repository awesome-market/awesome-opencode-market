// jsdom lacks rAF — solid-js/web batches render effects on it, so without a
// polyfill signal-driven re-renders never flush in mount tests.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number
}
