/** One-off data repair: recompute `features` for every catalog entry under the
 *  Host.resolve-aligned detectFeatures rules (feature-tag logic changed under
 *  the same catalog rows, so a version bump's rescan would never reach dormant
 *  packages — this patch does it directly).
 *
 *  Display slot ← the PINNED latestVersion's packument (registry latest may
 *  have drifted since); pendingUpdate slot ← its own held version. github-kind
 *  → [] (never resolved). Packages without exports+main fall back to one
 *  tarball fetch for the file listing (rare — measured 0/1975 on 2026-11).
 *  Idempotent: writes only when a features set actually changes.
 *
 *  Usage: npx tsx pipeline/re-features.ts <index.json> [--dry] */
import { readFileSync, writeFileSync } from 'node:fs'
import { CatalogIndex } from '../src/schema.ts'
import { detectFeatures } from '../src/features.ts'
import { scanTarball } from './scan/scan.ts'
import { fetchTarball, withTimeout } from './fetch/npm.ts'

interface VerDoc { main?: string; exports?: unknown; dist?: { tarball?: string } }
interface PkDoc { versions?: Record<string, VerDoc> }

export interface ReFeaturesResult {
  changed: string[]
  failed: string[]
  reorderOnly: number
  githubCleared: number
}

export async function main(file: string, opts: { dry?: boolean; fetchFn?: typeof fetch } = {}): Promise<ReFeaturesResult> {
  const dry = opts.dry ?? false
  const f = withTimeout(opts.fetchFn ?? fetch, 15_000)
  const docCache = new Map<string, PkDoc | null>()
  const packument = async (name: string): Promise<PkDoc | null> => {
    if (docCache.has(name)) return docCache.get(name)!
    try {
      const res = await f(`https://registry.npmjs.org/${name.replace('/', '%2f')}`)
      const doc = res.ok ? await res.json() as PkDoc : null
      docCache.set(name, doc)
      return doc
    } catch { docCache.set(name, null); return null }
  }

  const tarFiles = new Map<string, string[]>()
  const filesOf = async (v: VerDoc): Promise<string[]> => {
    const url = v.dist?.tarball
    if (!url) return []
    if (!tarFiles.has(url)) tarFiles.set(url, (await scanTarball(await fetchTarball(url, { fetchFn: f }))).files)
    return tarFiles.get(url)!
  }

  const index = CatalogIndex.parse(JSON.parse(readFileSync(file, 'utf8')))
  const changed: string[] = [], failed: string[] = []
  let reorderOnly = 0, githubCleared = 0   // same-set reorders / github-kind → []
  const same = (a?: string[], b?: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  const sameSet = (a?: string[], b?: string[]) =>
    (a ?? []).length === (b ?? []).length && (a ?? []).every(x => (b ?? []).includes(x))

  const BATCH = 10
  const queue = [...index.plugins]
  for (let i = 0; i < queue.length; i += BATCH) {
    await Promise.all(queue.slice(i, i + BATCH).map(async e => {
      try {
        if (e.source.kind !== 'npm') {
          if ((e.features?.length ?? 0) > 0) { e.features = []; githubCleared++ }
          return
        }
        const doc = await packument(e.name)
        for (const slot of [e, ...(e.pendingUpdate ? [e.pendingUpdate] : [])] as Array<{ version?: string; latestVersion?: string | null; features?: string[] }>) {
          const ver = slot.version ?? slot.latestVersion
          if (!ver) continue
          const v = doc?.versions?.[ver]
          if (!v) { if (slot === e) failed.push(`${e.name}@${ver}`); continue }
          const files = (!v.exports && !v.main) ? await filesOf(v) : undefined
          const next = detectFeatures({ exports: v.exports, main: v.main ?? null, ...(files ? { files } : {}) })
          if (!same(slot.features, next)) {
            if (sameSet(slot.features, next)) reorderOnly++
            else changed.push(`${e.name}@${ver}: [${slot.features}]→[${next}]`)
            slot.features = next
          }
        }
      } catch { failed.push(e.name) }
    }))
  }

  console.log(`re-features: ${changed.length} slot(s) semantic-corrected, ${githubCleared} github-kind emptied, ${reorderOnly} order-normalized, ${failed.length} skipped`)
  changed.slice(0, 30).forEach(c => console.log(`  ${c}`))
  if (changed.length > 30) console.log(`  … +${changed.length - 30} more`)
  if (failed.length) console.log(`  skipped: ${failed.slice(0, 15).join(', ')}${failed.length > 15 ? '…' : ''}`)

  if (!dry) {
    writeFileSync(file, JSON.stringify({ ...index, generatedAt: new Date().toISOString() }, null, 2))
    CatalogIndex.parse(JSON.parse(readFileSync(file, 'utf8')))   // post-write validation
    console.log('index.json written + revalidated')
  } else {
    console.log('(dry — index.json untouched)')
  }
  return { changed, failed, reorderOnly, githubCleared }
}

/* v8 ignore next 6 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  if (!file) { console.error('usage: re-features <index.json> [--dry]'); process.exit(2) }
  main(file, { dry: process.argv.includes('--dry') }).catch(e => { console.error(e); process.exit(1) })
}
