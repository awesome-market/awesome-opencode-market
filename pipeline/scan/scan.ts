/** Tarball scan driver: unpack .tgz in memory, apply rules per file. */
import { Readable } from 'node:stream'
import { extract } from 'tar'
import { RULES, isBinary, type Severity } from './rules.ts'

export interface ScanFinding {
  rule: string
  severity: Severity
  file: string
  detail: string
}

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
    const parser = extract({
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
        const chunks: Buffer[] = []
        entry.on('data', (c: Buffer) => {
          chunks.push(c)
          unpacked += c.length
          if (unpacked > MAX_UNPACKED) parser.abort(new Error(`unpacked size exceeds ${MAX_UNPACKED} — possible zip bomb`))
        })
        entry.on('end', () => {
          const buf = Buffer.concat(chunks)
          const path = entry.path
          if (isBinary(buf)) {
            if (!MEDIA_EXT.test(path)) {
              pushFinding({ rule: 'binary-blob', severity: 'high', file: path, detail: 'binary file in package' })
            }
            return
          }
          const text = TEXT_EXT.test(path) || isPkgJson(path) ? buf.toString('utf8') : null
          for (const r of RULES) {
            const detail = r.test(path, text)
            if (detail) pushFinding({ rule: r.id, severity: r.sev, file: path, detail })
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
