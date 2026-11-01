/** Static scan rules v1 (DEV §3). Read-only analysis — never executes package code. */

export type Severity = 'high' | 'medium' | 'low'

export interface Rule {
  id: string
  sev: Severity
  /** match against file path + text content (binary files flagged by isBinary separately) */
  test(path: string, content: string | null): string | null
}

const isPkgJson = (p: string) => /(^|\/)package\.json$/.test(p)

export const RULES: Rule[] = [
  {
    id: 'lifecycle-script', sev: 'high',
    test: (p, c) => isPkgJson(p) && c != null && /"(pre|post)?install"\s*:\s*"[^"]+"/.test(c)
      ? 'npm lifecycle script (pre/post/install) — code runs at install time' : null,
  },
  {
    id: 'prepare-script', sev: 'high',
    test: (p, c) => isPkgJson(p) && c != null && /"prepare"\s*:\s*"[^"]+"/.test(c)
      ? '"prepare" script — runs on git/tarball install' : null,
  },
  {
    id: 'network-call', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const m = c.match(/fetch\(|http\.request|require\(['"]https?['"]|axios|curl |wget /)
      return m ? `network indicator: ${m[0]}` : null
    },
  },
  {
    id: 'literal-ip', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const m = c.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
      if (!m) return null
      // ignore documentation/well-known ranges that are almost never endpoints
      if (/^(0\.0\.0\.0|127\.|255\.|169\.254\.|198\.51\.100\.|203\.0\.113\.|192\.0\.2\.)/.test(m[0])) return null
      return `literal IP ${m[0]}`
    },
  },
  {
    id: 'obfuscation', sev: 'high',
    test: (_p, c) => {
      if (c == null) return null
      if (/eval\(|new Function|atob\(/.test(c)) return 'eval/Function/atob usage'
      if (/(\\x[0-9a-fA-F]{2}){8,}/.test(c)) return 'long hex-escaped blob'
      return null
    },
  },
  {
    id: 'credential-read', sev: 'high',
    test: (p, c) => {
      // docs legitimately mention credential paths — only fire on code
      if (c == null || !/\.(js|mjs|cjs|ts|mts|cts|sh)$/i.test(p)) return null
      const m = c.match(/\.ssh|id_rsa|\.aws\/credentials|keychain|\.npmrc|\.netrc/)
      return m ? `credential-path reference: ${m[0]}` : null
    },
  },
  {
    id: 'child-process', sev: 'medium',
    test: (_p, c) =>
      c != null && /child_process|execSync|spawnSync|\bspawn\(|\bexec\(/.test(c) ? 'spawns child processes' : null,
  },
]

/** Binary blob detection: >30% non-printable bytes in first 8KB. */
export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  if (n === 0) return false
  let non = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]!
    if (b === 0 || (b < 9) || (b > 13 && b < 32)) non++
  }
  return non / n > 0.3
}
