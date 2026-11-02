#!/usr/bin/env node
// Catalog schema gate (dsh validate-registry.mjs analog): node scripts/validate-registry.mjs [index.json]
import { readFileSync } from 'node:fs'
const idx = JSON.parse(readFileSync(process.argv[2] ?? 'index.json', 'utf8'))
const errs = []
if (!idx.version) errs.push('missing version')
if (!Array.isArray(idx.plugins)) errs.push('plugins not array')
const seen = new Set()
for (const [i, p] of (idx.plugins ?? []).entries()) {
  if (!p.name) errs.push(`[${i}] no name`)
  if (!p.slug) errs.push(`[${i} ${p.name}] no slug`)
  if (seen.has(p.name)) errs.push(`dup name ${p.name}`)
  seen.add(p.name)
  const st = p.verification?.status
  if (st && !['verified','failed','unverified','skipped'].includes(st)) errs.push(`[${p.name}] bad status ${st}`)
}
if (errs.length) { console.error(`${errs.length} errors`); errs.slice(0,20).forEach(e => console.error(' -', e)); process.exit(1) }
console.log(`ok: ${idx.plugins.length} entries`)
