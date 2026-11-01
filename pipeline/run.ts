/** Daily pipeline orchestrator: discover → fetch → scan → assemble entries → merge+gate → index.json */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverNpm } from './discover/npm.ts'
import { discoverGithub, normalizeRepoUrl } from './discover/github.ts'
import { preAdmit, looksLikeTemplateSpam, hasPluginEvidence } from './discover/filter.ts'
import { fetchPackument, fetchTarball, fetchDownloads30d } from './fetch/npm.ts'
import { fetchRepoMeta, repoFileExists } from './fetch/github.ts'
import { scanTarball } from './scan/scan.ts'
import { buildIndex } from './publish/merge.ts'
import { slugOf } from './publish/slug.ts'
import { CatalogIndex, type PluginEntry } from '../src/schema.ts'

export interface RunOptions {
  seedPath?: string | undefined
  oldIndexPath?: string | undefined
  outPath?: string | undefined
  ghToken?: string | undefined
  maxEntries?: number | undefined
  now?: string | undefined
  fetchFn?: typeof fetch | undefined
}

export function loadOldIndex(path?: string): CatalogIndex | null {
  if (!path) return null
  try {
    return CatalogIndex.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export async function run(opts: RunOptions = {}) {
  const f = opts.fetchFn ?? fetch
  const now = opts.now ?? new Date().toISOString()
  const old = loadOldIndex(opts.oldIndexPath)

  // 1. discover (+ optional seed file: one npm name or github:owner/repo per line)
  const [npmCands, ghCands] = await Promise.all([
    discoverNpm(undefined, { fetchFn: f }),
    discoverGithub(undefined, { token: opts.ghToken, fetchFn: f }),
  ])
  if (opts.seedPath) {
    const lines = readFileSync(opts.seedPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    for (const name of lines.filter(l => !l.startsWith('github:'))) {
      if (!npmCands.has(name)) npmCands.set(name, {
        name, version: '', description: '', keywords: [], repoUrl: null, publishedAt: null,
        discoveredVia: ['submission' as const],
      } as never)
    }
    console.log(`seed: ${lines.length} entries injected`)
  }
  console.log(`discover: ${npmCands.size} npm + ${ghCands.size} github candidates`)

  // 2. cheap admission filters
  // npm candidates carry no archived/fork signals — preAdmit applies to GitHub side only
  const npmList = [...npmCands.values()]
  const ghList = [...ghCands.values()].filter(c =>
    preAdmit({ name: c.fullName, repoUrl: c.fullName, archived: c.archived, fork: c.fork }).admit)
  const byOwner = new Map<string, string[]>()
  for (const c of npmList) {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0] ?? c.name.split('/')[0]!
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), c.name])
  }
  const spamOwners = new Set([...byOwner.entries()].filter(([, ns]) => looksLikeTemplateSpam(ns)).map(([o]) => o))
  const admitted = npmList.filter(c => {
    const owner = normalizeRepoUrl(c.repoUrl)?.split('/')[0] ?? c.name.split('/')[0]!
    return !spamOwners.has(owner)
  })
  console.log(`admitted: ${admitted.length} npm + ${ghList.length} github (spam owners: ${spamOwners.size})`)

  // 3. fetch + evidence gate + scan — concurrent batches of 10 (serial was too slow for CI budget)
  const entries: PluginEntry[] = []
  const limit = opts.maxEntries ?? 500
  const queue = admitted.slice(0, limit)
  const worker = async (cand: (typeof admitted)[number]) => {
    try {
      const pk = await fetchPackument(cand.name, { fetchFn: f })
      if (!pk) return
      const ev = hasPluginEvidence({ keywords: pk.keywords, main: pk.main ?? undefined, exports: pk.exports })
      if (!ev.ok) return

      const repo = normalizeRepoUrl(pk.repository)
      let scan = { scannedAt: null as string | null, findings: [] as string[], redFlags: [] as string[] }
      if (pk.tarballUrl) {
        try {
          const tgz = await fetchTarball(pk.tarballUrl, { fetchFn: f })
          const r = await scanTarball(tgz)
          scan = {
            scannedAt: now,
            findings: r.findings.map(x => `${x.rule}:${x.file}`),
            redFlags: r.redFlags.map(x => `${x.rule}:${x.file}`),
          }
        } catch (e) {
          console.warn(`scan failed ${cand.name}:`, (e as Error).message)
        }
      }

      const repoMeta = repo ? await fetchRepoMeta(repo, { token: opts.ghToken, fetchFn: f }) : null
      const downloads = await fetchDownloads30d(cand.name, { fetchFn: f })
      const hasSkill = repo ? await repoFileExists(repo, 'SKILL.md', { token: opts.ghToken, fetchFn: f }) : false

      const entry: PluginEntry = {
        name: cand.name,
        slug: slugOf({ repo: repo ?? undefined, npmName: cand.name }),
        aliases: [],
        type: 'plugin',
        ...(hasSkill ? { contains: ['skill' as const] } : {}),
        discoveredVia: cand.discoveredVia as PluginEntry['discoveredVia'],
        source: { kind: 'npm', id: cand.name, ...(repo ? { repo } : {}), ...(pk.latest ? { version: pk.latest } : {}) },
        description: { en: cand.description },
        category: [],
        license: pk.license ?? repoMeta?.license ?? null,
        deprecated: pk.deprecated,
        replacement: null,
        firstSeenAt: now,
        latestVersion: pk.latest,
        publishedAt: pk.latestPublishedAt,
        metrics: { stars: repoMeta?.stars ?? null, npmDownloads30d: downloads, checkedAt: now },
        capabilities: scan,
        verification: scan.redFlags.length > 0
          ? { status: 'skipped', level: 'install' }
          : { status: 'unverified' },
        compat: {},
      }
      entries.push(entry)
      console.log(`  [${entries.length}] ${cand.name}`)
    } catch (e) {
      console.warn(`candidate ${cand.name} failed:`, (e as Error).message)
    }
  }
  const BATCH = 10
  for (let i = 0; i < queue.length; i += BATCH) {
    await Promise.all(queue.slice(i, i + BATCH).map(worker))
  }

  // 4. build index (merge + corruption gate)
  const { index, gate } = buildIndex(entries, old, { opencodeVersion: '2.2.5', now })
  if (!gate.ok) throw new Error(`publish gate: ${gate.reason}`)

  // 5. write
  const out = opts.outPath ?? 'dist/index.json'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(index, null, 2))
  console.log(`index.json: ${index.plugins.length} entries → ${out}`)
  return index
}

// CLI entry (untestable in vitest — excluded from coverage)
/* v8 ignore next 10 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
  run({
    ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    outPath: arg('--out'),
    oldIndexPath: arg('--old'),
    seedPath: arg('--seed'),
    ...(arg('--max') ? { maxEntries: Number(arg('--max')) } : {}),
  }).catch(e => { console.error(e); process.exit(1) })
}
