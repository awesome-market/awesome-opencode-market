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

export async function scanTarball(tgz: Buffer): Promise<ScanResult> {
  const findings: ScanFinding[] = []
  const files: string[] = []
  let fileCount = 0
  await new Promise<void>((resolve, reject) => {
    const parser = extract({
      onentry(entry) {
        if (entry.type !== 'File') { entry.resume(); return }
        // skip macOS AppleDouble metadata (._*) — tar artifact, not package content
        if (/(^|\/)\._/.test(entry.path)) { entry.resume(); return }
        fileCount++
        files.push(entry.path)
        const chunks: Buffer[] = []
        entry.on('data', (c: Buffer) => chunks.push(c))
        entry.on('end', () => {
          const buf = Buffer.concat(chunks)
          const path = entry.path
          if (isBinary(buf)) {
            if (!MEDIA_EXT.test(path)) {
              findings.push({ rule: 'binary-blob', severity: 'high', file: path, detail: 'binary file in package' })
            }
            return
          }
          const text = TEXT_EXT.test(path) || isPkgJson(path) ? buf.toString('utf8') : null
          for (const r of RULES) {
            const detail = r.test(path, text)
            if (detail) findings.push({ rule: r.id, severity: r.sev, file: path, detail })
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
