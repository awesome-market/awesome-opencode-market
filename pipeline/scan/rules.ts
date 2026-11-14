/** Static scan rules v1 (DEV §3). Read-only analysis — never executes package code. */

/** Bump when rules change — part of the scan cache key; stale findings get re-scanned. */
export const RULESET_VERSION = 'r6'

export type Severity = 'high' | 'medium' | 'low'

/** One rule hit: the human-readable detail PLUS the offending source line —
 *  `rule:file` alone forces a reviewer to re-derive WHERE the trigger sits;
 *  the line itself is the case file (serialized onto flag strings downstream). */
export interface RuleHit {
  detail: string
  /** source line (or a window around the match inside a giant minified
   *  line), trimmed — never spans lines */
  line?: string
  lineNo?: number
}

export interface Rule {
  id: string
  sev: Severity
  /** match against file path + text content (binary files flagged by isBinary separately) */
  test(path: string, content: string | null): RuleHit | null
}

const isPkgJson = (p: string) => /(^|\/)package\.json$/.test(p)

/** Locate the match's line and return a bounded excerpt around it — a
 *  minified single-line bundle would otherwise "excerpt" MBs of nothing
 *  useful, so the window centers on the match, not the line start.
 *  `…` markers disclose truncation. */
export function srcLine(content: string, m: RegExpMatchArray | null): { line: string; lineNo: number } | undefined {
  const i = m?.index
  if (i == null) return undefined
  const start = content.lastIndexOf('\n', i - 1) + 1
  let end = content.indexOf('\n', i)
  if (end < 0) end = content.length
  // count newlines without materializing a prefix copy — files scan up to
  // 32MB and a slice(0,i) per hit is pure GC churn
  let lineNo = 1
  for (let p = content.indexOf('\n'); p >= 0 && p < i; p = content.indexOf('\n', p + 1)) lineNo++
  const lo = Math.max(start, i - 60)
  const hi = Math.min(end, i + m![0].length + 80)
  const line = (lo > start ? '…' : '') + content.slice(lo, hi).trim() + (hi < end ? '…' : '')
  return { line, lineNo }
}

const EXEC_EXT = /\.(js|mjs|cjs|ts|mts|cts|sh)$/i

export const RULES: Rule[] = [
  {
    id: 'lifecycle-script', sev: 'high',
    // install-stage only: these run on the CONSUMER's machine during
    // npm install (prepublish is deprecated but still ran on install in
    // old npm). Pack-stage hooks (prepublishOnly/prepack/postpack) run
    // on the author's machine at publish/pack — downgraded to the
    // medium 'pack-script' rule below; they gated ~half of all
    // lifecycle hits as false positives.
    test: (p, c) => {
      if (!isPkgJson(p) || c == null) return null
      const m = c.match(/"(preinstall|postinstall|install|prepublish)"\s*:\s*"[^"]+"/)
      return m ? { detail: 'npm lifecycle script (install stage) — code runs at install time', ...srcLine(c, m) } : null
    },
  },
  {
    id: 'pack-script', sev: 'medium',
    // runs on npm pack/publish on the publisher's machine, not on
    // consumer install — a maintainer-side supply-chain signal, not a
    // consumer red flag (prepare remains 'high' via its own rule: it
    // DOES run when installing a git/tarball dep)
    test: (p, c) => {
      if (!isPkgJson(p) || c == null) return null
      const m = c.match(/"(prepublishOnly|prepack|postpack)"\s*:\s*"[^"]+"/)
      return m ? { detail: 'npm pack/publish-stage script — runs on publisher machine, not on install', ...srcLine(c, m) } : null
    },
  },
  {
    id: 'prepare-script', sev: 'high',
    test: (p, c) => {
      if (!isPkgJson(p) || c == null) return null
      const m = c.match(/"prepare"\s*:\s*"[^"]+"/)
      return m ? { detail: '"prepare" script — runs on git/tarball install', ...srcLine(c, m) } : null
    },
  },
  {
    id: 'network-call', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const m = c.match(/fetch\(|http\.request|require\(['"]https?['"]|axios|\bcurl\s|\bwget\s/)
      return m ? { detail: `network indicator: ${m[0]}`, ...srcLine(c, m) } : null
    },
  },
  {
    id: 'literal-ip', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const v4 = c.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
      if (v4 && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|192\.168\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(v4[0]))
        return { detail: `literal IP ${v4[0]}`, ...srcLine(c, v4) }
      // IPv6: hex-ish token with ≥2 colons AND ≥1 hex letter (the letter test
      // keeps 12:30:45-style times/ratios out; doc/loopback/ULA excluded too)
      const v6 = c.match(/\b(?=[0-9a-fA-F:]*[a-fA-F])[0-9a-fA-F]*(?::[0-9a-fA-F]*){2,}\b/)
      if (v6 && !/^(::1|::|fe80:|f[cd][0-9a-fA-F]{0,2}:|ff[0-9a-fA-F]{0,2}:|2001:db8:)/i.test(v6[0]))
        return { detail: `literal IPv6 ${v6[0]}`, ...srcLine(c, v6) }
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
      if (c == null || !EXEC_EXT.test(p)) return null
      const e = c.match(/eval\(|new Function/)
      if (e) return { detail: 'eval/Function usage', ...srcLine(c, e) }
      const h = c.match(/(\\x[0-9a-fA-F]{2}){8,}/)
      if (h) return { detail: 'long hex-escaped blob', ...srcLine(c, h) }
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
      return m ? { detail: `base64 payload decode: ${m[0].slice(0, 40)}`, ...srcLine(c, m) } : null
    },
  },
  {
    id: 'credential-read', sev: 'high',
    test: (p, c) => {
      // docs legitimately mention credential paths — only fire on code
      if (c == null || !EXEC_EXT.test(p)) return null
      const m = c.match(/\.ssh|id_rsa|\.aws\/credentials|keychain|\.npmrc|\.netrc/)
      return m ? { detail: `credential-path reference: ${m[0]}`, ...srcLine(c, m) } : null
    },
  },
  {
    id: 'child-process', sev: 'medium',
    test: (_p, c) => {
      if (c == null) return null
      const m = c.match(/child_process|execSync|spawnSync|\bspawn\(|\bexec\(/)
      return m ? { detail: 'spawns child processes', ...srcLine(c, m) } : null
    },
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
