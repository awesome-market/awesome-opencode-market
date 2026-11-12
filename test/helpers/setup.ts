// jsdom lacks rAF — solid-js/web batches render effects on it, so without a
// polyfill signal-driven re-renders never flush in mount tests.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number
}
// deterministic 'auto' locale — catalog resolves zh from LANG/LC_ALL now, so
// a zh host (LANG=zh_CN.UTF-8) flips every label assertion without this pin
process.env.LANG = 'en_US.UTF-8'
process.env.LC_ALL = 'en_US.UTF-8'
delete process.env.LANGUAGE
