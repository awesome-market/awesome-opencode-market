/** Tarball scan driver: unpack .tgz in memory, apply rules per file. */
import { Readable } from 'node:stream'
import { t as tarList } from 'tar'
import { RULES, isBinary, knownBinaryMagic, testPath, ASSET_PATH, type Severity } from './rules.ts'

export interface ScanFinding {
  rule: string
  severity: Severity
  file: string
  detail: string
  /** offending source line + number — the human-review case file; rules
   *  report it via srcLine so flag strings can carry the actual trigger */
  line?: string
  lineNo?: number
}

/** Serialize a finding for capabilities.findings/redFlags — `rule:file`
 *  plus, when the rule located it, ` — L<no>: <code>` evidence. Keep the
 *  prefix byte-compatible: ruleOf() (first `:`), sec:/sec-delta: prefix
 *  checks, and findings↔redFlags string equality all read the head only.
 *  Evidence is package source — already public bytes, bounded by srcLine. */
export const fmtFinding = (x: ScanFinding, strip: (p: string) => string = p => p): string =>
  `${x.rule}:${strip(x.file)}${x.lineNo != null ? ` — L${x.lineNo}: ${x.line}` : ''}`

export interface ScanResult {
  findings: ScanFinding[]
  redFlags: ScanFinding[]          // severity === 'high'
  fileCount: number
  files: string[]                  // all tarball paths — conventional-name
                                   // entrypoint resolution (Host.resolve parity)
}

const TEXT_EXT = /\.(js|mjs|cjs|ts|mts|cts|json|md|txt|yml|yaml|sh|toml)$/i
/** Benign media/doc assets — shipping these is normal, not a binary-blob signal. */
const MEDIA_EXT = /\.(png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|otf|eot|pdf|mp4|webm|mp3|wav)$/i
/** Well-known runtime binary payloads — a wasm/native blob is common in real
 *  plugins (tree-sitter, oniguruma, sqlite, esbuild). Still uninspectable, so
 *  it stays a finding — just not a high-severity one (high → verification
 *  skipped → every such release would need a human pass, FP-diluting the flag). */
const KNOWN_BIN_EXT = /\.(wasm|node|dll|so|dylib|exe|bin|dat|so\.[0-9]+)$/i

/** Zip-bomb guard: the fetch cap bounds the COMPRESSED tarball (64MB), not what
 *  it inflates to. A 64MB gzip can decompress to GBs — track cumulative bytes
 *  and abort the scan rather than OOM the generate job. */
const MAX_UNPACKED = 512 * 1024 * 1024
/** Findings ceiling — a pathological package (10k files, all matching) would
 *  otherwise write an unbounded array into index.json. */
const MAX_FINDINGS = 500
/** Member-count ceiling — a tarball of millions of zero-byte files stays under
 *  the byte cap but would still OOM the files[] bookkeeping (F-1). */
const MAX_FILES = 200_000
/** Per-file text ceiling: bufCap was Infinity for text, so one ~500MB
 *  minified bundle would be buffered whole AND utf8-decoded (×pool workers
 *  ≈ several GB on a 16GB runner). Scan the head and disclose the truncation
 *  as a finding instead — rules still cover the part that matters (package
 *  manifests, entry modules), and the signal is honest rather than silent. */
const MAX_TEXT_SCAN = 32 * 1024 * 1024

export async function scanTarball(tgz: Buffer, maxFiles = MAX_FILES): Promise<ScanResult> {
  const findings: ScanFinding[] = []
  const files: string[] = []
  let fileCount = 0, unpacked = 0, capped = false
  const pushFinding = (f: ScanFinding) => {
    if (findings.length < MAX_FINDINGS) findings.push(f)
    else if (!capped) {
      capped = true
      findings.push({ rule: 'scan-capped', severity: 'low', file: '(index)', detail: `findings truncated at ${MAX_FINDINGS}` })
    }
  }
  await new Promise<void>((resolve, reject) => {
    // tar.t (list) parses IN MEMORY — tar.x/extract would write every entry
    // to process.cwd() (the CI workspace / dev checkout): untrusted package
    // trees on disk, and the 512MB unpacked guard only stops the PARSER —
    // Unpack's disk writes would already have happened. Same onentry API.
    const parser = tarList({
      onentry(entry) {
        if (entry.type !== 'File') { entry.resume(); return }
        // skip macOS AppleDouble metadata (._*) — tar artifact, not package content
        if (/(^|\/)\._/.test(entry.path)) { entry.resume(); return }
        fileCount++
        if (fileCount > maxFiles) {
          parser.abort(new Error(`file count exceeds ${maxFiles} — possible tar bomb`))
          return
        }
        files.push(entry.path)
        const path = entry.path
        // Buffer only what the checks need: media assets are binary-by-design
        // and exempt from the blob rule (never buffered at all); non-text
        // files only need isBinary's 8KB window; text needs the whole file —
        // up to MAX_TEXT_SCAN, beyond which the head is scanned and the
        // truncation disclosed (see MAX_TEXT_SCAN).
        const skipBody = MEDIA_EXT.test(path)
        const isText = TEXT_EXT.test(path) || isPkgJson(path)
        const oversizeText = isText && entry.size > MAX_TEXT_SCAN
        const bufCap = oversizeText ? MAX_TEXT_SCAN : isText ? Infinity : 8192
        const chunks: Buffer[] = []
        let buffered = 0
        entry.on('data', (c: Buffer) => {
          unpacked += c.length
          if (unpacked > MAX_UNPACKED) parser.abort(new Error(`unpacked size exceeds ${MAX_UNPACKED} — possible zip bomb`))
          if (!skipBody && buffered < bufCap) {
            chunks.push(c.subarray(0, bufCap - buffered))
            buffered += c.length
          }
        })
        entry.on('end', () => {
          if (skipBody) return
          if (oversizeText) {
            pushFinding({
              rule: 'text-truncated', severity: 'medium', file: path,
              detail: `text file exceeds ${MAX_TEXT_SCAN}-byte scan cap — rules ran on the first ${MAX_TEXT_SCAN} bytes only`,
            })
          }
          const buf = Buffer.concat(chunks)
          if (isBinary(buf)) {
            // recognizable container / test fixture / asset dir — same
            // demotion logic as known runtime binaries: finding, not a
            // red flag. The magic string doubles as the explanation.
            const magic = knownBinaryMagic(buf)
            const known = KNOWN_BIN_EXT.test(path) || testPath(path) || ASSET_PATH.test(path) || magic !== null
            pushFinding({
              rule: 'binary-blob', severity: known ? 'medium' : 'high', file: path,
              detail: magic ? `recognized binary format (${magic}) — unscannable`
                : known ? 'binary asset in a resource/test path — unscannable'
                : 'binary file in package',
            })
            return
          }
          const text = isText ? buf.toString('utf8') : null
          for (const r of RULES) {
            const hit = r.test(path, text)
            if (hit) pushFinding({
              // hit.sev — per-hit context demotion (test path / comment /
              // descriptive string); falls back to the rule's own severity
              rule: r.id, severity: hit.sev ?? r.sev, file: path, detail: hit.detail,
              ...(hit.line !== undefined ? { line: hit.line } : {}),
              ...(hit.lineNo !== undefined ? { lineNo: hit.lineNo } : {}),
            })
          }
        })
      },
    })
    parser.on('end', resolve)
    parser.on('error', reject)
    Readable.from(tgz).pipe(parser)
  })
  return { findings, redFlags: findings.filter(f => f.severity === 'high'), fileCount, files }
}

const isPkgJson = (p: string) => /(^|\/)package\.json$/.test(p)
