/** Static scan rules v1 (DEV §3). Read-only analysis — never executes package code. */

/** Bump when rules change — part of the scan cache key; stale findings get
 *  re-scanned. This is ALSO the admission-gate epoch: the incremental reuse
 *  short-circuit keys on it, so tightening discover/filter.ts without a bump
 *  leaves previously-admitted entries reuse-skipping the new gate forever
 *  (the foreign-host demotion shipped under r9 proved this — r9-stamped
 *  rescan entries kept their slots without ever facing the gate). */
export const RULESET_VERSION = 'r10'

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
  /** per-hit severity override — the same token means different things in a
   *  shipping entry point vs a test fixture; context demotes high→medium
   *  (stays a finding, stops forcing a human slot) without hiding the hit */
  sev?: Severity
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

/** Files that never sit on the install/runtime path — tests, fixtures,
 *  mocks, examples, docs. A high-severity hit there gates the release on
 *  a human slot over content that cannot execute on the consumer; the
 *  triage backlog showed ~half of all flags were exactly this. The hit
 *  stays a finding (visible), just not a red flag. */
export const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|spec|testing|e2e|fixtures?|mocks?|examples?|demos?|docs?|testdata|test[-_]data)\//i
const TEST_FILE = /[._-](test|spec|stories)\.[^/]+$/i
export const testPath = (p: string): boolean => TEST_PATH.test(p) || TEST_FILE.test(p)

/** The matching line + the match's offset within it — inertness checks need
 *  the real line, not srcLine's clipped excerpt. */
const lineOf = (c: string, i: number): { text: string; off: number } => {
  const s = c.lastIndexOf('\n', i - 1) + 1
  let e = c.indexOf('\n', i)
  if (e < 0) e = c.length
  return { text: c.slice(s, e), off: s }
}

/** Deny/guard-table context — a credential token inside a FORBIDDEN /
 *  EXCLUDE / sensitive-pattern list is the guard doing its job
 *  (workspace-read-broker, FORBIDDEN_GRANT_PATTERN), not a read. */
const DENY_LINE = /FORBIDDEN|EXCLUD|deny|blocklist|sensitive|SANITIZ|protect|BASENAME_PATTERN|GRANT_PATTERN|cannot be (committed|read|granted)|DETECT|signature/i

/** The token is descriptive rather than operational: inside a // or block
 *  comment, inside a guard/deny-pattern table, or inside a quoted string
 *  that is NOT a bare path — quoted content containing whitespace or
 *  shell/regex syntax ('cat ~/.ssh/id_rsa', 'eval(String.fromCharCode(..))')
 *  is an example command, a detection signature, or a test case, not a path
 *  being opened. Bare path strings ('~/.ssh/id_rsa', '.npmrc') contain none
 *  of those characters and keep their severity — writing/reading that
 *  literal path is the real signal. */
const inertRef = (c: string, m: RegExpMatchArray): boolean => {
  const i = m.index!
  const { text: line, off } = lineOf(c, i)
  const li = i - off
  const before = line.slice(0, li)
  if (/\/\/|\/\*/.test(before)) return true
  if (DENY_LINE.test(line)) return true
  // inside an unclosed quoted string? count parity per quote type — an
  // odd count means the last quote of that type opened a string that
  // contains the match (a closed earlier string must NOT demote:
  // `const a='x'; eval('run()')` stays a real hit)
  for (const q of ["'", '"', '`']) {
    const pos = before.lastIndexOf(q)
    if (pos < 0 || (before.split(q).length - 1) % 2 === 0) continue
    const rq = line.indexOf(q, li + m[0].length)
    if (rq < 0) return false
    return /[\s()|\\]/.test(line.slice(pos + 1, rq))
  }
  return false
}

/** severity override honoring both non-execution paths and inert context. */
const demoted = (p: string, c: string, m: RegExpMatchArray): { sev: 'medium' } | Record<never, never> =>
  testPath(p) || inertRef(c, m) ? { sev: 'medium' } : {}

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
      // a fixture package.json under test/ is a test asset, not the shipped
      // manifest — keep as finding, don't gate on it
      return m ? { detail: 'npm lifecycle script (install stage) — code runs at install time',
        ...(testPath(p) ? { sev: 'medium' as const } : {}), ...srcLine(c, m) } : null
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
      return m ? { detail: '"prepare" script — runs on git/tarball install',
        ...(testPath(p) ? { sev: 'medium' as const } : {}), ...srcLine(c, m) } : null
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
      if (v4) {
        // octet + context validity — \d{1,3} alone matches version pins
        // (opencv-python==4.9.0.80), UA strings (Chrome/131.0.0.0), RFC
        // section numbers (§6.2.2.1), OIDs, and SVG path soup, none of
        // which are addresses. Octets must be ≤255, the token must not be
        // glued to a longer dotted number, and version/host context
        // (==v, /v, -v, RFC §) demotes the hit out entirely.
        const o = v4[0].split('.').map(Number)
        const i = v4.index!
        const pre = c.slice(Math.max(0, i - 30), i)
        const post = c.slice(i + v4[0].length, i + v4[0].length + 8)
        const valid = o.every(x => x <= 255)
          && !/[\d.]$/.test(pre) && !/^\.[\dA-Za-z]/.test(post)
          && !/[-=~§]$/.test(pre) && !/[A-Za-z]\/$/.test(pre) && !/==\s*$/.test(pre)
          && !/(RFC|rfc|§|version|v\.?|Chapter|sec(tion)?\.?|clause)\s*$/.test(pre)
        if (valid && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.0\.2\.|192\.168\.|198\.51\.100\.|203\.0\.113\.|255\.|22[4-9]\.|23[0-9]\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(v4[0]))
          return { detail: `literal IP ${v4[0]}`, ...srcLine(c, v4) }
      }
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
      if (e) {
        const i = e.index!
        const pre = c.slice(Math.max(0, i - 15), i)
        // identifier suffix / member call / method definition — `myeval(`,
        // `page.eval(`, `eval(args, ctx) {` — the DANGEROUS form is bare
        // global eval; x.eval() is usually CDP/schema/jexl-style APIs
        if (/[A-Za-z_$.]$/.test(pre) || /\beval\s*\([^)]*\)\s*\{/.test(lineOf(c, i).text))
          return { detail: 'eval as identifier/method name', sev: 'medium', ...srcLine(c, e) }
        // schema/template codegen & the globalThis polyfill — ajv's
        // compiled validators, multi-arg new Function("a","b",body), and
        // new Function('return this') are everywhere; keep the hit as a
        // finding, drop the flag. Single-arg new Function(payload) is the
        // form that smells like a payload and stays high.
        if (/new Function\s*\(\s*[`'"]return this/.test(c)
          || /new Function\s*\([^)]*,[^)]*,/.test(c)
          || /ajv|schemastery|schema\.callback|code\.process|makeValidate|jsonata|expr[.-]?eval|mathjs|jexl/i.test(lineOf(c, i).text))
          return { detail: 'eval/Function codegen (schema/template/polyfill)', sev: 'medium', ...srcLine(c, e) }
        // inertRef demotion: 'eval(String.fromCharCode(114,109))' inside a
        // detection-signature table / comment is a string ABOUT eval
        return { detail: 'eval/Function usage', ...demoted(p, c, e), ...srcLine(c, e) }
      }
      // \x and \\x escape runs both — iconv tables and packed strings are
      // written \\xNN, smuggled payloads often plain \xNN
      const h = c.match(/(\\\\?x[0-9a-fA-F]{2}){8,}/)
      if (h) {
        // regex char-class runs (/[\x01-\x1f...]/) and iconv/encoding
        // tables (chars:"\\x80\\x81…", _sbcs/_dbcs) are data, not payloads
        const { text: hline } = lineOf(c, h.index!)
        if (/chars\s*[:=]|_sbcs|_dbcs|iconv|encoding|\/\[|\]\/g|new RegExp|\\u/i.test(hline))
          return { detail: 'hex escapes in regex/encoding table', sev: 'medium', ...srcLine(c, h) }
        return { detail: 'long hex-escaped blob',
          ...(testPath(p) ? { sev: 'medium' as const } : {}), ...srcLine(c, h) }
      }
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
      // .ssh needs a boundary — '.ssh-runtime-manifest.json' is a product's
      // own file name, not the credential dir; '.ssh/' and '~/.ssh' match
      const m = c.match(/\.ssh(?![\w-])|id_rsa|\.aws\/credentials|keychain|\.npmrc|\.netrc/)
      return m ? { detail: `credential-path reference: ${m[0]}`, ...demoted(p, c, m), ...srcLine(c, m) } : null
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

/** Resource/asset dirs — blobs there are shipped data (fonts, audio,
 *  fixtures, vendored blobs), not smuggled payloads. Same demotion
 *  philosophy as testPath: finding yes, red flag no. */
export const ASSET_PATH =
  /(^|\/)(__pycache__|assets?|sfx|sounds?|fonts?|media|static|public|resources?|img|images?|icons?|vendor|third[-_]?party|deps|extern|learning|i18n|locales?|spell|data)\//i

/** Magic-byte sniffing for the binary-blob rule — a recognizable container
 *  is unscannable but explained; an unknown blob stays high. Covers the
 *  formats the review backlog actually contained: sqlite WAL, pyc, vim
 *  spell, .lnk, ogg/flac/id3 audio, fonts, utf-16 text. */
export function knownBinaryMagic(buf: Buffer): string | null {
  const h = (m: number[]) => m.every((b, i) => buf[i] === b)
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return 'utf16-text'
  if (buf.length >= 4 && buf[0] === 0x37 && buf[1] === 0x7f && (buf[2] === 0x06) && (buf[3] === 0x82 || buf[3] === 0x83)) return 'sqlite-wal'
  const pairs: [number[] | Buffer, string][] = [
    [Buffer.from('SQLite format 3\0', 'latin1'), 'sqlite'],
    [Buffer.from('\0asm', 'latin1'), 'wasm'],
    [[0x7f, 0x45, 0x4c, 0x46], 'elf'],
    [[0x4d, 0x5a], 'pe'],
    [[0x50, 0x4b, 0x03, 0x04], 'zip'],
    [[0x1f, 0x8b], 'gzip'],
    [[0x89, 0x50, 0x4e, 0x47], 'png'],
    [[0xff, 0xd8, 0xff], 'jpeg'],
    [Buffer.from('GIF8', 'latin1'), 'gif'],
    [Buffer.from('RIFF', 'latin1'), 'riff'],
    [Buffer.from('OggS', 'latin1'), 'ogg'],
    [Buffer.from('fLaC', 'latin1'), 'flac'],
    [Buffer.from('ID3', 'latin1'), 'mp3'],
    [Buffer.from('OTTO', 'latin1'), 'otf'],
    [Buffer.from('wOFF', 'latin1'), 'woff'],
    [Buffer.from('wOF2', 'latin1'), 'woff2'],
    [Buffer.from('true', 'latin1'), 'ttf'],
    [Buffer.from('\xca\xfe\xba\xbe', 'latin1'), 'class/fat-macho'],
    [[0xfe, 0xed, 0xfa], 'mach-o'], [[0xce, 0xfa, 0xed, 0xfe], 'mach-o'], [[0xcf, 0xfa, 0xed, 0xfe], 'mach-o'],
    [[0xfd, 0x37, 0x7a, 0x58, 0x5a], 'xz'],
    [[0x28, 0xb5, 0x2f, 0xfd], 'zstd'],
    [Buffer.from('BZh', 'latin1'), 'bzip2'],
    [Buffer.from('VIMsug', 'latin1'), 'vim-spell'],
    [[0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02], 'lnk'],
    [Buffer.from('PDLP', 'latin1'), 'pdl'],
    [Buffer.from('CPFONT', 'latin1'), 'cpfont'],
    [[0x00, 0x00, 0x01, 0x00], 'ico'],
  ]
  for (const [m, k] of pairs) if (buf.length >= m.length && h([...m] as number[])) return k
  if (buf.length > 262 && buf.subarray(257, 262).toString('latin1') === 'ustar') return 'tar'
  return null
}

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
