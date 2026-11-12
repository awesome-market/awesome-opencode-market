/** CLI entry guard. `import.meta.url` percent-encodes non-ASCII path segments
 *  and is realpath-resolved by the loader, while `process.argv[1]` keeps the
 *  spelled filesystem path — a naive `import.meta.url === 'file://'+argv[1]`
 *  compare is FALSE on checkouts under CJK/space/accented dirs and on symlinked
 *  paths, silently disabling the whole CLI (exit 0, no output). Canonicalize
 *  both sides before comparing. */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const isMain = (metaUrl: string): boolean => {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    const a = realpathSync(argv1)
    const m = realpathSync(fileURLToPath(metaUrl))
    // case-insensitive volumes (default macOS/Windows) can disagree on case
    // between the spelled argv and the loader-resolved url
    return a === m || (process.platform !== 'linux' && a.toLowerCase() === m.toLowerCase())
  } catch {
    return false
  }
}
