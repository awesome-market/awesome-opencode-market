/** Static scan rules v1 (DEV §3). Read-only analysis — never executes package code. */

/** Bump when rules change — part of the scan cache key; stale findings get re-scanned. */
export const RULESET_VERSION = 'r5'

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
    // install-stage only: these run on the CONSUMER's machine during
    // npm install (prepublish is deprecated but still ran on install in
    // old npm). Pack-stage hooks (prepublishOnly/prepack/postpack) run
    // on the author's machine at publish/pack — downgraded to the
    // medium 'pack-script' rule below; they gated ~half of all
    // lifecycle hits as false positives.
    test: (p, c) => isPkgJson(p) && c != null && /"(preinstall|postinstall|install|prepublish)"\s*:\s*"[^"]+"/.test(c)
      ? 'npm lifecycle script (install stage) — code runs at install time' : null,
  },
  {
    id: 'pack-script', sev: 'medium',
    // runs on npm pack/publish on the publisher's machine, not on
    // consumer install — a maintainer-side supply-chain signal, not a
    // consumer red flag (prepare remains 'high' via its own rule: it
    // DOES run when installing a git/tarball dep)
    test: (p, c) => isPkgJson(p) && c != null && /"(prepublishOnly|prepack|postpack)"\s*:\s*"[^"]+"/.test(c)
      ? 'npm pack/publish-stage script — runs on publisher machine, not on install' : null,
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
      const m = c.match(/fetch\(|http\.request|require\(['"]https?['"]|axios|\bcurl\s|\bwget\s/)
      return m ? `network indicator: ${m[0]}` : null
    },
  },
  {
    id: 'literal-ip', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const v4 = c.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
      if (v4 && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|192\.168\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(v4[0]))
        return `literal IP ${v4[0]}`
      // IPv6: hex-ish token with ≥2 colons AND ≥1 hex letter (the letter test
      // keeps 12:30:45-style times/ratios out; doc/loopback/ULA excluded too)
      const v6 = c.match(/\b(?=[0-9a-fA-F:]*[a-fA-F])[0-9a-fA-F]*(?::[0-9a-fA-F]*){2,}\b/)
      if (v6 && !/^(::1|::|fe80:|f[cd][0-9a-fA-F]{0,2}:|ff[0-9a-fA-F]{0,2}:|2001:db8:)/i.test(v6[0]))
        return `literal IPv6 ${v6[0]}`
      return null
    },
  },
  {
    id: 'obfuscation', sev: 'high',
    test: (p, c) => {
      // docs legitimately SHOW eval/hex examples — a high-severity hit on a
      // README would fake a red flag and gate the whole version on manual
      // review; only executable surface can obfuscate (same scoping as
      // credential-read)
      if (c == null || !/\.(js|mjs|cjs|ts|mts|cts|sh)$/i.test(p)) return null
      if (/eval\(|new Function/.test(c)) return 'eval/Function usage'
      if (/(\\x[0-9a-fA-F]{2}){8,}/.test(c)) return 'long hex-escaped blob'
      return null
    },
  },
  {
    // split from obfuscation (r3): bare base64 decode is common in legit code —
    // suspicious as a signal, not execution-capable on its own
    id: 'base64-blob', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const m = c.match(/atob\(|Buffer\.from\(['"][A-Za-z0-9+/=]{200,}/)
      return m ? `base64 payload decode: ${m[0].slice(0, 40)}` : null
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
