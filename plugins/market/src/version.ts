/** Version stamp injected by build.ts (esbuild define) so the header label
 *  never drifts from package.json. Dev/tsc runs without the define fall back
 *  to a neutral marker. */
declare const __PKG_VERSION__: string | undefined
export const PKG_VERSION = typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : '0.0.0-dev'
