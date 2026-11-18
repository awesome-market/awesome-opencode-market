/** outbound fetch honoring HTTP(S)_PROXY/NO_PROXY — Node's undici fetch
 *  ignores proxy env vars by default, so hosts only reachable via a local
 *  proxy (raw.githubusercontent/api.github.com behind a network filter)
 *  time out silently and masquerade as "fetch failed". EnvHttpProxyAgent
 *  is a no-op when no proxy env is set, so CI is unaffected. */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

let installed = false
export function installEnvProxy(): void {
  if (installed) return
  installed = true
  if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY &&
      !process.env.http_proxy && !process.env.https_proxy) return
  setGlobalDispatcher(new EnvHttpProxyAgent())
}
