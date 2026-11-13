/** material.ts — CI-side review-material bundle builder.
 *
 *  For every pending target the diagnose daemon will eventually review,
 *  download+extract the tarball HERE (CI bandwidth + memory are free) and
 *  stage the extracted text surface as a small JSON bundle on the catalog
 *  branch (material/<name>@<ver>.json). The daemon then reviews from the
 *  bundle instead of touching npm tarballs — >32MB packages no longer lose
 *  their text review surface to the transport cap.
 *
 *  Lifecycle (kept small by construction):
 *    - per-run build cap (--limit): bundles arrive as fast as the daemon
 *      consumes them, no pile-up
 *    - consumption: the daemon deletes a bundle in the same push that lands
 *      its verdict — files are transient by design
 *    - this script prunes too: files whose name@ver is no longer an
 *      unreviewed target (verdicted / braked / removed) get deleted here,
 *      so the branch stays clean even if the daemon's deletions lag
 *    - sha pin: bundle.sourceSha must equal the registry's CURRENT tarball
 *      sha — a re-tag produces a rebuilt bundle, never a stale review.
 *
 *  No secrets, no LLM — deterministic like the submission prechecks.
 *
 *  Usage: --index <p> --verdicts <p> --outdir <dir> [--limit N=500] [--dry] */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { exit } from 'node:process'
import { CatalogIndex } from '../../src/schema.ts'
import { loadVerdicts } from '../verdicts.ts'
import { isMain } from '../main-guard.ts'
import {
  unreviewedTargets, reviewPin, reviewMaterial, contentMaterial, makePackumentOf,
  materialFileName, type Material, type MaterialBundle,
} from './diagnose.ts'

const BUNDLE_CAP = 512 * 1024 // refuse to stage an oversized bundle — the daemon falls back to live collection

export async function main(argv: string[] = process.argv.slice(2),
  deps: { fetchFn?: typeof fetch | undefined } = {},
): Promise<number> {
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const usage = 'usage: --index <p> --verdicts <p> --outdir <material-dir> [--limit N=500] [--dry]'
  const idxPath = arg('--index'), verdictsPath = arg('--verdicts'), outdir = arg('--outdir')
  if (!idxPath || !verdictsPath || !outdir) { console.error(usage); return 1 }
  const limit = Number(arg('--limit') ?? 500)
  if (!Number.isFinite(limit) || limit < 0) { console.error(usage); return 1 }
  const dry = argv.includes('--dry')
  // CI downloads the tarballs the daemon can't: runner RAM/disk is free, so
  // the transport cap lifts to 512MB (konoha-mcp's 201MB class). The REVIEW
  // budgets inside contentMaterial stay — output bundles stay tiny either way.
  const transportCap = Number(process.env.MATERIAL_TARBALL_CAP ?? 512 * 1024 * 1024)

  const idx = CatalogIndex.parse(JSON.parse(readFileSync(idxPath, 'utf8')))
  const verdicts = loadVerdicts(verdictsPath)
  // `ahead` selection: bundles are built BEFORE verify lands — install
  // evidence and review material then arrive at the daemon together.
  // includeLegacy mirrors the daemon's first-launch sweep: legacy npm
  // entries review their displayed latestVersion under the same name@ver
  // key, so their bundles line up. Self-limiting — once the backfill
  // drains, legacy targets stop appearing and nothing more is built.
  const targets = unreviewedTargets(idx, verdicts, null, { ahead: true, includeLegacy: true })
  const want = new Set(targets.flatMap(e => {
    const pin = reviewPin(e, true)
    return pin ? [materialFileName(e.name, pin)] : []
  }))

  // prune pass — files for keys no longer reviewable die here (covers
  // verdicted/braked/removed entries even when the daemon's own deletion
  // push hasn't landed yet)
  let pruned = 0
  if (existsSync(outdir)) for (const f of readdirSync(outdir)) {
    if (!f.endsWith('.json') || want.has(f)) continue
    if (!dry) unlinkSync(join(outdir, f))
    pruned++
  }

  const pkOf = makePackumentOf(deps.fetchFn)
  let built = 0, kept = 0, oversized = 0, failed = 0
  mkdirSync(outdir, { recursive: true })
  for (const e of targets.slice(0, limit)) {
    const pin = reviewPin(e, true)
    if (!pin) { kept++; continue }
    const gh = e.source?.kind === 'github'
    const fn = materialFileName(e.name, pin)
    try {
      // byte anchor: npm = the registry tarball SRI (a fetch, re-tag aware);
      // github = the resolved commit sha itself — it IS the pinned bytes,
      // no upstream call needed. The codeload URL pins the SAME sha the
      // verdict will record (never a mutable ref).
      let sha: string | undefined | null
      let tarballUrl: string | null
      if (gh) {
        sha = pin
        const repo = /^[\w.-]+\/[\w.-]+$/.test(e.source?.repo ?? e.source?.id ?? '')
          ? (e.source!.repo ?? e.source!.id)! : null
        tarballUrl = repo ? `https://codeload.github.com/${repo}/tar.gz/${pin}` : null
      } else {
        const pk = await pkOf(e.name)
        sha = pk?.integrityOf[pin]
        tarballUrl = pk?.tarballOf[pin] ?? null
      }
      if (!sha) { kept++; continue } // anchor lookup failed — leave any existing bundle for the daemon to judge
      const cur = join(outdir, fn)
      if (existsSync(cur)) {
        try {
          const old = JSON.parse(readFileSync(cur, 'utf8')) as MaterialBundle
          // contentFailed bundles are never "fresh": a transient fetch failure
          // or an over-cap tarball would otherwise pin a contentless shell for
          // that sha forever
          if (old.sourceSha === sha && !old.contentFailed) { kept++; continue } // still fresh — nothing to rebuild
        } catch { /* malformed → rebuild */ }
      }
      // a 'content-error' block (or a thrown failure) = degraded extraction —
      // distinct from an empty [] which is a legitimate "no whitelist files"
      // package. The flag keeps degraded builds out of the freshness check.
      const content = await contentMaterial(e.name, pin, tarballUrl, deps.fetchFn, transportCap).catch(() => null)
      const degraded = content === null || content.some(b => b.id === 'content-error')
      const bundle: MaterialBundle = {
        name: e.name, version: pin, sourceSha: sha,
        builtAt: new Date().toISOString(),
        ...(degraded ? { contentFailed: true } : {}),
        material: [...reviewMaterial(e), ...(content ?? [])],
      }
      const json = JSON.stringify(bundle)
      if (json.length > BUNDLE_CAP) { oversized++; continue }
      if (!dry) writeFileSync(cur, json)
      built++
    } catch (x) { failed++; console.warn(`[material] ${e.name}@${pin} build failed: ${String(x).slice(0, 120)}`) }
  }
  console.log(`[material] targets=${targets.length} built=${built} kept=${kept} pruned=${pruned} oversized=${oversized} failed=${failed}`)
  return 0
}

if (isMain(import.meta.url)) exit(await main())
