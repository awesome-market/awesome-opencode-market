/** opt-in outbound proxy — ONLY honors MARKET_PROXY (e.g.
 *  `socks5://127.0.0.1:1080` for `ssh -D`, or `http://127.0.0.1:7890`).
 *  HTTP_PROXY/HTTPS_PROXY/ALL_PROXY are deliberately ignored: Node's
 *  undici fetch uses no proxy by default and this machine's context
 *  fetches must never silently pick up a dead ambient proxy. Unset or
 *  empty → plain direct fetch. */
import { ProxyAgent, Socks5ProxyAgent, setGlobalDispatcher } from 'undici'

let installed = false
export function installMarketProxy(): void {
  if (installed) return
  installed = true
  const p = process.env.MARKET_PROXY?.trim()
  if (!p) return
  const agent = p.startsWith('http://') || p.startsWith('https://')
    ? new ProxyAgent(p)
    : new Socks5ProxyAgent(p.startsWith('socks5://') || p.startsWith('socks4://') ? p : `socks5://${p}`)
  setGlobalDispatcher(agent)
}
