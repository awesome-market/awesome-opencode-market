/** opt-in outbound proxy — a -p/--proxy flag or MARKET_PROXY env var.
 *  Accepted shapes: `1080` (bare port → socks5://127.0.0.1:1080),
 *  `socks5://ip:port` / `sock5://ip:port`, bare `ip:port` (→ socks5),
 *  `http(s)://ip:port`. Standard proxy env vars are deliberately ignored:
 *  undici fetch uses no proxy by default and a dead ambient proxy must
 *  never silently break context fetches. Unset → plain direct fetch. */
import { Agent, ProxyAgent, Socks5ProxyAgent, Dispatcher, setGlobalDispatcher } from 'undici'

export function normalizeProxy(raw: string): string {
  const p = raw.trim()
  if (/^\d+$/.test(p)) return `socks5://127.0.0.1:${p}`
  if (p.startsWith('sock5://')) return `socks5://${p.slice(8)}`
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p)) return `socks5://${p}`
  return p
}

/** loopback + RFC1918 always go direct — through a tunnel `localhost`
 *  means the VPS's localhost (the omlx judge at 127.0.0.1:8001 dies with
 *  `open failed: connect failed`), and LAN targets aren't reachable from
 *  the VPS either. */
const DIRECT_HOST = /^https?:\/\/(localhost|0\.0\.0\.0|\[::1\]|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/
export const isDirectOrigin = (origin: string): boolean => DIRECT_HOST.test(origin)

export class LocalBypass extends Dispatcher {
  #proxy: Dispatcher
  #direct = new Agent()
  constructor(proxy: Dispatcher) { super(); this.#proxy = proxy }
  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    return (isDirectOrigin(String(opts.origin)) ? this.#direct : this.#proxy).dispatch(opts, handler)
  }
}

let installed = false
export function installMarketProxy(override?: string): void {
  if (installed) return
  installed = true
  const raw = (override ?? process.env.MARKET_PROXY)?.trim()
  if (!raw) return
  const p = normalizeProxy(raw)
  const agent = p.startsWith('http://') || p.startsWith('https://')
    ? new ProxyAgent(p)
    : new Socks5ProxyAgent(p)
  setGlobalDispatcher(new LocalBypass(agent))
}
